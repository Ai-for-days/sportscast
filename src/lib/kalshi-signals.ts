// ── Kalshi Signal Engine & Paper Trading ─────────────────────────────────────
//
// Compares Kalshi market-implied probabilities against our consensus forecast
// model to identify edges, then manages paper trades in Redis.

import { getRedis } from './redis';
import { getConsensusForecast } from './forecast-consensus';
import { fetchKalshiWeatherMarkets, KALSHI_CONFIG } from './kalshi';
import type { KalshiMarket } from './kalshi';
import { mapAllMarkets } from './kalshi-market-mapper';
import type { MappedMarket } from './kalshi-market-mapper';

// ── Types ───────────────────────────────────────────────────────────────────

export interface KalshiSignal {
  ticker: string;
  title: string;
  locationName?: string;
  metric?: string;
  targetDate?: string;
  threshold?: number;
  marketProbYes: number;
  marketProbNo: number;
  modelProbYes: number;
  modelProbNo: number;
  edgeYes: number;
  edgeNo: number;
  recommendedSide: 'yes' | 'no' | 'none';
  confidence: 'low' | 'medium' | 'high';
  mapped: boolean;
  reason?: string;
}

export interface PaperTrade {
  id: string;
  createdAt: string;
  ticker: string;
  title: string;
  side: 'yes' | 'no';
  entryPrice: number;
  modelProb: number;
  marketProb: number;
  edge: number;
  confidence: string;
  stakeCents: number;
  status: 'open' | 'settled' | 'cancelled';
  settlementPrice?: number;
  pnlCents?: number;
  notes?: string;
}

// ── Gaussian CDF (Abramowitz & Stegun approximation) ────────────────────────

/**
 * Approximates the standard normal CDF using the Abramowitz & Stegun
 * formula 7.1.26 (rational approximation). Maximum error ~1.5e-7.
 */
function normalCdf(x: number): number {
  // Constants for the A&S approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Computes P(X >= threshold) given a Gaussian distribution N(mu, sigma).
 */
function probAboveThreshold(threshold: number, mu: number, sigma: number): number {
  if (sigma <= 0) return mu >= threshold ? 1 : 0;
  const z = (threshold - mu) / sigma;
  return 1 - normalCdf(z);
}

// ── Signal Generation ───────────────────────────────────────────────────────

/**
 * Generates a trading signal for a single mapped Kalshi market by comparing
 * the market-implied probability against our consensus forecast model.
 */
export async function generateSignal(mapped: MappedMarket): Promise<KalshiSignal> {
  const base: Partial<KalshiSignal> = {
    ticker: mapped.ticker,
    title: mapped.title,
    locationName: mapped.locationName || undefined,
    metric: mapped.metric || undefined,
    targetDate: mapped.targetDate || undefined,
    threshold: mapped.threshold || undefined,
  };

  // If market wasn't successfully mapped, we can't generate a meaningful signal
  if (!mapped.mapped) {
    return {
      ...base,
      marketProbYes: 0,
      marketProbNo: 0,
      modelProbYes: 0,
      modelProbNo: 0,
      edgeYes: 0,
      edgeNo: 0,
      recommendedSide: 'none',
      confidence: 'low',
      mapped: false,
      reason: 'Market could not be mapped to forecast system',
    } as KalshiSignal;
  }

  // Market-implied probability (Kalshi prices are in cents 1-99)
  const yesPrice = mapped.yesPrice ?? 50;
  const marketProbYes = yesPrice / 100;
  const marketProbNo = 1 - marketProbYes;

  // Get our consensus forecast
  const consensus = await getConsensusForecast(
    mapped.locationName,
    mapped.metric,
    mapped.targetDate,
  );

  if (!consensus) {
    return {
      ...base,
      marketProbYes,
      marketProbNo,
      modelProbYes: 0,
      modelProbNo: 0,
      edgeYes: 0,
      edgeNo: 0,
      recommendedSide: 'none',
      confidence: 'low',
      mapped: false,
      reason: 'No forecast data',
    } as KalshiSignal;
  }

  // Compute model probability using Gaussian CDF
  // For high_temp / low_temp: P(metric >= threshold)
  const mu = consensus.weightedMean;
  const sigma = Math.max(consensus.stdDev, 0.5); // floor sigma to avoid division by zero
  const modelProbYes = probAboveThreshold(mapped.threshold, mu, sigma);
  const modelProbNo = 1 - modelProbYes;

  // Compute edge
  const edgeYes = modelProbYes - marketProbYes;
  const edgeNo = modelProbNo - marketProbNo;

  // Determine recommended side based on edge threshold
  const minEdge = KALSHI_CONFIG.minEdgeThreshold;
  let recommendedSide: 'yes' | 'no' | 'none' = 'none';
  if (edgeYes >= minEdge && edgeYes >= edgeNo) {
    recommendedSide = 'yes';
  } else if (edgeNo >= minEdge && edgeNo > edgeYes) {
    recommendedSide = 'no';
  }

  // Confidence based on absolute edge magnitude
  const maxEdge = Math.max(Math.abs(edgeYes), Math.abs(edgeNo));
  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (maxEdge > 0.15) confidence = 'high';
  else if (maxEdge > 0.08) confidence = 'medium';

  return {
    ...base,
    marketProbYes: Math.round(marketProbYes * 10000) / 10000,
    marketProbNo: Math.round(marketProbNo * 10000) / 10000,
    modelProbYes: Math.round(modelProbYes * 10000) / 10000,
    modelProbNo: Math.round(modelProbNo * 10000) / 10000,
    edgeYes: Math.round(edgeYes * 10000) / 10000,
    edgeNo: Math.round(edgeNo * 10000) / 10000,
    recommendedSide,
    confidence,
    mapped: true,
  } as KalshiSignal;
}

/**
 * Fetches all weather markets, maps them, and generates signals for each.
 */
export async function generateAllSignals(): Promise<KalshiSignal[]> {
  const markets = await fetchKalshiWeatherMarkets();
  const mapped = mapAllMarkets(markets);
  const signals = await Promise.all(mapped.map(generateSignal));
  return signals;
}

// ── Paper Trade CRUD ────────────────────────────────────────────────────────

const PAPER_TRADE_KEY_PREFIX = 'kalshi:paper-trade:';
const PAPER_TRADES_SORTED_SET = 'kalshi:paper-trades:all';

function generateTradeId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `pt_${ts}_${rand}`;
}

