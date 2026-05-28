// ── Step 161: Crypto paper-trading portfolio (admin-only, server-only) ──
//
// **Side-effect-free paper trading.** No exchange API, no broker API,
// no wallet, no custody, no private keys, no real-order execution, no
// mailer. The portfolio is a $100,000 model bankroll that admins can
// run hypothetical buys / sells against. State lives in Redis at a
// dedicated namespace so it is never reachable from any customer code
// path.
//
// This module exposes:
//   - The full data model (PaperPosition / PaperTrade / RiskSettings /
//     PaperPortfolioState / AlertPayload + their unions).
//   - A bounded Redis store (single state record per project).
//   - Pure helpers for risk checks, fee/slippage math, position rollup,
//     and derived-field recomputation.
//
// The trade simulator (Step 161, file `crypto-paper-trade-simulator.ts`)
// composes these helpers; the renderer (`crypto-trade-alert-renderer.ts`)
// only reads the `AlertPayload` shape from here.
//
// Trust posture:
//   - Server-only — browser-import throws.
//   - Bounded retention: `MAX_TRADES` and `MAX_CLOSED_POSITIONS` cap
//     in-memory and Redis growth.
//   - **Imports zero** exchange / broker / wallet / private-key /
//     custody / mailer / settlement / grading / wager-store mutator
//     modules — only `getRedis()` plus types.
//   - PaperPortfolioState is admin-only. The PublicWagerView allow-list
//     does not contain any field whose name overlaps with this module
//     (verified by grep).
//
// **Paper trading only. Research only. Not financial advice.**

import { getRedis } from './redis';

if (typeof window !== 'undefined') {
  throw new Error(
    'crypto-paper-portfolio is server-only and must not be imported in client code',
  );
}

// ── Constants ──────────────────────────────────────────────────────────────

export const STARTING_BANKROLL = 100_000;
export const PORTFOLIO_MODE = 'paper' as const;

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  maxRiskPerTradePct: 1.5,
  maxSinglePositionPct: 15,
  maxTotalExposurePct: 80,
  minCashPct: 20,
  feePct: 0.1,
  slippagePct: 0.05,
};

/** Bounded retention — keeps Redis payload reasonable across long runs. */
export const MAX_TRADES = 500;
export const MAX_CLOSED_POSITIONS = 200;
/** Open-position cap — any signal beyond this is blocked with a clear reason. */
export const MAX_OPEN_POSITIONS = 25;

const KEY = {
  state: 'crypto-paper-portfolio:state',
} as const;

// ── Types ──────────────────────────────────────────────────────────────────

export type PositionStatus = 'open' | 'closed';

export type TradeAction =
  | 'buy'
  | 'sell'
  | 'trim'
  | 'add'
  | 'stop_loss'
  | 'take_profit';

export type TradeSource = 'simulated_signal' | 'manual_admin';

export type SignalRecommendation = 'buy' | 'sell' | 'trim' | 'hold';

export type SignalConfidence = 'low' | 'medium' | 'high';

export interface RiskSettings {
  /** % of total equity risked per trade — drives position sizing via stop distance. */
  maxRiskPerTradePct: number;
  /** % of total equity any single position may consume (gross). */
  maxSinglePositionPct: number;
  /** % of total equity that may be allocated to positions in aggregate. */
  maxTotalExposurePct: number;
  /** % of total equity that must remain in cash at all times. */
  minCashPct: number;
  /** % fee applied per trade notional. */
  feePct: number;
  /** % adverse slippage applied to the fill price. */
  slippagePct: number;
}

export interface PaperPosition {
  id: string;
  symbol: string;
  assetName: string;
  side: 'long';
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  /** quantity × currentPrice (or avgEntryPrice when currentPrice unknown). */
  positionValue: number;
  /** $ amount risked between entry and stop. */
  riskAmount: number;
  /** Risk as % of bankroll at entry. */
  riskPctBankroll: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  status: PositionStatus;
  openedAt: string;
  closedAt?: string;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  action: TradeAction;
  quantity: number;
  price: number;
  notionalValue: number;
  fee: number;
  slippage: number;
  /** Always 0 for adds/buys; non-zero on sells / trims / stops / tps. */
  realizedPnl: number;
  /** Cash balance after this trade settles. */
  bankrollAfter: number;
  rationale: string;
  source: TradeSource;
  createdAt: string;
}

export interface PaperPortfolioState {
  startingBankroll: number;
  cashBalance: number;
  totalEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  cumulativeReturnPct: number;
  exposurePct: number;
  openPositions: PaperPosition[];
  closedPositions: PaperPosition[];
  trades: PaperTrade[];
  riskSettings: RiskSettings;
  mode: 'paper';
  createdAt: string;
  updatedAt: string;
  /** Step 161 — last simulated alert kept inline so the preview page works without an extra store. */
  lastAlert?: AlertPayload;
}

