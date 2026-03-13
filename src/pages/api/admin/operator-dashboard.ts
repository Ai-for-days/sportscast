import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { generateOperatorDashboard, markTaskDone, resetDailyTasks } from '../../../lib/operator-workflow';
import { generateStrategyAnalytics } from '../../../lib/strategy-analytics';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const [dashboard, analytics] = await Promise.all([
      generateOperatorDashboard(),
      generateStrategyAnalytics(),
    ]);

    return new Response(JSON.stringify({ ...dashboard, analytics }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'mark-task-done') {
      const { taskId } = body;
      if (!taskId) {
        return new Response(JSON.stringify({ error: 'Missing taskId' }), { status: 400 });
      }
      await markTaskDone(taskId);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'reset-daily-tasks') {
      await resetDailyTasks();
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};
