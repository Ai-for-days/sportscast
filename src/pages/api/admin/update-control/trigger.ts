import { triggerManualUpdate } from '@/lib/admin-update-control';
import { requirePermission } from '@/lib/security-store';
import { auditLog } from '@/lib/audit-log';

export async function POST({ request }: any) {
  try {
    await requirePermission(request, 'admin_access');

    const body = await request.json();
    const { type } = body;

    const validTypes = ['weather', 'sports', 'odds', 'nws', 'all'];
    if (!validTypes.includes(type)) {
      throw new Error(`type must be one of: ${validTypes.join(', ')}`);
    }

    const jobId = await triggerManualUpdate(type);

    await auditLog({
      action: 'update-control-trigger',
      details: { type, jobId },
      severity: 'info',
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
