// ── Kalshi Market Ingestion ──────────────────────────────────────────────────
//
// Fetches and normalizes weather prediction markets from the Kalshi API v2.
// Falls back to demo data when the API is unavailable.

// ── Types ───────────────────────────────────────────────────────────────────

export interface KalshiMarket {
  ticker: string;
  title: string;
  category: string;
  locationName?: string;
  metricType?: string;
  targetDate?: string;
  threshold?: number;
  marketType: 'yes-no-threshold' | 'range' | 'other';
  yesPrice?: number;
  noPrice?: number;
  bestBidYes?: number;
  bestAskYes?: number;
  bestBidNo?: number;
  bestAskNo?: number;
  volume?: number;
  openInterest?: number;
  closeTime?: string;
  raw: any;
}

// ── Configuration ───────────────────────────────────────────────────────────

export const KALSHI_CONFIG = {
  /** Operating mode: disabled = no fetching, paper = signals only, demo = mock data, live = real trades */
  mode: (import.meta.env.KALSHI_MODE ?? 'paper') as 'disabled' | 'paper' | 'demo' | 'live',
  /** Minimum edge (model prob - market prob) required to recommend a side */
  minEdgeThreshold: 0.05,
  /** Kalshi API v2 base URL */
  apiBase: 'https://api.elections.kalshi.com/trade-api/v2',
  /** Series ticker prefixes for weather markets */
  weatherPrefixes: ['KXHIGH', 'KXLOW'],
} as const;

// ── Location code mapping ───────────────────────────────────────────────────

const LOCATION_CODES: Record<string, string> = {
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

export function locationFromCode(code: string): string | undefined {
  return LOCATION_CODES[code.toUpperCase()];
}

// ── API Fetching ────────────────────────────────────────────────────────────

/**
 * Normalizes a raw Kalshi API market object into our KalshiMarket shape.
 */
function normalizeMarket(raw: any): KalshiMarket {
  const ticker: string = raw.ticker ?? '';
  const title: string = raw.title ?? raw.subtitle ?? '';

  // Attempt to detect metric type from ticker prefix
  let metricType: string | undefined;
  if (ticker.startsWith('KXHIGH')) metricType = 'high_temp';
  else if (ticker.startsWith('KXLOW')) metricType = 'low_temp';

  // Parse location code from ticker (e.g. KXHIGHNY-25MAR14 → NY)
  let locationCode: string | undefined;
  let locationName: string | undefined;
  for (const prefix of KALSHI_CONFIG.weatherPrefixes) {
    if (ticker.startsWith(prefix)) {
      const rest = ticker.slice(prefix.length);
      const dashIdx = rest.indexOf('-');
      locationCode = dashIdx >= 0 ? rest.slice(0, dashIdx) : rest;
      locationName = locationFromCode(locationCode);
      break;
    }
  }

  // Parse target date from ticker (e.g. -25MAR14 → 2025-03-14)
  let targetDate: string | undefined;
  const dateMatch = ticker.match(/-(\d{2})([A-Z]{3})(\d{2})$/);
  if (dateMatch) {
    const monthMap: Record<string, string> = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
    };
    const yy = dateMatch[1];
    const mm = monthMap[dateMatch[2]] ?? '01';
    const dd = dateMatch[3];
    targetDate = `20${yy}-${mm}-${dd}`;
  }

  // Extract threshold from raw data or title
  let threshold: number | undefined;
  if (raw.strike_type === 'greater' || raw.strike_type === 'less') {
    threshold = raw.floor_strike ?? raw.cap_strike ?? undefined;
  }
  if (threshold == null && raw.floor_strike != null) {
    threshold = raw.floor_strike;
  }
  // Fallback: parse from title like "above 55°F"
  if (threshold == null) {
    const threshMatch = title.match(/(?:above|below|over|under|≥|≤)\s*(\d+)/i);
    if (threshMatch) threshold = parseInt(threshMatch[1], 10);
  }

  return {
    ticker,
    title,
    category: 'weather',
    locationName,
    metricType,
    targetDate,
    threshold,
    marketType: threshold != null ? 'yes-no-threshold' : 'other',
    yesPrice: raw.yes_price ?? raw.last_price,
    noPrice: raw.no_price ?? (raw.yes_price != null ? 100 - raw.yes_price : undefined),
    bestBidYes: raw.yes_bid,
    bestAskYes: raw.yes_ask,
    bestBidNo: raw.no_bid,
    bestAskNo: raw.no_ask,
    volume: raw.volume ?? raw.volume_24h,
    openInterest: raw.open_interest,
    closeTime: raw.close_time ?? raw.expiration_time,
    raw,
  };
}

/**
 * Fetches weather markets from the Kalshi API.
 * Falls back to demo data on error or when mode is 'demo'.
 */
