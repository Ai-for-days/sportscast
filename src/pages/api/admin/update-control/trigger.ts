import { triggerManualUpdate } from '@/lib/admin-update-control';
import { requireAdmin } from '@/lib/admin-auth';
import { requirePermission } from '@/lib/sensitive-actions';
import { logAuditEvent } from '@/lib/audit-log';

export async function POST({ request }: any) {
  try {
    const session = await requireAdmin(request);
    if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

    await requirePermission(session, 'admin_access', 'update control trigger');

    const body = await request.json();
    const { type } = body;

    const validTypes = ['weather', 'sports', 'odds', 'nws', 'all'];
    if (!validTypes.includes(type)) {
      throw new Error(`type must be one of: ${validTypes.join(', ')}`);
    }

    const jobId = await triggerManualUpdate(type);

    await logAuditEvent({
      eventType: 'update_control_triggered',
      targetType: 'update-control',
      details: { type, jobId },
    });

    return new Response(JSON.stringify({ jobId }), {
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
