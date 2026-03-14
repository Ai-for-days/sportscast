import { getUserRole } from './security-store';
import { isKillSwitchActive, canExecuteLive, getExecutionConfig } from './execution-config';
import { getLaunchState } from './go-live';
import { isDualControlAction, hasPermission } from './rbac';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ProtectionLevel =
  | 'admin'
  | 'admin+permission'
  | 'admin+approval'
  | 'admin+dual_control'
  | 'admin+execution_guard'
  | 'admin+launch_guard';

export type SensitivityLevel = 'critical' | 'high' | 'medium';

export type EnforcementStatus = 'enforced' | 'partially_enforced' | 'expected_not_enforced';

export interface SensitiveAction {
  key: string;
  route: string;
  method: string;
  actionName: string;
  description: string;
  sensitivity: SensitivityLevel;
  expectedProtection: ProtectionLevel;
  actualProtection: ProtectionLevel;
  enforcement: EnforcementStatus;
  hardenedInStep54: boolean;
  notes: string;
}

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

export const SENSITIVE_ACTIONS: SensitiveAction[] = [
  // Critical — live trading
  {
    key: 'live_order_submit',
    route: '/api/admin/live-execution',
    method: 'POST',
    actionName: 'submit',
    description: 'Submit live order to Kalshi',
    sensitivity: 'critical',
    expectedProtection: 'admin+execution_guard',
    actualProtection: 'admin+execution_guard',
    enforcement: 'enforced',
    hardenedInStep54: true,
    notes: 'requireAdmin + fail-closed RBAC (submit_live_orders) + canExecuteLive() + confirmation phrase. Uses real session identity.',
  },
  {
    key: 'live_order_cancel',
    route: '/api/admin/live-execution',
    method: 'POST',
    actionName: 'cancel',
    description: 'Cancel live order',
    sensitivity: 'critical',
    expectedProtection: 'admin+execution_guard',
    actualProtection: 'admin+execution_guard',
    enforcement: 'enforced',
    hardenedInStep54: true,
    notes: 'requireAdmin + fail-closed RBAC (cancel_live_orders) + kill switch check. Uses real session identity.',
  },
  // Critical — kill switch
  {
    key: 'kill_switch_toggle',
    route: '/api/admin/execution-control',
    method: 'POST',
    actionName: 'toggle-kill-switch',
    description: 'Toggle execution kill switch',
    sensitivity: 'critical',
    expectedProtection: 'admin+permission',
    actualProtection: 'admin+permission',
    enforcement: 'enforced',
    hardenedInStep54: true,
    notes: 'requireAdmin + fail-closed RBAC (toggle_kill_switch) + audit log. Uses real session identity.',
  },
  {
    key: 'execution_config_update',
    route: '/api/admin/execution-control',
    method: 'POST',
    actionName: 'update-config',
    description: 'Update execution mode/config',
    sensitivity: 'critical',
    expectedProtection: 'admin+permission',
    actualProtection: 'admin+permission',
    enforcement: 'enforced',
    hardenedInStep54: true,
    notes: 'requireAdmin + fail-closed RBAC (toggle_kill_switch) + audit log. Live mode requires liveTradingEnabled safety guardrail. Uses real session identity.',
  },
  // Critical — launch
  {
    key: 'launch_state_change',
    route: '/api/admin/launch-readiness',
    method: 'POST',
    actionName: 'update-launch-state',
    description: 'Change launch state machine',
    sensitivity: 'critical',
    expectedProtection: 'admin+launch_guard',
    actualProtection: 'admin+launch_guard',
    enforcement: 'enforced',
    hardenedInStep54: true,
    notes: 'requireAdmin + valid state transition check + audit log',
  },
  {
    key: 'launch_signoff_approve',
    route: '/api/admin/launch-readiness',
    method: 'POST',
    actionName: 'approve-launch-signoff',
    description: 'Approve launch signoff',
    sensitivity: 'critical',
    expectedProtection: 'admin+dual_control',
    actualProtection: 'admin+dual_control',
    enforcement: 'enforced',
    hardenedInStep54: false,
    notes: 'requireAdmin + dual-control (self-approval blocked in go-live.ts). Already enforced at lib level.',
  },
  // High — settlement
  {
    key: 'settlement_rebuild',
    route: '/api/admin/settlement',
    method: 'POST',
    actionName: 'rebuild-settlements',
    description: 'Rebuild settlement calculations',
    sensitivity: 'high',
    expectedProtection: 'admin+permission',
    actualProtection: 'admin+permission',
    enforcement: 'enforced',
    hardenedInStep54: true,
    notes: 'requireAdmin + fail-closed RBAC (manage_settlement) + audit log. Uses real session identity.',
  },
  // High — security/roles
  {
    key: 'role_assignment',
    route: '/api/admin/security',
    method: 'POST',
    actionName: 'assign-role',
    description: 'Assign role to user',
    sensitivity: 'high',
    expectedProtection: 'admin+permission',
    actualProtection: 'admin+permission',
    enforcement: 'enforced',
    hardenedInStep54: true,
    notes: 'requireAdmin + fail-closed RBAC (manage_users_and_roles). Uses real session identity.',
  },
  {
    key: 'approval_approve',
    route: '/api/admin/security',
    method: 'POST',
    actionName: 'approve',
    description: 'Approve approval request',
    sensitivity: 'high',
    expectedProtection: 'admin+dual_control',
    actualProtection: 'admin+dual_control',
    enforcement: 'enforced',
    hardenedInStep54: false,
    notes: 'requireAdmin + dual-control (self-approval blocked in security-store.ts). Already enforced at lib level.',
  },
  // High — model governance
  {
    key: 'model_promote',
    route: '/api/admin/model-governance',
    method: 'POST',
    actionName: 'promote-model-version',
    description: 'Promote model version to active',
    sensitivity: 'high',
    expectedProtection: 'admin+permission',
    actualProtection: 'admin+permission',
    enforcement: 'enforced',
    hardenedInStep54: true,
    notes: 'requireAdmin + fail-closed RBAC (manage_model_versions) + audit log. Uses real session identity.',
  },
  // Medium — demo execution
  {
    key: 'demo_order_submit',
    route: '/api/admin/demo-execution',
    method: 'POST',
    actionName: 'submit',
    description: 'Submit demo order',
    sensitivity: 'medium',
    expectedProtection: 'admin+execution_guard',
    actualProtection: 'admin+execution_guard',
    enforcement: 'enforced',
    hardenedInStep54: true,
    notes: 'requireAdmin + fail-closed RBAC (submit_demo_orders) + demo-enabled guard. Uses real session identity.',
  },
  // Medium — resilience
  {
    key: 'resilience_drill_start',
    route: '/api/admin/resilience',
    method: 'POST',
    actionName: 'start-drill',
    description: 'Start resilience drill',
    sensitivity: 'medium',
    expectedProtection: 'admin',
    actualProtection: 'admin',
    enforcement: 'enforced',
    hardenedInStep54: false,
    notes: 'requireAdmin + audit log. Drills are non-destructive simulations — admin-level protection is sufficient.',
  },
  // Medium — compliance export
  {
    key: 'compliance_evidence_create',
    route: '/api/admin/compliance',
    method: 'POST',
    actionName: 'create-evidence',
    description: 'Create evidence record',
    sensitivity: 'medium',
    expectedProtection: 'admin',
    actualProtection: 'admin',
    enforcement: 'enforced',
    hardenedInStep54: false,
    notes: 'requireAdmin. Evidence records are append-only — no deletion risk. Admin-level protection is sufficient.',
  },
];