export async function fetchKalshiWeatherMarkets(): Promise<KalshiMarket[]> {
  if (KALSHI_CONFIG.mode === 'disabled') return [];
  if (KALSHI_CONFIG.mode === 'demo') return generateDemoMarkets();

  try {
    const url = new URL(`${KALSHI_CONFIG.apiBase}/markets`);
    url.searchParams.set('limit', '200');
    url.searchParams.set('status', 'open');
    // Filter by series ticker for weather markets
    url.searchParams.set('series_ticker', 'KXHIGH');

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const apiKey = import.meta.env.KALSHI_API_KEY;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`Kalshi API returned ${res.status}, falling back to demo data`);
      return generateDemoMarkets();
    }

    const body = await res.json();
    const rawMarkets: any[] = body.markets ?? [];

    // Also fetch KXLOW series
    const url2 = new URL(`${KALSHI_CONFIG.apiBase}/markets`);
    url2.searchParams.set('limit', '200');
    url2.searchParams.set('status', 'open');
    url2.searchParams.set('series_ticker', 'KXLOW');

    try {
      const res2 = await fetch(url2.toString(), { headers, signal: AbortSignal.timeout(10_000) });
      if (res2.ok) {
        const body2 = await res2.json();
        rawMarkets.push(...(body2.markets ?? []));
      }
    } catch {
      // Low temp fetch failed, continue with what we have
    }

    if (rawMarkets.length === 0) {
      console.warn('Kalshi API returned 0 weather markets, falling back to demo data');
      return generateDemoMarkets();
    }

    return rawMarkets.map(normalizeMarket);
  } catch (err) {
    console.warn('Kalshi API fetch failed, falling back to demo data:', err);
    return generateDemoMarkets();
  }
}

// ── Demo / Mock Data ────────────────────────────────────────────────────────

/**
 * Generates realistic-looking sample weather markets for demo/testing purposes.
 */
export function generateDemoMarkets(): KalshiMarket[] {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(today);
  dayAfter.setDate(dayAfter.getDate() + 2);

  function fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  function fmtTicker(d: Date): string {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const yy = String(d.getFullYear()).slice(2);
    const mm = months[d.getMonth()];
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  const dateSuffix1 = fmtTicker(tomorrow);
  const dateSuffix2 = fmtTicker(dayAfter);
  const dateStr1 = fmtDate(tomorrow);
  const dateStr2 = fmtDate(dayAfter);

  const demos: KalshiMarket[] = [
    {
      ticker: `KXHIGHNY-${dateSuffix1}`,
      title: `Will the high temperature in NYC be above 55°F on ${dateStr1}?`,
      category: 'weather',
      locationName: 'New York',
      metricType: 'high_temp',
      targetDate: dateStr1,
      threshold: 55,
      marketType: 'yes-no-threshold',
      yesPrice: 72,
      noPrice: 28,
      bestBidYes: 71,
      bestAskYes: 73,
      bestBidNo: 27,
      bestAskNo: 29,
      volume: 1540,
      openInterest: 320,
      closeTime: `${dateStr1}T22:00:00Z`,
      raw: { demo: true },
    },
    {
      ticker: `KXHIGHCHI-${dateSuffix1}`,
      title: `Will the high temperature in Chicago be above 48°F on ${dateStr1}?`,
      category: 'weather',
      locationName: 'Chicago',
      metricType: 'high_temp',
      targetDate: dateStr1,
      threshold: 48,
      marketType: 'yes-no-threshold',
      yesPrice: 58,
      noPrice: 42,
      bestBidYes: 56,
      bestAskYes: 60,
      bestBidNo: 40,
      bestAskNo: 44,
      volume: 890,
      openInterest: 210,
      closeTime: `${dateStr1}T22:00:00Z`,
      raw: { demo: true },
    },
    {
      ticker: `KXLOWMIA-${dateSuffix1}`,
      title: `Will the low temperature in Miami be above 68°F on ${dateStr1}?`,
      category: 'weather',
      locationName: 'Miami',
      metricType: 'low_temp',
      targetDate: dateStr1,
      threshold: 68,
      marketType: 'yes-no-threshold',
      yesPrice: 81,
      noPrice: 19,
      bestBidYes: 80,
      bestAskYes: 83,
      bestBidNo: 17,
      bestAskNo: 20,
      volume: 420,
      openInterest: 95,
      closeTime: `${dateStr1}T22:00:00Z`,
      raw: { demo: true },
    },
    {
      ticker: `KXHIGHDEN-${dateSuffix2}`,
      title: `Will the high temperature in Denver be above 62°F on ${dateStr2}?`,
      category: 'weather',
      locationName: 'Denver',
      metricType: 'high_temp',
      targetDate: dateStr2,
      threshold: 62,
      marketType: 'yes-no-threshold',
      yesPrice: 45,
      noPrice: 55,
      bestBidYes: 43,
      bestAskYes: 47,
      bestBidNo: 53,
      bestAskNo: 57,
      volume: 670,
      openInterest: 155,
      closeTime: `${dateStr2}T22:00:00Z`,
      raw: { demo: true },
    },
    {
      ticker: `KXLOWATL-${dateSuffix2}`,
      title: `Will the low temperature in Atlanta be above 52°F on ${dateStr2}?`,
      category: 'weather',
      locationName: 'Atlanta',
      metricType: 'low_temp',
      targetDate: dateStr2,
      threshold: 52,
      marketType: 'yes-no-threshold',
      yesPrice: 63,
      noPrice: 37,
      bestBidYes: 61,
      bestAskYes: 65,
      bestBidNo: 35,
      bestAskNo: 39,
      volume: 310,
      openInterest: 78,
      closeTime: `${dateStr2}T22:00:00Z`,
      raw: { demo: true },
    },
    {
      ticker: `KXHIGHPHX-${dateSuffix1}`,
      title: `Will the high temperature in Phoenix be above 88°F on ${dateStr1}?`,
      category: 'weather',
      locationName: 'Phoenix',
      metricType: 'high_temp',
      targetDate: dateStr1,
      threshold: 88,
      marketType: 'yes-no-threshold',
      yesPrice: 34,
      noPrice: 66,
      bestBidYes: 32,
      bestAskYes: 36,
      bestBidNo: 64,
      bestAskNo: 68,
      volume: 1120,
      openInterest: 245,
      closeTime: `${dateStr1}T22:00:00Z`,
      raw: { demo: true },
    },
  ];

  return demos;
}
