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

const CACHE_TTL_SECONDS = 60 * 60 * 3; // 3 hours — plenty fresh for a public info page, easy on API credits
const FAILURE_BACKOFF_SECONDS = 180; // 3 min — throttles retries on outage/rate-limit instead of retrying every request

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
}

function normTeam(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function fetchSportOdds(sportKey: string): Promise<any[] | null> {
  const key = apiKey();
  if (!key) return null;

  const cacheKey = `odds:sport:${sportKey}`;
  try {
    const raw = await getRedis().get(cacheKey);
    if (raw) return (typeof raw === 'string' ? JSON.parse(raw) : raw) as any[];
  } catch {
    /* redis unconfigured or miss — fall through to fetch */
  }

  let games: any[] | null = null;
  try {
    const params = new URLSearchParams({
      apiKey: key,
      regions: 'us',
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american',
      bookmakers: 'draftkings,fanduel',
    });
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) games = await res.json();
  } catch {
    games = null;
  }

  // Cache something either way. A real success (even an empty response, e.g.
  // off-season) gets the full TTL. A fetch failure still gets a short backoff
  // cache — otherwise every single venue-page view retries the API with no
  // throttling at all, which burns through the metered credit budget fast
  // during an outage instead of failing quietly.
  try {
    const ttl = games !== null ? CACHE_TTL_SECONDS : FAILURE_BACKOFF_SECONDS;
    await getRedis().set(cacheKey, JSON.stringify(games ?? []), { ex: ttl });
  } catch {
    /* ignore */
  }

  return games;
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

  return lines;
}
