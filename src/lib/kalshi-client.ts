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

import { sign as nodeSign, constants as cryptoConstants } from 'node:crypto';
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
//
// Kalshi requires RSA-PSS-SHA256 with a digest-length salt over the message
// `${timestampMs}${METHOD}${fullPath}`. The signature is base64-encoded and
// sent in `KALSHI-ACCESS-SIGNATURE` (with KALSHI-ACCESS-KEY +
// KALSHI-ACCESS-TIMESTAMP).
//
// We use Node's `crypto.sign` rather than WebCrypto's `subtle.importKey`
// because Kalshi hands operators a **PKCS#1** PEM (`-----BEGIN RSA PRIVATE
// KEY-----`). WebCrypto's `importKey('pkcs8', …)` rejects that envelope.
// Node's `sign({ key: pem, … })` auto-detects PKCS#1 vs PKCS#8 so the same
// PEM the Kalshi dashboard hands you works without conversion.

function signMessage(message: string, pem: string): string {
  const signature = nodeSign('sha256', Buffer.from(message, 'utf8'), {
    key: pem,
    padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
    saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString('base64');
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
    signature = signMessage(message, pem);
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage: `Kalshi request signing failed: ${err?.message ?? 'unknown'}`,
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
