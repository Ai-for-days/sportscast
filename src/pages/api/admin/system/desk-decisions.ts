import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  createDecision, updateDecision, reviewDecision,
  listDecisions, summarize, findMissedOpportunities,
  type DecisionType, type ReasonCategory, type OutcomeStatus,
} from '../../../../lib/desk-decisions';
import { logAuditEvent } from '../../../../lib/audit-log';

export const prerender = false;

const VALID_DECISIONS: DecisionType[] = ['take', 'skip', 'watch', 'reject'];
const VALID_REASONS: ReasonCategory[] = ['edge', 'calibration', 'liquidity', 'risk', 'venue', 'weather_uncertainty', 'manual_override', 'other'];
const VALID_OUTCOMES: OutcomeStatus[] = ['pending', 'won', 'lost', 'push', 'missed_opportunity'];

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const action = url.searchParams.get('action') ?? 'list-decisions';
  try {
    if (action === 'list-decisions') {
      const limit = parseInt(url.searchParams.get('limit') ?? '200', 10) || 200;
      const decisions = await listDecisions(limit);
      return new Response(JSON.stringify({ decisions }), { status: 200 });
    }
    if (action === 'summarize-decisions') {
      const decisions = await listDecisions(2000);
      const summary = summarize(decisions);
      const missed = findMissedOpportunities(decisions);
      return new Response(JSON.stringify({ summary, missed, decisionCount: decisions.length }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? 'unknown' }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const body = await request.json().catch(() => ({} as any));
  const action = body.action as string | undefined;
  if (!action) return new Response(JSON.stringify({ error: 'Missing action' }), { status: 400 });

  try {
    const operatorId = await getOperatorId((session as any).id ?? '');

    if (action === 'create-decision') {
      const decision = body.decision as DecisionType;
      const reasonCategory = body.reasonCategory as ReasonCategory;
      if (!VALID_DECISIONS.includes(decision)) return new Response(JSON.stringify({ error: 'Invalid decision' }), { status: 400 });
      if (!VALID_REASONS.includes(reasonCategory)) return new Response(JSON.stringify({ error: 'Invalid reasonCategory' }), { status: 400 });
      if (!body.signalId || !body.title || !body.source) return new Response(JSON.stringify({ error: 'signalId, title, and source are required' }), { status: 400 });

      const created = await createDecision({
        signalId: body.signalId,
        title: body.title,
        source: body.source,
        marketType: body.marketType,
        locationName: body.locationName,
        metric: body.metric,
        targetDate: body.targetDate,
        operatorId,
        decision,
        reasonCategory,
        notes: body.notes,
        rawEdge: body.rawEdge,
        calibratedEdge: body.calibratedEdge,
        reliabilityFactor: body.reliabilityFactor,
        signalScore: body.signalScore,
        sizingTier: body.sizingTier,
      });

      await logAuditEvent({
        actor: operatorId,
        eventType: 'desk_decision_created',
        targetType: 'signal',
        targetId: body.signalId,
        summary: `Desk decision "${decision}" recorded for ${body.title} (${reasonCategory})`,
        details: { decisionId: created.id, decision, reasonCategory },
      });

      return new Response(JSON.stringify({ decision: created }), { status: 200 });
    }

    if (action === 'update-decision') {
      const id = body.id as string;
      if (!id) return new Response(JSON.stringify({ error: 'id is required' }), { status: 400 });
      const patch: any = {};
      if (body.decision != null) {
        if (!VALID_DECISIONS.includes(body.decision)) return new Response(JSON.stringify({ error: 'Invalid decision' }), { status: 400 });
        patch.decision = body.decision;
      }
      if (body.reasonCategory != null) {
        if (!VALID_REASONS.includes(body.reasonCategory)) return new Response(JSON.stringify({ error: 'Invalid reasonCategory' }), { status: 400 });
        patch.reasonCategory = body.reasonCategory;
      }
      if (body.notes != null) patch.notes = body.notes;

      const updated = await updateDecision(id, patch);
      if (!updated) return new Response(JSON.stringify({ error: 'Decision not found' }), { status: 404 });

      await logAuditEvent({
        actor: operatorId,
        eventType: 'desk_decision_updated',
        targetType: 'signal',
        targetId: updated.signalId,
        summary: `Desk decision ${id} updated`,
        details: { patch },
      });

      return new Response(JSON.stringify({ decision: updated }), { status: 200 });
    }

    if (action === 'review-decision') {
      const id = body.id as string;
      if (!id) return new Response(JSON.stringify({ error: 'id is required' }), { status: 400 });
      const outcomeStatus = body.outcomeStatus as OutcomeStatus | undefined;
      if (outcomeStatus != null && !VALID_OUTCOMES.includes(outcomeStatus)) {
        return new Response(JSON.stringify({ error: 'Invalid outcomeStatus' }), { status: 400 });
      }
      const reviewed = await reviewDecision(id, {
        outcomeStatus,
        pnlCents: body.pnlCents,
        reviewNotes: body.reviewNotes,
      });
      if (!reviewed) return new Response(JSON.stringify({ error: 'Decision not found' }), { status: 404 });

      await logAuditEvent({
        actor: operatorId,
        eventType: 'desk_decision_reviewed',
        targetType: 'signal',
        targetId: reviewed.signalId,
        summary: `Desk decision ${id} reviewed (${outcomeStatus ?? 'no outcome'})`,
        details: { outcomeStatus, pnlCents: body.pnlCents },
      });

      return new Response(JSON.stringify({ decision: reviewed }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? 'unknown' }), { status: 500 });
  }
};
