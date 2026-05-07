// ── Step 126: Polymarket read-only HTTP client (server-only) ────────────────
//
// Wraps the public, read-only portion of the Polymarket Gamma API:
//   GET /markets   — list/search markets, paginated
//   GET /events    — list/search events (a Polymarket "event" groups markets)
//
// The Gamma API is unauthenticated for read access — there is no API key,
// no signing, no wallet, no private key. This client deliberately exposes
// no write methods.
//
// Safety:
// - Server-only. Importing this module in client code throws at runtime.
// - Read-only by construction — no order, position, or wallet endpoints exist.
// - No credentials are ever read, requested, or carried.
// - Network errors are normalized into a structured response — no raw fetch
//   errors propagate, no headers are echoed.
//
// See docs/polymarket-integration-plan.md for the phased build-out.

import { POLYMARKET_GAMMA_API_BASE } from './polymarket-config';

if (typeof window !== 'undefined') {
  throw new Error(
    'polymarket-client is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export class PolymarketClientError extends Error {
  constructor(message: string, public code: string, public httpStatus?: number) {
    super(message);
  }
}

export interface PolymarketResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  errorMessage?: string;
}

/**
 * Loosely-typed Gamma market record. Treated as untrusted: every consumer
 * picks fields by name through the allow-list in normalizeMarket().
 */
export interface PolymarketMarketRaw {
  id?: string;
  conditionId?: string;
  question?: string;
  description?: string;
  slug?: string;
  category?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  endDate?: string;
  endDateIso?: string;
  startDate?: string;
  volume?: number | string;
  volumeNum?: number;
  liquidity?: number | string;
  liquidityNum?: number;
  /** JSON-stringified array of outcome labels in the upstream payload. */
  outcomes?: string | string[];
  /** JSON-stringified array of decimal probabilities aligned to outcomes. */
  outcomePrices?: string | string[];
  /** Tag/category metadata. Shapes vary; we only inspect tag.slug / tag.label. */
  tags?: Array<{ slug?: string; label?: string }>;
  events?: Array<{ slug?: string; title?: string; tags?: Array<{ slug?: string; label?: string }> }>;
  [key: string]: unknown;
}

/** Internal normalized shape — only fields admins should ever see. */
export interface PolymarketMarketSummary {
  id: string;
  question: string;
  slug?: string;
  url?: string;
  category?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  endDate?: string;
  startDate?: string;
  outcomes: string[];
  /** Decimal probabilities aligned to outcomes (0–1). May be empty. */
  outcomePrices: number[];
  volumeUsd?: number;
  liquidityUsd?: number;
  tags: string[];
  /** "polymarket" — discriminator for downstream three-way comparison. */
  rawSource: 'polymarket';
}

export interface PolymarketMarketDiscoveryResult {
  markets: PolymarketMarketSummary[];
  /** Whether the discovery hit the targeted weather endpoint vs. the keyword fallback. */
  strategy: 'tag' | 'keyword' | 'mixed';
  /** Human-readable note about how the result was assembled. */
  note: string;
}

// ── Request ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 8000;

interface GammaRequestOptions {
  /** Path relative to POLYMARKET_GAMMA_API_BASE — e.g., "/markets". */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

function buildUrl(base: string, path: string, query?: GammaRequestOptions['query']): string {
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function gammaGet<T>(opts: GammaRequestOptions): Promise<PolymarketResponse<T>> {
  const url = buildUrl(POLYMARKET_GAMMA_API_BASE, opts.path, opts.query);
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage: aborted
        ? `Polymarket request timed out after ${timeoutMs}ms.`
        : `Polymarket network error: ${err?.message ?? 'unknown'}`,
    };
  }
  clearTimeout(timer);

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
        `Polymarket GET ${opts.path} returned ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data: data as T };
}

// ── Normalization ───────────────────────────────────────────────────────────

function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function parseJsonNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  }
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((v) => Number(v)).filter((n) => Number.isFinite(n))
      : [];
  } catch {
    return [];
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function collectTags(m: PolymarketMarketRaw): string[] {
  const out = new Set<string>();
  for (const t of m.tags ?? []) {
    if (t?.slug) out.add(String(t.slug));
    if (t?.label) out.add(String(t.label));
  }
  for (const e of m.events ?? []) {
    for (const t of e?.tags ?? []) {
      if (t?.slug) out.add(String(t.slug));
      if (t?.label) out.add(String(t.label));
    }
  }
  return Array.from(out);
}

export function normalizeMarket(m: PolymarketMarketRaw): PolymarketMarketSummary | null {
  const id = m.id ? String(m.id) : m.conditionId ? String(m.conditionId) : undefined;
  const question = typeof m.question === 'string' ? m.question : undefined;
  if (!id || !question) return null;

  const slug = typeof m.slug === 'string' ? m.slug : undefined;
  return {
    id,
    question,
    slug,
    url: slug ? `https://polymarket.com/market/${slug}` : undefined,
    category: typeof m.category === 'string' ? m.category : undefined,
    active: typeof m.active === 'boolean' ? m.active : undefined,
    closed: typeof m.closed === 'boolean' ? m.closed : undefined,
    archived: typeof m.archived === 'boolean' ? m.archived : undefined,
    acceptingOrders: typeof m.acceptingOrders === 'boolean' ? m.acceptingOrders : undefined,
    endDate: typeof m.endDate === 'string'
      ? m.endDate
      : typeof m.endDateIso === 'string'
      ? m.endDateIso
      : undefined,
    startDate: typeof m.startDate === 'string' ? m.startDate : undefined,
    outcomes: parseJsonStringArray(m.outcomes),
    outcomePrices: parseJsonNumberArray(m.outcomePrices),
    volumeUsd: toNumber(m.volumeNum) ?? toNumber(m.volume),
    liquidityUsd: toNumber(m.liquidityNum) ?? toNumber(m.liquidity),
    tags: collectTags(m),
    rawSource: 'polymarket',
  };
}

