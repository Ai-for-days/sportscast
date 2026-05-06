import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  listNotifications,
  listUnread,
  getNotification,
  getInboxSummary,
  generateDigest,
  markRead,
  acknowledge,
  dismiss,
  addNote,
  InboxError,
  type NotificationSource,
  type NotificationSeverity,
  type NotificationStatus,
} from '../../../../lib/admin-notification-inbox';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list';

    if (action === 'summary') {
      const summary = await getInboxSummary();
      return jsonResponse({ summary });
    }

    if (action === 'list') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const status = (url.searchParams.get('status') as NotificationStatus | null) ?? undefined;
      const source = (url.searchParams.get('source') as NotificationSource | null) ?? undefined;
      const severity = (url.searchParams.get('severity') as NotificationSeverity | null) ?? undefined;
      const notifications = await listNotifications({ status, source, severity, limit });
      return jsonResponse({ notifications });
    }

    if (action === 'unread') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const notifications = await listUnread(limit);
      return jsonResponse({ notifications });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const notification = await getNotification(id);
      if (!notification) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ notification });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'admin_notification_inbox_failed', message: err?.message ?? String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const action = body.action as string | undefined;
  if (!action) return jsonResponse({ error: 'Missing action' }, 400);

  try {
    const actor = await getOperatorId(session ?? '');
    if (!actor) return jsonResponse({ error: 'actor_required', message: 'No operator id resolved from session' }, 400);

    if (action === 'generate-digest') {
      const result = await generateDigest(actor);
      return jsonResponse({ result });
    }

    if (action === 'mark-read') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const notification = await markRead(body.id, actor);
      return jsonResponse({ notification });
    }

    if (action === 'acknowledge') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const notification = await acknowledge(body.id, actor, body.note);
      return jsonResponse({ notification });
    }

    if (action === 'dismiss') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const notification = await dismiss(body.id, actor, body.note);
      return jsonResponse({ notification });
    }

    if (action === 'add-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      const notification = await addNote(body.id, body.note, actor);
      return jsonResponse({ notification });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof InboxError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'admin_notification_inbox_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
