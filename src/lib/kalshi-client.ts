// ── Kalshi public market-data client (server-only) ─────────────────────────
//
// WOW-011 (K1): Kalshi publishes its market data without authentication
// ("No authentication headers are required" — docs.kalshi.com, Quick Start:
// Market Data). WagerOnWeather uses Kalshi as a data/news source only, so
// this client sends UNAUTHENTICATED GETs to Kalshi's fixed production host and
// nothing else:
//   GET /markets                       — list markets, with optional filters
//   GET /markets/{ticker}              — market detail
//   GET /markets/{ticker}/orderbook    — current order book
//   GET /series, /events, /events/{t}  — discovery
//
// Safety:
// - Server-only. Importing in client code throws at runtime.
// - No credentials are read, no request is signed, no account header is sent.
//   Market data does not depend on any KALSHI_* environment variable.
// - A path outside the allowlist below (anything under /portfolio above all)
//   is refused without a network call.
// - On a non-2xx response the body is not passed through: callers get
//   ok:false and no numbers, so a page shows "Kalshi data unavailable"
//   rather than stale or partial figures (rule 5).

if (typeof window !== 'undefined') {
  throw new Error(
    'kalshi-client is server-only and must not be imported in client code',
  );
}

export class KalshiClientError extends Error {
  constructor(message: string, public code: string, public httpStatus?: number) {
    super(message);
  }
}

/** Kalshi's public production API host. Fixed: not read from KALSHI_ENV. */
export const KALSHI_PUBLIC_BASE = 'https://external-api.kalshi.com/trade-api/v2';

/** Public market-data paths this site may read. Anything else is refused. */
const PUBLIC_PATH_ALLOWLIST: readonly RegExp[] = [
  /^\/markets$/,
  /^\/markets\/[A-Za-z0-9._%-]+$/,
  /^\/markets\/[A-Za-z0-9._%-]+\/orderbook$/,
  /^\/series$/,
  /^\/events$/,
  /^\/events\/[A-Za-z0-9._%-]+$/,
];

export function isAllowedPublicKalshiPath(path: string): boolean {
  if (path.split('/').some((seg) => seg === '.' || seg === '..')) return false;
  return PUBLIC_PATH_ALLOWLIST.some((re) => re.test(path));
}

// ── Request ─────────────────────────────────────────────────────────────────

interface KalshiRequestOptions {
  /** Path relative to /trade-api/v2 — e.g., "/markets". */
  path: string;
  /** Query parameters. Values are URL-encoded; undefined values are skipped. */
  query?: Record<string, string | number | undefined>;
  /** Always GET. */
  method?: 'GET';
}

export interface KalshiResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  errorMessage?: string;
}

function buildPath(path: string, query?: KalshiRequestOptions['query']): string {
  if (!query) return path;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? path : `${path}?${parts.join('&')}`;
}

/** Unauthenticated GET of a public Kalshi market-data path. Exported for tests. */
export async function kalshiPublicGet<T>(opts: KalshiRequestOptions): Promise<KalshiResponse<T>> {
  if (!isAllowedPublicKalshiPath(opts.path)) {
    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage: `${opts.path} is not an allowed public Kalshi path (market data only).`,
    };
  }
  const url = `${KALSHI_PUBLIC_BASE}${buildPath(opts.path, opts.query)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage: `Kalshi network error: ${err?.message ?? 'unknown'}`,
    };
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON or empty body */
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data: null,
      errorMessage: buildErrorMessage(data, opts.path, res.status),
    };
  }
  return { ok: true, status: res.status, data: data as T };
}

const kalshiGet = kalshiPublicGet;

/**
 * Render Kalshi's error response body as a short readable string. Kalshi
 * sometimes returns `{error: "..."}` (string), sometimes
 * `{error: {code, detail, ...}}` (object), sometimes `{message: "..."}`,
 * and occasionally no body at all. Passing an object straight to
 * `new Error(message)` would coerce it to the literal string
 * `"[object Object]"`, which then propagates through every warning
 * the climate fetcher surfaces. Normalize here at the source.
 */
function buildErrorMessage(data: any, path: string, status: number): string {
  const fallback = `Kalshi GET ${path} returned ${status}`;
  if (!data) return fallback;
  const candidate = data.error ?? data.message ?? null;
  if (candidate == null) return fallback;
  if (typeof candidate === 'string') return candidate.slice(0, 240) || fallback;
  if (typeof candidate === 'object') {
    const e = candidate as { code?: unknown; detail?: unknown; message?: unknown };
    const parts: string[] = [];
    if (typeof e.code === 'string') parts.push(e.code);
    if (typeof e.message === 'string') parts.push(e.message);
    if (typeof e.detail === 'string') parts.push(e.detail);
    if (parts.length > 0) return `${fallback} — ${parts.join(': ').slice(0, 240)}`;
    try {
      return `${fallback} — ${JSON.stringify(candidate).slice(0, 240)}`;
    } catch {
      return fallback;
    }
  }
  return `${fallback} — ${String(candidate).slice(0, 240)}`;
}

// ── Public read-only operations ─────────────────────────────────────────────

export interface KalshiMarketRaw {
  ticker: string;
  title?: string;
  category?: string;
  status?: string;
  close_time?: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  volume?: number;
  open_interest?: number;
  [key: string]: any;
}

export interface ListMarketsParams {
  /** Free-text search term sent to Kalshi as `q`. */
  q?: string;
  /** Kalshi event ticker filter. */
  event_ticker?: string;
  /** Kalshi series ticker filter — for weather markets this is
   *  typically `KXHIGH` or `KXLOW`. */
  series_ticker?: string;
  /** open / closed / settled. */
  status?: string;
  /** Defaults to 100; Kalshi caps this at 1000. */
  limit?: number;
  /** Pagination cursor from a previous response. */
  cursor?: string;
}

export async function listMarkets(
  params: ListMarketsParams = {},
): Promise<KalshiResponse<{ markets: KalshiMarketRaw[]; cursor?: string }>> {
  return kalshiGet({
    path: '/markets',
    query: {
      limit: params.limit ?? 100,
      q: params.q,
      event_ticker: params.event_ticker,
      series_ticker: params.series_ticker,
      status: params.status,
      cursor: params.cursor,
    },
  });
}

export async function getMarket(
  ticker: string,
): Promise<KalshiResponse<{ market: KalshiMarketRaw }>> {
  return kalshiGet({ path: `/markets/${encodeURIComponent(ticker)}` });
}

export async function getOrderbook(
  ticker: string,
): Promise<KalshiResponse<{ orderbook: any }>> {
  return kalshiGet({ path: `/markets/${encodeURIComponent(ticker)}/orderbook` });
}

export interface KalshiSeriesRaw {
  ticker: string;
  title?: string;
  category?: string;
  [key: string]: any;
}

/**
 * List available Kalshi series. Used by the climate-market fetcher to
 * discover weather series dynamically rather than guessing city codes.
 */
export async function listSeries(
  params: { limit?: number; cursor?: string } = {},
): Promise<KalshiResponse<{ series: KalshiSeriesRaw[]; cursor?: string }>> {
  return kalshiGet({
    path: '/series',
    query: {
      limit: params.limit ?? 1000,
      cursor: params.cursor,
    },
  });
}
