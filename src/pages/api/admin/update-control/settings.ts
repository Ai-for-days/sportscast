import { getUpdateSettings } from '@/lib/admin-update-control';
import { requireAdmin } from '@/lib/admin-auth';
import { requirePermission } from '@/lib/sensitive-actions';

export async function GET({ request }: any) {
  try {
    const session = await requireAdmin(request);
    if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

    await requirePermission(session, 'admin_access', 'update control settings check');
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
