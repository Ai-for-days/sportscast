import { setAutoUpdateEnabled, getUpdateSettings } from '@/lib/admin-update-control';
import { requirePermission } from '@/lib/security-store';
import { auditLog } from '@/lib/audit-log';

export async function POST({ request }: any) {
  try {
    await requirePermission(request, 'admin_access');

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }

    await setAutoUpdateEnabled(enabled);

    await auditLog({
      action: 'update-control-toggle',
      details: { autoUpdateEnabled: enabled },
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
