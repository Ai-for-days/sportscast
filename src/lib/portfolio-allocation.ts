// ── Step 78: Portfolio allocation — sizing for systematicEligible signals ───
//
// Converts validated edge into recommended capital allocation. Read-only
// recommendation layer — no automatic execution, no order submission, no
// candidate auto-creation. The output is metadata for operator review.
//
// Sizing model:
//   p = modelProbForSide  (model probability for the traded side)
//   q = 1 − p
//   b = decimal odds = profit-if-win / stake
//       For Kalshi YES at price P (cents): b = (100−P)/P = (1−market)/market
//   kellyFraction = (p·b − q) / b
//
//   When marketProbForSide is unavailable (e.g. sportsbook signals), we fall
//   back to a 50¢-market approximation: kellyFraction ≈ 2 × calibratedEdge.
//
// Adjusted: kellyFraction × reliabilityFactor × riskScalingFactor (0.25)
// Final:    bankroll × adjustedFraction, then clamped to hard caps.

import { generateRankedSignals, type RankedSignal } from './signal-ranking';
import { getStrategyMode, type StrategyMode } from './strategy-mode';

// ── Configuration ───────────────────────────────────────────────────────────

export const PORTFOLIO_CONFIG = {
  BANKROLL_CENTS: 100_000,             // $1,000
  RISK_SCALING_FACTOR: 0.25,           // fractional-Kelly scalar
  MAX_SINGLE_TRADE_CENTS: 5_000,       // $50 per trade
  MAX_PORTFOLIO_CENTS: 100_000,        // $1,000 total exposure
  MAX_PER_MARKET_CENTS: 10_000,        // $100 per ticker
  MAX_PER_CITY_CENTS: 30_000,          // $300 per city
  MAX_PER_DATE_CENTS: 50_000,          // $500 per target date
  MAX_PER_METRIC_CENTS: 30_000,        // $300 per metric
  CONCENTRATION_WARN_PCT: 0.40,        // any bucket > 40% of portfolio
} as const;

// ── Core Kelly ──────────────────────────────────────────────────────────────

function kellyFraction(modelProb: number | undefined, marketProb: number | undefined, calibratedEdge: number | undefined): {
  fraction: number;
  formula: 'kelly' | 'edge-fallback';
} {
  // Preferred formula: Kelly with explicit market prob for accurate odds.
  if (modelProb != null && marketProb != null && marketProb > 0 && marketProb < 1) {
    const p = modelProb;
    const q = 1 - p;
    const b = (1 - marketProb) / marketProb;
    if (b <= 0 || !Number.isFinite(b)) return { fraction: 0, formula: 'kelly' };
    const f = (p * b - q) / b;
    return { fraction: Math.max(0, f), formula: 'kelly' };
  }
  // Fallback: assume ~50¢ market. For a fair-coin market, kelly ≈ 2·edge.
  if (calibratedEdge != null) {
    return { fraction: Math.max(0, 2 * calibratedEdge), formula: 'edge-fallback' };
  }
  return { fraction: 0, formula: 'edge-fallback' };
}

// ── Per-signal recommendation ───────────────────────────────────────────────

export interface AllocationRecord {
  signalId: string;
  title: string;
  source: 'kalshi' | 'sportsbook';
  ticker?: string;
  side?: 'yes' | 'no';
  locationName?: string;
  metric?: string;
  targetDate?: string;
  systematicEligible: boolean;

  calibratedEdge?: number;
  reliabilityFactor?: number;
  modelProbForSide?: number;
  marketProbForSide?: number;

  kellyFraction: number;
  kellyFormula: 'kelly' | 'edge-fallback';
  riskScalingFactor: number;
  adjustedFraction: number;

  /** Bankroll × adjustedFraction, before per-market and per-portfolio caps. */
  rawRecommendedStakeCents: number;
  /** After per-trade cap and per-bucket caps. */
  recommendedStakeCents: number;
  /** After portfolio total cap (final amount). */
  cappedStakeCents: number;
  capReason: string | null;
}

