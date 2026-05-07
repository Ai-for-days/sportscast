// ── Step 119B Part A: Admin API for Pretend User Testing ────────────────────
//
// Sandbox-only. No wallet/bet writes. Audit-logged for every mutation.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import {
  createTestSession,
  addSessionNote,
  closeTestSession,
  listTestSessions,
  getTestSession,
  getActiveSession,
  getTestSessionSummary,
  PretendUserTestingError,
  type TestSession,
} from '../../../../lib/pretend-user-testing';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list';

    if (action === 'list') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw) || 50)) : 50;
      const sessions = await listTestSessions(limit);
      return jsonResponse({ sessions });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const found = await getTestSession(id);
      if (!found) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ session: found });
    }

    if (action === 'active') {
      const pretendUserId = url.searchParams.get('pretendUserId');
      if (!pretendUserId) return jsonResponse({ error: 'pretendUserId required' }, 400);
      const found = await getActiveSession(pretendUserId);
      return jsonResponse({ session: found });
    }

    if (action === 'summary') {
      const summary = await getTestSessionSummary();
      return jsonResponse({ summary });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'pretend_user_testing_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  const action = body.action as string | undefined;
  if (!action) return jsonResponse({ error: 'Missing action' }, 400);

  try {
    const actor = await getOperatorId(session ?? '');
    if (!actor) {
      return jsonResponse(
        { error: 'actor_required', message: 'No operator id resolved from session' },
        400,
      );
    }

    if (action === 'create-session') {
      let created: TestSession;
      try {
        created = await createTestSession(
          {
            displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
            startingTestBalanceCents:
              typeof body.startingTestBalanceCents === 'number'
                ? body.startingTestBalanceCents
                : undefined,
            pretendUserId:
              typeof body.pretendUserId === 'string' ? body.pretendUserId : undefined,
          },
          actor,
        );
      } catch (err: any) {
        if (err instanceof PretendUserTestingError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }
      await logAuditEvent({
        actor,
        eventType: 'pretend_user_session_created',
        targetType: 'pretend_user_session',
        targetId: created.id,
        summary: `Created pretend-user test session for ${created.pretendUserId} (${created.displayName}).`,
        details: {
          pretendUserId: created.pretendUserId,
          startingTestBalanceCents: created.startingTestBalanceCents,
        },
      });
      return jsonResponse({ session: created });
    }

    if (action === 'add-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      let updated: TestSession;
      try {
        updated = await addSessionNote(String(body.id), String(body.note), actor);
      } catch (err: any) {
        if (err instanceof PretendUserTestingError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }
      await logAuditEvent({
        actor,
        eventType: 'pretend_user_session_note_added',
        targetType: 'pretend_user_session',
        targetId: updated.id,
        summary: `Added note to pretend-user session ${updated.id}.`,
        details: { note: String(body.note).slice(0, 500) },
      });
      return jsonResponse({ session: updated });
    }

    if (action === 'close-session') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      let updated: TestSession;
      try {
        updated = await closeTestSession(
          String(body.id),
          actor,
          typeof body.reason === 'string' ? body.reason : undefined,
        );
      } catch (err: any) {
        if (err instanceof PretendUserTestingError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }
      await logAuditEvent({
        actor,
        eventType: 'pretend_user_session_closed',
        targetType: 'pretend_user_session',
        targetId: updated.id,
        summary: `Closed pretend-user session ${updated.id}.`,
        details: typeof body.reason === 'string' ? { reason: body.reason } : undefined,
      });
      return jsonResponse({ session: updated });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      {
        error: 'pretend_user_testing_action_failed',
        message: err?.message ?? String(err),
      },
      500,
    );
  }
};
