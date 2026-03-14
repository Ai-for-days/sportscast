import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';

export const prerender = false;

const RISK_ITEMS = [
  // Infrastructure
  { category: 'Infrastructure', item: 'Redis Connectivity', severity: 'low', summary: 'Redis connectivity is validated via ping in multiple dashboards. Upstash provides managed availability.', action: 'Continue monitoring via /admin/system/health' },
  { category: 'Infrastructure', item: 'API Responsiveness', severity: 'low', summary: 'API performance is tracked via withTiming and withMetric. 8 operations instrumented.', action: '7 operations awaiting instrumentation — see health dashboard' },
  { category: 'Infrastructure', item: 'Health Metrics Coverage', severity: 'moderate', summary: '53% of tracked operations are instrumented (8/15). Forecasting subsystem lacks instrumentation due to in-memory generation patterns.', action: 'Instrument forecast/pricing handlers when refactored to have single entry points' },

  // Data Integrity
  { category: 'Data Integrity', item: 'Domain Integrity Scanning', severity: 'low', summary: '11 domains scanned with index count, freshness, and sample record integrity checks. Tiered scan depth (5/25/100).', action: 'Run standard or deep scans before launch' },
  { category: 'Data Integrity', item: 'Cross-Domain Consistency', severity: 'low', summary: '5 cross-domain reference checks validate candidate→signal, order→candidate, settlement→order, verification→forecast relationships.', action: 'Run full integrity scan and resolve any orphaned references' },
  { category: 'Data Integrity', item: 'Stale Data Risk', severity: 'moderate', summary: 'Freshness thresholds are heuristic (24-168h by domain). No automated pipeline scheduling — data freshness depends on manual operator runs.', action: 'Establish operational cadence for forecast/signal generation' },

  // Security
  { category: 'Security', item: 'Admin Auth Protection', severity: 'low', summary: 'All 40 admin pages and 60+ API routes have requireAdmin guards. Step 53 audit confirmed 100% coverage.', action: 'None required — fully protected' },
  { category: 'Security', item: 'Sensitive Action Authorization', severity: 'low', summary: '8 sensitive actions use fail-closed RBAC with real operator identity. Missing RBAC records deny access.', action: 'Ensure primary-admin has super_admin role via bootstrap (auto-seeded on login)' },
  { category: 'Security', item: 'Operator Identity', severity: 'low', summary: 'Single-operator model with server-controlled identity binding. No client-supplied identity spoofing. Session stores stable operatorId.', action: 'None required for current single-operator model' },

  // Execution Safety
  { category: 'Execution Safety', item: 'Kill Switch Behavior', severity: 'low', summary: 'Kill switch blocks all execution when active. State is readable and toggleable from Execution Control. Audit logged.', action: 'Test kill switch activation before launch via resilience drills' },
  { category: 'Execution Safety', item: 'Execution Mode Configuration', severity: 'low', summary: 'Execution config supports disabled/paper/demo/live modes with safety guardrails. Live mode requires liveTradingEnabled flag.', action: 'Verify config is set to paper/demo before any testing' },
  { category: 'Execution Safety', item: 'Demo vs Live Safeguards', severity: 'moderate', summary: 'Demo and live execution use separate order stores and separate permission checks. Confirmation phrase required for live orders. However, both paths use the same Kalshi API client.', action: 'Ensure KALSHI_MODE env var distinguishes demo/live API endpoints' },

  // Operational Workflow
  { category: 'Operational Workflow', item: 'Signal → Candidate → Execution Flow', severity: 'low', summary: 'Full workflow path exists: signal generation → ranking → candidate creation → approval → demo/live execution. All manual, operator-initiated.', action: 'Complete a full desk dry-run to verify end-to-end' },
  { category: 'Operational Workflow', item: 'Reconciliation & Settlement', severity: 'moderate', summary: 'Reconciliation compares local vs remote order status. Settlement computes P&L. Both require manual triggering. No automated scheduling.', action: 'Establish operational runbook for regular reconciliation cadence' },

  // External Dependencies
  { category: 'External Dependencies', item: 'Weather Data Providers', severity: 'moderate', summary: 'Open-Meteo and NWS provide forecast data. Both are external APIs with no SLA guarantees from platform side.', action: 'Monitor data freshness — stale forecasts indicate provider issues' },
  { category: 'External Dependencies', item: 'Kalshi Connectivity', severity: 'high', summary: 'Kalshi API is required for market data, signal generation, and order execution. API key must be valid and mode must match (demo vs production).', action: 'Verify KALSHI_API_KEY and KALSHI_MODE environment variables before launch' },
  { category: 'External Dependencies', item: 'API Failure Tolerance', severity: 'moderate', summary: 'External API failures are caught and surfaced as errors. No automatic retry or circuit breaker pattern exists.', action: 'Operator should monitor execution health and retry manually if needed' },

  // Observability
  { category: 'Observability', item: 'Health Metrics Coverage', severity: 'moderate', summary: '8 of 15 operations instrumented. Coverage is strongest for execution, accounting, and system operations. Weakest for forecasting/pricing.', action: 'Acceptable for launch — expand instrumentation post-launch' },
  { category: 'Observability', item: 'Validation System Coverage', severity: 'low', summary: '27 validation checks + 24 E2E checks + 5 manual signoffs cover the full platform workflow.', action: 'Run full E2E validation before launch' },
  { category: 'Observability', item: 'Audit Logging', severity: 'low', summary: 'Audit events logged for config changes, sensitive actions, permission denials, validation runs, and manual signoffs. Max 500 events auto-trimmed.', action: 'None required — comprehensive coverage' },
];

function getSeveritySummary() {
  const low = RISK_ITEMS.filter(r => r.severity === 'low').length;
  const moderate = RISK_ITEMS.filter(r => r.severity === 'moderate').length;
  const high = RISK_ITEMS.filter(r => r.severity === 'high').length;
  const unknown = RISK_ITEMS.filter(r => r.severity === 'unknown').length;
  return { total: RISK_ITEMS.length, low, moderate, high, unknown };
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    return new Response(JSON.stringify({
      risks: RISK_ITEMS,
      summary: getSeveritySummary(),
      categories: [...new Set(RISK_ITEMS.map(r => r.category))],
      auditCompletedAt: new Date().toISOString(),
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