// ── Signal & alert payload shapes ──────────────────────────────────────────

export interface CryptoSignal {
  symbol: string;
  assetName: string;
  recommendation: SignalRecommendation;
  score: number;
  confidence: SignalConfidence;
  entryPrice: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  rationale: string;
}

export type AlertAction = TradeAction | 'blocked' | 'no_op';

export interface AlertPayload {
  action: AlertAction;
  symbol: string;
  assetName: string;
  modelBankroll: number;
  entryPrice: number;
  quantity: number;
  positionValue: number;
  riskPct: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  signalScore: number;
  confidence: SignalConfidence;
  rationale: string;
  updatedCash: number;
  updatedExposurePct: number;
  blockedReason?: string;
  generatedAt: string;
  /** Echoed so the renderer can stamp the disclaimer with the right mode. */
  mode: 'paper';
}

// ── Initial state + parse helpers ──────────────────────────────────────────

export function initialPortfolioState(now: string = new Date().toISOString()): PaperPortfolioState {
  return {
    startingBankroll: STARTING_BANKROLL,
    cashBalance: STARTING_BANKROLL,
    totalEquity: STARTING_BANKROLL,
    realizedPnl: 0,
    unrealizedPnl: 0,
    cumulativeReturnPct: 0,
    exposurePct: 0,
    openPositions: [],
    closedPositions: [],
    trades: [],
    riskSettings: { ...DEFAULT_RISK_SETTINGS },
    mode: PORTFOLIO_MODE,
    createdAt: now,
    updatedAt: now,
  };
}

function parseState(raw: string | null | unknown): PaperPortfolioState | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as PaperPortfolioState)
      : (raw as PaperPortfolioState);
  } catch {
    return null;
  }
}

// ── Store API ──────────────────────────────────────────────────────────────

export async function loadPortfolioState(): Promise<PaperPortfolioState | null> {
  const redis = getRedis();
  const raw = (await redis.get(KEY.state)) as string | null;
  return parseState(raw);
}

export async function getOrInitPortfolioState(): Promise<PaperPortfolioState> {
  const existing = await loadPortfolioState();
  if (existing) return existing;
  const fresh = initialPortfolioState();
  await savePortfolioState(fresh);
  return fresh;
}

export async function savePortfolioState(state: PaperPortfolioState): Promise<void> {
  const redis = getRedis();
  const bounded: PaperPortfolioState = {
    ...state,
    trades: state.trades.slice(-MAX_TRADES),
    closedPositions: state.closedPositions.slice(-MAX_CLOSED_POSITIONS),
    updatedAt: new Date().toISOString(),
  };
  await redis.set(KEY.state, JSON.stringify(bounded));
}

export async function resetPortfolioState(): Promise<PaperPortfolioState> {
  const fresh = initialPortfolioState();
  await savePortfolioState(fresh);
  return fresh;
}

// ── Pure helpers — derived fields, risk math, sizing ───────────────────────

/**
 * Recompute every derived field (totalEquity / unrealizedPnl /
 * cumulativeReturnPct / exposurePct + per-position mark-to-market)
 * from the canonical state. Pure — no I/O. Idempotent.
 */
export function recomputeDerivedFields(state: PaperPortfolioState): PaperPortfolioState {
  let unrealized = 0;
  let exposure = 0;
  const openPositions = state.openPositions.map((p) => {
    const price = p.currentPrice || p.avgEntryPrice;
    const positionValue = p.quantity * price;
    const pnl = (price - p.avgEntryPrice) * p.quantity;
    const pnlPct = p.avgEntryPrice > 0 ? (pnl / (p.avgEntryPrice * p.quantity)) * 100 : 0;
    unrealized += pnl;
    exposure += positionValue;
    return {
      ...p,
      currentPrice: price,
      positionValue,
      unrealizedPnl: round2(pnl),
      unrealizedPnlPct: round2(pnlPct),
    };
  });
  const totalEquity = state.cashBalance + exposure;
  const cumulativeReturnPct =
    state.startingBankroll > 0
      ? ((totalEquity - state.startingBankroll) / state.startingBankroll) * 100
      : 0;
  const exposurePct = totalEquity > 0 ? (exposure / totalEquity) * 100 : 0;
  return {
    ...state,
    openPositions,
    unrealizedPnl: round2(unrealized),
    totalEquity: round2(totalEquity),
    cumulativeReturnPct: round2(cumulativeReturnPct),
    exposurePct: round2(exposurePct),
  };
}

export interface SizingPlan {
  quantity: number;
  /** Notional (quantity × entry, before fees). */
  positionValue: number;
  /** $ risked between entry and stop. */
  riskAmount: number;
  /** Position risk as % of bankroll. */
  riskPctBankroll: number;
  /** Filled entry price after slippage. */
  filledEntryPrice: number;
  /** Fee on the gross notional. */
  fee: number;
  /** Total cash debited (notional + fee, post-slippage). */
  totalCashCost: number;
}

