import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  createPilot, listPilots, getPilot, updatePilot, transitionPilot, addNote, computePilotMonitoring,
  loadLinkedRecords, linkRecordToPilot, unlinkRecordFromPilot,
  PILOT_STATUSES, PILOT_MODES, PilotError, type PilotMode, type PilotStatus, type ExecutionRecordType,
} from '../../../../lib/strategy-pilot';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list';
    if (action === 'list') {
      const pilots = await listPilots(200);
      return jsonResponse({ pilots, statuses: PILOT_STATUSES, modes: PILOT_MODES });
    }
    if (action === 'detail') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const pilot = await getPilot(id);
      if (!pilot) return jsonResponse({ error: 'not found' }, 404);
      const monitoring = await withTiming(
        'strategy-pilot:monitoring',
        'quant-review',
        () => cached(`pilot-monitoring:${id}`, () => computePilotMonitoring(pilot), 30_000),
      );
      return jsonResponse({ pilot, monitoring });
    }

    if (action === 'execution-review') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const pilot = await getPilot(id);
      if (!pilot) return jsonResponse({ error: 'not found' }, 404);
      const linked = await loadLinkedRecords(id);
      // Aggregate linked vs inferred summary for the UI
      const settledPnl = linked.settlements.reduce((s, x) => s + (x.netPnlCents ?? 0), 0);
      const totalLinked = linked.candidates.length + linked.demoOrders.length + linked.liveOrders.length + linked.paperRecords.length;
      return jsonResponse({
        pilot,
        linked,
        summary: {
          totalLinkedRecords: totalLinked,
          linkedSettlements: linked.settlements.length,
          settledPnlCents: settledPnl,
          mode: pilot.mode,
          status: pilot.status,
        },
      });
    }
    if (action === 'active') {
      const pilots = await listPilots(200);
      const active = pilots.find(p => p.status === 'active');
      if (!active) return jsonResponse({ active: null });
      const monitoring = await withTiming(
        'strategy-pilot:monitoring',
        'quant-review',
        () => cached(`pilot-monitoring:${active.id}`, () => computePilotMonitoring(active), 30_000),
      );
      return jsonResponse({ active, monitoring });
    }
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'strategy_pilot_failed', message: err?.message ?? String(err) }, 500);
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
    const operatorId = await getOperatorId((session as any).id ?? '');

    if (action === 'create-pilot') {
      const created = await createPilot({
        strategyId: body.strategyId,
        mode: body.mode as PilotMode,
        startDate: body.startDate,
        endDate: body.endDate,
        maxCapitalCents: Number(body.maxCapitalCents),
        maxDailyLossCents: Number(body.maxDailyLossCents),
        maxOpenPositions: Number(body.maxOpenPositions),
        maxSingleTradeCents: Number(body.maxSingleTradeCents),
        allowedSources: body.allowedSources,
        allowedMetrics: body.allowedMetrics,
        notes: body.notes,
        createdBy: operatorId,
      });
      return jsonResponse({ pilot: created });
    }

    if (action === 'update-pilot') {
      const r = await updatePilot(body.id, {
        startDate: body.startDate,
        endDate: body.endDate,
        maxCapitalCents: body.maxCapitalCents != null ? Number(body.maxCapitalCents) : undefined,
        maxDailyLossCents: body.maxDailyLossCents != null ? Number(body.maxDailyLossCents) : undefined,
        maxOpenPositions: body.maxOpenPositions != null ? Number(body.maxOpenPositions) : undefined,
        maxSingleTradeCents: body.maxSingleTradeCents != null ? Number(body.maxSingleTradeCents) : undefined,
        allowedSources: body.allowedSources,
        allowedMetrics: body.allowedMetrics,
      }, operatorId);
      if (!r) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ pilot: r });
    }

    if (action === 'transition-pilot') {
      const r = await transitionPilot({
        id: body.id,
        toStatus: body.toStatus as PilotStatus,
        actor: operatorId,
        reason: body.reason,
      });
      return jsonResponse({ pilot: r });
    }

    if (action === 'add-note') {
      const r = await addNote(body.id, body.note, operatorId);
      if (!r) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ pilot: r });
    }

    if (action === 'cancel-pilot') {
      const r = await transitionPilot({ id: body.id, toStatus: 'cancelled', actor: operatorId, reason: body.reason ?? 'cancelled' });
      return jsonResponse({ pilot: r });
    }

    if (action === 'complete-pilot') {
      const r = await transitionPilot({ id: body.id, toStatus: 'completed', actor: operatorId, reason: body.reason ?? 'completed' });
      return jsonResponse({ pilot: r });
    }

    if (action === 'link-record-to-pilot') {
      const result = await linkRecordToPilot({
        pilotId: body.pilotId,
        recordType: body.recordType as ExecutionRecordType,
        recordId: body.recordId,
        actor: operatorId,
      });
      if (!result.ok) return jsonResponse({ error: result.error ?? 'link_failed', message: result.check.reason }, 400);
      return jsonResponse({ record: result.record, check: result.check });
    }

    if (action === 'unlink-record-from-pilot') {
      const result = await unlinkRecordFromPilot({
        recordType: body.recordType as ExecutionRecordType,
        recordId: body.recordId,
        actor: operatorId,
      });
      if (!result.ok) return jsonResponse({ error: result.error ?? 'unlink_failed' }, 400);
      return jsonResponse({ record: result.record });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof PilotError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'strategy_pilot_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
