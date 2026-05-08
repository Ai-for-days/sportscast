// ── Step 139: Forecast quality automation cron endpoint ─────────────────────
//
// Secret-protected cron endpoint that drives the Step 138 batch quality
// pipeline on a schedule. Designed for Vercel Cron, which sends an
// `Authorization: Bearer <secret>` header on each invocation.
//
// Auth (in order of precedence):
//   1. FORECAST_QUALITY_CRON_SECRET — feature-isolated secret (preferred).
//   2. CRON_SECRET — project-wide existing convention from the existing
//      grade-wagers / verify-forecasts crons. Accepted as fallback so a
//      single Vercel Cron secret continues to work for all jobs.
//
// If neither secret env is set, the endpoint refuses every request. The
// endpoint NEVER returns a secret in any response, log line, or error.
//
// Cadence guards (defaults):
//   - seeded-comparison: at least 4 hours between successful runs
//   - quality-report:     at least 22 hours between successful runs
// `?force=true` bypasses the cadence guard but still requires a valid
// secret. Skipped runs report `status: "skipped"` with a reason — never
// a 4xx — so a Vercel Cron invocation that arrives during the cadence
// window doesn't look like a failure.
//
// This endpoint MUST NOT mutate grading, settlement, wallet, or wager
// state. It only invokes the Step 138 batch runners and the Step 137
// quality-gate runner, both of which are read-only against
// `nws-observations.ts` and write-only against admin-scope Redis stores.

import type { APIRoute } from 'astro';
import {
  runSeededBatchComparison,
  runBatchQualityReport,
} from '../../../lib/forecast-quality-batch-runner';
import { recordQualityReport } from '../../../lib/forecast-quality-report-store';
import {
  getCronState,
  isCadenceElapsed,
  recordSeededComparisonAttempt,
  recordQualityReportAttempt,
} from '../../../lib/forecast-quality-cron-state';

export const prerender = false;

// ── Cadence guards ──────────────────────────────────────────────────────────

const SEEDED_MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;        // 4 hours
const REPORT_MIN_INTERVAL_MS = 22 * 60 * 60 * 1000;       // ~daily

// ── Auth ────────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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

function expectedSecret(): string | undefined {
  return readEnv('FORECAST_QUALITY_CRON_SECRET') ?? readEnv('CRON_SECRET');
}

function isAuthorized(request: Request): { ok: boolean; reason?: string } {
  const expected = expectedSecret();
  if (!expected) {
    // Refuse rather than silently allow when no secret is configured.
    return { ok: false, reason: 'no_secret_configured' };
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader === `Bearer ${expected}`) return { ok: true };
  return { ok: false, reason: 'invalid_or_missing_bearer' };
}

// ── Handlers ────────────────────────────────────────────────────────────────

interface CommonOpts {
  force: boolean;
  includeWeatherNextSample: boolean;
  includeWeatherNextProduction: boolean;
}

function readOpts(url: URL, body: any): CommonOpts {
  const forceQ = url.searchParams.get('force');
  const sampleQ = url.searchParams.get('includeWeatherNextSample');
  const prodQ = url.searchParams.get('includeWeatherNextProduction');
  return {
    force: forceQ === 'true' || body?.force === true,
    includeWeatherNextSample: sampleQ === 'true' || body?.includeWeatherNextSample === true,
    includeWeatherNextProduction: prodQ === 'true' || body?.includeWeatherNextProduction === true,
  };
}

