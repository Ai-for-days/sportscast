import { setUpdatesPerHour, getUpdateSettings } from '@/lib/admin-update-control';
import { requireAdmin } from '@/lib/admin-auth';
import { requirePermission } from '@/lib/sensitive-actions';
import { logAuditEvent } from '@/lib/audit-log';

export async function POST({ request }: any) {
  try {
    const session = await requireAdmin(request);
    if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

    await requirePermission(session, 'admin_access', 'update control frequency change');

    const body = await request.json();
    const { frequency } = body;

    if (!Number.isInteger(frequency) || frequency < 1 || frequency > 60) {
      throw new Error('frequency must be an integer between 1 and 60');
    }

    await setUpdatesPerHour(frequency);

    await logAuditEvent({
      eventType: 'update_control_frequency_changed',
      targetType: 'update-control',
      details: { updatesPerHour: frequency },
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