// ── Public read-only operations ─────────────────────────────────────────────

export interface ListMarketsParams {
  /** Polymarket Gamma `limit`. Capped at 500 by us. */
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  /** Tag slug filter, when supported by Gamma (e.g. "weather"). */
  tag_slug?: string;
}

export async function listMarkets(
  params: ListMarketsParams = {},
): Promise<PolymarketResponse<PolymarketMarketRaw[]>> {
  const limit = Math.min(500, Math.max(1, Math.floor(params.limit ?? 100)));
  const query: Record<string, string | number | boolean | undefined> = {
    limit,
    offset: params.offset,
    active: params.active,
    closed: params.closed,
    archived: params.archived,
    tag_slug: params.tag_slug,
  };
  return gammaGet<PolymarketMarketRaw[]>({ path: '/markets', query });
}

// ── Weather discovery ───────────────────────────────────────────────────────

export const WEATHER_KEYWORDS = [
  'weather',
  'temperature',
  'temp ',
  'rain',
  'snow',
  'hurricane',
  'storm',
  'climate',
  'forecast',
  'tornado',
  'wind',
  'heatwave',
  'heat wave',
  'cold front',
  'cyclone',
  'flood',
] as const;

function looksLikeWeather(s: PolymarketMarketSummary): boolean {
  const haystack = [
    s.question,
    s.category ?? '',
    s.slug ?? '',
    ...(s.tags ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return WEATHER_KEYWORDS.some((kw) => haystack.includes(kw));
}

/**
 * Discover Polymarket weather markets using the public read-only Gamma API.
 *
 * Strategy:
 *   1. Attempt a tag filter for `tag_slug=weather`.
 *   2. If that returns nothing or fails, fall back to a broader active-markets
 *      pull and keyword-filter for weather terminology.
 *
 * Returns a structured result so the admin UI can show how the list was
 * assembled and what the upstream's behavior was.
 */
export async function discoverWeatherMarkets(
  options: { limit?: number } = {},
): Promise<PolymarketMarketDiscoveryResult> {
  const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));

  const tagged = await listMarkets({ limit, active: true, closed: false, tag_slug: 'weather' });
  const taggedMarkets: PolymarketMarketSummary[] = [];
  if (tagged.ok && Array.isArray(tagged.data)) {
    for (const raw of tagged.data) {
      const norm = normalizeMarket(raw);
      if (norm) taggedMarkets.push(norm);
    }
  }

  if (taggedMarkets.length > 0) {
    return {
      markets: taggedMarkets,
      strategy: 'tag',
      note: `Tag filter "weather" returned ${taggedMarkets.length} market(s).`,
    };
  }

  // Fallback: pull active markets and keyword-filter.
  const broad = await listMarkets({ limit, active: true, closed: false });
  if (!broad.ok || !Array.isArray(broad.data)) {
    throw new PolymarketClientError(
      broad.errorMessage ?? `Polymarket /markets failed (status ${broad.status})`,
      'polymarket_request_failed',
      broad.status || undefined,
    );
  }

  const keywordMarkets: PolymarketMarketSummary[] = [];
  for (const raw of broad.data) {
    const norm = normalizeMarket(raw);
    if (norm && looksLikeWeather(norm)) keywordMarkets.push(norm);
  }

  return {
    markets: keywordMarkets,
    strategy: 'keyword',
    note:
      `Tag filter "weather" returned no results; fell back to keyword scan ` +
      `over the latest ${broad.data.length} active market(s) and matched ${keywordMarkets.length}.`,
  };
}