interface BucketUsage {
  market: Record<string, number>;
  city: Record<string, number>;
  date: Record<string, number>;
  metric: Record<string, number>;
  total: number;
}

function makeUsage(): BucketUsage {
  return { market: {}, city: {}, date: {}, metric: {}, total: 0 };
}

function bucketSize(b: BucketUsage, signal: { ticker?: string; locationName?: string; targetDate?: string; metric?: string }) {
  const cfg = PORTFOLIO_CONFIG;
  const mUsed = signal.ticker ? (b.market[signal.ticker] ?? 0) : 0;
  const cUsed = signal.locationName ? (b.city[signal.locationName] ?? 0) : 0;
  const dUsed = signal.targetDate ? (b.date[signal.targetDate] ?? 0) : 0;
  const tUsed = signal.metric ? (b.metric[signal.metric] ?? 0) : 0;

  return {
    perMarketRoom:   Math.max(0, cfg.MAX_PER_MARKET_CENTS  - mUsed),
    perCityRoom:     Math.max(0, cfg.MAX_PER_CITY_CENTS    - cUsed),
    perDateRoom:     Math.max(0, cfg.MAX_PER_DATE_CENTS    - dUsed),
    perMetricRoom:   Math.max(0, cfg.MAX_PER_METRIC_CENTS  - tUsed),
    portfolioRoom:   Math.max(0, cfg.MAX_PORTFOLIO_CENTS   - b.total),
  };
}

function applyCaps(rawCents: number, b: BucketUsage, signal: { ticker?: string; locationName?: string; targetDate?: string; metric?: string }): { stake: number; reason: string | null } {
  const cfg = PORTFOLIO_CONFIG;
  const reasons: string[] = [];
  let stake = Math.round(rawCents);

  if (stake > cfg.MAX_SINGLE_TRADE_CENTS) {
    stake = cfg.MAX_SINGLE_TRADE_CENTS;
    reasons.push(`per-trade cap $${cfg.MAX_SINGLE_TRADE_CENTS / 100}`);
  }
  const room = bucketSize(b, signal);
  if (stake > room.perMarketRoom) {
    stake = room.perMarketRoom;
    reasons.push(`per-market cap $${cfg.MAX_PER_MARKET_CENTS / 100}`);
  }
  if (stake > room.perCityRoom) {
    stake = room.perCityRoom;
    reasons.push(`per-city cap $${cfg.MAX_PER_CITY_CENTS / 100}`);
  }
  if (stake > room.perDateRoom) {
    stake = room.perDateRoom;
    reasons.push(`per-date cap $${cfg.MAX_PER_DATE_CENTS / 100}`);
  }
  if (stake > room.perMetricRoom) {
    stake = room.perMetricRoom;
    reasons.push(`per-metric cap $${cfg.MAX_PER_METRIC_CENTS / 100}`);
  }
  if (stake > room.portfolioRoom) {
    stake = room.portfolioRoom;
    reasons.push(`portfolio cap $${cfg.MAX_PORTFOLIO_CENTS / 100}`);
  }

  return { stake: Math.max(0, stake), reason: reasons.length > 0 ? reasons.join('; ') : null };
}

// ── Portfolio summary ───────────────────────────────────────────────────────

export interface PortfolioSummary {
  totalEligible: number;
  totalAllocated: number;            // count of records with cappedStake > 0
  totalRecommendedExposureCents: number;
  totalCappedExposureCents: number;
  avgStakeCents: number | null;
  maxRecord: AllocationRecord | null;
  riskBuckets: {
    bySource: { source: string; cents: number; pct: number }[];
    byCity:   { city: string;   cents: number; pct: number }[];
    byDate:   { date: string;   cents: number; pct: number }[];
    byMetric: { metric: string; cents: number; pct: number }[];
  };
  warnings: string[];
}

// ── Top-level report ────────────────────────────────────────────────────────

export interface AllocationReport {
  generatedAt: string;
  config: typeof PORTFOLIO_CONFIG;
  strategyMode: StrategyMode;
  records: AllocationRecord[];
  summary: PortfolioSummary;
  notes: string[];
}

