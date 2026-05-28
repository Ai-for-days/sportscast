// ── Step 161: Crypto paper-trade simulator (admin-only, server-only) ────
//
// Composes the pure helpers from `crypto-paper-portfolio.ts` into a
// single entry point: `simulateSignal(state, signal, source?)`. Given
// the current `PaperPortfolioState` and an incoming `CryptoSignal`,
// returns `{ updatedState, trade?, alert, blockedReason? }`.
//
// **No exchange API. No broker API. No wallet. No private keys. No
// order routing. No mailer.** Every effect of this module is confined
// to in-memory transformation of the Redis-backed state document; the
// caller persists by calling `savePortfolioState(updated)`.
//
// **Paper trading only. Research only. Not financial advice.**

import {
  applyBuyTrade,
  applySellTrade,
  planBuySize,
  runBuyRiskChecks,
  recomputeDerivedFields,
  type AlertPayload,
  type CryptoSignal,
  type PaperPortfolioState,
  type PaperTrade,
  type RiskCheckResult,
  type TradeSource,
} from './crypto-paper-portfolio';

if (typeof window !== 'undefined') {
  throw new Error(
    'crypto-paper-trade-simulator is server-only and must not be imported in client code',
  );
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Minimum signal score that qualifies for a paper buy. */
export const MIN_BUY_SCORE = 75;

// ── Types ──────────────────────────────────────────────────────────────────

export interface SimulationResult {
  /** True when the simulator applied a trade to the state. */
  applied: boolean;
  /** Updated state — always returned, even when no trade was applied. */
  updatedState: PaperPortfolioState;
  /** The trade emitted, when one was. */
  trade?: PaperTrade;
  /** The alert payload — populated for every result (even blocked / no-op). */
  alert: AlertPayload;
  /** Stable identifier for downstream audit / UI rendering. */
  blockedReason?: RiskCheckResult['blockedReason'];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isValidSignal(signal: CryptoSignal): boolean {
  return (
    !!signal &&
    typeof signal.symbol === 'string' &&
    signal.symbol.length > 0 &&
    typeof signal.assetName === 'string' &&
    typeof signal.recommendation === 'string' &&
    typeof signal.score === 'number' &&
    Number.isFinite(signal.score) &&
    typeof signal.entryPrice === 'number' &&
    Number.isFinite(signal.entryPrice) &&
    signal.entryPrice > 0
  );
}

function baseAlertFromSignal(
  signal: CryptoSignal,
  state: PaperPortfolioState,
  now: string,
): AlertPayload {
  return {
    action: 'no_op',
    symbol: signal.symbol,
    assetName: signal.assetName,
    modelBankroll: state.startingBankroll,
    entryPrice: signal.entryPrice,
    quantity: 0,
    positionValue: 0,
    riskPct: 0,
    stopLoss: signal.stopLoss,
    takeProfit1: signal.takeProfit1,
    takeProfit2: signal.takeProfit2,
    takeProfit3: signal.takeProfit3,
    signalScore: signal.score,
    confidence: signal.confidence,
    rationale: signal.rationale,
    updatedCash: state.cashBalance,
    updatedExposurePct: state.exposurePct,
    generatedAt: now,
    mode: 'paper',
  };
}

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Pure-ish simulator entry. Returns the new state + the alert payload.
 * Does **not** persist — the caller is responsible for calling
 * `savePortfolioState(result.updatedState)` if they want to keep the
 * mutation. This split lets the preview page render an alert without
 * committing it.
 */
export function simulateSignal(
  state: PaperPortfolioState,
  signal: CryptoSignal,
  source: TradeSource = 'simulated_signal',
  now: string = new Date().toISOString(),
): SimulationResult {
  const recomputed = recomputeDerivedFields(state);
  const alert = baseAlertFromSignal(signal, recomputed, now);

  if (!isValidSignal(signal)) {
    return {
      applied: false,
      updatedState: recomputed,
      alert: { ...alert, action: 'blocked', blockedReason: 'invalid_signal' },
      blockedReason: 'invalid_signal',
    };
  }

  // ── Buy path ────────────────────────────────────────────────────────────
  if (signal.recommendation === 'buy') {
    if (signal.score < MIN_BUY_SCORE) {
      return {
        applied: false,
        updatedState: recomputed,
        alert: {
          ...alert,
          action: 'blocked',
          blockedReason: `Signal score ${signal.score} below minimum ${MIN_BUY_SCORE}.`,
        },
        blockedReason: 'low_signal_score',
      };
    }
    const plan = planBuySize(signal, recomputed);
    if (!plan) {
      return {
        applied: false,
        updatedState: recomputed,
        alert: {
          ...alert,
          action: 'blocked',
          blockedReason: 'Signal is unsizable — check entry price + stop loss.',
        },
        blockedReason: 'unsizable',
      };
    }
    const gate = runBuyRiskChecks(plan, recomputed);
    if (!gate.ok) {
      return {
        applied: false,
        updatedState: recomputed,
        alert: {
          ...alert,
          action: 'blocked',
          quantity: plan.quantity,
          positionValue: plan.positionValue,
          riskPct: plan.riskPctBankroll,
          blockedReason: gate.detail ?? gate.blockedReason,
        },
        blockedReason: gate.blockedReason,
      };
    }
    const applyResult = applyBuyTrade(recomputed, signal, plan, source, now);
    const updated = applyResult.state;
    return {
      applied: true,
      updatedState: updated,
      trade: applyResult.trade,
      alert: {
        ...alert,
        action: 'buy',
        entryPrice: plan.filledEntryPrice,
        quantity: plan.quantity,
        positionValue: plan.positionValue,
        riskPct: plan.riskPctBankroll,
        updatedCash: updated.cashBalance,
        updatedExposurePct: updated.exposurePct,
      },
    };
  }

  // ── Sell / trim path ────────────────────────────────────────────────────
  if (signal.recommendation === 'sell' || signal.recommendation === 'trim') {
    const action: 'sell' | 'trim' = signal.recommendation;
    const result = applySellTrade(recomputed, signal.symbol, signal, action, source, now);
    if (!result) {
      return {
        applied: false,
        updatedState: recomputed,
        alert: {
          ...alert,
          action: 'blocked',
          blockedReason: `No open paper position found for ${signal.symbol}.`,
        },
        blockedReason: 'position_not_found',
      };
    }
    return {
      applied: true,
      updatedState: result.state,
      trade: result.trade,
      alert: {
        ...alert,
        action,
        entryPrice: result.trade.price,
        quantity: result.trade.quantity,
        positionValue: result.trade.notionalValue,
        riskPct: 0,
        updatedCash: result.state.cashBalance,
        updatedExposurePct: result.state.exposurePct,
      },
    };
  }

  // ── Hold (no-op) ────────────────────────────────────────────────────────
  return {
    applied: false,
    updatedState: recomputed,
    alert: { ...alert, action: 'no_op' },
    blockedReason: 'recommendation_not_actionable',
  };
}

// ── Sample signal — used by the alert-preview page ─────────────────────────

/**
 * Deterministic mock signal for the admin preview page. Lives next to
 * the simulator so the preview path has no need for a separate fixtures
 * module. **Not a real recommendation. Research only.**
 */
export const SAMPLE_SIGNAL: CryptoSignal = {
  symbol: 'BTC-USD',
  assetName: 'Bitcoin',
  recommendation: 'buy',
  score: 82,
  confidence: 'medium',
  entryPrice: 100_000,
  stopLoss: 96_000,
  takeProfit1: 106_000,
  takeProfit2: 112_000,
  takeProfit3: 120_000,
  rationale:
    'Sample mock signal for the admin preview page. Paper trading only. Research only. Not financial advice.',
};
