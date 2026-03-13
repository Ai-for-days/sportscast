import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { fetchKalshiWeatherMarkets } from '../../../../lib/kalshi';
import { mapAllMarkets } from '../../../../lib/kalshi-market-mapper';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const raw = await fetchKalshiWeatherMarkets();
    const mapped = mapAllMarkets(raw);

    const mappedCount = mapped.filter(m => m.mapped).length;
    const unmappedCount = mapped.filter(m => !m.mapped).length;

    return new Response(JSON.stringify({ markets: mapped, mappedCount, unmappedCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed' }), { status: 500 });
  }
};
