import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  captureCurrentAllocation, refreshPaperOutcomes,
  listPaperRecords, voidPaperEntry, addNote, computePerformance,
} from '../../../../lib/paper-strategy-portfolio';
import { logAuditEvent } from '../../../../lib/audit-log';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list';
    if (action === 'list') {
      const records = await withTiming(
        'paper-portfolio:list',
        'quant-review',
        () => cached('paper-portfolio:list', () => listPaperRecords(1000), 30_000),
      );
      return jsonResponse({ records });
    }
    if (action === 'summary') {
      const records = await withTiming(
        'paper-portfolio:summary',
        'quant-review',
        () => cached('paper-portfolio:summary', () => listPaperRecords(2000), 30_000),
      );
      const performance = computePerformance(records);
      return jsonResponse({ records, performance });
    }
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'paper_portfolio_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'capture-current-allocation') {
      const result = await captureCurrentAllocation();
      await logAuditEvent({
        actor: operatorId,
        eventType: 'paper_portfolio_captured',
        targetType: 'system',
        targetId: 'paper-portfolio',
        summary: `Captured ${result.capturedCount} paper entries (${result.duplicateCount} duplicates skipped, ${result.skippedZeroStake} zero-stake skipped)`,
        details: { capturedCount: result.capturedCount, duplicateCount: result.duplicateCount },
      });
      return jsonResponse({ result });
    }

    if (action === 'refresh-paper-outcomes') {
      const result = await refreshPaperOutcomes();
      await logAuditEvent({
        actor: operatorId,
        eventType: 'paper_portfolio_refreshed',
        targetType: 'system',
        targetId: 'paper-portfolio',
        summary: `Refreshed paper outcomes: ${result.updated} settled, ${result.stillOpen} still open`,
        details: result,
      });
      return jsonResponse({ result });
    }

    if (action === 'void-paper-entry') {
      const id = body.id as string;
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const r = await voidPaperEntry(id, body.note);
      if (!r) return jsonResponse({ error: 'not found' }, 404);
      await logAuditEvent({
        actor: operatorId,
        eventType: 'paper_portfolio_voided',
        targetType: 'paper-portfolio',
        targetId: id,
        summary: `Paper entry ${id} voided`,
        details: { note: body.note },
      });
      return jsonResponse({ record: r });
    }

    if (action === 'add-note') {
      const id = body.id as string;
      const note = body.note as string;
      if (!id || !note) return jsonResponse({ error: 'id and note required' }, 400);
      const r = await addNote(id, note);
      if (!r) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ record: r });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'paper_portfolio_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
