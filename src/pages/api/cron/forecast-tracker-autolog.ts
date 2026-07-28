// ── Forecast Tracker autolog cron ───────────────────────────────────────────
//
// Secret-protected cron that records Forecast Tracker entries automatically for
// the seeded city set, so the accuracy leaderboard fills itself instead of
// depending on an operator running manual pulls.
//
// Auth matches the existing crons, in order of precedence:
//   1. FORECAST_TRACKER_CRON_SECRET — feature-isolated secret (preferred).
//   2. CRON_SECRET — project-wide convention, so one Vercel Cron secret still
//      works for every job.
// With neither configured the endpoint refuses every request and never echoes
// a secret in any response, log line, or error.
//
// Writes ONLY to the forecast-tracker store. No grading, settlement, wallet,
// pricing, or customer-facing surface is touched. Re-running the same day is a
// no-op: entries are deduped on (city, metric, target date, source).
//
// Query params (all optional):
//   ?dryRun=true      report what would be written, write nothing
//   ?horizons=1,3,5   days ahead to log (never 0 — see the autolog lib)
//   ?cities=a,b       restrict to seed city ids
//   ?budgetMs=45000   wall-clock budget

import type { APIRoute } from 'astro';
import { runForecastTrackerAutolog } from '../../../lib/forecast-tracker-autolog';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function readEnv(name: string): string | undefined {
  const v = (import.meta as any).env?.[name];
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof process !== 'undefined' && process.env) {
    const p = process.env[name];
    if (typeof p === 'string' && p.length > 0) return p;
  }
  return undefined;
}

function isAuthorized(request: Request): { ok: boolean; reason?: string } {
  const expected = readEnv('FORECAST_TRACKER_CRON_SECRET') ?? readEnv('CRON_SECRET');
  if (!expected) return { ok: false, reason: 'no_secret_configured' };
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader === `Bearer ${expected}`) return { ok: true };
  return { ok: false, reason: 'invalid_or_missing_bearer' };
}

function parseNumberList(raw: string | null): number[] | undefined {
  if (!raw) return undefined;
  const out = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return out.length > 0 ? out : undefined;
}

export const GET: APIRoute = async ({ request, url }) => {
  const auth = isAuthorized(request);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: 'unauthorized', reason: auth.reason }, 401);
  }

  const dryRun = url.searchParams.get('dryRun') === 'true';
  const horizons = parseNumberList(url.searchParams.get('horizons'));
  const budgetMs = parseNumberList(url.searchParams.get('budgetMs'))?.[0];
  const citiesRaw = url.searchParams.get('cities');
  const seedCityIds = citiesRaw
    ? citiesRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  try {
    const result = await runForecastTrackerAutolog({ dryRun, horizons, budgetMs, seedCityIds });
    return jsonResponse({ ok: true, ...result });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: err?.message ?? 'autolog failed' }, 500);
  }
};

export const POST = GET;
