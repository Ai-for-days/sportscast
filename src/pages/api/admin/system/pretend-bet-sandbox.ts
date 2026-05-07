// ── Step 120 Part F: Admin API for the pretend-bet sandbox ──────────────────
//
// Sandbox-only. No bet-store / wallet-store writes. Audit-logged.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import {
  placePretendBet,
  addBetNote,
  voidPretendBet,
  listPretendBets,
  getPretendBet,
  getPretendBetsBySession,
  getPretendBetsByWager,
  getPretendBetSummary,
  previewPretendPayout,
  PretendBetError,
  type PretendBet,
} from '../../../../lib/pretend-bet-store';

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
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 50)) : 50;
      const bets = await listPretendBets(limit);
      return jsonResponse({ bets });
    }
    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const bet = await getPretendBet(id);
      if (!bet) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ bet });
    }
    if (action === 'get-by-session') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return jsonResponse({ error: 'sessionId required' }, 400);
      const bets = await getPretendBetsBySession(sessionId);
      return jsonResponse({ bets });
    }
    if (action === 'get-by-wager') {
      const wagerId = url.searchParams.get('wagerId');
      if (!wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const bets = await getPretendBetsByWager(wagerId);
      return jsonResponse({ bets });
    }
    if (action === 'summary') {
      const summary = await getPretendBetSummary();
      return jsonResponse({ summary });
    }
    if (action === 'preview') {
      const wagerId = url.searchParams.get('wagerId');
      const outcomeLabel = url.searchParams.get('outcomeLabel');
      const stakeCents = Number(url.searchParams.get('stakeCents') ?? '0');
      if (!wagerId || !outcomeLabel) {
        return jsonResponse({ error: 'wagerId and outcomeLabel required' }, 400);
      }
      const result = await previewPretendPayout(wagerId, outcomeLabel, stakeCents);
      return jsonResponse({ result });
    }
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'pretend_bet_failed', message: err?.message ?? String(err) },
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

    if (action === 'place-pretend-bet') {
      let bet: PretendBet;
      let updatedSession;
      try {
        const result = await placePretendBet(
          {
            sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
            wagerId: typeof body.wagerId === 'string' ? body.wagerId : '',
            outcomeLabel: typeof body.outcomeLabel === 'string' ? body.outcomeLabel : '',
            stakeCents:
              typeof body.stakeCents === 'number'
                ? Math.floor(body.stakeCents)
                : NaN,
          },
          actor,
        );
        bet = result.bet;
        updatedSession = result.session;
      } catch (err: any) {
        if (err instanceof PretendBetError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }
      await logAuditEvent({
        actor,
        eventType: 'pretend_bet_placed',
        targetType: 'pretend_bet',
        targetId: bet.id,
        summary: `Placed pretend bet (${bet.outcomeLabel}, $${(bet.stakeCents / 100).toFixed(2)}) on wager ${bet.wagerId} in session ${bet.sessionId}.`,
        details: {
          sessionId: bet.sessionId,
          pretendUserId: bet.pretendUserId,
          wagerId: bet.wagerId,
          outcomeLabel: bet.outcomeLabel,
          stakeCents: bet.stakeCents,
          odds: bet.odds,
          potentialPayoutCents: bet.potentialPayoutCents,
        },
      });
      return jsonResponse({ bet, session: updatedSession });
    }

    if (action === 'add-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      let bet: PretendBet;
      try {
        bet = await addBetNote(String(body.id), String(body.note), actor);
      } catch (err: any) {
        if (err instanceof PretendBetError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }
      await logAuditEvent({
        actor,
        eventType: 'pretend_bet_note_added',
        targetType: 'pretend_bet',
        targetId: bet.id,
        summary: `Added note to pretend bet ${bet.id}.`,
        details: { note: String(body.note).slice(0, 500) },
      });
      return jsonResponse({ bet });
    }

    if (action === 'void-pretend-bet') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      let bet: PretendBet;
      let updatedSession;
      try {
        const result = await voidPretendBet(
          String(body.id),
          actor,
          typeof body.reason === 'string' ? body.reason : undefined,
        );
        bet = result.bet;
        updatedSession = result.session;
      } catch (err: any) {
        if (err instanceof PretendBetError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }
      await logAuditEvent({
        actor,
        eventType: 'pretend_bet_voided',
        targetType: 'pretend_bet',
        targetId: bet.id,
        summary: `Voided pretend bet ${bet.id} ($${(bet.stakeCents / 100).toFixed(2)} restored to session balance).`,
        details: { sessionId: bet.sessionId, restoredCents: bet.stakeCents, reason: body.reason },
      });
      return jsonResponse({ bet, session: updatedSession });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'pretend_bet_action_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};
