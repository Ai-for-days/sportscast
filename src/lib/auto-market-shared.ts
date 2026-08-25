// ── Shared utilities for the automated market-creation cron engines ────────
//
// Extracted 2026-08-25 when the "Wager on Weather - HvL" engine's pattern
// (auto-hvl-market.ts, added 2026-08-23) was extended to three more market
// types per Derek — Degrees HvH, Degrees LvL (auto-cross-venue-market.ts),
// and the per-venue "at game start" O/U (auto-venue-ou-market.ts). This file
// holds only the parts that are byte-for-byte identical across all of them
// and MUST stay that way — a divergence here would let one market type
// silently drift from the dedup/safety guarantees the others rely on.
//
// SAFETY: pure/read-only helpers plus the Redis claim mechanism only — no
// function here ever calls createWager/updateWager itself. Same deliberate,
// scoped exception to "market creation is always operator-initiated" as the
// original HvL engine (see CLAUDE.md §Safety model) — narrow, documented,
// per explicit instruction.

import { getForecast } from './weather-queries';
import { getRedis } from './redis';
import type { SiteLeague } from './league-schedule';

export const ET = 'America/New_York';
export const LEAGUES: SiteLeague[] = ['mlb', 'nfl', 'ncaa-football', 'mls'];

// Open-Meteo's real daily-forecast ceiling — also doubles as "how far ahead
// we look for candidate games," since scheduling further out than the
// forecast can reach wouldn't let us price anything anyway.
export const FORECAST_HORIZON_DAYS = 16;

// Odds are fixed at -110/-110 both sides per Derek — no vig modeling, for
// every auto-managed market. suggestOverUnderLine()/suggestPointspreadPrice()
// in bookmaker-pricing.ts are for operator-driven Suggest Lines/Spread
// elsewhere and are untouched by these engines.
export const FIXED_ODDS = -110;

export const SAME_VENUE_TOLERANCE_DEG = 0.01;

/** Caps how many BRAND-NEW wagers a single cron invocation will create.
 * Re-pricing an existing wager is cheap (one cached-or-warm forecast fetch
 * per side, plus near-free Redis lookups for every already-skipped game);
 * creating a new one costs 2 real NWS station-resolution round trips per
 * side. HvL's steady state is cheap because almost every game already has
 * a mapped wager after running for days — but the very first population
 * sweep for a brand-new market type (HvH/LvL/venue O/U, added 2026-08-25)
 * has to create one for EVERY current game across all 4 leagues in a
 * single invocation.
 *
 * Lowered 12 -> 6 same day: timing instrumentation on a live failing run
 * showed MLB's own creation cost (9 new wagers) was ~12.9s almost entirely
 * from creation itself (~1.4s/wager; the other 141 MLB games' skip-checks
 * were near-free) — and a DIFFERENT run died with no timeout error and no
 * exception at just ~13.5s elapsed, while a THIRD run completed cleanly in
 * 30.8s. That inconsistency (clean success sometimes, silent death at a
 * fraction of the 300s budget other times) looks like contention with real
 * site traffic sharing the same underlying function, not a deterministic
 * bug in this file — so the fix is to shrink worst-case exposure rather
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
 * smaller raw value) on a cross-venue pointspread — the favored side must
 * beat the raw forecast gap by MORE to win, never less. When the raw diff is
 * already a non-integer half-point or finer, this still rounds UP to the
 * next half-point rather than to the nearest one, so the dog is never worse
 * off than the unrounded forecast gap suggested. */
export function roundHalfPointFavoringDog(rawDiff: number): number {
  let magnitude = Math.ceil(rawDiff * 2) / 2;
  if (Number.isInteger(magnitude)) magnitude += 0.5;
  return magnitude;
}

/** Half-point O/U line from a raw forecast value — always a .5 so a push is
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

/** ET wall-clock "HH:MM" at a given UTC instant — the site's canonical
 * reference clock for every by-time auto-market, applied uniformly at every
 * venue regardless of that venue's own real timezone. Per Derek (2026-08-25),
 * confirming the design for the "at game start" venue O/U markets: "it
 * should be time 'at start of game' because it holds true for all 4 sports,
 * but it is the temp at that venue eastern time when the game starts" — one
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
// minute apart — either the schedule feed listed the game twice in one
// pass, or the cron double-fired (Vercel occasionally retries a slow
// invocation). Read-then-write on a plain GET/SET can't stop that: two
// callers can both see no mapping and both create. Fixed with a real claim
// — SET NX on the mapping key, short-lived, BEFORE any expensive work — so
// only one caller per game ever proceeds to createWager.
//
// `namespace` keeps each market type's mapping keys/claims independent
// (e.g. 'autohvl:game', 'autohvh:game', 'autoou:home:game') so four engines
// sweeping the same schedule every 30 minutes can never collide with each
// other or with an operator-created wager of the same shape.

const CLAIM_SENTINEL = 'creating';
const CLAIM_TTL_SECONDS = 180; // generous for one game's forecast fetch + wager creation; expires on its own if a run crashes mid-claim
const MAP_TTL_SECONDS = 90 * 86400; // well past any realistic grading/dispute window — just cleanup

/** Reported live (2026-08-25): the Toronto Blue Jays (MLB) and every
 * MLS team based in Canada (Toronto FC, CF Montréal, Vancouver Whitecaps)
 * play at venues NWS's api.weather.gov simply doesn't cover (it's US-only)
 * — every creation attempt for one of these venues fails with "NWS points
 * API failed: 404", forever, no matter how many times it's retried. Before
 * this sentinel existed, a failed creation just let the short-lived claim
 * expire, so the NEXT run tried the exact same doomed game again — and
 * since Toronto alone had several games in the tracked horizon, it
 * consumed the ENTIRE creation budget every single run, leaving zero
 * budget for the ~140 other MLB games that would have succeeded. This
 * sentinel remembers "don't bother" for a week (long enough to stop the
 * waste; short enough to self-heal if NWS ever adds coverage, or if this
 * diagnosis turns out to be wrong for some other reason) — cheap to be
 * wrong about since it costs nothing but a retry once the TTL lapses. */
export const PERMANENT_FAILURE_SENTINEL = 'unsupported';
const PERMANENT_FAILURE_TTL_SECONDS = 7 * 86400;

function mapKey(namespace: string, league: SiteLeague, gameId: string): string {
  return `${namespace}:${league}:${gameId}`;
}

export async function getMappedWagerId(namespace: string, league: SiteLeague, gameId: string): Promise<string | null> {
  try {
    const v = await getRedis().get(mapKey(namespace, league, gameId));
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export async function markPermanentlyUnsupported(namespace: string, league: SiteLeague, gameId: string): Promise<void> {
  try {
    await getRedis().set(mapKey(namespace, league, gameId), PERMANENT_FAILURE_SENTINEL, { ex: PERMANENT_FAILURE_TTL_SECONDS });
  } catch {
    /* best-effort — worst case the next run wastes one more budget slot re-discovering this */
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
    return false; // Redis error — safer to skip this run than risk a duplicate
  }
}

export async function setMappedWagerId(namespace: string, league: SiteLeague, gameId: string, wagerId: string): Promise<void> {
  try {
    await getRedis().set(mapKey(namespace, league, gameId), wagerId, { ex: MAP_TTL_SECONDS });
  } catch {
    /* best-effort — the claim sentinel will simply expire and the next run retries cleanly */
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
