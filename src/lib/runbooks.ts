import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface Runbook {
  id: string;
  createdAt: string;
  title: string;
  category: string;
  steps: string[];
  severity: 'info' | 'warning' | 'critical';
  linkedAlertTypes?: string[];
  linkedPages?: string[];
}

const PREFIX = 'runbook:';
const SET = 'runbooks:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

async function saveRunbook(rb: Runbook): Promise<void> {
  const redis = getRedis();
  await redis.set(`${PREFIX}${rb.id}`, JSON.stringify(rb));
  await redis.zadd(SET, { score: Date.now(), member: rb.id });
}

export async function getRunbook(id: string): Promise<Runbook | null> {
  const redis = getRedis();
  const raw = await redis.get(`${PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as Runbook;
}

export async function listRunbooks(): Promise<Runbook[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SET, 0, 100, { rev: true }) || [];
  const results: Runbook[] = [];
  for (const id of ids) {
    const rb = await getRunbook(id);
    if (rb) results.push(rb);
  }
  return results;
}

export async function createRunbook(input: {
  title: string;
  category: string;
  steps: string[];
  severity: 'info' | 'warning' | 'critical';
  linkedAlertTypes?: string[];
  linkedPages?: string[];
}): Promise<Runbook> {
  const rb: Runbook = {
    id: `rb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    title: input.title,
    category: input.category,
    steps: input.steps,
    severity: input.severity,
    linkedAlertTypes: input.linkedAlertTypes,
    linkedPages: input.linkedPages,
  };
  await saveRunbook(rb);
  await logAuditEvent({
    actor: 'admin',
    eventType: 'runbook_created',
    targetType: 'runbook',
    targetId: rb.id,
    summary: `Runbook created: ${rb.title}`,
  });
  return rb;
}

/* ------------------------------------------------------------------ */
/*  Default Runbooks                                                    */
/* ------------------------------------------------------------------ */

const DEFAULT_RUNBOOKS: Omit<Runbook, 'id' | 'createdAt'>[] = [
  {
    title: 'Kill Switch Active',
    category: 'execution',
    severity: 'critical',
    steps: [
      'Verify kill switch status on /admin/trading-desk',
      'Check recent alerts on /admin/alerts for triggering event',
      'Review open orders — cancel any pending orders if needed',
      'Investigate root cause (pricing, data feed, risk limit)',
      'Resolve underlying issue before deactivating kill switch',
      'Create incident record if not already created',
      'Deactivate kill switch only after root cause confirmed resolved',
      'Monitor for 15 minutes after reactivation',
    ],
    linkedAlertTypes: ['kill_switch'],
    linkedPages: ['/admin/trading-desk', '/admin/alerts'],
  },
  {
    title: 'Live Order Failure',
    category: 'execution',
    severity: 'critical',
    steps: [
      'Check order status on /admin/live-execution',
      'Verify Kalshi API credentials and connectivity',
      'Check venue health on /admin/venues',
      'Review error message in order detail',
      'Check if order was partially filled on exchange',
      'If credentials issue: verify env vars KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY',
      'If network issue: check Kalshi API status page',
      'Create incident record and assign owner',
      'Do NOT retry order until root cause confirmed',
    ],
    linkedAlertTypes: ['order_failure', 'execution_error'],
    linkedPages: ['/admin/live-execution', '/admin/venues'],
  },
  {
    title: 'Stale Reconciliation',
    category: 'reconciliation',
    severity: 'warning',
    steps: [
      'Check last reconciliation timestamp on /admin/operator-dashboard',
      'Run manual reconciliation from /admin/reconciliation',
      'Check if data feeds are current',
      'Review any unreconciled items',
      'If persistent: check Redis connectivity',
      'Note findings in handoff log',
    ],
    linkedAlertTypes: ['stale_reconciliation'],
    linkedPages: ['/admin/operator-dashboard'],
  },
  {
    title: 'Stale Market Ingestion',
    category: 'data',
    severity: 'warning',
    steps: [
      'Check market data freshness on /admin/operator-dashboard',
      'Verify Kalshi API is responding on /admin/venues',
      'Check KALSHI_MODE env var (should be paper/demo/live, not disabled)',
      'Try manual market refresh from trading desk',
      'If API error: check rate limits and credentials',
      'If resolved: verify signals are regenerating from fresh data',
    ],
    linkedAlertTypes: ['stale_ingestion', 'data_freshness'],
    linkedPages: ['/admin/trading-desk', '/admin/venues'],
  },
  {
    title: 'High Unreconciled Count',
    category: 'reconciliation',
    severity: 'warning',
    steps: [
      'Open /admin/reconciliation and review unmatched items',
      'Check if settlements are up to date on /admin/settlement',
      'Look for position/order mismatches',
      'Review recent fills for correct pricing',
      'If fee discrepancy: verify fee calculation logic',
      'Manually resolve or flag for next handoff',
    ],
    linkedAlertTypes: ['reconciliation_mismatch'],
    linkedPages: ['/admin/settlement'],
  },
  {
    title: 'Pricing Drift Alert',
    category: 'pricing',
    severity: 'warning',
    steps: [
      'Check repricing suggestions on /admin/market-making',
      'Compare current book prices to market mid-prices',
      'Review closing line value for recent markets',
      'Apply repricing suggestions if appropriate',
      'If drift > 10%: escalate to incident',
      'Document any manual price adjustments',
    ],
    linkedAlertTypes: ['pricing_drift', 'reprice_needed'],
    linkedPages: ['/admin/market-making'],
  },
  {
    title: 'Settlement Discrepancy',
    category: 'settlement',
    severity: 'critical',
    steps: [
      'Open /admin/settlement and review discrepancies tab',
      'Compare settlement amounts against exchange confirmation',
      'Check if fee calculations are correct',
      'Review original order vs fill data',
      'Mark discrepancy status: reviewed / resolved / disputed',
      'If disputed: create incident and escalate',
      'Add notes explaining resolution or dispute reason',
    ],
    linkedAlertTypes: ['settlement_discrepancy'],
    linkedPages: ['/admin/settlement'],
  },
  {
    title: 'Permission / Approval Failure',
    category: 'security',
    severity: 'warning',
    steps: [
      'Check pending approvals on /admin/security',
      'Verify requesting user has correct role assigned',
      'Check if dual-control action requires second approver',
      'Ensure approver is different from requester',
      'If role issue: assign correct role via security admin',
      'Log outcome in incident or handoff note',
    ],
    linkedAlertTypes: ['permission_denied', 'approval_blocked'],
    linkedPages: ['/admin/security'],
  },
  {
    title: 'Venue Outage',
    category: 'ops',
    severity: 'critical',
    steps: [
      'Check venue health on /admin/venues',
      'Verify external service status (Kalshi status page)',
      'Activate kill switch if live trading is at risk',
      'Cancel any pending orders on affected venue',
      'Create incident and assign owner',
      'Monitor venue health every 5 minutes until restored',
      'Do NOT resume trading until health returns to "healthy"',
      'Document outage duration and impact in handoff',
    ],
    linkedAlertTypes: ['venue_down', 'venue_degraded'],
    linkedPages: ['/admin/venues', '/admin/trading-desk'],
  },
];

export async function seedDefaultRunbooks(): Promise<number> {
  const existing = await listRunbooks();
  if (existing.length > 0) return 0;
  let count = 0;
  for (const def of DEFAULT_RUNBOOKS) {
    await createRunbook(def);
    count++;
  }
  return count;
}
