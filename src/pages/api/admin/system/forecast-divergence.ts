// ── Step 165: Forecast Divergence Intelligence API ───────────────────────
//
// Admin-only endpoint that wraps the Step 165 divergence engine. Two
// usable surfaces:
//
//   1. POST `action=analyze` with `body.snapshots` — pure scoring path.
//      Useful for testing + for callers that already have their own
//      forecast revision pipeline.
//
//   2. POST `action=analyze-stored` with `locationKey | (zip | lat+lon)`
//      + `targetDate` + `metric` — pulls the historical snapshot series
//      from `forecast-revision-store` (Step 132 infra) and runs the
//      analyzer on it. Graceful when fewer than two snapshots exist.
//
// **Admin-gated. Read-only.** No writes to the snapshot store, no
// publish/grade/settlement/wallet/Kalshi/Polymarket calls anywhere in
// this file.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import {
  calculateForecastDivergence,
  getDivergenceThresholds,
  DIVERGENCE_METRICS,
  STABILITY_LABELS,
  RISK_LEVELS,
  type DivergenceMetric,
  type DivergenceSnapshotValue,
  type ForecastDivergenceResult,
} from '../../../../lib/forecast-divergence';
import {
  listSnapshots,
  locationKey as buildLocationKey,
  type ForecastSnapshot,
} from '../../../../lib/forecast-revision-store';
import {
  analyzeSavedIdeasDivergence,
  MAX_SAVED_IDEAS_PER_BATCH,
} from '../../../../lib/forecast-divergence-watch';

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

