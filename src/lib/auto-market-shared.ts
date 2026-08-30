// ── Shared utilities for the automated market-creation cron engines ────────
//
// Extracted 2026-08-25 when the "Wager on Weather - HvL" engine's pattern
// (auto-hvl-market.ts, added 2026-08-23) was extended to three more market
// types per Derek, Degrees HvH, Degrees LvL (auto-cross-venue-market.ts),
// and the per-venue "at game start" O/U (auto-venue-ou-market.ts). This file
// holds only the parts that are byte-for-byte identical across all of them
// and MUST stay that way. A divergence here would let one market type
// silently drift from the dedup/safety guarantees the others rely on.
//
// SAFETY: pure/read-only helpers plus the Redis claim mechanism only, no
// function here ever calls createWager/updateWager itself. Same deliberate,
// scoped exception to "market creation is always operator-initiated" as the
// original HvL engine (see CLAUDE.md §Safety model): narrow, documented,
// per explicit instruction.

import { getForecast } from './weather-queries';
import { raiseAlert } from './alerts';
import { getRedis } from './redis';
import { localTimeToUTC, LOCK_HOURS_BEFORE_KICKOFF, DAILY_LOCK_LOCAL_TIME } from './wager-store';
import type { SiteLeague, EnrichedScheduleGame } from './league-schedule';
import type { ForecastResponse } from './types';

export const ET = 'America/New_York';
export const LEAGUES: SiteLeague[] = ['mlb', 'nfl', 'ncaa-football', 'mls'];

// Open-Meteo's real daily-forecast ceiling, which also doubles as "how far ahead
// we look for candidate games," since scheduling further out than the
// forecast can reach wouldn't let us price anything anyway.
export const FORECAST_HORIZON_DAYS = 16;

// Odds are fixed at -110/-110 both sides per Derek, no vig modeling, for
// every auto-managed market. suggestOverUnderLine()/suggestPointspreadPrice()
// in bookmaker-pricing.ts are for operator-driven Suggest Lines/Spread
// elsewhere and are untouched by these engines.
export const FIXED_ODDS = -110;

export const SAME_VENUE_TOLERANCE_DEG = 0.01;

// ── When a market stops accepting action ───────────────────────────────────
//
// Derek's definitive rule, 2026-08-27, given after several earlier passes at
// this had left three different conventions in the code and a fourth in the
// live data:
//
//   "for all wagers that measure daily highs or lows, those all lock at 6am
//    at the time of the venue where the game is played. for wagers that do
//    not measure daily, those all close 3 hours before the game starts."
//
// It supersedes all of: 11:45 PM venue-local (the old manual-builder
// default), 2:00 AM ET on game day (the old pointspread engines), 15 minutes
// before kickoff (the old venue O/U engine), and the blanket
// 3-hours-before-kickoff from 2026-08-26 that briefly covered daily wagers
// too. Which rule applies is decided by the METRIC, not by the market type.
//
// An operator can still set an individual lock time by hand, but note the
// engines re-assert the rule on auto-managed markets on their next tick.

// Both constants live in wager-store.ts, which this file already imports
// from; re-exported here so the engines and their tests keep one source.
export { LOCK_HOURS_BEFORE_KICKOFF, DAILY_LOCK_LOCAL_TIME } from './wager-store';

/**
 * The calendar date of a game AT ITS OWN VENUE, which is not always the ET
 * date: a 10pm Pacific first pitch is already tomorrow in Eastern. The 6 AM
 * lock has to land on the venue's own game day, so it keys off this.
 */
export function venueLocalDateStr(kickoffUTC: string, venueTimeZone: string): string {
  const d = new Date(kickoffUTC);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: venueTimeZone });
}

/**
 * Lock for a wager measuring a DAILY high or low: 6:00 AM local time at the
 * venue the game is played at, on that venue's own game day.
 *
 * Resolved through the IANA zone rather than a fixed offset, so it stays
 * correct across a DST boundary within the 16-day booking horizon.
 */
export function lockTimeDailyMetric(venueGameDateStr: string, venueTimeZone: string): string {
  return localTimeToUTC(venueGameDateStr, DAILY_LOCK_LOCAL_TIME, venueTimeZone).toISOString();
}

/** Lock for a wager that does NOT measure a daily high or low: 3 hours
 *  before the game starts. The other half of the rule above. */
export function lockTimeBeforeKickoff(kickoffUTC: string): string {
  return new Date(Date.parse(kickoffUTC) - LOCK_HOURS_BEFORE_KICKOFF * 3600_000).toISOString();
}

