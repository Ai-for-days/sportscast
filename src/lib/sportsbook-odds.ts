// ── Sportsbook betting lines (server-only, optional) ────────────────────────
//
// Raw, factual lines for a venue's next home game — spread, moneyline, total
// — sourced from The Odds API (the-odds-api.com), which aggregates real
// DraftKings/FanDuel prices. NEUTRAL display only: no picks, no "value"/"lock"
// framing, per CLAUDE.md's no-betting-advice rule.
//
// Entirely optional: with no ODDS_API_KEY set, every function no-ops (returns
// null), so venue pages simply omit the betting-lines section. One API call
// fetches ALL of a sport's upcoming games at once (that's how the endpoint
// works), so it's cached whole and matched locally — far cheaper on the
// free-tier credit budget than one call per game.

import { getRedis } from './redis';

const DEFAULT_INTERVAL_HOURS = 6; // default auto-mode cache lifetime — this is an informational page, not a live ticker
const FAILURE_BACKOFF_SECONDS = 180; // 3 min — throttles retries on outage/rate-limit instead of retrying every request
const MANUAL_MODE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — long enough to read as "doesn't expire on its own" without literally being infinite

// ── Fetch control (admin: /admin/system/odds-usage) ─────────────────────
//
// Full control over when a real request happens, per Derek's ask:
//  - 'auto' (default): cache lives `intervalHours` (configurable, was a
//    hard-coded 6) before the next request naturally happens on demand.
//  - 'manual': never auto-request on a cache miss or expiry — odds simply
//    stay whatever they last were (or absent, if never fetched) until an
//    admin explicitly triggers a fetch via triggerOddsFetch(). The site
//    never spends a credit on its own in this mode.

export type OddsFetchMode = 'auto' | 'manual';
export interface OddsFetchConfig {
  mode: OddsFetchMode;
  intervalHours: number; // only meaningful in 'auto' mode
}
const FETCH_CONFIG_KEY = 'odds:fetch-config';
const DEFAULT_FETCH_CONFIG: OddsFetchConfig = { mode: 'auto', intervalHours: DEFAULT_INTERVAL_HOURS };

export async function getOddsFetchConfig(): Promise<OddsFetchConfig> {
  try {
    const raw = await getRedis().get(FETCH_CONFIG_KEY);
    if (raw) {
      const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<OddsFetchConfig>;
      const intervalHours = Number(parsed.intervalHours);
      return {
        mode: parsed.mode === 'manual' ? 'manual' : 'auto',
        intervalHours: Number.isFinite(intervalHours) && intervalHours > 0 ? Math.min(168, intervalHours) : DEFAULT_FETCH_CONFIG.intervalHours,
      };
    }
  } catch {
    /* redis unconfigured or miss — fall through to default */
  }
  return DEFAULT_FETCH_CONFIG;
}