function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T12:00:00Z`));
}

function isValidMetric(s: unknown): s is DivergenceMetric {
  return typeof s === 'string' && (DIVERGENCE_METRICS as readonly string[]).includes(s);
}

function looksLikeSnapshotValue(x: any): x is DivergenceSnapshotValue {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof x.forecastTime === 'string' &&
    typeof x.value === 'number' &&
    Number.isFinite(x.value)
  );
}

/** Project a stored ForecastSnapshot daily entry → a Step-165 snapshot value. */
function projectStoredSnapshot(
  stored: ForecastSnapshot,
  targetDate: string,
  metric: DivergenceMetric,
): DivergenceSnapshotValue | null {
  const day = stored.daily?.find((d) => d.date === targetDate);
  if (!day) return null;
  let value: number;
  switch (metric) {
    case 'high_temp':
      value = day.highF;
      break;
    case 'low_temp':
      value = day.lowF;
      break;
    case 'precipitation_probability':
      value = day.precipProbability;
      break;
    case 'wind_speed':
      value = day.windSpeedMph;
      break;
  }
  if (!Number.isFinite(value)) return null;
  return {
    forecastTime: stored.generatedAt,
    value,
  };
}

function daysUntilTarget(targetDate: string, now: number = Date.now()): number {
  const t = Date.parse(`${targetDate}T12:00:00Z`);
  if (!Number.isFinite(t)) return 0;
  return Math.round((t - now) / (24 * 60 * 60 * 1000));
}

// ── GET ─────────────────────────────────────────────────────────────────────

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const action = url.searchParams.get('action') ?? 'bootstrap';

  if (action === 'bootstrap') {
    return jsonResponse({
      metrics: DIVERGENCE_METRICS,
      stabilityLabels: STABILITY_LABELS,
      riskLevels: RISK_LEVELS,
      thresholdsByMetric: Object.fromEntries(
        DIVERGENCE_METRICS.map((m) => [m, getDivergenceThresholds(m)]),
      ),
      limits: {
        maxSnapshotsPerRequest: 30,
      },
    });
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

  if (action === 'analyze') {
    return handleAnalyze(body, session);
  }
  if (action === 'analyze-stored') {
    return handleAnalyzeStored(body, session);
  }
  if (action === 'analyze-saved-ideas') {
    return handleAnalyzeSavedIdeas(body, session);
  }
  return jsonResponse({ error: 'unknown_action', action }, 400);
};

async function handleAnalyzeSavedIdeas(body: any, session: string): Promise<Response> {
  const ids = Array.isArray(body?.savedIdeaIds)
    ? body.savedIdeaIds.filter((s: any) => typeof s === 'string')
    : [];
  if (ids.length === 0) {
    return jsonResponse({ results: {} });
  }
  if (ids.length > MAX_SAVED_IDEAS_PER_BATCH) {
    return jsonResponse(
      {
        error: 'too_many_saved_ideas',
        message: `savedIdeaIds must contain at most ${MAX_SAVED_IDEAS_PER_BATCH} entries.`,
        suppliedCount: ids.length,
      },
      400,
    );
  }
  try {
    const results = await analyzeSavedIdeasDivergence(ids);
    // Best-effort audit — non-fatal.
    try {
      const actor = await getOperatorId(session);
      if (actor) {
        await logAuditEvent({
          actor,
          eventType: 'forecast_divergence_analyze_saved_ideas',
          targetType: 'forecast_divergence',
          summary: `Analyzed divergence for ${ids.length} saved-idea id(s); produced ${Object.keys(results).length} result(s).`,
          details: {
            system: 'forecast_divergence',
            requestedCount: ids.length,
            producedCount: Object.keys(results).length,
          },
        });
      }
    } catch {
      /* non-fatal */
    }
    return jsonResponse({ results });
  } catch (err: any) {
    return jsonResponse(
      { error: 'analyze_saved_ideas_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleAnalyze(body: any, session: string): Promise<Response> {
  if (!isValidMetric(body.metric)) {
    return jsonResponse(
      { error: 'invalid_metric', message: `metric must be one of ${DIVERGENCE_METRICS.join(', ')}` },
      400,
    );
  }
  if (typeof body.targetDate !== 'string' || !isValidDateString(body.targetDate)) {
    return jsonResponse(
      { error: 'invalid_target_date', message: 'targetDate must be YYYY-MM-DD' },
      400,
    );
  }
  if (!Array.isArray(body.snapshots)) {
    return jsonResponse(
      { error: 'invalid_snapshots', message: 'snapshots must be an array' },
      400,
    );
  }
  // Bound the snapshot list defensively — anything beyond 30 is dropped.
  const snapshots = body.snapshots
    .filter((s: any) => looksLikeSnapshotValue(s))
    .slice(0, 30) as DivergenceSnapshotValue[];

  const cityName = typeof body.cityName === 'string' ? body.cityName.slice(0, 80) : undefined;
  const daysUntil =
    typeof body.daysUntilTarget === 'number' && Number.isFinite(body.daysUntilTarget)
      ? Math.round(body.daysUntilTarget)
      : daysUntilTarget(body.targetDate);
  const metricNoiseHint =
    body.metricNoiseHint === 'low' ||
    body.metricNoiseHint === 'medium' ||
    body.metricNoiseHint === 'high'
      ? body.metricNoiseHint
      : undefined;

  const result = calculateForecastDivergence({
    cityName,
    targetDate: body.targetDate,
    metric: body.metric,
    snapshots,
    daysUntilTarget: daysUntil,
    metricNoiseHint,
  });

  await safeAudit(session, 'analyze', result);
  return jsonResponse({ result });
}

async function handleAnalyzeStored(body: any, session: string): Promise<Response> {
  if (!isValidMetric(body.metric)) {
    return jsonResponse(
      { error: 'invalid_metric', message: `metric must be one of ${DIVERGENCE_METRICS.join(', ')}` },
      400,
    );
  }
  if (typeof body.targetDate !== 'string' || !isValidDateString(body.targetDate)) {
    return jsonResponse(
      { error: 'invalid_target_date', message: 'targetDate must be YYYY-MM-DD' },
      400,
    );
  }

  // Build a location key from either an explicit `locationKey`, a
  // `zip` + `countryCode`, or `lat`+`lon`. Reuses the helper so the
  // canonicalization matches whatever wrote the snapshots.
  let locKey: string | null = null;
  if (typeof body.locationKey === 'string' && body.locationKey.trim()) {
    locKey = body.locationKey.trim();
  } else if (typeof body.zip === 'string' && body.zip.trim()) {
    locKey = buildLocationKey({
      zip: body.zip,
      countryCode: typeof body.countryCode === 'string' ? body.countryCode : undefined,
      lat: typeof body.lat === 'number' ? body.lat : 0,
      lon: typeof body.lon === 'number' ? body.lon : 0,
    });
  } else if (typeof body.lat === 'number' && typeof body.lon === 'number') {
    locKey = buildLocationKey({ lat: body.lat, lon: body.lon });
  }
  if (!locKey) {
    return jsonResponse(
      {
        error: 'missing_location',
        message: 'Provide locationKey, zip+countryCode, or lat+lon.',
      },
      400,
    );
  }

  const requestedLimit =
    typeof body.limit === 'number' && Number.isFinite(body.limit) ? Math.round(body.limit) : 12;

  let stored: ForecastSnapshot[];
  try {
    stored = await listSnapshots(locKey, Math.min(30, Math.max(2, requestedLimit)));
  } catch (err: any) {
    return jsonResponse(
      { error: 'snapshot_store_failed', message: err?.message ?? String(err) },
      500,
    );
  }

  const projected: DivergenceSnapshotValue[] = [];
  for (const s of stored) {
    const v = projectStoredSnapshot(s, body.targetDate, body.metric);
    if (v) projected.push(v);
  }

  const cityName = typeof body.cityName === 'string' ? body.cityName.slice(0, 80) : undefined;
  const daysUntil = daysUntilTarget(body.targetDate);
  const metricNoiseHint =
    body.metricNoiseHint === 'low' ||
    body.metricNoiseHint === 'medium' ||
    body.metricNoiseHint === 'high'
      ? body.metricNoiseHint
      : undefined;

  const result = calculateForecastDivergence({
    cityName,
    targetDate: body.targetDate,
    metric: body.metric,
    snapshots: projected,
    daysUntilTarget: daysUntil,
    metricNoiseHint,
  });

  await safeAudit(session, 'analyze-stored', result, { locationKey: locKey, storedCount: stored.length });
  return jsonResponse({ result, locationKey: locKey, storedSnapshotCount: stored.length });
}

async function safeAudit(
  session: string,
  variant: 'analyze' | 'analyze-stored',
  result: ForecastDivergenceResult,
  extra: Record<string, any> = {},
): Promise<void> {
  try {
    const actor = await getOperatorId(session);
    if (!actor) return;
    await logAuditEvent({
      actor,
      eventType: `forecast_divergence_${variant.replace('-', '_')}`,
      targetType: 'forecast_divergence',
      summary: `${result.stabilityLabel} · ${result.metric} ${result.targetDate ?? ''} · spread ${result.spread} · divergence ${result.divergenceScore} · volatility ${result.volatilityScore} · settlement ${result.settlementRisk} · opportunity ${result.opportunitySignal} · n=${result.comparedForecasts}`,
      details: {
        system: 'forecast_divergence',
        metric: result.metric,
        targetDate: result.targetDate,
        cityName: result.cityName,
        spread: result.spread,
        divergenceScore: result.divergenceScore,
        volatilityScore: result.volatilityScore,
        revisionMagnitude: result.revisionMagnitude,
        stabilityLabel: result.stabilityLabel,
        settlementRisk: result.settlementRisk,
        opportunitySignal: result.opportunitySignal,
        comparedForecasts: result.comparedForecasts,
        ...extra,
      },
    });
  } catch {
    /* audit failures are non-fatal — operator-facing read still works */
  }
}
