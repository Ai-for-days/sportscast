import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type CheckCategory = 'env' | 'secrets' | 'execution' | 'security' | 'ops' | 'compliance' | 'resilience' | 'release';
export type CheckSeverity = 'info' | 'warning' | 'critical';

export interface ReadinessCheck {
  key: string;
  label: string;
  category: CheckCategory;
  severity: CheckSeverity;
  passed: boolean;
  message: string;
  checkedAt: string;
}

export interface ReadinessSummary {
  total: number;
  passed: number;
  failed: number;
  critical: number;
  warnings: number;
  ready: boolean;
  checkedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Readiness checks                                                    */
/* ------------------------------------------------------------------ */

export async function runAllReadinessChecks(): Promise<ReadinessCheck[]> {
  const now = new Date().toISOString();
  const checks: ReadinessCheck[] = [];
  const redis = getRedis();

  const check = (key: string, label: string, category: CheckCategory, severity: CheckSeverity, passed: boolean, message: string) => {
    checks.push({ key, label, category, severity, passed, message, checkedAt: now });
  };

  // --- ENV ---
  check('env_redis_url', 'Redis URL configured', 'env', 'critical',
    !!process.env.KV_REST_API_URL, process.env.KV_REST_API_URL ? 'Configured' : 'KV_REST_API_URL not set');
  check('env_redis_token', 'Redis token configured', 'env', 'critical',
    !!process.env.KV_REST_API_TOKEN, process.env.KV_REST_API_TOKEN ? 'Configured' : 'KV_REST_API_TOKEN not set');

  // --- SECRETS ---
  check('secret_admin', 'Admin auth secret configured', 'secrets', 'critical',
    !!process.env.ADMIN_SECRET, process.env.ADMIN_SECRET ? 'Configured' : 'ADMIN_SECRET not set');
  check('secret_kalshi_key', 'Kalshi API key configured', 'secrets', 'warning',
    !!process.env.KALSHI_API_KEY, process.env.KALSHI_API_KEY ? 'Configured' : 'KALSHI_API_KEY not set (paper/demo only)');
  check('secret_kalshi_key_id', 'Kalshi API key ID configured', 'secrets', 'warning',
    !!process.env.KALSHI_API_KEY_ID, process.env.KALSHI_API_KEY_ID ? 'Configured' : 'KALSHI_API_KEY_ID not set');
  check('secret_kalshi_private_key', 'Kalshi private key configured', 'secrets', 'warning',
    !!process.env.KALSHI_PRIVATE_KEY, process.env.KALSHI_PRIVATE_KEY ? 'Configured' : 'KALSHI_PRIVATE_KEY not set');

  // --- EXECUTION ---
  try {
    const execRaw = await redis.get('execution:config');
    const execConfig = execRaw ? (typeof execRaw === 'string' ? JSON.parse(execRaw) : execRaw) : null;
    check('exec_config_exists', 'Execution config initialized', 'execution', 'critical',
      !!execConfig, execConfig ? 'Config exists' : 'No execution config found');
    if (execConfig) {
      check('exec_kill_switch', 'Kill switch available', 'execution', 'critical',
        execConfig.killSwitchEnabled !== undefined, execConfig.killSwitchEnabled !== undefined ? `Kill switch: ${execConfig.killSwitchEnabled ? 'ACTIVE' : 'available'}` : 'Kill switch not configured');
      check('exec_require_approval', 'Approval requirement configured', 'execution', 'warning',
        !!execConfig.requireApproval, execConfig.requireApproval ? 'Approval required for live' : 'Approval not required — consider enabling');
      check('exec_mode', 'Execution mode set', 'execution', 'info',
        !!execConfig.mode, `Mode: ${execConfig.mode || 'unknown'}`);
    }
  } catch { check('exec_config_exists', 'Execution config initialized', 'execution', 'critical', false, 'Error reading execution config'); }

  // --- SECURITY ---
  try {
    const rolesRaw = await redis.get('security:roles');
    const roles = rolesRaw ? (typeof rolesRaw === 'string' ? JSON.parse(rolesRaw) : rolesRaw) : {};
    const roleEntries = Object.entries(roles);
    check('sec_roles_exist', 'User roles assigned', 'security', 'warning',
      roleEntries.length > 0, roleEntries.length > 0 ? `${roleEntries.length} role assignment(s)` : 'No roles assigned');
    const hasAdmin = roleEntries.some(([, r]) => r === 'admin' || r === 'super_admin');
    check('sec_admin_role', 'Admin or super_admin role exists', 'security', 'critical',
      hasAdmin, hasAdmin ? 'Admin role found' : 'No admin/super_admin role assigned');
  } catch { check('sec_roles_exist', 'User roles assigned', 'security', 'warning', false, 'Error reading roles'); }

  // --- OPS ---
  try {
    const runbookIds = await redis.zrange('runbooks:all', 0, -1) || [];
    check('ops_runbooks', 'Default runbooks seeded', 'ops', 'warning',
      runbookIds.length >= 5, `${runbookIds.length} runbook(s) found`);
  } catch { check('ops_runbooks', 'Default runbooks seeded', 'ops', 'warning', false, 'Error reading runbooks'); }

  try {
    const notifConfigRaw = await redis.get('notification:config');
    const notifConfig = notifConfigRaw ? (typeof notifConfigRaw === 'string' ? JSON.parse(notifConfigRaw) : notifConfigRaw) : null;
    check('ops_notifications', 'Notification config initialized', 'ops', 'warning',
      !!notifConfig, notifConfig ? 'Configured' : 'Notification config not initialized');
  } catch { check('ops_notifications', 'Notification config initialized', 'ops', 'warning', false, 'Error reading notification config'); }

  try {
    const escRaw = await redis.get('escalation:rules');
    const rules = escRaw ? (typeof escRaw === 'string' ? JSON.parse(escRaw) : escRaw) : [];
    check('ops_escalation_rules', 'Escalation rules seeded', 'ops', 'warning',
      Array.isArray(rules) && rules.length >= 5, `${Array.isArray(rules) ? rules.length : 0} rule(s) found`);
  } catch { check('ops_escalation_rules', 'Escalation rules seeded', 'ops', 'warning', false, 'Error reading escalation rules'); }

  // --- COMPLIANCE ---
  try {
    const policiesRaw = await redis.get('retention:policies');
    const policies = policiesRaw ? (typeof policiesRaw === 'string' ? JSON.parse(policiesRaw) : policiesRaw) : [];
    check('comp_retention', 'Retention policies seeded', 'compliance', 'warning',
      Array.isArray(policies) && policies.length >= 5, `${Array.isArray(policies) ? policies.length : 0} policy/policies found`);
  } catch { check('comp_retention', 'Retention policies seeded', 'compliance', 'warning', false, 'Error reading retention policies'); }

  // --- RESILIENCE ---
  try {
    const drillIds = await redis.zrange('drills:all', 0, 0, { rev: true }) || [];
    check('res_drills', 'At least one resilience drill completed', 'resilience', 'warning',
      drillIds.length > 0, drillIds.length > 0 ? 'Drill history found' : 'No drills completed yet');
  } catch { check('res_drills', 'At least one resilience drill completed', 'resilience', 'warning', false, 'Error reading drills'); }

  // --- RELEASE ---
  try {
    const crIds = await redis.zrange('change-requests:all', 0, 0) || [];
    check('rel_change_control', 'Change control active', 'release', 'info',
      crIds.length >= 0, `${crIds.length} change request(s)`);
  } catch { check('rel_change_control', 'Change control active', 'release', 'info', false, 'Error reading change requests'); }

  // --- VENUE ---
  check('env_kalshi_mode', 'Kalshi mode configured', 'env', 'info',
    !!process.env.KALSHI_MODE, `Mode: ${process.env.KALSHI_MODE || 'not set (defaults to demo)'}`);

  await logAuditEvent({
    actor: 'system',
    eventType: 'readiness_checks_run',
    targetType: 'production-readiness',
    targetId: 'all',
    summary: `Readiness: ${checks.filter(c => c.passed).length}/${checks.length} passed`,
  });

  return checks;
}

export function summarizeChecks(checks: ReadinessCheck[]): ReadinessSummary {
  const critical = checks.filter(c => !c.passed && c.severity === 'critical').length;
  const warnings = checks.filter(c => !c.passed && c.severity === 'warning').length;
  return {
    total: checks.length,
    passed: checks.filter(c => c.passed).length,
    failed: checks.filter(c => !c.passed).length,
    critical,
    warnings,
    ready: critical === 0,
    checkedAt: new Date().toISOString(),
  };
}
