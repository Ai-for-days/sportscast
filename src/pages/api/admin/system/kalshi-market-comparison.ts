// ── Step 119: Admin API for Kalshi vs WagerOnWeather comparisons ────────────
//
// Read-only / advisory-only. No wager mutation. No pricing mutation. No
// trade endpoints. Admin-only at every entry.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import { listAllWagers } from '../../../../lib/wager-store';
import {
  generateComparison,
  listComparisons,
  getComparison,
  getComparisonsByWager,
  getComparisonSummary,
  KalshiComparisonError,
  type KalshiComparison,
} from '../../../../lib/kalshi-market-comparison';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list';

    if (action === 'list') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw) || 50)) : 50;
      const comparisons = await listComparisons(limit);
      return jsonResponse({ comparisons });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const comparison = await getComparison(id);
      if (!comparison) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ comparison });
    }

    if (action === 'get-by-wager') {
      const wagerId = url.searchParams.get('wagerId');
      if (!wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(50, Math.max(1, Number(limitRaw) || 20)) : 20;
      const comparisons = await getComparisonsByWager(wagerId, limit);
      return jsonResponse({ comparisons });
    }

    if (action === 'summary') {
      const summary = await getComparisonSummary();
      return jsonResponse({ summary });
    }

    if (action === 'list-wagers') {
      // Convenience: a thin admin wager picker that returns only what the UI needs.
      const wagers = await listAllWagers(200);
      const slim = wagers.map((w) => ({
        id: w.id,
        ticketNumber: w.ticketNumber,
        title: w.title,
        kind: w.kind,
        status: w.status,
        metric: w.metric,
        targetDate: w.targetDate,
      }));
      return jsonResponse({ wagers: slim });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'kalshi_market_comparison_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  const action = body.action as string | undefined;
  if (!action) return jsonResponse({ error: 'Missing action' }, 400);

  try {
    const actor = await getOperatorId(session ?? '');
    if (!actor) {
      return jsonResponse(
        { error: 'actor_required', message: 'No operator id resolved from session' },
        400,
      );
    }

    if (action === 'generate') {
      let comparison: KalshiComparison;
      try {
        comparison = await generateComparison(
          {
            wagerId: typeof body.wagerId === 'string' ? body.wagerId : '',
            snapshotId:
              typeof body.snapshotId === 'string' && body.snapshotId.trim()
                ? body.snapshotId.trim()
                : undefined,
          },
          actor,
        );
      } catch (err: any) {
        if (err instanceof KalshiComparisonError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }

      await logAuditEvent({
        actor,
        eventType: 'kalshi_market_comparison_generated',
        targetType: 'kalshi_comparison',
        targetId: comparison.id,
        summary: `Generated Kalshi comparison for wager ${comparison.wagerId}: verdict=${comparison.verdict}, matched=${comparison.matchedKalshiMarkets.length}.`,
        details: {
          wagerId: comparison.wagerId,
          snapshotId: comparison.kalshiSnapshotId,
          matched: comparison.matchedKalshiMarkets.length,
          pricingGaps: comparison.pricingGapNotes.length,
          hedgeReviewNotes: comparison.hedgeReviewNotes.length,
          verdict: comparison.verdict,
        },
      });

      return jsonResponse({ comparison });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'kalshi_market_comparison_action_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};
