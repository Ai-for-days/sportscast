import type { APIRoute } from 'astro';
import {
  getVenueAdapter,
  listVenueMeta,
  listVenueNames,
  checkAllVenueHealth,
} from '../../../lib/venues/registry';
import { KalshiAdapter } from '../../../lib/venues/kalshi-adapter';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ url }) => {
  try {
    const action = url.searchParams.get('action') || 'overview';
    const venue = url.searchParams.get('venue') || '';
    const mode = url.searchParams.get('mode') || '';
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    if (action === 'markets') {
      const adapter = venue ? getVenueAdapter(venue) : null;
      if (venue && !adapter) {
        return new Response(JSON.stringify({ error: `Unknown venue: ${venue}` }), { status: 404 });
      }

      let markets: any[] = [];
      if (adapter) {
        markets = await adapter.getMarkets({ limit });
      } else {
        // All venues
        const names = listVenueNames();
        for (const name of names) {
          const a = getVenueAdapter(name);
          if (!a || a.meta.status === 'disabled') continue;
          try {
            const m = await a.getMarkets({ limit });
            markets.push(...m);
          } catch { /* skip */ }
        }
      }
      return new Response(JSON.stringify({ markets, count: markets.length }), { status: 200 });
    }

    if (action === 'orders') {
      let orders: any[] = [];
      const names = venue ? [venue] : listVenueNames();
      for (const name of names) {
        const a = getVenueAdapter(name);
        if (!a) continue;
        // Only KalshiAdapter has getAllOrders
        if (a instanceof KalshiAdapter) {
          const o = await a.getAllOrders({ mode: mode || undefined, limit });
          orders.push(...o);
        }
      }
      orders.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      if (limit) orders = orders.slice(0, limit);
      return new Response(JSON.stringify({ orders, count: orders.length }), { status: 200 });
    }

    if (action === 'health') {
      const health = await checkAllVenueHealth();
      return new Response(JSON.stringify({ health }), { status: 200 });
    }

    // Default: overview
    const venues = listVenueMeta();
    const health = await checkAllVenueHealth();
    return new Response(JSON.stringify({ venues, health, venueNames: listVenueNames() }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
