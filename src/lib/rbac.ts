/* ------------------------------------------------------------------ */
/*  Roles                                                               */
/* ------------------------------------------------------------------ */

export const ROLES = [
  'viewer',
  'analyst',
  'trader',
  'bookmaker',
  'risk_manager',
  'operator',
  'reviewer',
  'admin',
  'super_admin',
] as const;

export type Role = typeof ROLES[number];

/* ------------------------------------------------------------------ */
/*  Permissions                                                         */
/* ------------------------------------------------------------------ */

export const PERMISSIONS = [
  'view_admin_pages',
  'manage_forecasts',
  'manage_wagers',
  'run_pricing_lab',
  'apply_repricing',
  'manage_execution_candidates',
  'submit_demo_orders',
  'submit_live_orders',
  'cancel_live_orders',
  'toggle_kill_switch',
  'enable_live_mode',
  'resolve_discrepancies',
  'manage_model_versions',
  'create_experiments',
  'export_reports',
  'manage_users_and_roles',
  'approve_requests',
  'run_sandbox',
  'manage_alerts',
  'view_settlement',
  'manage_settlement',
] as const;

export type Permission = typeof PERMISSIONS[number];

/* ------------------------------------------------------------------ */
/*  Role → Permission map                                               */
/* ------------------------------------------------------------------ */

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  viewer: [
    'view_admin_pages',
  ],
  analyst: [
    'view_admin_pages',
    'manage_forecasts',
    'run_pricing_lab',
    'run_sandbox',
    'export_reports',
    'create_experiments',
  ],
  trader: [
    'view_admin_pages',
    'manage_forecasts',
    'run_pricing_lab',
    'manage_execution_candidates',
    'submit_demo_orders',
    'export_reports',
    'run_sandbox',
    'create_experiments',
  ],
  bookmaker: [
    'view_admin_pages',
    'manage_wagers',
    'run_pricing_lab',
    'apply_repricing',
    'export_reports',
  ],
  risk_manager: [
    'view_admin_pages',
    'manage_forecasts',
    'run_pricing_lab',
    'toggle_kill_switch',
    'resolve_discrepancies',
    'export_reports',
    'manage_alerts',
    'view_settlement',
  ],
  operator: [
    'view_admin_pages',
    'manage_forecasts',
    'manage_wagers',
    'run_pricing_lab',
    'apply_repricing',
    'manage_execution_candidates',
    'submit_demo_orders',
    'cancel_live_orders',
    'toggle_kill_switch',
    'resolve_discrepancies',
    'export_reports',
    'run_sandbox',
    'create_experiments',
    'manage_alerts',
    'view_settlement',
    'manage_settlement',
  ],
  reviewer: [
    'view_admin_pages',
    'manage_forecasts',
    'run_pricing_lab',
    'export_reports',
    'run_sandbox',
    'create_experiments',
    'approve_requests',
    'manage_alerts',
    'view_settlement',
  ],
  admin: [
    'view_admin_pages',
    'manage_forecasts',
    'manage_wagers',
    'run_pricing_lab',
    'apply_repricing',
    'manage_execution_candidates',
    'submit_demo_orders',
    'submit_live_orders',
    'cancel_live_orders',
    'toggle_kill_switch',
    'enable_live_mode',
    'resolve_discrepancies',
    'manage_model_versions',
    'create_experiments',
    'export_reports',
    'approve_requests',
    'run_sandbox',
    'manage_alerts',
    'view_settlement',
    'manage_settlement',
  ],
  super_admin: [...PERMISSIONS],
};

/* ------------------------------------------------------------------ */
/*  Dual-control actions                                                */
/* ------------------------------------------------------------------ */

export const DUAL_CONTROL_ACTIONS = [
  'enable_live_mode',
  'submit_live_order',
  'promote_model_version',
  'emergency_shutdown_override',
] as const;

export type DualControlAction = typeof DUAL_CONTROL_ACTIONS[number];

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

export function hasPermission(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes(permission);
}

export function getRolePermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

export function isDualControlAction(action: string): boolean {
  return (DUAL_CONTROL_ACTIONS as readonly string[]).includes(action);
}

export function canApprove(role: Role): boolean {
  return hasPermission(role, 'approve_requests');
}
