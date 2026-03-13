import { getRedis } from './redis';
import { getExecutionConfig, updateExecutionConfig } from './execution-config';
import { logAuditEvent } from './audit-log';
import { HARD_LIMITS } from './pretrade-risk';
import { listDemoOrders } from './kalshi-execution';
import { listCandidates } from './order-builder';
import { listAuditEvents } from './audit-log';
import { listJournalEntries } from './trade-journal';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ReadinessCheck {
  key: string;
  label: string;
  category: string;
  passed: boolean;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
  criticalFailures: number;
  warnings: number;
}

export interface PreflightRecord {
  id: string;
  createdAt: string;
  actor: string;
  confirmedItems: string[];
  notes?: string;
}

export interface LiveGuardrails {
  maxOrderSizeCents: number;
  minEdgeThreshold: number;
  maxSpreadThreshold: number;
  requireApproval: boolean;
  requireDryRun: boolean;
  requireAuditBeforeSubmit: boolean;
}

/* ------------------------------------------------------------------ */
/*  Live Guardrails — stricter than demo defaults                      */
/* ------------------------------------------------------------------ */

export const LIVE_GUARDRAILS: LiveGuardrails = {
  maxOrderSizeCents: 5_000,        // $50 per order (demo: $100)
  minEdgeThreshold: 0.03,          // 3% min edge (demo: 2%)
  maxSpreadThreshold: 0.10,        // 10% max spread (demo: 15%)
  requireApproval: true,
  requireDryRun: true,
  requireAuditBeforeSubmit: true,
};

/* ------------------------------------------------------------------ */
/*  Redis keys                                                         */
/* ------------------------------------------------------------------ */

const PREFLIGHT_KEY = 'live-readiness:preflight';
const PREFLIGHT_SET = 'live-readiness:preflights';

/* ------------------------------------------------------------------ */
/*  Preflight CRUD                                                     */
/* ------------------------------------------------------------------ */

export async function savePreflightRecord(record: PreflightRecord): Promise<void> {
  const redis = getRedis();
  await redis.set(`${PREFLIGHT_KEY}:${record.id}`, JSON.stringify(record));
  await redis.zadd(PREFLIGHT_SET, { score: Date.now(), member: record.id });
  await redis.set(`${PREFLIGHT_KEY}:latest`, JSON.stringify(record));
}

export async function getLatestPreflight(): Promise<PreflightRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(`${PREFLIGHT_KEY}:latest`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as PreflightRecord;
}

/* ------------------------------------------------------------------ */
/*  Readiness Checks                                                   */
/* ------------------------------------------------------------------ */

const PREFLIGHT_ITEMS = [
  'kill_switch_location',
  'live_mode_manual_only',
  'risk_limits_reviewed',
  'demo_execution_tested',
  'credentials_verified',
];

