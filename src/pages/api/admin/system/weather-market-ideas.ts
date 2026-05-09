// ── Step 144 / Step 145: Admin API for weather market idea generation ────
//
// Read-only diagnostics. Generates draft pointspread ideas — never
// creates a wager, never publishes anything, never touches pricing,
// settlement, grading, or wallet code paths.
//
// Step 145 added target-difference search inputs (targetDifferenceF,
// toleranceF, metricPair, dayOffset, maxResults) and tightened input
// validation. The route still has no mutation surface.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import {
  generateWeatherMarketIdeas,
  METRIC_PAIR_OPTIONS,
  TARGET_DIFFERENCE_F_MAX,
  TOLERANCE_F_MAX,
  MAX_RESULTS_CAP,
  type MetricPairOption,
} from '../../../../lib/weather-market-idea-generator';
import { FORECAST_QUALITY_SEED_CITIES } from '../../../../lib/forecast-quality-seed-cities';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T12:00:00Z`);
  return Number.isFinite(t);
}

function isFiniteNumberInRange(n: unknown, min: number, max: number): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Surface the seed list + the validation envelope so the UI can render
  // the controls (and label the limits) without round-tripping through
  // the existing forecast-quality endpoint or hardcoding values.
  return jsonResponse({
    seedCities: FORECAST_QUALITY_SEED_CITIES,
    metricPairOptions: METRIC_PAIR_OPTIONS,
    limits: {
      targetDifferenceFMax: TARGET_DIFFERENCE_F_MAX,
      toleranceFMax: TOLERANCE_F_MAX,
      maxResultsCap: MAX_RESULTS_CAP,
    },
  });
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
  if (action !== 'generate') {
    return jsonResponse(
      { error: 'Unknown or missing action', supported: ['generate'] },
      400,
    );
  }

  // ── Step 145 — validate target-difference search inputs ──
  let targetDate: string | undefined =
    typeof body.targetDate === 'string' ? body.targetDate : undefined;
  const dayOffset =
    typeof body.dayOffset === 'number' && Number.isFinite(body.dayOffset)
      ? Math.round(body.dayOffset)
      : undefined;
  if (!targetDate && dayOffset === undefined) {
    return jsonResponse(
      { error: 'invalid_target_date', message: 'targetDate (YYYY-MM-DD) or dayOffset is required' },
      400,
    );
  }
  if (targetDate && !isValidDate(targetDate)) {
    return jsonResponse(
      { error: 'invalid_target_date', message: 'targetDate must be YYYY-MM-DD' },
      400,
    );
  }
  if (dayOffset !== undefined && !isFiniteNumberInRange(dayOffset, 0, 14)) {
    return jsonResponse(
      { error: 'invalid_day_offset', message: 'dayOffset must be 0–14' },
      400,
    );
  }

  let targetDifferenceF: number | undefined;
  if (body.targetDifferenceF !== undefined && body.targetDifferenceF !== null) {
    if (!isFiniteNumberInRange(body.targetDifferenceF, 0, TARGET_DIFFERENCE_F_MAX)) {
      return jsonResponse(
        {
          error: 'invalid_target_difference',
          message: `targetDifferenceF must be a number between 0 and ${TARGET_DIFFERENCE_F_MAX}`,
        },
        400,
      );
    }
    targetDifferenceF = body.targetDifferenceF;
  }

  let toleranceF: number | undefined;
  if (body.toleranceF !== undefined && body.toleranceF !== null) {
    if (!isFiniteNumberInRange(body.toleranceF, 0, TOLERANCE_F_MAX)) {
      return jsonResponse(
        {
          error: 'invalid_tolerance',
          message: `toleranceF must be a number between 0 and ${TOLERANCE_F_MAX}`,
        },
        400,
      );
    }
    toleranceF = body.toleranceF;
  }

  let metricPair: MetricPairOption | undefined;
  if (body.metricPair !== undefined && body.metricPair !== null) {
    if (typeof body.metricPair !== 'string' || !METRIC_PAIR_OPTIONS.includes(body.metricPair as MetricPairOption)) {
      return jsonResponse(
        {
          error: 'invalid_metric_pair',
          message: `metricPair must be one of ${METRIC_PAIR_OPTIONS.join(', ')}`,
        },
        400,
      );
    }
    metricPair = body.metricPair;
  }

  const cityIds = Array.isArray(body.cityIds)
    ? body.cityIds.filter((s: any) => typeof s === 'string')
    : undefined;

  let maxIdeas: number | undefined;
  if (body.maxIdeas !== undefined && body.maxIdeas !== null) {
    if (!isFiniteNumberInRange(body.maxIdeas, 1, MAX_RESULTS_CAP)) {
      return jsonResponse(
        { error: 'invalid_max_ideas', message: `maxIdeas must be 1–${MAX_RESULTS_CAP}` },
        400,
      );
    }
    maxIdeas = Math.round(body.maxIdeas);
  }

  let maxResults: number | undefined;
  if (body.maxResults !== undefined && body.maxResults !== null) {
    if (!isFiniteNumberInRange(body.maxResults, 1, MAX_RESULTS_CAP)) {
      return jsonResponse(
        { error: 'invalid_max_results', message: `maxResults must be 1–${MAX_RESULTS_CAP}` },
        400,
      );
    }
    maxResults = Math.round(body.maxResults);
  }

  try {
    const result = await generateWeatherMarketIdeas({
      targetDate,
      dayOffset,
      cityIds,
      maxIdeas,
      maxResults,
      targetDifferenceF,
      toleranceF,
      metricPair,
    });
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'weather_market_ideas_generated',
        targetType: 'weather_market_ideas',
        summary: `Generated ${result.ideas.length} draft idea(s) for ${result.targetDate} (metricPair=${result.resolved.metricPair}${
          targetDifferenceF !== undefined ? `, target=${targetDifferenceF}±${toleranceF ?? 3}°F` : ''
        }) across ${result.cityCount} city/cities.`,
        details: {
          targetDate: result.targetDate,
          dayOffset,
          targetDifferenceF,
          toleranceF,
          metricPair: result.resolved.metricPair,
          cityCount: result.cityCount,
          ideaCount: result.ideas.length,
          warnings: result.warnings,
        },
      });
    }
    return jsonResponse({ result });
  } catch (err: any) {
    return jsonResponse(
      { error: 'weather_market_ideas_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};
