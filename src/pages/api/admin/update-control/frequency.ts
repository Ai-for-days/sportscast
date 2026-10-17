import { setUpdatesPerHour, getUpdateSettings } from '@/lib/admin-update-control';
import { requirePermission } from '@/lib/security-store';
import { auditLog } from '@/lib/audit-log';

export async function POST({ request }: any) {
  try {
    await requirePermission(request, 'admin_access');

    const body = await request.json();
    const { frequency } = body;

    if (!Number.isInteger(frequency) || frequency < 1 || frequency > 60) {
      throw new Error('frequency must be an integer between 1 and 60');
    }

    await setUpdatesPerHour(frequency);

    await auditLog({
      action: 'update-control-frequency',
      details: { updatesPerHour: frequency },
      severity: 'info',
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
