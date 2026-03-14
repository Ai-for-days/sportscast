import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import {
  listNotifications, getNotificationConfig, saveNotificationConfig,
  sendNotification, retryNotification, getNotificationSummary,
} from '../../../lib/notifications';
import {
  getEscalationRules, seedDefaultRules, updateEscalationRule,
} from '../../../lib/escalations';
import { cached } from '../../../lib/performance-cache';
import { withTiming } from '../../../lib/performance-metrics';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'history') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const { result: notifications, durationMs } = await withTiming('/api/admin/notifications?history', 'notifications', () => listNotifications(limit));
      return new Response(JSON.stringify({ notifications, _meta: { count: notifications.length, limit, durationMs } }), { status: 200 });
    }

    if (action === 'rules') {
      const rules = await getEscalationRules();
      return new Response(JSON.stringify({ rules }), { status: 200 });
    }

    if (action === 'config') {
      const config = await getNotificationConfig();
      return new Response(JSON.stringify({ config }), { status: 200 });
    }

    // Default: overview (cached)
    const { result: overview, durationMs } = await withTiming('/api/admin/notifications?overview', 'notifications', () =>
      cached('notifications:overview', async () => {
        const [summary, config, rules, notifications] = await Promise.all([
          getNotificationSummary(),
          getNotificationConfig(),
          getEscalationRules(),
          listNotifications(50),
        ]);
        return { summary, config, rules, notifications };
      }, 30_000)
    );

    return new Response(JSON.stringify({ ...overview, _meta: { durationMs, cached: true } }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/*  POST                                                                */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'update-config': {
        const config = {
          notificationsEnabled: !!body.notificationsEnabled,
          webhookUrl: body.webhookUrl || undefined,
          slackWebhookUrl: body.slackWebhookUrl || undefined,
          emailEnabled: !!body.emailEnabled,
        };
        await saveNotificationConfig(config);
        return new Response(JSON.stringify({ ok: true, config }), { status: 200 });
      }

      case 'send-test-notification': {
        const n = await sendNotification({
          type: 'test',
          severity: 'info',
          title: 'Test Notification',
          message: 'This is a test notification from the Operations Center.',
          channels: body.channels || ['internal_log'],
          metadata: { test: true },
        });
        return new Response(JSON.stringify({ ok: true, notification: n }), { status: 200 });
      }

      case 'retry-notification': {
        const n = await retryNotification(body.id);
        if (!n) return new Response(JSON.stringify({ error: 'Notification not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, notification: n }), { status: 200 });
      }

      case 'update-escalation-rule': {
        const rule = await updateEscalationRule(body.id, {
          channels: body.channels,
          enabled: body.enabled,
        });
        if (!rule) return new Response(JSON.stringify({ error: 'Rule not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, rule }), { status: 200 });
      }

      case 'seed-default-rules': {
        const count = await seedDefaultRules();
        return new Response(JSON.stringify({ ok: true, count, message: count > 0 ? `Seeded ${count} rules` : 'Rules already exist' }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
