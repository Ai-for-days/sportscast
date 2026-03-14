import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getOperatorId } from '../../../../lib/admin-auth';
import { getRedis } from '../../../../lib/redis';
import { logAuditEvent } from '../../../../lib/audit-log';

export const prerender = false;

const DRY_RUN_PREFIX = 'dryrun:step:';

const STEPS = [
  { stage: 'Forecasting', key: 'forecast_ingest', title: 'Ingest Forecast Data', description: 'Navigate to /admin/forecasts and trigger forecast ingestion for at least one location.', successCriteria: 'Forecast records appear in the forecasts list.' },
  { stage: 'Forecasting', key: 'verification_run', title: 'Run Verification', description: 'Navigate to /admin/forecasts and run verification scoring on recent forecasts.', successCriteria: 'Verification results appear with accuracy metrics.' },
  { stage: 'Forecasting', key: 'consensus_compute', title: 'Compute Consensus', description: 'Verify consensus generation produces output from multiple forecast sources.', successCriteria: 'Consensus records visible in forecasts or consensus views.' },
  { stage: 'Market Generation', key: 'pricing_generate', title: 'Generate Pricing', description: 'Navigate to /admin/pricing-lab and generate market prices.', successCriteria: 'Pricing records with odds/lines appear.' },
  { stage: 'Market Generation', key: 'market_board', title: 'Verify Market Board', description: 'Navigate to /admin/trading-desk and confirm markets appear in the overview.', successCriteria: 'Trading desk shows active markets with handle/liability data.' },
  { stage: 'Signals', key: 'signal_generate', title: 'Generate Signals', description: 'Navigate to /admin/signals. Signals are generated automatically on page load from Kalshi market data.', successCriteria: 'Signal list populated with ranked trading opportunities.' },
  { stage: 'Signals', key: 'signal_review', title: 'Review Signal Rankings', description: 'Review signal edge, confidence, and ranking scores. Filter by tradable signals.', successCriteria: 'Top signals show positive edge and high confidence scores.' },
  { stage: 'Candidates', key: 'candidate_create', title: 'Create Execution Candidate', description: 'From /admin/signals, click "Create Candidate" on a tradable signal.', successCriteria: 'Candidate appears in /admin/execution-candidates with pending state.' },
  { stage: 'Candidates', key: 'candidate_review', title: 'Review Candidate Parameters', description: 'Navigate to /admin/execution-candidates. Review dry-run order, risk checks, and sizing.', successCriteria: 'Candidate shows valid dry-run order with passing risk checks.' },
  { stage: 'Execution', key: 'demo_execute', title: 'Run Demo Execution', description: 'Navigate to /admin/demo-execution. Approve a candidate and click "Send to Demo".', successCriteria: 'Demo order appears with status open or filled.' },
  { stage: 'Execution', key: 'execution_verify', title: 'Verify Execution Records', description: 'Confirm demo order appears in the orders table with correct ticker, side, and status.', successCriteria: 'Order details match the candidate parameters.' },
  { stage: 'Post-Trade', key: 'reconciliation_run', title: 'Run Reconciliation', description: 'Navigate to /admin/reconciliation and click "Reconcile All Orders".', successCriteria: 'Reconciliation records appear. Unreconciled count should be 0 or explained.' },
  { stage: 'Post-Trade', key: 'settlement_run', title: 'Run Settlement', description: 'Navigate to /admin/settlement and click "Rebuild Settlements".', successCriteria: 'Settlement records appear with P&L calculations.' },
  { stage: 'Operations', key: 'alerts_confirm', title: 'Confirm Alerts System', description: 'Navigate to /admin/alerts and verify the alert dashboard loads and shows system health.', successCriteria: 'Alert summary and health checks visible.' },
  { stage: 'Operations', key: 'incident_verify', title: 'Verify Incident Logging', description: 'Navigate to /admin/operations-center and create a test incident.', successCriteria: 'Incident record created and visible in incidents list.' },
  { stage: 'Operations', key: 'notification_verify', title: 'Verify Notifications', description: 'Navigate to /admin/notifications and confirm notification system is accessible.', successCriteria: 'Notification configuration and history visible.' },
  { stage: 'Governance', key: 'audit_review', title: 'Review Audit Logs', description: 'Navigate to /admin/execution-control and review recent audit events.', successCriteria: 'Audit events show recent actions with timestamps and actors.' },
  { stage: 'Governance', key: 'approval_confirm', title: 'Confirm Approval Flows', description: 'Navigate to /admin/security and verify RBAC roles and approval request system.', successCriteria: 'At least one RBAC role assigned. Approval workflow accessible.' },
  { stage: 'Launch Readiness', key: 'launch_state', title: 'Review Launch State', description: 'Navigate to /admin/launch-readiness and review current state machine position.', successCriteria: 'Launch state visible (expected: prelaunch or ready).' },
  { stage: 'Launch Readiness', key: 'kill_switch_test', title: 'Confirm Kill Switch', description: 'Navigate to /admin/execution-control and verify kill switch toggle works.', successCriteria: 'Kill switch activates/deactivates with audit log entry.' },
  { stage: 'Launch Readiness', key: 'checklist_review', title: 'Review Launch Checklist', description: 'Navigate to /admin/launch-readiness and review the go-live checklist items.', successCriteria: 'Checklist items visible. Seed defaults if empty.' },
];

export function getDryRunSteps() { return STEPS; }

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const redis = getRedis();
    const progress: any[] = [];
    for (const step of STEPS) {
      const raw = await redis.get(`${DRY_RUN_PREFIX}${step.key}`);
      const saved = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      progress.push({ ...step, completed: !!saved, completedBy: saved?.operatorId, completedAt: saved?.completedAt, notes: saved?.notes });
    }
    const completed = progress.filter(p => p.completed).length;
    return new Response(JSON.stringify({
      steps: progress,
      summary: { total: STEPS.length, completed, remaining: STEPS.length - completed, percent: Math.round((completed / STEPS.length) * 100) },
      stages: [...new Set(STEPS.map(s => s.stage))],
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;
    const operatorId = await getOperatorId(session);

    if (action === 'complete-step') {
      const { key, notes } = body;
      if (!key) return new Response(JSON.stringify({ error: 'key required' }), { status: 400 });
      const step = STEPS.find(s => s.key === key);
      if (!step) return new Response(JSON.stringify({ error: `Unknown step: ${key}` }), { status: 404 });
      const redis = getRedis();
      const record = { key, operatorId, completedAt: new Date().toISOString(), notes };
      await redis.set(`${DRY_RUN_PREFIX}${key}`, JSON.stringify(record));
      await logAuditEvent({ actor: operatorId, eventType: 'dry_run_step_completed', targetType: 'desk-dry-run', targetId: key, summary: `Dry-run step completed: ${step.title}` });
      return new Response(JSON.stringify({ ok: true, record }), { status: 200 });
    }

    if (action === 'reset-all') {
      const redis = getRedis();
      for (const step of STEPS) { await redis.del(`${DRY_RUN_PREFIX}${step.key}`); }
      return new Response(JSON.stringify({ ok: true, message: 'All dry-run progress reset' }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