export async function runReadinessChecks(): Promise<ReadinessResult> {
  const checks: ReadinessCheck[] = [];

  // --- Environment / Config ---
  const config = await getExecutionConfig();

  checks.push({
    key: 'env_mode',
    label: 'Execution mode configured',
    category: 'Environment',
    passed: config.mode !== 'disabled',
    severity: 'critical',
    message: config.mode === 'disabled' ? 'Execution is disabled' : `Mode: ${config.mode}`,
  });

  checks.push({
    key: 'env_live_enabled',
    label: 'Live trading flag enabled',
    category: 'Environment',
    passed: config.liveTradingEnabled,
    severity: 'critical',
    message: config.liveTradingEnabled ? 'Live trading enabled' : 'Live trading not enabled in config',
  });

  checks.push({
    key: 'env_kill_switch',
    label: 'Kill switch is OFF',
    category: 'Environment',
    passed: !config.killSwitchEnabled,
    severity: 'critical',
    message: config.killSwitchEnabled ? 'Kill switch is active — blocks all execution' : 'Kill switch off',
  });

  checks.push({
    key: 'env_approval_required',
    label: 'Approval requirement enabled',
    category: 'Environment',
    passed: config.requireApproval,
    severity: 'warning',
    message: config.requireApproval ? 'Approval required for execution' : 'Approval not required — consider enabling',
  });

  // --- Credentials ---
  const keyId = import.meta.env.KALSHI_API_KEY_ID;
  const privateKey = import.meta.env.KALSHI_PRIVATE_KEY;
  checks.push({
    key: 'creds_present',
    label: 'Kalshi API credentials present',
    category: 'Credentials',
    passed: !!(keyId && privateKey),
    severity: 'critical',
    message: keyId && privateKey ? 'API key and private key configured' : 'Missing KALSHI_API_KEY_ID or KALSHI_PRIVATE_KEY',
  });

  // --- Demo Execution Tested ---
  let demoOrders: any[] = [];
  try { demoOrders = await listDemoOrders(); } catch {}
  const hasFilledDemo = demoOrders.some(o => o.status === 'filled');
  const hasAnyDemo = demoOrders.length > 0;
  checks.push({
    key: 'demo_tested',
    label: 'Demo execution tested successfully',
    category: 'Demo Testing',
    passed: hasFilledDemo,
    severity: 'critical',
    message: hasFilledDemo
      ? `${demoOrders.filter(o => o.status === 'filled').length} demo orders filled`
      : hasAnyDemo ? 'Demo orders submitted but none filled yet' : 'No demo orders found — test demo execution first',
  });

  // --- Kill Switch Tested ---
  let auditEvents: any[] = [];
  try { auditEvents = await listAuditEvents(100); } catch {}
  const killSwitchToggled = auditEvents.some(e => e.eventType === 'kill_switch_toggled' || e.eventType === 'kill_switch_enabled' || e.eventType === 'kill_switch_disabled');
  checks.push({
    key: 'kill_switch_tested',
    label: 'Kill switch tested',
    category: 'Safety',
    passed: killSwitchToggled,
    severity: 'warning',
    message: killSwitchToggled ? 'Kill switch has been toggled in audit log' : 'No kill switch toggle found in recent audit log — test it',
  });

  // --- Pre-trade Risk Checks Enabled ---
  checks.push({
    key: 'risk_checks_enabled',
    label: 'Pre-trade risk checks configured',
    category: 'Safety',
    passed: HARD_LIMITS.MAX_ORDER_SIZE_CENTS > 0 && HARD_LIMITS.MIN_EDGE_THRESHOLD > 0,
    severity: 'critical',
    message: 'Hard risk limits configured',
  });

  // --- Audit Logging Working ---
  checks.push({
    key: 'audit_logging',
    label: 'Audit logging operational',
    category: 'Safety',
    passed: auditEvents.length > 0,
    severity: 'critical',
    message: auditEvents.length > 0 ? `${auditEvents.length} audit events recorded` : 'No audit events found — verify logging',
  });

  // --- Paper Trading Available ---
  checks.push({
    key: 'paper_trading',
    label: 'Paper trading available',
    category: 'Infrastructure',
    passed: true, // always available as infrastructure exists
    severity: 'info',
    message: 'Paper trading infrastructure in place',
  });

  // --- Execution Candidates Workflow ---
  let candidates: any[] = [];
  try { candidates = await listCandidates(); } catch {}
  const hasApproved = candidates.some(c => c.state === 'approved' || c.state === 'sent');
  checks.push({
    key: 'candidates_workflow',
    label: 'Execution candidates approval flow working',
    category: 'Infrastructure',
    passed: hasApproved || candidates.length > 0,
    severity: 'warning',
    message: hasApproved
      ? `${candidates.filter(c => c.state === 'approved' || c.state === 'sent').length} approved/sent candidates`
      : candidates.length > 0 ? `${candidates.length} candidates, none approved yet` : 'No candidates found — create and approve some',
  });

  // --- Trade Journal Working ---
  let journalEntries: any[] = [];
  try { journalEntries = await listJournalEntries(); } catch {}
  checks.push({
    key: 'trade_journal',
    label: 'Trade journal operational',
    category: 'Infrastructure',
    passed: journalEntries.length > 0,
    severity: 'warning',
    message: journalEntries.length > 0 ? `${journalEntries.length} journal entries` : 'No journal entries — create some',
  });

  // --- Operator Preflight Completed ---
  const preflight = await getLatestPreflight();
  const preflightRecent = preflight && (Date.now() - new Date(preflight.createdAt).getTime()) < 24 * 60 * 60 * 1000;
  const preflightComplete = preflight && PREFLIGHT_ITEMS.every(item => preflight.confirmedItems.includes(item));
  checks.push({
    key: 'preflight_completed',
    label: 'Operator preflight completed recently',
    category: 'Operator',
    passed: !!(preflightComplete && preflightRecent),
    severity: 'critical',
    message: preflightComplete && preflightRecent
      ? `Preflight completed ${new Date(preflight!.createdAt).toLocaleString()}`
      : preflight ? 'Preflight incomplete or expired (>24h)' : 'Preflight not completed yet',
  });

  const criticalFailures = checks.filter(c => !c.passed && c.severity === 'critical').length;
  const warnings = checks.filter(c => !c.passed && c.severity === 'warning').length;
  const ready = criticalFailures === 0;

  return { ready, checks, criticalFailures, warnings };
}

/* ------------------------------------------------------------------ */
/*  Preflight Submission                                               */
/* ------------------------------------------------------------------ */