export async function buildAllocationReport(): Promise<AllocationReport> {
  const [signals, modeCfg] = await Promise.all([generateRankedSignals(), getStrategyMode()]);
  const eligible = signals.filter(s => s.systematicEligible === true);

  // Sort eligible by signalScore desc — we allocate to higher-scored signals
  // first so per-bucket caps consume the strongest opportunities preferentially.
  eligible.sort((a, b) => b.signalScore - a.signalScore);

  const usage = makeUsage();
  const records: AllocationRecord[] = [];

  for (const s of eligible) {
    const { fraction, formula } = kellyFraction(s.modelProbForSide, s.marketProbForSide, s.calibratedEdge);
    const adjusted = fraction * (s.reliabilityFactor ?? 0) * PORTFOLIO_CONFIG.RISK_SCALING_FACTOR;
    const rawCents = Math.max(0, Math.round(PORTFOLIO_CONFIG.BANKROLL_CENTS * adjusted));

    const sigCtx = { ticker: s.id, locationName: s.locationName, targetDate: s.targetDate, metric: s.metric };
    const { stake, reason } = applyCaps(rawCents, usage, sigCtx);

    records.push({
      signalId: s.id,
      title: s.title,
      source: s.source,
      ticker: s.id,
      side: s.side,
      locationName: s.locationName,
      metric: s.metric,
      targetDate: s.targetDate,
      systematicEligible: true,

      calibratedEdge: s.calibratedEdge,
      reliabilityFactor: s.reliabilityFactor,
      modelProbForSide: s.modelProbForSide,
      marketProbForSide: s.marketProbForSide,

      kellyFraction: Math.round(fraction * 10000) / 10000,
      kellyFormula: formula,
      riskScalingFactor: PORTFOLIO_CONFIG.RISK_SCALING_FACTOR,
      adjustedFraction: Math.round(adjusted * 10000) / 10000,
      rawRecommendedStakeCents: rawCents,
      recommendedStakeCents: stake,
      cappedStakeCents: stake,
      capReason: reason,
    });

    // Update usage
    usage.total += stake;
    if (s.id) usage.market[s.id] = (usage.market[s.id] ?? 0) + stake;
    if (s.locationName) usage.city[s.locationName] = (usage.city[s.locationName] ?? 0) + stake;
    if (s.targetDate) usage.date[s.targetDate] = (usage.date[s.targetDate] ?? 0) + stake;
    if (s.metric) usage.metric[s.metric] = (usage.metric[s.metric] ?? 0) + stake;
  }

  // Summary
  const allocated = records.filter(r => r.cappedStakeCents > 0);
  const totalCapped = allocated.reduce((s, r) => s + r.cappedStakeCents, 0);
  const totalRaw = records.reduce((s, r) => s + r.rawRecommendedStakeCents, 0);
  const avg = allocated.length > 0 ? Math.round(totalCapped / allocated.length) : null;
  const maxRecord = allocated.reduce<AllocationRecord | null>((max, r) =>
    !max || r.cappedStakeCents > max.cappedStakeCents ? r : max, null);

  const bucketize = (m: Record<string, number>): { key: string; cents: number; pct: number }[] => {
    const total = Object.values(m).reduce((s, v) => s + v, 0);
    return Object.entries(m)
      .map(([k, v]) => ({ key: k, cents: v, pct: total > 0 ? v / total : 0 }))
      .sort((a, b) => b.cents - a.cents);
  };

  const bySourceCounts: Record<string, number> = {};
  for (const r of records) bySourceCounts[r.source] = (bySourceCounts[r.source] ?? 0) + r.cappedStakeCents;
  const totalForSource = Object.values(bySourceCounts).reduce((s, v) => s + v, 0);
  const bySource = Object.entries(bySourceCounts)
    .map(([source, cents]) => ({ source, cents, pct: totalForSource > 0 ? cents / totalForSource : 0 }))
    .sort((a, b) => b.cents - a.cents);

  const warnings: string[] = [];
  for (const item of bucketize(usage.city)) {
    if (item.pct > PORTFOLIO_CONFIG.CONCENTRATION_WARN_PCT) {
      warnings.push(`City "${item.key}" holds ${(item.pct * 100).toFixed(0)}% of allocated exposure (>${(PORTFOLIO_CONFIG.CONCENTRATION_WARN_PCT * 100).toFixed(0)}% threshold)`);
    }
  }
  for (const item of bucketize(usage.date)) {
    if (item.pct > PORTFOLIO_CONFIG.CONCENTRATION_WARN_PCT) {
      warnings.push(`Date "${item.key}" holds ${(item.pct * 100).toFixed(0)}% of allocated exposure (>${(PORTFOLIO_CONFIG.CONCENTRATION_WARN_PCT * 100).toFixed(0)}% threshold)`);
    }
  }
  for (const item of bucketize(usage.metric)) {
    if (item.pct > PORTFOLIO_CONFIG.CONCENTRATION_WARN_PCT) {
      warnings.push(`Metric "${item.key}" holds ${(item.pct * 100).toFixed(0)}% of allocated exposure (>${(PORTFOLIO_CONFIG.CONCENTRATION_WARN_PCT * 100).toFixed(0)}% threshold)`);
    }
  }
  if (totalCapped > 0 && (totalCapped / PORTFOLIO_CONFIG.MAX_PORTFOLIO_CENTS) > 0.9) {
    warnings.push(`Portfolio cap nearly exhausted: ${(totalCapped / PORTFOLIO_CONFIG.MAX_PORTFOLIO_CENTS * 100).toFixed(0)}% utilised`);
  }
  if (totalRaw > totalCapped) {
    warnings.push(`Caps reduced raw allocation by $${((totalRaw - totalCapped) / 100).toFixed(2)} — consider whether per-trade or portfolio caps need review`);
  }

  return {
    generatedAt: new Date().toISOString(),
    config: PORTFOLIO_CONFIG,
    strategyMode: modeCfg.mode,
    records,
    summary: {
      totalEligible: eligible.length,
      totalAllocated: allocated.length,
      totalRecommendedExposureCents: totalRaw,
      totalCappedExposureCents: totalCapped,
      avgStakeCents: avg,
      maxRecord,
      riskBuckets: {
        bySource,
        byCity:   bucketize(usage.city)  .map(b => ({ city: b.key, cents: b.cents, pct: b.pct })),
        byDate:   bucketize(usage.date)  .map(b => ({ date: b.key, cents: b.cents, pct: b.pct })),
        byMetric: bucketize(usage.metric).map(b => ({ metric: b.key, cents: b.cents, pct: b.pct })),
      },
      warnings,
    },
    notes: [
      `Bankroll = $${PORTFOLIO_CONFIG.BANKROLL_CENTS / 100}, riskScalingFactor = ${PORTFOLIO_CONFIG.RISK_SCALING_FACTOR} (fractional Kelly).`,
      `Per-trade cap $${PORTFOLIO_CONFIG.MAX_SINGLE_TRADE_CENTS / 100}; portfolio cap $${PORTFOLIO_CONFIG.MAX_PORTFOLIO_CENTS / 100}; per-market $${PORTFOLIO_CONFIG.MAX_PER_MARKET_CENTS / 100}; per-city $${PORTFOLIO_CONFIG.MAX_PER_CITY_CENTS / 100}; per-date $${PORTFOLIO_CONFIG.MAX_PER_DATE_CENTS / 100}; per-metric $${PORTFOLIO_CONFIG.MAX_PER_METRIC_CENTS / 100}.`,
      'Kelly uses marketProbForSide when available; otherwise falls back to a 50¢-market approximation (kelly ≈ 2 × calibratedEdge). The kellyFormula field on each record reports which path was taken.',
      'Allocation order follows signalScore desc — strongest opportunities consume per-bucket caps first.',
      'Concentration warnings fire when any city/date/metric bucket exceeds 40% of allocated exposure.',
      'No automatic execution. No order submission. No candidate auto-creation. Read-only recommendation layer.',
    ],
  };
}
