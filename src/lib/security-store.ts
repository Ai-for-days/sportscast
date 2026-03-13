import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import type { Role } from './rbac';
import { hasPermission, canApprove, isDualControlAction } from './rbac';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface UserRole {
  userId: string;
  email?: string;
  role: Role;
  status: 'active' | 'disabled';
  assignedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  createdAt: string;
  actionType: string;
  targetType: string;
  targetId?: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approverId?: string;
  approvedAt?: string;
  rejectedAt?: string;
  notes?: string;
  payload?: any;
}

export interface SecurityEvent {
  id: string;
  createdAt: string;
  eventType: string;
  actor: string;
  target?: string;
  details?: string;
}

/* ------------------------------------------------------------------ */
/*  Redis keys                                                          */
/* ------------------------------------------------------------------ */

const USER_ROLE_PREFIX = 'security:user:';
const USER_ROLE_SET = 'security:users:all';
const APPROVAL_PREFIX = 'security:approval:';
const APPROVAL_SET = 'security:approvals:all';
const SEC_EVENT_PREFIX = 'security:event:';
const SEC_EVENT_SET = 'security:events:all';

/* ------------------------------------------------------------------ */
/*  User Role CRUD                                                      */
/* ------------------------------------------------------------------ */

export async function saveUserRole(user: UserRole): Promise<void> {
  const redis = getRedis();
  await redis.set(`${USER_ROLE_PREFIX}${user.userId}`, JSON.stringify(user));
  await redis.zadd(USER_ROLE_SET, { score: Date.now(), member: user.userId });
}

export async function getUserRole(userId: string): Promise<UserRole | null> {
  const redis = getRedis();
  const raw = await redis.get(`${USER_ROLE_PREFIX}${userId}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as UserRole;
}

export async function listUserRoles(): Promise<UserRole[]> {
  const redis = getRedis();
  const ids = await redis.zrange(USER_ROLE_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const users: UserRole[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${USER_ROLE_PREFIX}${id}`);
    if (raw) users.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as UserRole);
  }
  return users;
}

export async function assignRole(userId: string, role: Role, assignedBy: string, email?: string): Promise<UserRole> {
  const existing = await getUserRole(userId);
  const now = new Date().toISOString();

  const user: UserRole = {
    userId,
    email: email || existing?.email,
    role,
    status: existing?.status || 'active',
    assignedBy,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await saveUserRole(user);

  const eventType = existing ? 'role_changed' : 'role_assigned';
  await logSecurityEvent(eventType, assignedBy, userId, `Role ${eventType}: ${userId} → ${role}`);
  await logAuditEvent({
    actor: assignedBy,
    eventType,
    targetType: 'user',
    targetId: userId,
    summary: `${eventType}: ${userId} → ${role}`,
    details: { previousRole: existing?.role, newRole: role },
  });

  return user;
}

export async function disableUser(userId: string, actor: string): Promise<UserRole | null> {
  const user = await getUserRole(userId);
  if (!user) return null;
  user.status = 'disabled';
  user.updatedAt = new Date().toISOString();
  await saveUserRole(user);
  await logSecurityEvent('user_disabled', actor, userId, `User disabled: ${userId}`);
  await logAuditEvent({ actor, eventType: 'user_disabled', targetType: 'user', targetId: userId, summary: `User disabled: ${userId}` });
  return user;
}

export async function enableUser(userId: string, actor: string): Promise<UserRole | null> {
  const user = await getUserRole(userId);
  if (!user) return null;
  user.status = 'active';
  user.updatedAt = new Date().toISOString();
  await saveUserRole(user);
  await logSecurityEvent('user_enabled', actor, userId, `User enabled: ${userId}`);
  return user;
}

/* ------------------------------------------------------------------ */
/*  Permission check helper                                             */
/* ------------------------------------------------------------------ */

export async function checkPermission(userId: string, permission: string): Promise<{ allowed: boolean; reason: string; role?: Role }> {
  const user = await getUserRole(userId);

  // Default: if no user record exists, treat as admin for backward compat
  if (!user) {
    return { allowed: true, reason: 'No user record — default admin access', role: 'admin' };
  }

  if (user.status === 'disabled') {
    await logSecurityEvent('permission_denied', userId, permission, `Disabled user attempted: ${permission}`);
    return { allowed: false, reason: 'User account is disabled', role: user.role };
  }

  const allowed = hasPermission(user.role, permission as any);
  if (!allowed) {
    await logSecurityEvent('permission_denied', userId, permission, `Permission denied: ${user.role} cannot ${permission}`);
  }
  return { allowed, reason: allowed ? 'Permitted' : `Role '${user.role}' lacks permission '${permission}'`, role: user.role };
}

/* ------------------------------------------------------------------ */
/*  Approval CRUD                                                       */
/* ------------------------------------------------------------------ */

async function saveApproval(req: ApprovalRequest): Promise<void> {
  const redis = getRedis();
  await redis.set(`${APPROVAL_PREFIX}${req.id}`, JSON.stringify(req));
  await redis.zadd(APPROVAL_SET, { score: Date.now(), member: req.id });
}

export async function getApproval(id: string): Promise<ApprovalRequest | null> {
  const redis = getRedis();
  const raw = await redis.get(`${APPROVAL_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ApprovalRequest;
}

export async function listApprovals(limit = 100): Promise<ApprovalRequest[]> {
  const redis = getRedis();
  const ids = await redis.zrange(APPROVAL_SET, 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const reqs: ApprovalRequest[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${APPROVAL_PREFIX}${id}`);
    if (raw) reqs.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ApprovalRequest);
  }
  return reqs;
}