export async function submitPreflight(
  confirmedItems: string[],
  notes?: string,
): Promise<{ success: boolean; record?: PreflightRecord; missing?: string[] }> {
  const missing = PREFLIGHT_ITEMS.filter(item => !confirmedItems.includes(item));

  const record: PreflightRecord = {
    id: `pf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    actor: 'admin',
    confirmedItems,
    notes,
  };

  await savePreflightRecord(record);

  if (missing.length > 0) {
    await logAuditEvent({
      actor: 'admin',
      eventType: 'preflight_failed',
      targetType: 'preflight',
      targetId: record.id,
      summary: `Preflight incomplete: missing ${missing.join(', ')}`,
      details: { confirmedItems, missing },
    });
    return { success: false, record, missing };
  }

  await logAuditEvent({
    actor: 'admin',
    eventType: 'preflight_completed',
    targetType: 'preflight',
    targetId: record.id,
    summary: `Operator preflight completed with ${confirmedItems.length} items confirmed`,
    details: { confirmedItems, notes },
  });

  return { success: true, record };
}

/* ------------------------------------------------------------------ */
/*  Enable Live Mode                                                   */
/* ------------------------------------------------------------------ */

export async function enableLiveMode(
  confirmationPhrase: string,
): Promise<{ success: boolean; reason?: string }> {
  const REQUIRED_PHRASE = 'ENABLE LIVE TRADING';

  await logAuditEvent({
    actor: 'admin',
    eventType: 'live_mode_requested',
    targetType: 'execution-config',
    summary: 'Live mode activation requested',
  });

  // Check confirmation phrase
  if (confirmationPhrase.trim() !== REQUIRED_PHRASE) {
    await logAuditEvent({
      actor: 'admin',
      eventType: 'live_mode_denied',
      targetType: 'execution-config',
      summary: 'Live mode denied: incorrect confirmation phrase',
    });
    return { success: false, reason: `Confirmation phrase must be exactly "${REQUIRED_PHRASE}"` };
  }

  // Check readiness
  const readiness = await runReadinessChecks();
  if (!readiness.ready) {
    const failures = readiness.checks.filter(c => !c.passed && c.severity === 'critical').map(c => c.label);
    await logAuditEvent({
      actor: 'admin',
      eventType: 'live_mode_denied',
      targetType: 'execution-config',
      summary: `Live mode denied: ${readiness.criticalFailures} critical checks failed`,
      details: { failures },
    });
    return { success: false, reason: `${readiness.criticalFailures} critical readiness checks failed: ${failures.join('; ')}` };
  }

  // Check config prerequisites
  const config = await getExecutionConfig();
  if (!config.liveTradingEnabled) {
    await logAuditEvent({
      actor: 'admin',
      eventType: 'live_mode_denied',
      targetType: 'execution-config',
      summary: 'Live mode denied: liveTradingEnabled is false',
    });
    return { success: false, reason: 'liveTradingEnabled must be true' };
  }
  if (config.killSwitchEnabled) {
    await logAuditEvent({
      actor: 'admin',
      eventType: 'live_mode_denied',
      targetType: 'execution-config',
      summary: 'Live mode denied: kill switch active',
    });
    return { success: false, reason: 'Kill switch must be off' };
  }

  // Enable live mode
  await updateExecutionConfig({ mode: 'live', requireApproval: true });

  await logAuditEvent({
    actor: 'admin',
    eventType: 'live_mode_enabled',
    targetType: 'execution-config',
    summary: 'LIVE MODE ENABLED — manual approval still required',
  });

  return { success: true };
}

/* ------------------------------------------------------------------ */
/*  Disable Live Mode                                                  */
/* ------------------------------------------------------------------ */

export async function disableLiveMode(): Promise<{ success: boolean }> {
  await updateExecutionConfig({ mode: 'paper' });

  await logAuditEvent({
    actor: 'admin',
    eventType: 'live_mode_disabled',
    targetType: 'execution-config',
    summary: 'Live mode disabled — reverted to paper mode',
  });

  return { success: true };
}

/* ------------------------------------------------------------------ */
/*  Emergency Shutdown                                                 */
/* ------------------------------------------------------------------ */

export async function emergencyShutdown(
  notes?: string,
): Promise<{ success: boolean }> {
  await updateExecutionConfig({
    mode: 'paper',
    killSwitchEnabled: true,
    liveTradingEnabled: false,
  });

  await logAuditEvent({
    actor: 'admin',
    eventType: 'emergency_shutdown',
    targetType: 'execution-config',
    summary: 'EMERGENCY SHUTDOWN — kill switch enabled, reverted to paper, live trading disabled',
    details: { notes },
  });

  return { success: true };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function getPreflightItems(): { key: string; label: string; description: string }[] {
  return [
    { key: 'kill_switch_location', label: 'Kill switch location understood', description: 'I know where the kill switch is and how to activate it immediately.' },
    { key: 'live_mode_manual_only', label: 'Live mode is manual only', description: 'I understand that live mode requires manual approval for every order.' },
    { key: 'risk_limits_reviewed', label: 'Notional/risk limits reviewed', description: 'I have reviewed the hard risk limits and live guardrails.' },
    { key: 'demo_execution_tested', label: 'Demo execution tested', description: 'I have successfully submitted and verified at least one demo order.' },
    { key: 'credentials_verified', label: 'Credentials verified', description: 'I have confirmed API credentials are correct and scoped properly.' },
  ];
}
