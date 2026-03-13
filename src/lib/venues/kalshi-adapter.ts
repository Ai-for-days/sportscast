import type { VenueAdapter, VenueMeta, VenueMarket, VenueOrder, VenuePosition, VenueHealth } from './types';
import { fetchKalshiWeatherMarkets, type KalshiMarket } from '../kalshi';
import { mapAllMarkets, type MappedMarket } from '../kalshi-market-mapper';
import {
  listDemoOrders, listLiveOrders,
  submitDemoOrder, cancelDemoOrder, refreshDemoOrderStatus,
  submitLiveOrder, cancelLiveOrder, refreshLiveOrderStatus,
  type DemoOrder, type LiveOrder,
} from '../kalshi-execution';
import { listPositions } from '../positions';
import { getRedis } from '../redis';
import { logAuditEvent } from '../audit-log';

/* ------------------------------------------------------------------ */
/*  Normalization helpers                                               */
/* ------------------------------------------------------------------ */

function normalizeMarket(m: MappedMarket): VenueMarket {
  return {
    venue: 'kalshi',
    marketId: m.ticker,
    ticker: m.ticker,
    title: m.title,
    category: m.category || 'weather',
    metric: m.metric || m.metricType || undefined,
    locationName: m.locationName || undefined,
    targetDate: m.targetDate || undefined,
    threshold: m.threshold ?? undefined,
    yesPrice: m.yesPrice,
    noPrice: m.noPrice,
    bestBid: m.bestBidYes,
    bestAsk: m.bestAskYes,
    volume: m.volume,
    openInterest: m.openInterest,
    closeTime: m.closeTime,
    mapped: m.mapped,
    raw: m,
  };
}

function normalizeDemoOrder(o: DemoOrder): VenueOrder {
  return {
    venue: 'kalshi',
    venueOrderId: o.kalshiOrderId || undefined,
    clientOrderId: o.clientOrderId,
    marketId: o.ticker,
    ticker: o.ticker,
    title: o.title,
    side: o.side,
    action: o.action,
    price: o.price,
    quantity: o.quantity,
    status: o.status,
    mode: 'demo',
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    raw: o,
  };
}

function normalizeLiveOrder(o: LiveOrder): VenueOrder {
  return {
    venue: 'kalshi',
    venueOrderId: o.kalshiOrderId || undefined,
    clientOrderId: o.clientOrderId,
    marketId: o.ticker,
    ticker: o.ticker,
    title: o.title,
    side: o.side,
    action: o.action,
    price: o.price,
    quantity: o.quantity,
    status: o.status,
    mode: 'live',
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    raw: o,
  };
}

/* ------------------------------------------------------------------ */
/*  Kalshi Adapter                                                      */
/* ------------------------------------------------------------------ */

export class KalshiAdapter implements VenueAdapter {
  meta: VenueMeta = {
    name: 'kalshi',
    displayName: 'Kalshi',
    description: 'CFTC-regulated event contracts exchange — weather markets',
    status: 'active',
    capabilities: {
      marketFetch: true,
      orderSubmit: true,
      orderCancel: true,
      orderRefresh: true,
      positions: true,
      demoSupport: true,
      liveSupport: true,
    },
    supportedModes: ['paper', 'demo', 'live'],
    marketCategories: ['weather'],
  };

  async getMarkets(opts?: { limit?: number; category?: string }): Promise<VenueMarket[]> {
    const raw = await fetchKalshiWeatherMarkets();
    const mapped = mapAllMarkets(raw);
    let markets = mapped.map(normalizeMarket);
    if (opts?.limit) markets = markets.slice(0, opts.limit);

    await logAuditEvent({
      actor: 'admin',
      eventType: 'venue_adapter_used',
      targetType: 'venue',
      targetId: 'kalshi',
      summary: `Kalshi adapter: fetched ${markets.length} markets`,
    });

    return markets;
  }

  async getMarketByTicker(ticker: string): Promise<VenueMarket | null> {
    const markets = await this.getMarkets();
    return markets.find(m => m.ticker === ticker) || null;
  }

