import type { VenueAdapter, VenueMeta, VenueMarket, VenueOrder, VenuePosition, VenueHealth } from './types';

/* ------------------------------------------------------------------ */
/*  Internal Stub Adapter                                               */
/*  Demonstrates extensibility — returns mock data, no real API calls   */
/* ------------------------------------------------------------------ */

const STUB_MARKETS: VenueMarket[] = [
  {
    venue: 'internal_stub',
    marketId: 'STUB-RAIN-NYC-20250320',
    ticker: 'STUB-RAIN-NYC-20250320',
    title: 'Will it rain in NYC on March 20, 2025?',
    category: 'weather',
    metric: 'precipitation',
    locationName: 'New York',
    targetDate: '2025-03-20',
    threshold: 0.1,
    yesPrice: 65,
    noPrice: 35,
    bestBid: 63,
    bestAsk: 67,
    volume: 0,
    openInterest: 0,
    mapped: true,
  },
  {
    venue: 'internal_stub',
    marketId: 'STUB-WIND-CHI-20250321',
    ticker: 'STUB-WIND-CHI-20250321',
    title: 'Will wind speed exceed 25 mph in Chicago on March 21?',
    category: 'weather',
    metric: 'wind_speed',
    locationName: 'Chicago',
    targetDate: '2025-03-21',
    threshold: 25,
    yesPrice: 40,
    noPrice: 60,
    bestBid: 38,
    bestAsk: 42,
    volume: 0,
    openInterest: 0,
    mapped: true,
  },
];

export class InternalStubAdapter implements VenueAdapter {
  meta: VenueMeta = {
    name: 'internal_stub',
    displayName: 'Internal Stub',
    description: 'Placeholder venue for testing and extensibility demonstration',
    status: 'stub',
    capabilities: {
      marketFetch: true,
      orderSubmit: false,
      orderCancel: false,
      orderRefresh: false,
      positions: false,
      demoSupport: false,
      liveSupport: false,
    },
    supportedModes: ['paper'],
    marketCategories: ['weather'],
  };

  async getMarkets(opts?: { limit?: number }): Promise<VenueMarket[]> {
    let markets = [...STUB_MARKETS];
    if (opts?.limit) markets = markets.slice(0, opts.limit);
    return markets;
  }

  async getMarketByTicker(ticker: string): Promise<VenueMarket | null> {
    return STUB_MARKETS.find(m => m.ticker === ticker) || null;
  }

  buildOrder(params: {
    ticker: string; side: string; action: string; price: number; quantity: number; mode: 'paper' | 'demo' | 'live';
  }): VenueOrder {
    return {
      venue: 'internal_stub',
      clientOrderId: `stub-${Date.now()}`,
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

  async submitOrder(_order: VenueOrder): Promise<VenueOrder> {
    throw new Error('Internal stub does not support order submission');
  }

  async cancelOrder(_venueOrderId: string): Promise<VenueOrder | null> {
    throw new Error('Internal stub does not support order cancellation');
  }

  async refreshOrder(_venueOrderId: string): Promise<VenueOrder | null> {
    throw new Error('Internal stub does not support order refresh');
  }

  async getPositions(): Promise<VenuePosition[]> {
    return [];
  }

  async getHealth(): Promise<VenueHealth> {
    return {
      venue: 'internal_stub',
      status: 'healthy',
      message: 'Stub adapter always healthy — no external dependencies',
      checkedAt: new Date().toISOString(),
    };
  }
}
