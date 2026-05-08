// ── Step 136: Admin API for forecast provider A/B comparison ────────────────
//
// Read-only diagnostics. Mirrors the conventions of the Kalshi /
// Polymarket admin APIs: requireAdmin gate, action-based dispatch,
// audit-logged, no secrets returned, no public/customer reachability.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import {
  runProviderComparison,
  toCompactRun,
} from '../../../../lib/forecast-provider-comparison-runner';
import {
  recordComparisonRun,
  listComparisonRuns,
  getComparisonRun,
} from '../../../../lib/forecast-provider-comparison-store';

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
      const snapshots = await listComparisonRuns(limit);
      return jsonResponse({ snapshots });
    }

    if (action === 'get-snapshot') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const snapshot = await getComparisonRun(id);
      if (!snapshot) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ snapshot });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'forecast_provider_comparison_failed', message: err?.message ?? String(err) },
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

    if (action === 'run-comparison') {
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return jsonResponse({ error: 'invalid_input', message: 'lat and lon must be numeric' }, 400);
      }
      const days = Math.max(1, Math.min(15, Math.floor(Number(body.days) || 5)));
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : undefined;
      const includeWeatherNextSample = body.includeWeatherNextSample === true;
      const includeWeatherNextProduction = body.includeWeatherNextProduction === true;

      const run = await runProviderComparison({
        lat,
        lon,
        days,
        label,
        includeWeatherNextSample,
        includeWeatherNextProduction,
      });

      const compact = toCompactRun(run);
      try {
        await recordComparisonRun(compact);
      } catch (err) {
        console.warn('[forecast-provider-comparison] snapshot persist failed:', err);
      }

      await logAuditEvent({
        actor,
        eventType: 'forecast_provider_comparison_run',
        targetType: 'forecast_provider_comparison',
        targetId: run.id,
        summary: `Compared ${compact.providerSummaries.length} forecast provider(s) at ${lat.toFixed(3)},${lon.toFixed(3)}.`,
        details: {
          lat,
          lon,
          days,
          label,
          providerSummaries: compact.providerSummaries.map((p) => ({
            provider: p.provider,
            ok: p.ok,
            failureMode: p.failureMode,
            durationMs: p.durationMs,
          })),
        },
      });

      return jsonResponse({ snapshot: compact });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'forecast_provider_comparison_action_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};
