// ── Step 126: Admin API for Polymarket weather market data ──────────────────
//
// Read-only Polymarket data ingestion. Discovers weather markets via the
// public Gamma API, normalizes them, persists snapshots, and exposes
// list/get/discover/test-connectivity endpoints. Admin-only; never
// reachable from public surfaces. No order/wallet/signing routes exist.
//
// Mirrors src/pages/api/admin/system/kalshi-market-data.ts conventions.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import {
  fetchAndStoreWeatherSnapshot,
  listMarketSnapshots,
  getMarketSnapshot,
  testPolymarketConnectivity,
  PolymarketMarketDataError,
  type PolymarketMarketSnapshot,
} from '../../../../lib/polymarket-market-store';

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
    const action = url.searchParams.get('action') ?? 'list-snapshots';

    if (action === 'list-snapshots') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw) || 50)) : 50;
      const snapshots = await listMarketSnapshots(limit);
      return jsonResponse({ snapshots });
    }

    if (action === 'get-snapshot') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const snapshot = await getMarketSnapshot(id);
      if (!snapshot) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ snapshot });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'polymarket_market_data_failed', message: err?.message ?? String(err) },
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

    if (action === 'test-connectivity') {
      const result = await testPolymarketConnectivity();
      await logAuditEvent({
        actor,
        eventType: 'polymarket_connectivity_test',
        targetType: 'polymarket_market_data',
        summary: result.ok
          ? `Polymarket connectivity test succeeded (markets=${result.marketsReturned}).`
          : `Polymarket connectivity test failed (code=${result.code}).`,
        details: {
          code: result.code,
          ok: result.ok,
          httpStatus: result.httpStatus,
          marketsReturned: result.marketsReturned,
        },
      });
      return jsonResponse({ result });
    }

    if (action === 'discover-weather-markets') {
      const limit =
        typeof body.limit === 'number' && body.limit > 0
          ? Math.min(500, Math.floor(body.limit))
          : undefined;

      let snapshot: PolymarketMarketSnapshot;
      try {
        snapshot = await fetchAndStoreWeatherSnapshot({ limit }, actor);
      } catch (err: any) {
        if (err instanceof PolymarketMarketDataError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }

      await logAuditEvent({
        actor,
        eventType: 'polymarket_market_snapshot_fetched',
        targetType: 'polymarket_market_snapshot',
        targetId: snapshot.id,
        summary: `Fetched ${snapshot.markets.length} Polymarket weather market(s) (${snapshot.strategy}).`,
        details: {
          query: snapshot.query,
          strategy: snapshot.strategy,
          marketCount: snapshot.markets.length,
          warnings: snapshot.warnings,
        },
      });

      return jsonResponse({ snapshot });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'polymarket_market_data_action_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};