/** Caps how many BRAND-NEW wagers a single cron invocation will create.
 * Re-pricing an existing wager is cheap (one cached-or-warm forecast fetch
 * per side, plus near-free Redis lookups for every already-skipped game);
 * creating a new one costs 2 real NWS station-resolution round trips per
 * side. HvL's steady state is cheap because almost every game already has
 * a mapped wager after running for days, but the very first population
 * sweep for a brand-new market type (HvH/LvL/venue O/U, added 2026-08-25)
 * has to create one for EVERY current game across all 4 leagues in a
 * single invocation.
 *
 * Lowered 12 -> 6 same day: timing instrumentation on a live failing run
 * showed MLB's own creation cost (9 new wagers) was ~12.9s almost entirely
 * from creation itself (~1.4s/wager; the other 141 MLB games' skip-checks
 * were near-free), and a DIFFERENT run died with no timeout error and no
 * exception at just ~13.5s elapsed, while a THIRD run completed cleanly in
 * 30.8s. That inconsistency (clean success sometimes, silent death at a
 * fraction of the 300s budget other times) looks like contention with real
 * site traffic sharing the same underlying function, not a deterministic
 * bug in this file, so the fix is to shrink worst-case exposure rather
 * than chase an exact number. A game skipped for budget reasons this run
 * tries again next tick with no side effects (its claim was never taken).
 */
export const MAX_NEW_CREATIONS_PER_RUN = 6;

export interface CreationBudget {
  remaining: number;
}
export function newCreationBudget(): CreationBudget {
  return { remaining: MAX_NEW_CREATIONS_PER_RUN };
}

export function gameEtDateStr(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: ET });
}

/** Per Derek (2026-08-23): the .5 always favors the "dog" (the side with the
 * smaller raw value) on a cross-venue pointspread: the favored side must
 * beat the raw forecast gap by MORE to win, never less. When the raw diff is
 * already a non-integer half-point or finer, this still rounds UP to the
 * next half-point rather than to the nearest one, so the dog is never worse
 * off than the unrounded forecast gap suggested. */
export function roundHalfPointFavoringDog(rawDiff: number): number {
  let magnitude = Math.ceil(rawDiff * 2) / 2;
  if (Number.isInteger(magnitude)) magnitude += 0.5;
  return magnitude;
}

/** Half-point O/U line from a raw forecast value, always a .5 so a push is
 * never possible, matching suggestOverUnderLine()'s own convention in
 * bookmaker-pricing.ts ("Uses half-point lines to avoid pushes"). That
 * function's vig-based odds aren't reused here since every auto-managed
 * market is fixed -110/-110 (see FIXED_ODDS above). */
export function roundHalfPointAvoidingPush(raw: number): number {
  const fairLine = Math.round(raw * 2) / 2;
  return Number.isInteger(fairLine) ? fairLine + 0.5 : fairLine;
}

