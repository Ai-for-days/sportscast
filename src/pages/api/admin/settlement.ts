import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { requirePermission } from '../../../lib/sensitive-actions';
import { logAuditEvent } from '../../../lib/audit-log';
import {
  listSettlements,
  listEnhancedPositions,
  listDiscrepancies,
  getSettlementOverview,
  rebuildSettlements,
  rebuildEnhancedPositions,
  rebuildUnrealizedPnl,
  rebuildDiscrepancies,
  updateDiscrepancyResolution,
} from '../../../lib/settlement';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const [settlements, positions, discrepancies, overview] = await Promise.all([
      listSettlements(100),
      listEnhancedPositions(100),
      listDiscrepancies(100),
      getSettlementOverview(),
    ]);

    return new Response(JSON.stringify({
      settlements,
      positions,
      discrepancies,
      overview,
    }), { status: 200 });
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
      case 'rebuild-settlements': {
        const permCheck = await requirePermission(session, 'manage_settlement', 'settlement rebuild');
        if (!permCheck.allowed) {
          return new Response(JSON.stringify({ error: permCheck.reason, code: permCheck.code }), { status: 403 });
        }
        await logAuditEvent({ actor: 'admin', eventType: 'settlement_rebuild', targetType: 'settlement', summary: 'Settlements rebuilt' });
        const result = await rebuildSettlements();
        return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
      }

      case 'rebuild-position-closes': {
        const result = await rebuildEnhancedPositions();
        return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
      }

      case 'rebuild-unrealized-pnl': {
        const result = await rebuildUnrealizedPnl();
        return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
      }

      case 'rebuild-discrepancies': {
        const result = await rebuildDiscrepancies();
        return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
      }

      case 'mark-discrepancy-reviewed':
      case 'resolve-discrepancy':
      case 'dispute-discrepancy':
      case 'ignore-discrepancy': {
        const { id, notes } = body;
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
        const resMap: Record<string, any> = {
          'mark-discrepancy-reviewed': 'reviewed',
          'resolve-discrepancy': 'resolved',
          'dispute-discrepancy': 'disputed',
          'ignore-discrepancy': 'ignored',
        };
        const disc = await updateDiscrepancyResolution(id, resMap[action], notes);
        if (!disc) return new Response(JSON.stringify({ error: 'Discrepancy not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, discrepancy: disc }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
