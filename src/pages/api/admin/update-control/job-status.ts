import { getUpdateJobStatus } from '@/lib/admin-update-control';
import { requirePermission } from '@/lib/security-store';

export async function GET({ request, url }: any) {
  try {
    await requirePermission(request, 'admin_access');

    const jobId = url.searchParams.get('jobId');
    if (!jobId) {
      throw new Error('jobId query parameter is required');
    }

    const job = await getUpdateJobStatus(jobId);

    if (!job) {
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(job), {
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
