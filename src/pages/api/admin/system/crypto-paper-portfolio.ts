// ── Step 161: Crypto paper-trading admin API ────────────────────────────
//
// Admin-only endpoint for the $100,000 paper portfolio engine.
// **No exchange API. No broker API. No wallet. No private keys. No
// order routing. No mailer.** Every state mutation here is a JSON
// rewrite of the Redis-backed `crypto-paper-portfolio:state` record.
//
// **Paper trading only. Research only. Not financial advice.**

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import {
  getOrInitPortfolioState,
  loadPortfolioState,
  resetPortfolioState,
  savePortfolioState,
  recomputeDerivedFields,
  type CryptoSignal,
  type PaperPortfolioState,
  type SignalConfidence,
  type SignalRecommendation,
} from '../../../../lib/crypto-paper-portfolio';
import {
  simulateSignal,
  SAMPLE_SIGNAL,
  MIN_BUY_SCORE,
} from '../../../../lib/crypto-paper-trade-simulator';
import { renderCryptoTradeAlertPayload } from '../../../../lib/crypto-trade-alert-renderer';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  });
}

const RECOMMENDATIONS: SignalRecommendation[] = ['buy', 'sell', 'trim', 'hold'];
const CONFIDENCES: SignalConfidence[] = ['low', 'medium', 'high'];

function looksLikeSignal(x: any): x is CryptoSignal {
  if (!x || typeof x !== 'object') return false;
  if (typeof x.symbol !== 'string' || !x.symbol) return false;
  if (typeof x.assetName !== 'string' || !x.assetName) return false;
  if (!RECOMMENDATIONS.includes(x.recommendation)) return false;
  if (typeof x.score !== 'number' || !Number.isFinite(x.score)) return false;
  if (!CONFIDENCES.includes(x.confidence)) return false;
  if (typeof x.entryPrice !== 'number' || !Number.isFinite(x.entryPrice) || x.entryPrice <= 0) {
    return false;
  }
  if (typeof x.rationale !== 'string') return false;
  return true;
}

function briefPayload(state: PaperPortfolioState): {
  state: PaperPortfolioState;
  riskSettings: PaperPortfolioState['riskSettings'];
  limits: { minBuyScore: number; maxTrades: number; maxClosedPositions: number; maxOpenPositions: number };
} {
  return {
    state: recomputeDerivedFields(state),
    riskSettings: state.riskSettings,
    limits: {
      minBuyScore: MIN_BUY_SCORE,
      maxTrades: 500,
      maxClosedPositions: 200,
      maxOpenPositions: 25,
    },
  };
}

// ── GET ─────────────────────────────────────────────────────────────────────

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const action = url.searchParams.get('action') ?? 'bootstrap';

  if (action === 'bootstrap') {
    try {
      const state = await getOrInitPortfolioState();
      return jsonResponse(briefPayload(state));
    } catch (err: any) {
      return jsonResponse(
        { error: 'bootstrap_failed', message: err?.message ?? String(err) },
        500,
      );
    }
  }

  if (action === 'latest-alert') {
    try {
      const state = await loadPortfolioState();
      return jsonResponse({ alert: state?.lastAlert ?? null });
    } catch (err: any) {
      return jsonResponse(
        { error: 'latest_alert_failed', message: err?.message ?? String(err) },
        500,
      );
    }
  }

  return jsonResponse({ error: 'unknown_action', action }, 400);
};

// ── POST ────────────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const action = body?.action;

  if (action === 'reset') {
    const fresh = await resetPortfolioState();
    const actor = await getOperatorId(session);
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'crypto_paper_portfolio_reset',
        targetType: 'crypto_paper_trading',
        summary: 'Reset paper trading portfolio to starting bankroll.',
        details: {
          system: 'crypto_paper_trading',
          mode: 'paper',
          startingBankroll: fresh.startingBankroll,
        },
      });
    }
    return jsonResponse(briefPayload(fresh));
  }

  if (action === 'simulate-signal' || action === 'simulate-sample-signal') {
    const signal: CryptoSignal | null =
      action === 'simulate-sample-signal'
        ? SAMPLE_SIGNAL
        : looksLikeSignal(body.signal)
          ? body.signal
          : null;
    if (!signal) {
      return jsonResponse(
        {
          error: 'invalid_signal',
          message:
            'signal payload missing required fields (symbol, assetName, recommendation, score, confidence, entryPrice, rationale).',
        },
        400,
      );
    }
    const persist = body.persist !== false;
    try {
      const state = await getOrInitPortfolioState();
      const result = simulateSignal(state, signal);
      // Always record the alert payload (even for blocked or no-op) so
      // the preview page has something to render after any simulation.
      const stateWithAlert: PaperPortfolioState = { ...result.updatedState, lastAlert: result.alert };
      if (persist) {
        await savePortfolioState(stateWithAlert);
      }
      const rendered = renderCryptoTradeAlertPayload(result.alert, {
        recipient: 'derek@derekbdavis.com',
      });
      const actor = await getOperatorId(session);
      if (actor) {
        await logAuditEvent({
          actor,
          eventType:
            result.applied
              ? 'crypto_paper_trade_simulated'
              : result.blockedReason
                ? 'crypto_paper_trade_blocked'
                : 'crypto_paper_signal_no_op',
          targetType: 'crypto_paper_trading',
          targetId: signal.symbol,
          summary: `[mode=paper] ${result.alert.action} ${signal.symbol} · score ${signal.score} · risk ${result.alert.riskPct.toFixed(2)}% · notional ${result.alert.positionValue.toFixed(2)}${
            result.blockedReason ? ` · blocked: ${result.blockedReason}` : ''
          }`,
          details: {
            system: 'crypto_paper_trading',
            mode: 'paper',
            symbol: signal.symbol,
            action: result.alert.action,
            score: signal.score,
            riskPctBankroll: result.alert.riskPct,
            notionalValue: result.alert.positionValue,
            blockedReason: result.blockedReason,
            persisted: persist,
            createdAt: result.alert.generatedAt,
          },
        });
      }
      return jsonResponse({
        applied: result.applied,
        blockedReason: result.blockedReason,
        trade: result.trade ?? null,
        alert: result.alert,
        renderedAlert: rendered,
        state: persist ? recomputeDerivedFields(stateWithAlert) : recomputeDerivedFields(state),
      });
    } catch (err: any) {
      return jsonResponse(
        { error: 'simulate_failed', message: err?.message ?? String(err) },
        500,
      );
    }
  }

  return jsonResponse({ error: 'unknown_action', action }, 400);
};
