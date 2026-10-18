import { setAutoUpdateEnabled, getUpdateSettings } from '@/lib/admin-update-control';
import { requireAdmin } from '@/lib/admin-auth';
import { requirePermission } from '@/lib/sensitive-actions';
import { logAuditEvent } from '@/lib/audit-log';

export async function POST({ request }: any) {
  try {
    const session = await requireAdmin(request);
    if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

    await requirePermission(session, 'admin_access', 'update control auto update toggle');

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }

    await setAutoUpdateEnabled(enabled);

    await logAuditEvent({
      eventType: 'update_control_toggled',
      targetType: 'update-control',
      details: { autoUpdateEnabled: enabled },
    });

    const settings = await getUpdateSettings();
    return new Response(JSON.stringify(settings), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.statusCode || 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
