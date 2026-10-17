import { getUpdateSettings } from '@/lib/admin-update-control';
import { requirePermission } from '@/lib/security-store';

export async function GET({ request }: any) {
  try {
    await requirePermission(request, 'admin_access');
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