export async function createApprovalRequest(
  actionType: string,
  targetType: string,
  requestedBy: string,
  targetId?: string,
  notes?: string,
  payload?: any,
): Promise<ApprovalRequest> {
  const req: ApprovalRequest = {
    id: `apr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    actionType,
    targetType,
    targetId,
    requestedBy,
    status: 'pending',
    notes,
    payload,
  };

  await saveApproval(req);
  await logSecurityEvent('approval_requested', requestedBy, `${actionType}:${targetId || ''}`, `Approval requested: ${actionType}`);
  await logAuditEvent({
    actor: requestedBy,
    eventType: 'approval_requested',
    targetType,
    targetId: req.id,
    summary: `Approval requested: ${actionType} on ${targetType}${targetId ? ` (${targetId})` : ''}`,
  });

  if (isDualControlAction(actionType)) {
    await logSecurityEvent('dual_control_required', requestedBy, actionType, `Dual-control required for: ${actionType}`);
  }

  return req;
}

export async function approveRequest(id: string, approverId: string): Promise<ApprovalRequest | null> {
  const req = await getApproval(id);
  if (!req || req.status !== 'pending') return null;

  // Self-approval check for dual-control actions
  if (isDualControlAction(req.actionType) && req.requestedBy === approverId) {
    await logSecurityEvent('sensitive_action_blocked', approverId, req.actionType, 'Self-approval denied for dual-control action');
    return null;
  }

  // Check approver has approve permission
  const approver = await getUserRole(approverId);
  if (approver && !canApprove(approver.role)) {
    await logSecurityEvent('sensitive_action_blocked', approverId, req.actionType, `Role '${approver.role}' cannot approve`);
    return null;
  }

  req.status = 'approved';
  req.approverId = approverId;
  req.approvedAt = new Date().toISOString();
  await saveApproval(req);

  await logSecurityEvent('approval_approved', approverId, `${req.actionType}:${req.targetId || ''}`, `Approved: ${req.actionType}`);
  await logAuditEvent({
    actor: approverId,
    eventType: 'approval_approved',
    targetType: 'approval',
    targetId: id,
    summary: `Approval granted: ${req.actionType} (requested by ${req.requestedBy})`,
  });

  return req;
}

export async function rejectRequest(id: string, approverId: string, notes?: string): Promise<ApprovalRequest | null> {
  const req = await getApproval(id);
  if (!req || req.status !== 'pending') return null;

  req.status = 'rejected';
  req.approverId = approverId;
  req.rejectedAt = new Date().toISOString();
  if (notes) req.notes = (req.notes ? req.notes + ' | ' : '') + notes;
  await saveApproval(req);

  await logSecurityEvent('approval_rejected', approverId, `${req.actionType}:${req.targetId || ''}`, `Rejected: ${req.actionType}`);
  await logAuditEvent({
    actor: approverId,
    eventType: 'approval_rejected',
    targetType: 'approval',
    targetId: id,
    summary: `Approval rejected: ${req.actionType} (requested by ${req.requestedBy})`,
  });

  return req;
}

/* ------------------------------------------------------------------ */
/*  Security event logging                                              */
/* ------------------------------------------------------------------ */

async function logSecurityEvent(eventType: string, actor: string, target?: string, details?: string): Promise<void> {
  const event: SecurityEvent = {
    id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    eventType,
    actor,
    target,
    details,
  };
  const redis = getRedis();
  await redis.set(`${SEC_EVENT_PREFIX}${event.id}`, JSON.stringify(event));
  await redis.zadd(SEC_EVENT_SET, { score: Date.now(), member: event.id });
}

export async function listSecurityEvents(limit = 50): Promise<SecurityEvent[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SEC_EVENT_SET, 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const events: SecurityEvent[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${SEC_EVENT_PREFIX}${id}`);
    if (raw) events.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as SecurityEvent);
  }
  return events;
}

/* ------------------------------------------------------------------ */
/*  Initialize default admin                                            */
/* ------------------------------------------------------------------ */

export async function initializeDefaultAdmin(): Promise<void> {
  const existing = await getUserRole('admin');
  if (!existing) {
    await assignRole('admin', 'super_admin', 'system', undefined);
  }
}