export function getSensitiveActionRegistry() {
  return SENSITIVE_ACTIONS;
}

export function getRegistrySummary() {
  const total = SENSITIVE_ACTIONS.length;
  const critical = SENSITIVE_ACTIONS.filter(a => a.sensitivity === 'critical').length;
  const high = SENSITIVE_ACTIONS.filter(a => a.sensitivity === 'high').length;
  const medium = SENSITIVE_ACTIONS.filter(a => a.sensitivity === 'medium').length;
  const enforced = SENSITIVE_ACTIONS.filter(a => a.enforcement === 'enforced').length;
  const hardened = SENSITIVE_ACTIONS.filter(a => a.hardenedInStep54).length;
  const deferred = SENSITIVE_ACTIONS.filter(a => !a.hardenedInStep54).length;

  return {
    total, critical, high, medium,
    enforced,
    partiallyEnforced: SENSITIVE_ACTIONS.filter(a => a.enforcement === 'partially_enforced').length,
    expectedNotEnforced: SENSITIVE_ACTIONS.filter(a => a.enforcement === 'expected_not_enforced').length,
    hardenedInStep54: hardened,
    deferred,
  };
}

/* ------------------------------------------------------------------ */
/*  Authorization guard helper                                         */
/* ------------------------------------------------------------------ */

