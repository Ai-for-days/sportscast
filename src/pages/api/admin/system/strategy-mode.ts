import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  getStrategyMode, setStrategyMode, listStrategyModeHistory,
  STRATEGY_MODES, STRATEGY_MODE_DESCRIPTIONS, STRATEGY_MODE_SAFETY,
  type StrategyMode,
} from '../../../../lib/strategy-mode';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const [current, history] = await Promise.all([
      getStrategyMode(true),
      listStrategyModeHistory(50),
    ]);
    return new Response(JSON.stringify({
      current,
      history,
      modes: STRATEGY_MODES,
      descriptions: STRATEGY_MODE_DESCRIPTIONS,
      safety: STRATEGY_MODE_SAFETY,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? 'unknown' }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const body = await request.json().catch(() => ({} as any));
    const action = body.action as string | undefined;
    const operatorId = await getOperatorId((session as any).id ?? '');

    if (action === 'set-mode') {
      const mode = body.mode as StrategyMode;
      if (!STRATEGY_MODES.includes(mode)) {
        return new Response(JSON.stringify({ error: 'Invalid mode' }), { status: 400 });
      }
      const cfg = await setStrategyMode({ mode, updatedBy: operatorId, notes: body.notes });
      return new Response(JSON.stringify({ current: cfg }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? 'unknown' }), { status: 500 });
  }
};