async function handleSeededComparison(opts: CommonOpts) {
  const state = await getCronState();
  if (!opts.force && !isCadenceElapsed(state.lastSeededComparisonRanAt, SEEDED_MIN_INTERVAL_MS)) {
    const next = await recordSeededComparisonAttempt(
      'skipped',
      `Cadence guard: last successful run at ${state.lastSeededComparisonRanAt}; min interval 4h. Use ?force=true to override.`,
    );
    return jsonResponse({
      ok: true,
      action: 'seeded-comparison',
      status: 'skipped',
      reason: 'cadence_guard',
      summary: next.lastSeededComparisonSummary,
      lastSeededComparisonRanAt: next.lastSeededComparisonRanAt,
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const result = await runSeededBatchComparison({
      includeWeatherNextSample: opts.includeWeatherNextSample,
      includeWeatherNextProduction: opts.includeWeatherNextProduction,
    });
    const oks = result.rows.filter((r) => r.ok).length;
    const fails = result.rows.length - oks;
    const summary = `Seeded batch ${result.id}: ${oks}/${result.rows.length} cities ok, ${fails} failed.`;
    await recordSeededComparisonAttempt('ran', summary);
    return jsonResponse({
      ok: true,
      action: 'seeded-comparison',
      status: 'ran',
      summary,
      seedCityCount: result.seedCityCount,
      cityCountOk: oks,
      cityCountFailed: fails,
      warningCount: result.warnings.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    const summary = err?.message ?? String(err);
    await recordSeededComparisonAttempt('failed', summary);
    return jsonResponse(
      {
        ok: false,
        action: 'seeded-comparison',
        status: 'failed',
        message: summary,
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }
}

async function handleQualityReport(opts: CommonOpts) {
  const state = await getCronState();
  if (!opts.force && !isCadenceElapsed(state.lastQualityReportRanAt, REPORT_MIN_INTERVAL_MS)) {
    const next = await recordQualityReportAttempt(
      'skipped',
      `Cadence guard: last successful run at ${state.lastQualityReportRanAt}; min interval 22h. Use ?force=true to override.`,
    );
    return jsonResponse({
      ok: true,
      action: 'quality-report',
      status: 'skipped',
      reason: 'cadence_guard',
      summary: next.lastQualityReportSummary,
      lastQualityReportRanAt: next.lastQualityReportRanAt,
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const report = await runBatchQualityReport({});
    try {
      await recordQualityReport(report);
    } catch (persistErr) {
      console.warn('[cron forecast-quality] report persist failed:', persistErr);
    }
    const summary =
      `Quality report ${report.id}: scored ${report.scoredCityCount} ` +
      `of ${report.eligibleCityCount} eligible cities ` +
      `across ${report.providerAggregates.length} provider(s).`;
    await recordQualityReportAttempt('ran', summary);
    return jsonResponse({
      ok: true,
      action: 'quality-report',
      status: 'ran',
      summary,
      reportId: report.id,
      seedCityCount: report.seedCityCount,
      eligibleCityCount: report.eligibleCityCount,
      scoredCityCount: report.scoredCityCount,
      providerCount: report.providerAggregates.length,
      topIssueCount: report.topIssues.length,
      warningCount: report.warnings.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    const summary = err?.message ?? String(err);
    await recordQualityReportAttempt('failed', summary);
    return jsonResponse(
      {
        ok: false,
        action: 'quality-report',
        status: 'failed',
        message: summary,
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function handle(request: Request, url: URL, body: any): Promise<Response> {
  const auth = isAuthorized(request);
  if (!auth.ok) {
    // Surface a non-secret reason — useful for ops to differentiate
    // "missing config" vs "wrong header" without leaking the secret value.
    return jsonResponse({ error: 'Unauthorized', reason: auth.reason ?? 'unknown' }, 401);
  }

  const action = (url.searchParams.get('action') ?? body?.action ?? '').toLowerCase();
  const opts = readOpts(url, body);

  if (action === 'seeded-comparison') return handleSeededComparison(opts);
  if (action === 'quality-report') return handleQualityReport(opts);

  return jsonResponse(
    {
      error: 'Unknown or missing action',
      hint: 'Use ?action=seeded-comparison or ?action=quality-report.',
      supported: ['seeded-comparison', 'quality-report'],
    },
    400,
  );
}

export const GET: APIRoute = async ({ request, url }) => handle(request, url, {});

export const POST: APIRoute = async ({ request, url }) => {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine for cron pings */
  }
  return handle(request, url, body);
};
