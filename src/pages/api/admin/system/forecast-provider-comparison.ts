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
import { runQualityGate } from '../../../../lib/forecast-quality-gate-runner';
import {
  recordQualityGateResult,
  listQualityGateResults,
  getQualityGateResult,
} from '../../../../lib/forecast-quality-gate-store';
import {
  runSeededBatchComparison,
  runBatchQualityReport,
} from '../../../../lib/forecast-quality-batch-runner';
import {
  recordQualityReport,
  listQualityReports,
  getQualityReport,
} from '../../../../lib/forecast-quality-report-store';
import { FORECAST_QUALITY_SEED_CITIES } from '../../../../lib/forecast-quality-seed-cities';
import { getCronState } from '../../../../lib/forecast-quality-cron-state';
import {
  buildQualityTrendDashboard,
  isValidTrendWindow,
  type TrendWindow,
} from '../../../../lib/forecast-quality-trends';
import { getWeatherNextReadiness } from '../../../../lib/weathernext-readiness';
import { getWeatherNextBigQueryReadiness } from '../../../../lib/weathernext-bigquery-readiness';
import {
  SMOKE_TEST_PROVIDERS,
  listProviderSmokeTestStatuses,
  runForecastProviderSmokeTest,
} from '../../../../lib/forecast-provider-smoke-tests';
import type { ForecastProvider } from '../../../../lib/forecast-source';

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

    // Step 137: quality-gate read endpoints.
    if (action === 'list-quality-gates') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw) || 50)) : 50;
      const results = await listQualityGateResults(limit);
      return jsonResponse({ results });
    }

    if (action === 'get-quality-gate') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const result = await getQualityGateResult(id);
      if (!result) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ result });
    }

    // Step 138: batch / seeded read endpoints.
    if (action === 'list-quality-reports') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(90, Math.max(1, Number(limitRaw) || 30)) : 30;
      const reports = await listQualityReports(limit);
      return jsonResponse({ reports });
    }

    if (action === 'get-quality-report') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const report = await getQualityReport(id);
      if (!report) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ report });
    }

    if (action === 'list-seed-cities') {
      return jsonResponse({ seedCities: FORECAST_QUALITY_SEED_CITIES });
    }

    // Step 139: surface cron-state for the admin UI's status panel.
    if (action === 'get-cron-state') {
      const state = await getCronState();
      return jsonResponse({ state });
    }

    // Step 141: WeatherNext production readiness — config presence only,
    // no network calls, no secret values returned.
    if (action === 'get-weathernext-readiness') {
      const readiness = getWeatherNextReadiness();
      return jsonResponse({ readiness });
    }

    // Step 142: WeatherNext BigQuery production readiness — same posture.
    if (action === 'get-weathernext-bigquery-readiness') {
      const readiness = getWeatherNextBigQueryReadiness();
      return jsonResponse({ readiness });
    }

    // Step 142: list of provider smoke tests + their static readiness.
    if (action === 'get-provider-smoke-tests') {
      const statuses = listProviderSmokeTestStatuses();
      return jsonResponse({ providers: statuses });
    }

    // Step 140: trend dashboard. Aggregates the existing report store
    // on demand (read-only — no new persisted data).
    if (action === 'get-quality-trends') {
      const windowParam = url.searchParams.get('window') ?? '7d';
      const providerParam = url.searchParams.get('provider') ?? undefined;
      const window: TrendWindow = isValidTrendWindow(windowParam) ? windowParam : '7d';
      // Pull enough reports to cover a 30d window even when fired on
      // shorter windows; the aggregator slices by timestamp itself.
      const reports = await listQualityReports(90);
      const dashboard = buildQualityTrendDashboard(reports, {
        window,
        provider: providerParam || undefined,
      });
      return jsonResponse({ dashboard });
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

    // Step 137: run a quality gate against a stored comparison snapshot.
    if (action === 'run-quality-gate') {
      const comparisonSnapshotId =
        typeof body.comparisonSnapshotId === 'string' ? body.comparisonSnapshotId : '';
      if (!comparisonSnapshotId) {
        return jsonResponse(
          { error: 'invalid_input', message: 'comparisonSnapshotId is required' },
          400,
        );
      }

      const result = await runQualityGate({ comparisonSnapshotId });

      // Persist if the run produced provider rows OR has elapsed-horizon
      // metadata worth keeping. "Too early" results are not persisted —
      // they're informational and the operator can re-run later.
      const worthKeeping = result.providers.length > 0 || result.elapsedHorizons.length > 0;
      if (worthKeeping) {
        try {
          await recordQualityGateResult(result);
        } catch (err) {
          console.warn('[forecast-quality-gate] persist failed:', err);
        }
      }

      await logAuditEvent({
        actor,
        eventType: 'forecast_quality_gate_run',
        targetType: 'forecast_quality_gate',
        targetId: result.id,
        summary: `Quality-gate scored snapshot ${comparisonSnapshotId}: ` +
          `${result.providers.length} provider(s), ` +
          `${result.elapsedHorizons.length} elapsed horizon(s).`,
        details: {
          comparisonSnapshotId,
          stationId: result.stationId,
          elapsedHorizons: result.elapsedHorizons,
          warnings: result.warnings,
          providerSummaries: result.providers.map((p) => ({
            provider: p.provider,
            summary: p.summary,
          })),
        },
      });

      return jsonResponse({ result });
    }

    // Step 138: seeded batch comparison and batch quality reporting.
    if (action === 'run-seeded-batch-comparison') {
      const includeWeatherNextSample = body.includeWeatherNextSample === true;
      const includeWeatherNextProduction = body.includeWeatherNextProduction === true;
      const days = Math.max(1, Math.min(15, Math.floor(Number(body.days) || 5)));
      const seedCityIds = Array.isArray(body.seedCityIds)
        ? body.seedCityIds.filter((s: any) => typeof s === 'string')
        : undefined;
      const result = await runSeededBatchComparison({
        days,
        includeWeatherNextSample,
        includeWeatherNextProduction,
        seedCityIds,
      });
      await logAuditEvent({
        actor,
        eventType: 'forecast_seeded_batch_comparison_run',
        targetType: 'forecast_seeded_batch_comparison',
        targetId: result.id,
        summary: `Seeded batch comparison ran across ${result.seedCityCount} city/cities; ` +
          `${result.rows.filter((r) => r.ok).length} succeeded, ` +
          `${result.rows.filter((r) => !r.ok).length} failed.`,
        details: {
          seedCityCount: result.seedCityCount,
          includeWeatherNextSample,
          includeWeatherNextProduction,
          days,
          rows: result.rows.map((r) => ({
            cityId: r.cityId,
            ok: r.ok,
            failureMode: r.failureMode,
            durationMs: r.durationMs,
          })),
          warnings: result.warnings,
        },
      });
      return jsonResponse({ result });
    }

    // Step 142: run a smoke test for one provider. Provider id is
    // restricted to a known list — no arbitrary endpoint URLs or SQL.
    if (action === 'run-provider-smoke-test') {
      const providerRaw = typeof body.provider === 'string' ? body.provider : '';
      if (!SMOKE_TEST_PROVIDERS.includes(providerRaw as ForecastProvider)) {
        return jsonResponse(
          {
            error: 'invalid_provider',
            message: `Unknown provider: ${providerRaw}. Allowed: ${SMOKE_TEST_PROVIDERS.join(', ')}.`,
          },
          400,
        );
      }
      const provider = providerRaw as ForecastProvider;
      const attemptLiveCall = body.attemptLiveCall === true;
      const attemptLiveQuery = body.attemptLiveQuery === true;
      const result = await runForecastProviderSmokeTest(provider, {
        attemptLiveCall,
        attemptLiveQuery,
      });
      await logAuditEvent({
        actor,
        eventType: 'forecast_provider_smoke_test_run',
        targetType: 'forecast_provider_smoke_test',
        targetId: provider,
        summary: `Smoke test ${provider}: ${result.status} (${result.durationMs}ms).`,
        details: {
          provider,
          status: result.status,
          ok: result.ok,
          durationMs: result.durationMs,
          attemptLiveCall,
          attemptLiveQuery,
          notes: result.notes,
        },
      });
      return jsonResponse({ result });
    }

    if (action === 'run-batch-quality-report') {
      const report = await runBatchQualityReport({});
      try {
        await recordQualityReport(report);
      } catch (err) {
        console.warn('[forecast-quality-report] persist failed:', err);
      }
      await logAuditEvent({
        actor,
        eventType: 'forecast_batch_quality_report_run',
        targetType: 'forecast_quality_report',
        targetId: report.id,
        summary: `Batch quality report scored ${report.scoredCityCount}/${report.eligibleCityCount} eligible city/cities ` +
          `across ${report.providerAggregates.length} provider(s).`,
        details: {
          seedCityCount: report.seedCityCount,
          eligibleCityCount: report.eligibleCityCount,
          scoredCityCount: report.scoredCityCount,
          providerAggregates: report.providerAggregates.map((a) => ({
            provider: a.provider,
            cellsScored: a.cellsScored,
            summary: a.summary,
            cityCount: a.cityCount,
            meanTempErrorF: a.meanTempErrorF,
          })),
          warnings: report.warnings,
        },
      });
      return jsonResponse({ report });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'forecast_provider_comparison_action_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};
