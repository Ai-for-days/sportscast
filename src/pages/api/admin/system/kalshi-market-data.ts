// ── Step 118: Admin API for Kalshi market-data snapshots ────────────────────
//
// Read-only Kalshi data ingestion. Fetches markets, normalizes, persists
// snapshots, and exposes config status / list / get / fetch endpoints.
// Admin-only; never reachable from public surfaces. No order/trade routes.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import { getKalshiConfig } from '../../../../lib/kalshi-config';
import {
  fetchAndStoreMarketSnapshot,
  listMarketSnapshots,
  getMarketSnapshot,
  testKalshiConnectivity,
  KalshiMarketDataError,
  type KalshiMarketSnapshot,
} from '../../../../lib/kalshi-market-data';
import type { ListMarketsParams } from '../../../../lib/kalshi-client';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function publicConfigStatus() {
  const cfg = getKalshiConfig();
  return {
    apiKeyIdConfigured: !!cfg.apiKeyId,
    privateKeyPresent: cfg.privateKeyPresent,
    env: cfg.env,
    readOnly: cfg.readOnly,
  };
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list-snapshots';

    if (action === 'config-status') {
      return jsonResponse({ config: publicConfigStatus() });
    }

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
      { error: 'kalshi_market_data_failed', message: err?.message ?? String(err) },
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
      const result = await testKalshiConnectivity();
      await logAuditEvent({
        actor,
        eventType: 'kalshi_connectivity_test',
        targetType: 'kalshi_market_data',
        summary: result.ok
          ? `Kalshi connectivity test succeeded (env=${result.env}, markets=${result.marketsReturned}).`
          : `Kalshi connectivity test failed (env=${result.env}, code=${result.code}).`,
        details: {
          code: result.code,
          ok: result.ok,
          httpStatus: result.httpStatus,
          env: result.env,
          marketsReturned: result.marketsReturned,
        },
      });
      return jsonResponse({ result });
    }

    if (action === 'fetch-markets') {
      const query: ListMarketsParams = {
        q: typeof body.q === 'string' && body.q.trim() ? body.q.trim() : undefined,
        event_ticker:
          typeof body.event_ticker === 'string' && body.event_ticker.trim()
            ? body.event_ticker.trim()
            : undefined,
        status:
          typeof body.status === 'string' && body.status.trim() ? body.status.trim() : undefined,
        limit:
          typeof body.limit === 'number' && body.limit > 0
            ? Math.min(1000, Math.floor(body.limit))
            : undefined,
      };

      let snapshot: KalshiMarketSnapshot;
      try {
        snapshot = await fetchAndStoreMarketSnapshot(query, actor);
      } catch (err: any) {
        if (err instanceof KalshiMarketDataError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }

      await logAuditEvent({
        actor,
        eventType: 'kalshi_market_snapshot_fetched',
        targetType: 'kalshi_market_snapshot',
        targetId: snapshot.id,
        summary: `Fetched ${snapshot.markets.length} Kalshi market(s) from ${snapshot.kalshiEnv}.`,
        details: {
          query: snapshot.query,
          env: snapshot.kalshiEnv,
          marketCount: snapshot.markets.length,
          warnings: snapshot.warnings,
        },
      });

      return jsonResponse({ snapshot });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'kalshi_market_data_action_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};
