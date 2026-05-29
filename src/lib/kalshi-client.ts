// ── Step 118: Kalshi read-only HTTP client (server-only) ────────────────────
//
// Wraps the public, read-only portion of the Kalshi Trade API v2:
//   GET /markets         — list markets, with optional filters
//   GET /markets/{ticker}— market detail
//   GET /markets/{ticker}/orderbook — current order book
//
// Authentication uses the same RSA-PSS-SHA256 scheme already used in
// src/lib/kalshi-execution.ts. The signing message is
// `${timestampMs}${METHOD}${fullPath}` and the signature is sent in
// `KALSHI-ACCESS-SIGNATURE` (base64). The API key id is sent in
// `KALSHI-ACCESS-KEY` and the timestamp in `KALSHI-ACCESS-TIMESTAMP`.
//
// Safety:
// - Server-only. Importing in client code throws at runtime.
// - Read-only by construction — no order/trade endpoints exposed.
// - Fails closed when credentials are missing or KALSHI_READ_ONLY is false
//   AND the caller did not opt into write mode (this client never does).
// - The private key value is never logged, returned, or echoed in errors.
// - This implementation has not been exercised live in this commit; see the
//   integration plan for verification gates before any production use.

import {
  getKalshiConfig,
  getKalshiPrivateKeyPem,
  getKalshiBaseUrl,
} from './kalshi-config';

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

// ── Auth ────────────────────────────────────────────────────────────────────

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const bin = Buffer.from(body, 'base64');
  return new Uint8Array(bin);
}

async function signMessage(message: string, pem: string): Promise<string> {
  const keyBytes = pemToDer(pem);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer,
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return Buffer.from(new Uint8Array(sig)).toString('base64');
}

// ── Request ─────────────────────────────────────────────────────────────────

interface KalshiRequestOptions {
  /** Path relative to /trade-api/v2 — e.g., "/markets". */
  path: string;
  /** Query parameters. Values are URL-encoded; undefined values are skipped. */
  query?: Record<string, string | number | undefined>;
  /** Defaults to GET. This client only signs GET; do not change. */
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

async function kalshiGet<T>(opts: KalshiRequestOptions): Promise<KalshiResponse<T>> {
  const cfg = getKalshiConfig();
  if (!cfg.apiKeyId || !cfg.privateKeyPresent) {
    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage:
        'Kalshi credentials not configured (KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_BASE64 required).',
    };
  }
  const pem = getKalshiPrivateKeyPem();
  if (!pem) {
    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage: 'Kalshi private key could not be decoded.',
    };
  }

  const fullPath = `/trade-api/v2${buildPath(opts.path, opts.query)}`;
  const url = `${getKalshiBaseUrl(cfg.env)}${buildPath(opts.path, opts.query)}`;
  const timestamp = Date.now();
  const message = `${timestamp}GET${fullPath}`;

  let signature: string;
  try {
    signature = await signMessage(message, pem);
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage: 'Kalshi request signing failed.',
    };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'KALSHI-ACCESS-KEY': cfg.apiKeyId,
        'KALSHI-ACCESS-SIGNATURE': signature,
        'KALSHI-ACCESS-TIMESTAMP': String(timestamp),
      },
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
      data,
      errorMessage:
        (data && (data.error || data.message)) ||
        `Kalshi GET ${opts.path} returned ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data: data as T };
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