/**
 * Pure position sizer. Hands back a SizingPlan or `null` when the
 * signal is unsizable (e.g. invalid stop, division by zero). Caller is
 * responsible for risk gates — this function only computes shape, not
 * approval.
 */
export function planBuySize(
  signal: { entryPrice: number; stopLoss?: number },
  state: PaperPortfolioState,
): SizingPlan | null {
  if (!Number.isFinite(signal.entryPrice) || signal.entryPrice <= 0) return null;
  if (!Number.isFinite(signal.stopLoss ?? NaN) || (signal.stopLoss ?? 0) <= 0) return null;
  if ((signal.stopLoss ?? 0) >= signal.entryPrice) return null;

  const risk = state.riskSettings;
  const riskAmount = (state.totalEquity * risk.maxRiskPerTradePct) / 100;
  const riskPerUnit = signal.entryPrice - (signal.stopLoss ?? 0);
  if (riskPerUnit <= 0) return null;

  let quantity = riskAmount / riskPerUnit;
  let positionValue = quantity * signal.entryPrice;
  // Cap by maxSinglePositionPct.
  const maxPosition = (state.totalEquity * risk.maxSinglePositionPct) / 100;
  if (positionValue > maxPosition) {
    positionValue = maxPosition;
    quantity = signal.entryPrice > 0 ? maxPosition / signal.entryPrice : 0;
  }
  if (quantity <= 0) return null;

  const filledEntryPrice = signal.entryPrice * (1 + risk.slippagePct / 100);
  const fee = positionValue * (risk.feePct / 100);
  const totalCashCost = quantity * filledEntryPrice + fee;
  const riskPctBankroll =
    state.startingBankroll > 0
      ? ((quantity * (signal.entryPrice - (signal.stopLoss ?? 0))) / state.startingBankroll) * 100
      : 0;

  return {
    quantity: round6(quantity),
    positionValue: round2(positionValue),
    riskAmount: round2(riskAmount),
    riskPctBankroll: round2(riskPctBankroll),
    filledEntryPrice: round2(filledEntryPrice),
    fee: round2(fee),
    totalCashCost: round2(totalCashCost),
  };
}

export interface RiskCheckResult {
  ok: boolean;
  /** Set when ok=false. Stable identifier consumed by the alert renderer + audit. */
  blockedReason?:
    | 'invalid_signal'
    | 'unsizable'
    | 'max_total_exposure_exceeded'
    | 'min_cash_violated'
    | 'max_open_positions_exceeded'
    | 'recommendation_not_actionable'
    | 'position_not_found'
    | 'low_signal_score';
  detail?: string;
}

/**
 * Pure risk gate. Returns ok=true when the proposed buy fits inside
 * every risk envelope. Order of checks matters — `max_open_positions`
 * is cheap, exposure is medium, cash is the most operator-visible.
 */
export function runBuyRiskChecks(
  plan: SizingPlan,
  state: PaperPortfolioState,
): RiskCheckResult {
  const risk = state.riskSettings;

  if (state.openPositions.length >= MAX_OPEN_POSITIONS) {
    return {
      ok: false,
      blockedReason: 'max_open_positions_exceeded',
      detail: `Already holding ${state.openPositions.length} open paper positions (cap ${MAX_OPEN_POSITIONS}).`,
    };
  }

  const currentExposure = sumPositionValues(state.openPositions);
  const projectedExposure = currentExposure + plan.positionValue;
  const exposurePct = state.totalEquity > 0 ? (projectedExposure / state.totalEquity) * 100 : 100;
  if (exposurePct > risk.maxTotalExposurePct) {
    return {
      ok: false,
      blockedReason: 'max_total_exposure_exceeded',
      detail: `Projected exposure ${exposurePct.toFixed(1)}% would exceed cap ${risk.maxTotalExposurePct}%.`,
    };
  }

  const projectedCash = state.cashBalance - plan.totalCashCost;
  const projectedCashPct = state.totalEquity > 0 ? (projectedCash / state.totalEquity) * 100 : 0;
  if (projectedCashPct < risk.minCashPct) {
    return {
      ok: false,
      blockedReason: 'min_cash_violated',
      detail: `Projected cash ${projectedCashPct.toFixed(1)}% would breach floor ${risk.minCashPct}%.`,
    };
  }

  return { ok: true };
}

/**
 * Sum mark-to-market value of all open positions. Pure.
 */
export function sumPositionValues(positions: readonly PaperPosition[]): number {
  let s = 0;
  for (const p of positions) s += p.positionValue;
  return s;
}

// ── Mutation helpers (pure — caller persists via savePortfolioState) ──────