export interface AuthorizationResult {
  allowed: boolean;
  reason: string;
  code: 'authorized' | 'unauthorized' | 'forbidden' | 'permission_denied' | 'invalid_state' | 'kill_switch_active';
}

/**
 * FAIL-CLOSED permission check for sensitive actions.
 *
 * Unlike the legacy checkPermission() which defaults to allowed when no
 * user record exists, this function DENIES by default for sensitive actions.
 *
 * @param sessionId - The real session ID from requireAdmin(). Must not be hardcoded.
 * @param permission - The RBAC permission to check.
 * @param actionDescription - Human-readable description for audit logs.
 */
export async function requirePermission(
  sessionId: string,
  permission: string,
  actionDescription: string,
): Promise<AuthorizationResult> {
  // Reject if no real session identity is provided
  if (!sessionId || sessionId === 'admin' || sessionId === 'unknown') {
    await logAuditEvent({
      actor: sessionId || 'anonymous',
      eventType: 'authorization_denied',
      targetType: 'sensitive-action',
      summary: `Sensitive action denied: no real session identity for ${actionDescription}`,
    });
    return {
      allowed: false,
      reason: 'Sensitive action requires authenticated session identity',
      code: 'unauthorized',
    };
  }

  // Use the existing RBAC check
  const user = await getUserRole(sessionId);

  // FAIL CLOSED: if no RBAC user record exists, deny for sensitive actions
  if (!user) {
    await logAuditEvent({
      actor: sessionId,
      eventType: 'authorization_denied',
      targetType: 'sensitive-action',
      summary: `Sensitive action denied: no RBAC record for session ${sessionId.slice(0, 8)}... — ${actionDescription}`,
    });
    return {
      allowed: false,
      reason: 'No RBAC user record found — sensitive actions require explicit role assignment. Use /admin/security to assign a role.',
      code: 'forbidden',
    };
  }

  // Check if user is disabled
  if (user.status === 'disabled') {
    await logAuditEvent({
      actor: sessionId,
      eventType: 'authorization_denied',
      targetType: 'sensitive-action',
      summary: `Disabled user attempted sensitive action: ${actionDescription}`,
    });
    return {
      allowed: false,
      reason: 'User account is disabled',
      code: 'forbidden',
    };
  }

  // Check specific permission
  if (!hasPermission(user.role, permission as any)) {
    await logAuditEvent({
      actor: sessionId,
      eventType: 'authorization_denied',
      targetType: 'sensitive-action',
      summary: `Permission denied: role ${user.role} lacks ${permission} for ${actionDescription}`,
    });
    return {
      allowed: false,
      reason: `Role "${user.role}" does not have permission: ${permission}`,
      code: 'permission_denied',
    };
  }

  return { allowed: true, reason: `Permission granted (role: ${user.role})`, code: 'authorized' };
}

/**
 * Check if execution is currently allowed (kill switch, mode).
 */
export async function requireExecutionAllowed(): Promise<AuthorizationResult> {
  if (await isKillSwitchActive()) {
    return { allowed: false, reason: 'Kill switch is active — all execution blocked', code: 'kill_switch_active' };
  }
  return { allowed: true, reason: 'Execution allowed', code: 'authorized' };
}

/**
 * Check if live execution is currently allowed.
 */
export async function requireLiveExecutionAllowed(): Promise<AuthorizationResult> {
  const result = await canExecuteLive();
  if (!result.allowed) {
    return { allowed: false, reason: result.reason || 'Live execution not allowed', code: 'invalid_state' };
  }
  return { allowed: true, reason: 'Live execution allowed', code: 'authorized' };
}
