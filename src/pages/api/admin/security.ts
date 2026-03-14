import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import {
  listUserRoles,
  assignRole,
  disableUser,
  enableUser,
  listApprovals,
  createApprovalRequest,
  approveRequest,
  rejectRequest,
  listSecurityEvents,
  initializeDefaultAdmin,
} from '../../../lib/security-store';
import { ROLES, PERMISSIONS, ROLE_PERMISSIONS, DUAL_CONTROL_ACTIONS } from '../../../lib/rbac';
import { requirePermission } from '../../../lib/sensitive-actions';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const [users, approvals, events] = await Promise.all([
      listUserRoles(),
      listApprovals(100),
      listSecurityEvents(50),
    ]);

    return new Response(JSON.stringify({
      users,
      approvals,
      events,
      roles: ROLES,
      permissions: PERMISSIONS,
      rolePermissions: ROLE_PERMISSIONS,
      dualControlActions: DUAL_CONTROL_ACTIONS,
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/*  POST                                                                */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'assign-role':
      case 'change-role': {
        const permCheck = await requirePermission('admin', 'manage_users_and_roles', 'role assignment');
        if (!permCheck.allowed) {
          return new Response(JSON.stringify({ error: permCheck.reason, code: permCheck.code }), { status: 403 });
        }
        const { userId, role, email } = body;
        if (!userId || !role) return resp400('userId and role required');
        if (!(ROLES as readonly string[]).includes(role)) return resp400(`Invalid role: ${role}`);
        const user = await assignRole(userId, role, 'admin', email);
        return ok({ user });
      }

      case 'disable-user': {
        const { userId } = body;
        if (!userId) return resp400('userId required');
        const user = await disableUser(userId, 'admin');
        if (!user) return resp404('User not found');
        return ok({ user });
      }

      case 'enable-user': {
        const { userId } = body;
        if (!userId) return resp400('userId required');
        const user = await enableUser(userId, 'admin');
        if (!user) return resp404('User not found');
        return ok({ user });
      }

      case 'create-approval-request': {
        const { actionType, targetType, requestedBy, targetId, notes, payload } = body;
        if (!actionType || !targetType || !requestedBy) return resp400('actionType, targetType, requestedBy required');
        const req = await createApprovalRequest(actionType, targetType, requestedBy, targetId, notes, payload);
        return ok({ approval: req });
      }

      case 'approve-request': {
        const { id, approverId } = body;
        if (!id || !approverId) return resp400('id and approverId required');
        const req = await approveRequest(id, approverId);
        if (!req) return new Response(JSON.stringify({ error: 'Cannot approve — not found, already processed, self-approval blocked, or insufficient role' }), { status: 403 });
        return ok({ approval: req });
      }

      case 'reject-request': {
        const { id, approverId, notes } = body;
        if (!id || !approverId) return resp400('id and approverId required');
        const req = await rejectRequest(id, approverId, notes);
        if (!req) return resp404('Request not found or already processed');
        return ok({ approval: req });
      }

      case 'initialize-defaults': {
        await initializeDefaultAdmin();
        return ok({});
      }

      default:
        return resp400(`Unknown action: ${action}`);
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

function ok(data: any) { return new Response(JSON.stringify({ ok: true, ...data }), { status: 200 }); }
function resp400(msg: string) { return new Response(JSON.stringify({ error: msg }), { status: 400 }); }
function resp404(msg: string) { return new Response(JSON.stringify({ error: msg }), { status: 404 }); }
