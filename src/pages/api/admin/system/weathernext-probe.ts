// ── Step 171: WeatherNext Vertex contract probe (admin-only) ────────────
//
// Diagnostic-only endpoint that wraps the Step 171 probe helpers from
// `weathernext-client.ts`. **Admin-gated. Read-only by default. Makes
// at most one Vertex AI call per POST, only when both feature flags
// are true.** The public ZIP-code forecast flow is never affected.
//
// GET: returns config + flag readiness only. Zero network calls.
// POST: validates auth + flags + env, issues one probe, returns the
//       sanitized `WeatherNextProbeResult`.
//
// **No raw credentials, tokens, endpoint ids, or full response bodies
// are ever returned.** The probe helpers sanitize their own output;
// this endpoint just forwards it.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import {
  validateWeatherNextVertexConfig,
  probeWeatherNextVertexContract,
} from '../../../../lib/weathernext-client';

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

// ── GET — config + readiness only ───────────────────────────────────────────

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const config = validateWeatherNextVertexConfig();
  const notes: string[] = [];
  if (!config.weatherNextEnabled) {
    notes.push('WEATHER_PROVIDER_WEATHERNEXT_ENABLED is not "true" — Step 170 kill switch active.');
  }
  if (!config.probeEnabled) {
    notes.push('WEATHERNEXT_VERTEX_PROBE_ENABLED is not "true" — POST will refuse to call Vertex AI.');
  }
  const missing: string[] = [];
  if (!config.hasProjectId) missing.push('GCP_PROJECT_ID');
  if (!config.hasCredentials) missing.push('GCP_CREDENTIALS_BASE64');
  if (!config.hasRegion) missing.push('WEATHERNEXT_VERTEX_REGION');
  if (!config.hasEndpointId) missing.push('WEATHERNEXT_VERTEX_ENDPOINT_ID');
  if (missing.length > 0) {
    notes.push(`Missing required env: ${missing.join(', ')}.`);
  }
  const ready =
    config.weatherNextEnabled &&
    config.probeEnabled &&
    config.hasProjectId &&
    config.hasCredentials &&
    config.hasRegion &&
    config.hasEndpointId;

  return jsonResponse({
    ok: ready,
    status: ready ? 'ready_to_probe' : 'not_ready',
    config,
    notes,
    publicForecastFlow: 'unchanged_open_meteo',
  });
};

// ── POST — controlled probe ────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* tolerate empty bodies for default probe */
  }

  const lat = typeof body?.lat === 'number' && Number.isFinite(body.lat) ? body.lat : undefined;
  const lon = typeof body?.lon === 'number' && Number.isFinite(body.lon) ? body.lon : undefined;

  let result;
  try {
    result = await probeWeatherNextVertexContract({ lat, lon });
  } catch (err: any) {
    // probeWeatherNextVertexContract never throws today, but defensively
    // surface anything unexpected as an admin-only error.
    return jsonResponse(
      {
        ok: false,
        status: 'unexpected_error',
        notes: [String(err?.message ?? err).slice(0, 240)],
      },
      500,
    );
  }

  // Best-effort audit — never raw creds or tokens; only the structured status.
  try {
    const actor = await getOperatorId(session);
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'weathernext_vertex_probe',
        targetType: 'weathernext_probe',
        summary: `WeatherNext probe status=${result.status} httpStatus=${result.httpStatus ?? 'n/a'} flags=(wn=${result.config.weatherNextEnabled},probe=${result.config.probeEnabled}).`,
        details: {
          system: 'weathernext_probe',
          status: result.status,
          httpStatus: result.httpStatus,
          configReady:
            result.config.weatherNextEnabled &&
            result.config.probeEnabled &&
            result.config.hasProjectId &&
            result.config.hasCredentials &&
            result.config.hasRegion &&
            result.config.hasEndpointId,
          requestShapeAttempted: result.requestShapeAttempted,
          topLevelKeys: result.responseShapeSummary?.topLevelKeys,
          forecastLikeFieldCount: result.responseShapeSummary?.forecastLikeFields?.length ?? 0,
        },
      });
    }
  } catch {
    /* audit failures are non-fatal */
  }

  return jsonResponse(result);
};
