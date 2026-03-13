// ── Kalshi Market Mapper ─────────────────────────────────────────────────────
//
// Maps Kalshi weather markets to our internal forecast system by parsing
// tickers and titles to extract location, metric, date, and threshold.

import type { KalshiMarket } from './kalshi';

// ── Types ───────────────────────────────────────────────────────────────────

export interface MappedMarket {
  ticker: string;
  title: string;
  category: string;
  marketType: KalshiMarket['marketType'];
  yesPrice?: number;
  noPrice?: number;
  bestBidYes?: number;
  bestAskYes?: number;
  bestBidNo?: number;
  bestAskNo?: number;
  volume?: number;
  openInterest?: number;
  closeTime?: string;

  mapped: boolean;
  locationName: string;
  metric: string;
  targetDate: string;
  targetTime?: string;
  threshold: number;
}

// ── Location code → internal location name ──────────────────────────────────

const KALSHI_LOCATION_MAP: Record<string, string> = {
  NY: 'New York',
  CHI: 'Chicago',
  LA: 'Los Angeles',
  DEN: 'Denver',
  MIA: 'Miami',
  ATL: 'Atlanta',
  DAL: 'Dallas',
  PHX: 'Phoenix',
  SEA: 'Seattle',
  HOU: 'Houston',
};

// ── Metric prefix → internal metric name ────────────────────────────────────

const METRIC_PREFIX_MAP: Record<string, string> = {
  KXHIGH: 'high_temp',
  KXLOW: 'low_temp',
};

// ── Ticker parsing ──────────────────────────────────────────────────────────

interface ParsedTicker {
  metricPrefix: string;
  locationCode: string;
  targetDate: string;
}

/**
 * Parses a Kalshi weather ticker like "KXHIGHNY-25MAR14" into components.
 * Returns null if the ticker cannot be parsed.
 */
function parseTicker(ticker: string): ParsedTicker | null {
  // Match pattern: PREFIX + LOCATION_CODE + "-" + YYMONDD
  const match = ticker.match(/^(KXHIGH|KXLOW)([A-Z]{2,4})-(\d{2})([A-Z]{3})(\d{2})$/);
  if (!match) return null;

  const [, metricPrefix, locationCode, yy, monthStr, dd] = match;

  const monthMap: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };

  const mm = monthMap[monthStr];
  if (!mm) return null;

  return {
    metricPrefix,
    locationCode,
    targetDate: `20${yy}-${mm}-${dd}`,
  };
}

/**
 * Extracts threshold from market data. Checks raw data fields first,
 * then falls back to parsing the title text.
 */
function extractThreshold(market: KalshiMarket): number | undefined {
  // Use pre-parsed threshold from normalization
  if (market.threshold != null) return market.threshold;

  // Try parsing from title: "above 55°F", "over 62", "≥ 48"
  const match = market.title.match(/(?:above|below|over|under|≥|≤|>=|<=)\s*(\d+)/i);
  if (match) return parseInt(match[1], 10);

  return undefined;
}

// ── Mapping functions ───────────────────────────────────────────────────────

/**
 * Maps a single Kalshi market to our internal forecast representation.
 * If the ticker cannot be parsed or required fields are missing,
 * returns a MappedMarket with `mapped: false`.
 */
export function mapKalshiMarket(market: KalshiMarket): MappedMarket {
  const base = {
    ticker: market.ticker,
    title: market.title,
    category: market.category,
    marketType: market.marketType,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    bestBidYes: market.bestBidYes,
    bestAskYes: market.bestAskYes,
    bestBidNo: market.bestBidNo,
    bestAskNo: market.bestAskNo,
    volume: market.volume,
    openInterest: market.openInterest,
    closeTime: market.closeTime,
  };

  const unmapped: MappedMarket = {
    ...base,
    mapped: false,
    locationName: '',
    metric: '',
    targetDate: '',
    threshold: 0,
  };

  // Try parsing the ticker
  const parsed = parseTicker(market.ticker);
  if (!parsed) return unmapped;

  // Resolve location
  const locationName = KALSHI_LOCATION_MAP[parsed.locationCode];
  if (!locationName) return unmapped;

  // Resolve metric
  const metric = METRIC_PREFIX_MAP[parsed.metricPrefix];
  if (!metric) return unmapped;

  // Extract threshold
  const threshold = extractThreshold(market);
  if (threshold == null) return unmapped;

  return {
    ...base,
    mapped: true,
    locationName,
    metric,
    targetDate: parsed.targetDate,
    threshold,
  };
}

/**
 * Maps all Kalshi markets and returns MappedMarket objects.
 * Markets that cannot be parsed will have `mapped: false`.
 */
export function mapAllMarkets(markets: KalshiMarket[]): MappedMarket[] {
  return markets.map(mapKalshiMarket);
}
