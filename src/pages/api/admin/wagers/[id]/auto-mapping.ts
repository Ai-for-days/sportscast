// ── Release a game so the auto-market engines can rebuild its market ──────
//
// GET  reports which game-to-wager pointers aim at this wager.
// DELETE clears them, which makes that game eligible for a fresh market on
// the engines' next tick.
//
// Why this exists (2026-08-27): voiding or deleting an auto-created market
// leaves its pointer behind for the remaining 90 days of its TTL, so the
// engine keeps skipping that game and never replaces the market. Until now
// there was no way to undo that from the admin UI at all.
//
// This does NOT create, price, cancel or settle anything. It removes a
// bookkeeping pointer. The engines do the rest on their own schedule, subject
// to their usual guards (the game must still be pre-game, and still before the
// lock time the current rule places on it).

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { findMappingsForWager, clearMappings } from '../../../../../lib/auto-market-mapping';
import { logAuditEvent } from '../../../../../lib/audit-log';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ params, request }) => {
  const session = await requireAdmin(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  if (!id) return json({ error: 'Missing wager ID' }, 400);

  try {
    const mappings = await findMappingsForWager(id);
    return json({ wagerId: id, mappings });
  } catch (err: any) {
    return json({ error: err?.message ?? 'Lookup failed' }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const session = await requireAdmin(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  if (!id) return json({ error: 'Missing wager ID' }, 400);

  try {
    const mappings = await findMappingsForWager(id);
    if (mappings.length === 0) {
      return json({ wagerId: id, cleared: 0, mappings: [], note: 'No auto-market pointer aims at this wager.' });
    }

    const cleared = await clearMappings(mappings.map(m => m.key));

    await logAuditEvent({
      actor: session,
      eventType: 'auto_market_mapping_cleared',
      targetType: 'wager',
      targetId: id,
      summary: `Released ${cleared} auto-market pointer(s) so the engines can rebuild: ${mappings.map(m => m.key).join(', ')}`,
    });

    return json({ wagerId: id, cleared, mappings });
  } catch (err: any) {
    return json({ error: err?.message ?? 'Clear failed' }, 500);
  }
};