/**
 * Creates a new paper trade from a signal.
 */
export async function createPaperTrade(
  signal: KalshiSignal,
  side: 'yes' | 'no',
  stakeCents: number,
  notes?: string,
): Promise<PaperTrade> {
  const redis = getRedis();
  const id = generateTradeId();
  const now = new Date().toISOString();

  const entryPrice = side === 'yes' ? signal.marketProbYes : signal.marketProbNo;
  const modelProb = side === 'yes' ? signal.modelProbYes : signal.modelProbNo;
  const marketProb = side === 'yes' ? signal.marketProbYes : signal.marketProbNo;
  const edge = side === 'yes' ? signal.edgeYes : signal.edgeNo;

  const trade: PaperTrade = {
    id,
    createdAt: now,
    ticker: signal.ticker,
    title: signal.title,
    side,
    entryPrice,
    modelProb,
    marketProb,
    edge,
    confidence: signal.confidence,
    stakeCents,
    status: 'open',
    notes,
  };

  const key = `${PAPER_TRADE_KEY_PREFIX}${id}`;
  await redis.set(key, JSON.stringify(trade));
  await redis.zadd(PAPER_TRADES_SORTED_SET, { score: Date.now(), member: id });

  return trade;
}

/**
 * Lists all paper trades, ordered by creation time (newest first).
 */
export async function listPaperTrades(): Promise<PaperTrade[]> {
  const redis = getRedis();

  // Get all trade IDs from the sorted set (newest first)
  const ids = await redis.zrange(PAPER_TRADES_SORTED_SET, 0, -1, { rev: true }) as string[];
  if (!ids || ids.length === 0) return [];

  const trades: PaperTrade[] = [];
  for (const id of ids) {
    const key = `${PAPER_TRADE_KEY_PREFIX}${id}`;
    const raw = await redis.get(key);
    if (raw) {
      const trade = typeof raw === 'string' ? JSON.parse(raw) : raw;
      trades.push(trade as PaperTrade);
    }
  }

  return trades;
}

/**
 * Settles a paper trade with the final outcome price (0 or 100 cents).
 * Computes P&L based on side:
 *   - YES side: pnl = (settlementPrice - entryPrice * 100) * stakeCents / 100
 *   - NO side: pnl = ((100 - settlementPrice) - (1 - entryPrice) * 100) * stakeCents / 100
 *
 * Kalshi settles at 100 (event happened) or 0 (didn't happen).
 */
export async function settlePaperTrade(
  id: string,
  settlementPrice: number,
): Promise<PaperTrade | null> {
  const redis = getRedis();
  const key = `${PAPER_TRADE_KEY_PREFIX}${id}`;
  const raw = await redis.get(key);
  if (!raw) return null;

  const trade: PaperTrade = typeof raw === 'string' ? JSON.parse(raw) : raw as PaperTrade;
  if (trade.status !== 'open') return trade;

  // Entry price is stored as a probability (0-1), convert to cents for P&L calc
  const entryPriceCents = Math.round(trade.entryPrice * 100);

  let pnlPerContract: number;
  if (trade.side === 'yes') {
    // Bought YES at entryPriceCents, settles at settlementPrice (0 or 100)
    pnlPerContract = settlementPrice - entryPriceCents;
  } else {
    // Bought NO at (100 - entryPriceCents), settles at (100 - settlementPrice)
    pnlPerContract = (100 - settlementPrice) - (100 - entryPriceCents);
  }

  // Scale P&L by stake (stakeCents represents total stake in cents)
  const pnlCents = Math.round((pnlPerContract / 100) * trade.stakeCents);

  trade.status = 'settled';
  trade.settlementPrice = settlementPrice;
  trade.pnlCents = pnlCents;

  await redis.set(key, JSON.stringify(trade));

  return trade;
}

/**
 * Returns a summary of all paper trades.
 */
export async function getPaperTradeSummary(): Promise<{
  openCount: number;
  settledCount: number;
  cancelledCount: number;
  totalPnlCents: number;
  winCount: number;
  lossCount: number;
  winRate: number | null;
}> {
  const trades = await listPaperTrades();

  let openCount = 0;
  let settledCount = 0;
  let cancelledCount = 0;
  let totalPnlCents = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const t of trades) {
    if (t.status === 'open') openCount++;
    else if (t.status === 'settled') {
      settledCount++;
      totalPnlCents += t.pnlCents ?? 0;
      if ((t.pnlCents ?? 0) > 0) winCount++;
      else if ((t.pnlCents ?? 0) < 0) lossCount++;
    } else if (t.status === 'cancelled') {
      cancelledCount++;
    }
  }

  return {
    openCount,
    settledCount,
    cancelledCount,
    totalPnlCents,
    winCount,
    lossCount,
    winRate: settledCount > 0 ? Math.round((winCount / settledCount) * 10000) / 10000 : null,
  };
}