export function applyBuyTrade(
  state: PaperPortfolioState,
  signal: CryptoSignal,
  plan: SizingPlan,
  source: TradeSource,
  now: string = new Date().toISOString(),
): { state: PaperPortfolioState; trade: PaperTrade; position: PaperPosition } {
  const positionId = `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const tradeId = `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const position: PaperPosition = {
    id: positionId,
    symbol: signal.symbol,
    assetName: signal.assetName,
    side: 'long',
    quantity: plan.quantity,
    avgEntryPrice: plan.filledEntryPrice,
    currentPrice: plan.filledEntryPrice,
    stopLoss: signal.stopLoss,
    takeProfit1: signal.takeProfit1,
    takeProfit2: signal.takeProfit2,
    takeProfit3: signal.takeProfit3,
    positionValue: plan.positionValue,
    riskAmount: plan.riskAmount,
    riskPctBankroll: plan.riskPctBankroll,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    status: 'open',
    openedAt: now,
  };

  const newCash = state.cashBalance - plan.totalCashCost;
  const trade: PaperTrade = {
    id: tradeId,
    symbol: signal.symbol,
    action: 'buy',
    quantity: plan.quantity,
    price: plan.filledEntryPrice,
    notionalValue: plan.positionValue,
    fee: plan.fee,
    slippage: round2(plan.filledEntryPrice - signal.entryPrice),
    realizedPnl: 0,
    bankrollAfter: round2(newCash),
    rationale: signal.rationale,
    source,
    createdAt: now,
  };

  const next: PaperPortfolioState = {
    ...state,
    cashBalance: round2(newCash),
    openPositions: [...state.openPositions, position],
    trades: [...state.trades, trade],
  };
  return { state: recomputeDerivedFields(next), trade, position };
}

export interface SellResult {
  state: PaperPortfolioState;
  trade: PaperTrade;
  closedPosition?: PaperPosition;
}

/**
 * Closes (or partially closes) every open position matching `symbol`.
 * When `action === 'trim'`, sells `trimFraction` (default 0.5) of each
 * matching position; otherwise closes them entirely.
 */
export function applySellTrade(
  state: PaperPortfolioState,
  symbol: string,
  signal: Pick<CryptoSignal, 'entryPrice' | 'rationale'>,
  action: 'sell' | 'trim' | 'stop_loss' | 'take_profit',
  source: TradeSource,
  now: string = new Date().toISOString(),
  trimFraction: number = 0.5,
): SellResult | null {
  const matches = state.openPositions.filter((p) => p.symbol === symbol);
  if (matches.length === 0) return null;
  const risk = state.riskSettings;
  const filledPrice = signal.entryPrice * (1 - risk.slippagePct / 100);

  let realizedPnl = 0;
  let cashGained = 0;
  let totalFee = 0;
  let totalQty = 0;
  const remainingOpen: PaperPosition[] = state.openPositions.filter((p) => p.symbol !== symbol);
  const newlyClosed: PaperPosition[] = [];

  for (const pos of matches) {
    const qty = action === 'trim' ? pos.quantity * trimFraction : pos.quantity;
    const notional = qty * filledPrice;
    const fee = notional * (risk.feePct / 100);
    realizedPnl += (filledPrice - pos.avgEntryPrice) * qty - fee;
    cashGained += notional - fee;
    totalFee += fee;
    totalQty += qty;
    if (action === 'trim') {
      const remainingQty = pos.quantity - qty;
      if (remainingQty > 0.000001) {
        remainingOpen.push({
          ...pos,
          quantity: round6(remainingQty),
          positionValue: round2(remainingQty * filledPrice),
        });
      } else {
        newlyClosed.push({ ...pos, status: 'closed', closedAt: now });
      }
    } else {
      newlyClosed.push({ ...pos, status: 'closed', closedAt: now });
    }
  }

  const tradeId = `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const newCash = state.cashBalance + cashGained;
  const trade: PaperTrade = {
    id: tradeId,
    symbol,
    action,
    quantity: round6(totalQty),
    price: round2(filledPrice),
    notionalValue: round2(totalQty * filledPrice),
    fee: round2(totalFee),
    slippage: round2(filledPrice - signal.entryPrice),
    realizedPnl: round2(realizedPnl),
    bankrollAfter: round2(newCash),
    rationale: signal.rationale,
    source,
    createdAt: now,
  };

  const next: PaperPortfolioState = {
    ...state,
    cashBalance: round2(newCash),
    realizedPnl: round2(state.realizedPnl + realizedPnl),
    openPositions: remainingOpen,
    closedPositions: [...state.closedPositions, ...newlyClosed],
    trades: [...state.trades, trade],
  };
  return {
    state: recomputeDerivedFields(next),
    trade,
    closedPosition: newlyClosed[0],
  };
}

// ── Small numeric helpers ─────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