export function findDailyValue(
  forecast: Awaited<ReturnType<typeof getForecast>>,
  dateStr: string,
  key: 'highF' | 'lowF',
): number | null {
  const daily = forecast.daily.find((d) => d.date === dateStr);
  if (!daily) return null;
  const v = daily[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export type VenueForecastMap = Map<string, ForecastResponse>;

/**
 * How many venue forecasts to have in flight at once.
 *
 * This used to be an unbounded `Promise.all` over every distinct venue in a
 * league — around 30 for MLB — and four engines run on their own crons a few
 * minutes apart. Open-Meteo answered 429 through the evening of 2026-08-29,
 * and the fallback for a 429 invents a forecast, so the burst was buying
 * simulated weather for the engines to price against. Bounded, the same work
 * takes marginally longer and stops tripping the limit that caused it.
 */
const FORECAST_FETCH_CONCURRENCY = 6;

/** Promise.all with a ceiling on how many run at once. Order is preserved. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Fetch every distinct venue's forecast ONCE, concurrently, instead of once
 * per game, sequentially, inside a per-game loop. Found live 2026-08-25: as
 * more auto-managed wagers exist (steady-state re-pricing, not just
 * first-time creation), the per-game "await getForecast() x2" pattern,
 * repeated once for every game with an existing mapped wager, one game at a
 * time, meant N games touching M distinct venues paid for close to N
 * sequential round trips even though most of them hit the exact same M
 * venues over and over. One MLB run took 167 seconds once enough wagers
 * existed to re-price, entirely from this. Same fix as
 * league-schedule.ts's own "one fetch per unique venue" comment, applied
 * here across a whole league's game list up front so the wall-clock cost is
 * bounded by the slowest single venue fetch, not the sum of all of them. A
 * venue whose fetch fails is simply absent from the map; callers already
 * treat a missing forecast as "not available yet" and skip gracefully. */
/**
 * Keep only the forecasts an engine may price against.
 *
 * A SIMULATED forecast is treated exactly like a missing one: absent from the
 * map, so the caller skips that game and the next tick tries again with a real
 * number. Pure and exported so the refusal is pinned by a test rather than
 * resting on a network call. See the `synthetic` flag's comment in types.ts
 * for what produces one.
 */
export function keepRealForecasts(
  entries: readonly (readonly [string, ForecastResponse | null])[],
): { map: VenueForecastMap; simulated: number } {
  const map: VenueForecastMap = new Map();
  let simulated = 0;
  for (const [id, forecast] of entries) {
    if (!forecast) continue;
    if (forecast.synthetic) {
      simulated++;
      continue;
    }
    map.set(id, forecast);
  }
  return { map, simulated };
}

export async function prefetchVenueForecasts(
  games: Pick<EnrichedScheduleGame, 'venue' | 'awayVenue'>[],
  horizonDays: number,
): Promise<VenueForecastMap> {
  const uniqueVenues = new Map<string, { lat: number; lon: number }>();
  for (const g of games) {
    if (g.venue) uniqueVenues.set(g.venue.id, g.venue);
    if (g.awayVenue) uniqueVenues.set(g.awayVenue.id, g.awayVenue);
  }
  const entries = await mapWithConcurrency(
    [...uniqueVenues.entries()],
    FORECAST_FETCH_CONCURRENCY,
    async ([id, v]) => {
      try {
        return [id, await getForecast(v.lat, v.lon, horizonDays)] as const;
      } catch {
        return [id, null] as const;
      }
    },
  );

  const { map, simulated } = keepRealForecasts(entries);

  if (simulated > 0) {
    console.error(`[auto-market] refused ${simulated} simulated venue forecast(s) — Open-Meteo is failing, so those games are being skipped rather than priced`);
    await raiseAlert(
      'critical',
      'forecast_simulated',
      'Pricing skipped: simulated forecasts',
      `${simulated} venue forecast(s) came back simulated because Open-Meteo could not be reached. Those games were skipped rather than priced. Repeated occurrences mean we are being rate-limited.`,
      '/admin/system/health',
      { venuesAffected: simulated, venuesRequested: uniqueVenues.size },
    ).catch(() => { /* an alert must never break a pricing run */ });
  }

  return map;
}

/** The only 4 tracked venues NWS's api.weather.gov (US-only) can never
 * resolve a station for: the Toronto Blue Jays (MLB) and the 3 MLS teams
 * based in Canada. Found live 2026-08-25 the hard way, see
 * LEGACY_UNSUPPORTED_SENTINEL's doc comment below for the full story of the
 * self-inflicted bug this replaced: inferring "permanent" from a 404
 * error message turned out to also catch genuinely TRANSIENT failures
 * (rate-limiting, momentary NWS hiccups) during the same debugging
 * session, silently blacklisting most of MLB's actual games for a full
 * week (the sentinel's TTL) even though nothing was wrong with them.
 * A hardcoded list of the 4 venues that are ACTUALLY permanently
 * unsupported is slower to extend if a league ever adds a 5th non-US team,
 * but can never falsely blacklist a working US venue no matter how NWS
 * behaves that day. */
export const NON_US_VENUE_IDS = new Set(['mlb-tor', 'mls-van', 'mls-tor', 'mls-mtl']);

export function isNonUsVenue(venueId: string | undefined | null): boolean {
  return !!venueId && NON_US_VENUE_IDS.has(venueId);
}

/** ET wall-clock "HH:MM" at a given UTC instant, the site's canonical
 * reference clock for every by-time auto-market, applied uniformly at every
 * venue regardless of that venue's own real timezone. Per Derek (2026-08-25),
 * confirming the design for the "at game start" venue O/U markets: "it
 * should be time 'at start of game' because it holds true for all 4 sports,
 * but it is the temp at that venue eastern time when the game starts": one
 * shared clock (matching how the site already displays every lock time/game
 * time in ET), not a per-venue local-time translation. */
export function etWallClockHHMM(utcIso: string): string {
  const d = new Date(utcIso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const hRaw = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const h = hRaw === '24' ? '00' : hRaw;
  return `${h}:${m}`;
}

// ── Redis mapping/claim helpers (game ↔ auto-created-wager, race-safe) ──────
//
// Reported live (2026-08-23) against the original HvL engine: the first
// production run created TWO contradictory wagers for the same game a
// minute apart, either the schedule feed listed the game twice in one
// pass, or the cron double-fired (Vercel occasionally retries a slow
// invocation). Read-then-write on a plain GET/SET can't stop that: two
// callers can both see no mapping and both create. Fixed with a real claim:
// SET NX on the mapping key, short-lived, BEFORE any expensive work, so
// only one caller per game ever proceeds to createWager.
//
// `namespace` keeps each market type's mapping keys/claims independent
// (e.g. 'autohvl:game', 'autohvh:game', 'autoou:home:game') so four engines
// sweeping the same schedule every 30 minutes can never collide with each
// other or with an operator-created wager of the same shape.

const CLAIM_SENTINEL = 'creating';
const CLAIM_TTL_SECONDS = 180; // generous for one game's forecast fetch + wager creation; expires on its own if a run crashes mid-claim
const MAP_TTL_SECONDS = 90 * 86400; // well past any realistic grading/dispute window, just cleanup

/** RETIRED (2026-08-25, same day it was added): originally set on a failed
 * creation whose error message looked like "NWS can't resolve this
 * location at all" (a 404 from NWS's points/stations API), with a 7-day
 * TTL, to stop the Toronto Blue Jays' games from burning the entire
 * creation budget every run (see NON_US_VENUE_IDS above for the full
 * story). Turned out to be too aggressive: inferring "permanent" from a
 * 404 message ALSO caught genuinely transient failures during the same
 * chaotic debugging session (NWS rate-limiting/hiccups unrelated to
 * geography), silently blacklisting most of MLB's real, working games for
 * a full week even though nothing was actually wrong with them. MLB sat
 * at zero new HvH/LvL creations for hours while NFL/NCAAF/MLS populated
 * fine, and this mis-marking was the reason. Replaced with the hardcoded
 * `NON_US_VENUE_IDS` check above, which can never be wrong about a working
 * US venue no matter how NWS behaves. `getMappedWagerId` below treats any
 * OLD entry still holding this literal value as if no mapping exists at
 * all, so every falsely-blacklisted game self-heals on its very next
 * budget-permitting run instead of waiting out the 7-day TTL. Nothing
 * writes this value anymore, kept only so old entries are recognized and
 * cleared. */
const LEGACY_UNSUPPORTED_SENTINEL = 'unsupported';

function mapKey(namespace: string, league: SiteLeague, gameId: string): string {
  return `${namespace}:${league}:${gameId}`;
}

export async function getMappedWagerId(namespace: string, league: SiteLeague, gameId: string): Promise<string | null> {
  try {
    const v = await getRedis().get(mapKey(namespace, league, gameId));
    if (v === LEGACY_UNSUPPORTED_SENTINEL) return null;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Atomically claims this game for wager creation. Returns true only for the
 * ONE caller that wins the race; every other concurrent/duplicate caller
 * gets false and must not create anything. */
export async function claimGameForCreation(namespace: string, league: SiteLeague, gameId: string): Promise<boolean> {
  try {
    const res = await getRedis().set(mapKey(namespace, league, gameId), CLAIM_SENTINEL, { nx: true, ex: CLAIM_TTL_SECONDS });
    return res === 'OK';
  } catch {
    return false; // Redis error: safer to skip this run than risk a duplicate
  }
}

export async function setMappedWagerId(namespace: string, league: SiteLeague, gameId: string, wagerId: string): Promise<void> {
  try {
    await getRedis().set(mapKey(namespace, league, gameId), wagerId, { ex: MAP_TTL_SECONDS });
  } catch {
    /* best-effort: the claim sentinel will simply expire and the next run retries cleanly */
  }
}

// ── Shared pass-result shapes ────────────────────────────────────────────────

export type AutoMarketAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'error';
export interface AutoMarketOutcome {
  league: SiteLeague;
  gameId: string;
  action: AutoMarketAction;
  reason?: string;
  wagerId?: string;
}
export interface AutoMarketPassSummary {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  outcomes: AutoMarketOutcome[];
}

export function emptyPassSummary(): AutoMarketPassSummary {
  return { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, outcomes: [] };
}

export function tallyOutcome(summary: AutoMarketPassSummary, outcome: AutoMarketOutcome): void {
  summary.outcomes.push(outcome);
  if (outcome.action === 'created') summary.created++;
  else if (outcome.action === 'updated') summary.updated++;
  else if (outcome.action === 'unchanged') summary.unchanged++;
  else if (outcome.action === 'error') summary.errors++;
  else summary.skipped++;
}
