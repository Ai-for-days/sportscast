import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { buildDeskQueue } from '../../../../lib/desk-priority-engine';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const queue = await withTiming(
      'desk-queue:build',
      'quant-review',
      () => cached('desk-queue:v1', () => buildDeskQueue(), 30_000),
    );
    return jsonResponse({ queue });
  } catch (err: any) {
    return jsonResponse({ error: 'desk_queue_failed', message: err?.message ?? String(err) }, 500);
  }
};