export async function setOddsFetchConfig(patch: Partial<OddsFetchConfig>): Promise<OddsFetchConfig> {
  const current = await getOddsFetchConfig();
  const intervalHours = Number(patch.intervalHours);
  const next: OddsFetchConfig = {
    mode: patch.mode === 'manual' || patch.mode === 'auto' ? patch.mode : current.mode,
    intervalHours: Number.isFinite(intervalHours) && intervalHours > 0 ? Math.min(168, intervalHours) : current.intervalHours,
  };
  try {
    await getRedis().set(FETCH_CONFIG_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

// ── Credit usage (for the admin Odds API Usage page) ────────────────────
//
// The Odds API reports remaining metered credits on every response via
// `x-requests-used` / `x-requests-remaining` / `x-requests-last` (the cost
// of the request that just returned). We only see these on a real fetch —
// a Redis cache hit never touches the network — so this is "usage as of
// the last live fetch," not a live meter. Good enough for an operator
// glancing at burn rate; not a substitute for the-odds-api.com's own
// dashboard for a precise billing-period total.

export interface OddsApiUsage {
  requestsUsed: number | null;
  requestsRemaining: number | null;
  lastRequestCost: number | null;
  sportKey: string;
  capturedAt: string; // ISO
}

const USAGE_CACHE_KEY = 'odds:usage:last';

async function recordUsage(res: Response, sportKey: string): Promise<void> {
  const used = res.headers.get('x-requests-used');
  const remaining = res.headers.get('x-requests-remaining');
  const last = res.headers.get('x-requests-last');
  if (used === null && remaining === null && last === null) return;
  const usage: OddsApiUsage = {
    requestsUsed: used !== null ? Number(used) : null,
    requestsRemaining: remaining !== null ? Number(remaining) : null,
    lastRequestCost: last !== null ? Number(last) : null,
    sportKey,
    capturedAt: new Date().toISOString(),
  };
  try {
    await getRedis().set(USAGE_CACHE_KEY, JSON.stringify(usage));
  } catch {
    /* ignore */
  }
}

/** Credit usage as of the last live (non-cached) Odds API fetch. Null if none has happened yet. */
export async function getOddsApiUsage(): Promise<OddsApiUsage | null> {
  try {
    const raw = await getRedis().get(USAGE_CACHE_KEY);
    if (!raw) return null;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as OddsApiUsage;
  } catch {
    return null;
  }
}

function apiKey(): string | null {
  const k =
    (import.meta as any).env?.ODDS_API_KEY ??
    (typeof process !== 'undefined' ? process.env?.ODDS_API_KEY : undefined);
  const v = k ? String(k).trim() : '';
  return v.length > 0 ? v : null;
}

/** True when an Odds API key is configured. */
export function oddsApiConfigured(): boolean {
  return apiKey() !== null;
}

/** venue-data `league` -> The Odds API sport key. NWSL has no market there. */
const SPORT_KEYS: Record<string, string> = {
  nfl: 'americanfootball_nfl',
  'ncaa-football': 'americanfootball_ncaaf',
  mlb: 'baseball_mlb',
  mls: 'soccer_usa_mls',
};

export interface PriceAndPoint {
  point: number;
  price: number;
}

export interface GameLines {
  bookmaker: string; // display title, e.g. "DraftKings"
  lastUpdate: string;
  moneylineHome: number | null;
  moneylineAway: number | null;
  spreadHome: PriceAndPoint | null;
  spreadAway: PriceAndPoint | null;
  total: { point: number; overPrice: number; underPrice: number } | null;
  // Official rotation numbers (Nevada-style bet numbers), best-effort — null
  // for games the odds provider hasn't synced a rotation for yet.
  homeRotation: number | null;
  awayRotation: number | null;
}

function normTeam(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Coalesces concurrent cold-cache callers for the same sport into a single
// live fetch. Without this, a page that calls getGameLines once per game
// (e.g. the Weatherboard, ~100 MLB games on one request) fires that many
// simultaneous identical requests at the Odds API on every cache miss —
// burning through the metered credit budget in one page load instead of
// spending the intended 3 credits (h2h+spreads+totals x 1 region-equivalent).
const inFlightSportOdds = new Map<string, Promise<any[] | null>>();

async function fetchSportOdds(sportKey: string, force = false): Promise<any[] | null> {
  const key = apiKey();
  if (!key) return null;

  const cacheKey = `odds:sport:${sportKey}`;

  if (!force) {
    try {
      const raw = await getRedis().get(cacheKey);
      if (raw) return (typeof raw === 'string' ? JSON.parse(raw) : raw) as any[];
    } catch {
      /* redis unconfigured or miss — fall through to fetch */
    }

    // Manual mode: a cache miss/expiry is NOT a signal to fetch — only an
    // explicit triggerOddsFetch(..., force: true) call is allowed to spend
    // a request. No cache yet in manual mode just means no odds yet.
    const config = await getOddsFetchConfig();
    if (config.mode === 'manual') return null;
  }

  const existing = inFlightSportOdds.get(sportKey);
  if (existing && !force) return existing;

  const promise = (async (): Promise<any[] | null> => {
    let games: any[] | null = null;
    try {
      const params = new URLSearchParams({
        apiKey: key,
        regions: 'us',
        markets: 'h2h,spreads,totals',
        oddsFormat: 'american',
        bookmakers: 'draftkings,fanduel', // 2 books still costs the same 1 "region equivalent" as 1 — every group of 10 bookmakers = 1 region, per the API's own cost formula
        includeRotationNumbers: 'true', // official Nevada-style rotation numbers, no extra credit cost
      });
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?${params.toString()}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      await recordUsage(res, sportKey);
      if (res.ok) games = await res.json();
    } catch {
      games = null;
    }

    // Cache something either way. A real success gets the configured
    // interval (auto mode) or a long "doesn't expire on its own" TTL
    // (manual mode, since only an explicit fetch should refresh it). A
    // fetch failure still gets a short backoff cache — otherwise every
    // single venue-page view retries the API with no throttling at all,
    // which burns through the metered credit budget fast during an outage
    // instead of failing quietly.
    try {
      let ttl = FAILURE_BACKOFF_SECONDS;
      if (games !== null) {
        const config = await getOddsFetchConfig();
        ttl = config.mode === 'manual' ? MANUAL_MODE_TTL_SECONDS : Math.max(1, config.intervalHours) * 3600;
      }
      await getRedis().set(cacheKey, JSON.stringify(games ?? []), { ex: ttl });
    } catch {
      /* ignore */
    }

    return games;
  })();

  inFlightSportOdds.set(sportKey, promise);
  try {
    return await promise;
  } finally {
    inFlightSportOdds.delete(sportKey);
  }
}

/**
 * Admin "Fetch Now" action — forces a real request (bypassing cache and
 * manual-mode's no-auto-fetch rule) for one league, or every tracked league
 * when none is given. Used by /admin/system/odds-usage.
 */
export async function triggerOddsFetch(leagueKey?: string): Promise<{ league: string; success: boolean }[]> {
  const entries = leagueKey && SPORT_KEYS[leagueKey]
    ? ([[leagueKey, SPORT_KEYS[leagueKey]]] as const)
    : (Object.entries(SPORT_KEYS) as [string, string][]);
  return Promise.all(
    entries.map(async ([lk, sk]) => ({ league: lk, success: (await fetchSportOdds(sk, true)) !== null })),
  );
}

function extractLines(bookmaker: any): GameLines | null {
  const markets = bookmaker?.markets ?? [];
  const h2h = markets.find((m: any) => m?.key === 'h2h');
  const spreads = markets.find((m: any) => m?.key === 'spreads');
  const totals = markets.find((m: any) => m?.key === 'totals');
  if (!h2h && !spreads && !totals) return null;

  const findOutcome = (market: any, name: string) => market?.outcomes?.find((o: any) => o?.name === name);

  return {
    bookmaker: bookmaker?.title ?? bookmaker?.key ?? 'Sportsbook',
    lastUpdate: bookmaker?.last_update ?? '',
    moneylineHome: null, // filled by caller (needs home/away team names)
    moneylineAway: null,
    spreadHome: null,
    spreadAway: null,
    homeRotation: null, // filled by caller (comes off the matched game, not the bookmaker)
    awayRotation: null,
    total: totals?.outcomes?.length === 2
      ? {
          point: totals.outcomes[0]?.point ?? 0,
          overPrice: findOutcome(totals, 'Over')?.price ?? 0,
          underPrice: findOutcome(totals, 'Under')?.price ?? 0,
        }
      : null,
  } as GameLines;
}

/**
 * Betting lines for a specific game — matched by team names + kickoff time
 * against the sport's full upcoming-games list. Prefers DraftKings, falls
 * back to FanDuel. Null if odds aren't configured, the sport has no market,
 * or no matching game is found (e.g. too far out, or a fetch failure).
 */
export async function getGameLines(
  league: string,
  homeTeam: string,
  awayTeam: string,
  commenceTimeISO: string,
): Promise<GameLines | null> {
  const sportKey = SPORT_KEYS[league];
  if (!sportKey) return null;

  const games = await fetchSportOdds(sportKey);
  if (!games) return null;

  const targetMs = Date.parse(commenceTimeISO);
  const nHome = normTeam(homeTeam);
  const nAway = normTeam(awayTeam);

  const match = games.find((g) => {
    const gMs = Date.parse(g?.commence_time ?? '');
    if (!Number.isFinite(gMs) || !Number.isFinite(targetMs)) return false;
    if (Math.abs(gMs - targetMs) > 30 * 60 * 1000) return false; // 30 min tolerance (disambiguates doubleheaders)
    return normTeam(g?.home_team ?? '') === nHome && normTeam(g?.away_team ?? '') === nAway;
  });
  if (!match) return null;

  const bookmakers: any[] = match.bookmakers ?? [];
  const preferred = bookmakers.find((b) => b?.key === 'draftkings') ?? bookmakers.find((b) => b?.key === 'fanduel');
  if (!preferred) return null;

  const lines = extractLines(preferred);
  if (!lines) return null;

  const h2h = preferred.markets?.find((m: any) => m?.key === 'h2h');
  const spreads = preferred.markets?.find((m: any) => m?.key === 'spreads');
  lines.moneylineHome = h2h?.outcomes?.find((o: any) => o?.name === match.home_team)?.price ?? null;
  lines.moneylineAway = h2h?.outcomes?.find((o: any) => o?.name === match.away_team)?.price ?? null;
  const homeSpread = spreads?.outcomes?.find((o: any) => o?.name === match.home_team);
  const awaySpread = spreads?.outcomes?.find((o: any) => o?.name === match.away_team);
  lines.spreadHome = homeSpread ? { point: homeSpread.point ?? 0, price: homeSpread.price ?? 0 } : null;
  lines.spreadAway = awaySpread ? { point: awaySpread.point ?? 0, price: awaySpread.price ?? 0 } : null;
  // Real Nevada-style rotation numbers are always 3-digit (100-999); a
  // 4+-digit value is bad data (seen from a stale/degraded upstream
  // response), not a real rotation — drop it rather than display it.
  const validRotation = (n: unknown): number | null => (Number.isFinite(n) && (n as number) >= 100 && (n as number) <= 999 ? (n as number) : null);
  lines.homeRotation = validRotation(match.home_rotation);
  lines.awayRotation = validRotation(match.away_rotation);

  return lines;
}
