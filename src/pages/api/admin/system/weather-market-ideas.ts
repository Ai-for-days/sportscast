// ── Step 144: Admin API for weather market idea generation ──────────────────
//
// Read-only diagnostics. Generates draft pointspread ideas — never
// creates a wager, never publishes anything, never touches pricing,
// settlement, grading, or wallet code paths.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import { generateWeatherMarketIdeas } from '../../../../lib/weather-market-idea-generator';
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

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Surface the seed list so the UI can render the city checkbox / selector
  // without round-tripping through the existing forecast-quality endpoint.
  return jsonResponse({ seedCities: FORECAST_QUALITY_SEED_CITIES });
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

  const targetDate = typeof body.targetDate === 'string' ? body.targetDate : '';
  if (!isValidDate(targetDate)) {
    return jsonResponse(
      { error: 'invalid_target_date', message: 'targetDate must be YYYY-MM-DD' },
      400,
    );
  }

  const cityIds = Array.isArray(body.cityIds)
    ? body.cityIds.filter((s: any) => typeof s === 'string')
    : undefined;
  const maxIdeas = typeof body.maxIdeas === 'number' && body.maxIdeas > 0 ? body.maxIdeas : undefined;

  try {
    const result = await generateWeatherMarketIdeas({
      targetDate,
      cityIds,
      maxIdeas,
    });
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'weather_market_ideas_generated',
        targetType: 'weather_market_ideas',
        summary: `Generated ${result.ideas.length} draft idea(s) for ${targetDate} across ${result.cityCount} city/cities.`,
        details: {
          targetDate,
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
