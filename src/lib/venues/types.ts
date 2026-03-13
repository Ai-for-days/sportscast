/* ------------------------------------------------------------------ */
/*  Venue Abstraction Layer — Types                                     */
/* ------------------------------------------------------------------ */

/** Normalized market representation across all venues */
export interface VenueMarket {
  venue: string;
  marketId: string;
  ticker: string;
  title: string;
  category?: string;
  metric?: string;
  locationName?: string;
  targetDate?: string;
  threshold?: number;
  yesPrice?: number;
  noPrice?: number;
  bestBid?: number;
  bestAsk?: number;
  volume?: number;
  openInterest?: number;
  closeTime?: string;
  mapped?: boolean;
  raw?: any;
}

/** Normalized order representation across all venues */
export interface VenueOrder {
  venue: string;
  venueOrderId?: string;
  clientOrderId: string;
  marketId?: string;
  ticker: string;
  title?: string;
  side: string;
  action: string;
  price: number;
  quantity: number;
  status: string;
  mode: 'paper' | 'demo' | 'live';
  createdAt: string;
  updatedAt: string;
  raw?: any;
}

/** Normalized position across all venues */
export interface VenuePosition {
  venue: string;
  ticker: string;
  title?: string;
  side: string;
  contracts: number;
  avgEntryPrice: number;
  notionalCents: number;
  status: 'open' | 'closed';
  realizedPnlCents: number;
  unrealizedPnlCents: number;
}

/** Health status for a venue adapter */
export interface VenueHealth {
  venue: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  message: string;
  checkedAt: string;
  details?: Record<string, any>;
}

/** Capabilities a venue adapter can declare */
export interface VenueCapabilities {
  marketFetch: boolean;
  orderSubmit: boolean;
  orderCancel: boolean;
  orderRefresh: boolean;
  positions: boolean;
  demoSupport: boolean;
  liveSupport: boolean;
}

/** Venue metadata for registry */
export interface VenueMeta {
  name: string;
  displayName: string;
  description: string;
  status: 'active' | 'stub' | 'disabled';
  capabilities: VenueCapabilities;
  supportedModes: ('paper' | 'demo' | 'live')[];
  marketCategories: string[];
}

/** The adapter interface that all venues implement */
export interface VenueAdapter {
  meta: VenueMeta;

  /** Fetch and normalize available markets */
  getMarkets(opts?: { limit?: number; category?: string }): Promise<VenueMarket[]>;

  /** Get a single market by ticker */
  getMarketByTicker(ticker: string): Promise<VenueMarket | null>;

  /** Build a normalized order (dry-run, does not submit) */
  buildOrder(params: {
    ticker: string;
    side: string;
    action: string;
    price: number;
    quantity: number;
    mode: 'paper' | 'demo' | 'live';
  }): VenueOrder;

  /** Submit an order to the venue */
  submitOrder(order: VenueOrder): Promise<VenueOrder>;

  /** Cancel an order */
  cancelOrder(venueOrderId: string, mode: 'demo' | 'live'): Promise<VenueOrder | null>;

  /** Refresh order status from venue */
  refreshOrder(venueOrderId: string, mode: 'demo' | 'live'): Promise<VenueOrder | null>;

  /** Get positions from this venue */
  getPositions(mode?: 'demo' | 'live'): Promise<VenuePosition[]>;

  /** Health check */
  getHealth(): Promise<VenueHealth>;
}