  buildOrder(params: {
    ticker: string; side: string; action: string; price: number; quantity: number; mode: 'paper' | 'demo' | 'live';
  }): VenueOrder {
    return {
      venue: 'kalshi',
      clientOrderId: `wow-${params.mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ticker: params.ticker,
      side: params.side,
      action: params.action,
      price: params.price,
      quantity: params.quantity,
      status: 'pending',
      mode: params.mode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async submitOrder(order: VenueOrder): Promise<VenueOrder> {
    // This adapter wraps the existing execution layer.
    // Actual submission goes through the candidate-based execution pipeline.
    // This method is for structural completeness — real submissions use
    // submitDemoOrder/submitLiveOrder with full risk checks via the execution API.
    return { ...order, status: 'pending', updatedAt: new Date().toISOString() };
  }

  async cancelOrder(venueOrderId: string, mode: 'demo' | 'live'): Promise<VenueOrder | null> {
    if (mode === 'demo') {
      const result = await cancelDemoOrder(venueOrderId);
      return result ? normalizeDemoOrder(result) : null;
    }
    const result = await cancelLiveOrder(venueOrderId);
    return result ? normalizeLiveOrder(result) : null;
  }

  async refreshOrder(venueOrderId: string, mode: 'demo' | 'live'): Promise<VenueOrder | null> {
    if (mode === 'demo') {
      const result = await refreshDemoOrderStatus(venueOrderId);
      return result ? normalizeDemoOrder(result) : null;
    }
    const result = await refreshLiveOrderStatus(venueOrderId);
    return result ? normalizeLiveOrder(result) : null;
  }

  async getPositions(mode?: 'demo' | 'live'): Promise<VenuePosition[]> {
    const positions = await listPositions();
    return positions
      .filter(p => {
        if (!mode) return true;
        if (mode === 'demo') return p.source === 'kalshi-demo';
        if (mode === 'live') return p.source === 'kalshi-live';
        return true;
      })
      .map(p => ({
        venue: 'kalshi',
        ticker: p.ticker,
        title: p.title,
        side: p.side,
        contracts: p.contracts,
        avgEntryPrice: p.avgEntryPrice,
        notionalCents: p.notionalCents,
        status: p.status,
        realizedPnlCents: p.realizedPnlCents,
        unrealizedPnlCents: p.unrealizedPnlCents,
      }));
  }

  async getHealth(): Promise<VenueHealth> {
    try {
      const redis = getRedis();
      const pingStart = Date.now();
      await redis.ping();
      const latencyMs = Date.now() - pingStart;

      // Check if we have recent market data
      const demoOrders = await listDemoOrders();
      const liveOrders = await listLiveOrders();

      const hasCredentials = !!(import.meta.env.KALSHI_API_KEY_ID && import.meta.env.KALSHI_PRIVATE_KEY);

      let status: VenueHealth['status'] = 'healthy';
      let message = `Redis OK (${latencyMs}ms), ${demoOrders.length} demo orders, ${liveOrders.length} live orders`;

      if (!hasCredentials) {
        status = 'degraded';
        message += ' — API credentials not configured';
      }

      return { venue: 'kalshi', status, message, checkedAt: new Date().toISOString(), details: { latencyMs, demoOrders: demoOrders.length, liveOrders: liveOrders.length, hasCredentials } };
    } catch (err: any) {
      return { venue: 'kalshi', status: 'down', message: err.message || 'Health check failed', checkedAt: new Date().toISOString() };
    }
  }

  /** Get normalized demo orders */
  async getDemoOrders(limit?: number): Promise<VenueOrder[]> {
    const orders = await listDemoOrders();
    const normalized = orders.map(normalizeDemoOrder);
    return limit ? normalized.slice(0, limit) : normalized;
  }

  /** Get normalized live orders */
  async getLiveOrders(limit?: number): Promise<VenueOrder[]> {
    const orders = await listLiveOrders();
    const normalized = orders.map(normalizeLiveOrder);
    return limit ? normalized.slice(0, limit) : normalized;
  }

  /** Get all normalized orders (demo + live) */
  async getAllOrders(opts?: { mode?: string; limit?: number }): Promise<VenueOrder[]> {
    let results: VenueOrder[] = [];
    if (!opts?.mode || opts.mode === 'demo') {
      results.push(...await this.getDemoOrders());
    }
    if (!opts?.mode || opts.mode === 'live') {
      results.push(...await this.getLiveOrders());
    }
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }
}
