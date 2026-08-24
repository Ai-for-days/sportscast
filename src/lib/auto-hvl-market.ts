// ── Automated "Wager on Weather - HvL" pricing engine ───────────────────────
//
// Added 2026-08-23 per Derek: for every tracked game, automatically publish
// (and keep re-pricing, as forecasts update) a single pointspread market
// pitting whichever of the game's two venues is forecast WARMER that day
// (its daily high) against the other venue's daily low. This is the ONLY
// native market the plain Weatherboard shows now ("Wager on Weather - HvL");
// the full detail (including any operator-created markets) still lives on
// Weatherboard Extended.
//
// Fully automatic by design (a deliberate, scoped exception to this repo's
// usual "market creation is always operator-initiated" rule — see CLAUDE.md
// §Safety model): runs on a cron (see /api/cron/auto-hvl-pricing.ts), creates
// the wager the first time a game's target date falls inside the forecast
// horizon, and keeps nudging `spread` as new forecasts come in — right up
// until an operator locks it early (Wager Dashboard's "Lock Now") or its
// natural lock time (2:00 AM ET on the game's date) passes, whichever is
// first. Only ever touches wagers it created itself (`autoManaged: true`);
// never an operator-created pointspread, even if it happens to be shaped the
// same way.
//
// Odds are fixed at -110/-110 both sides per Derek — no vig modeling, unlike
// suggestPointspread() in bookmaker-pricing.ts (that engine is for operator-
// driven Suggest Spread elsewhere and is untouched by this one).

import { getForecast } from './weather-queries';
import { createWager, updateWager, getWager, localTimeToUTC } from './wager-store';
import { getScheduleGames, type SiteLeague, type EnrichedScheduleGame } from './league-schedule';
import { getRedis } from './redis';
import type { PointspreadWager } from './wager-types';

const ET = 'America/New_York';
const LEAGUES: SiteLeague[] = ['mlb', 'nfl', 'ncaa-football', 'mls'];

// Open-Meteo's real daily-forecast ceiling (matches the live-fallback used
// throughout bookmaker-pricing.ts) — also doubles as "how far ahead we look
// for candidate games," since scheduling further out than the forecast can
// reach wouldn't let us price anything anyway. As games roll into this
// window on later runs, they get picked up automatically — no hardcoded
// "how far in advance" cutoff beyond this physical one.
const FORECAST_HORIZON_DAYS = 16;
const FIXED_ODDS = -110;
const SAME_VENUE_TOLERANCE_DEG = 0.01;

function gameEtDateStr(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: ET });
}

/** Per Derek (2026-08-23): the .5 always favors the Low side (the "dog") —
 * the High side must beat the raw forecast gap by MORE to win, never less.
 * When the raw diff is already a non-integer half-point or finer, this still
 * rounds UP to the next half-point rather than to the nearest one, so the
 * dog is never worse off than the unrounded forecast gap suggested. */
export function roundHalfPointFavoringDog(rawDiff: number): number {
  let magnitude = Math.ceil(rawDiff * 2) / 2;
  if (Number.isInteger(magnitude)) magnitude += 0.5;
  return magnitude;
}

function findDailyValue(forecast: Awaited<ReturnType<typeof getForecast>>, dateStr: string, key: 'highF' | 'lowF'): number | null {
  const daily = forecast.daily.find((d) => d.date === dateStr);
  if (!daily) return null;
  const v = daily[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ── Game ↔ auto-wager mapping (so re-runs update the SAME wager instead of duplicating it) ──

function mapKey(league: SiteLeague, gameId: string): string {
  return `autohvl:game:${league}:${gameId}`;
}
const MAP_TTL_SECONDS = 90 * 86400; // well past any realistic grading/dispute window — just cleanup

// Reported live (2026-08-23): the first production run created TWO
// contradictory wagers for the same game a minute apart (#MZA67713 "Tampa
// Bay Rays High vs Detroit Tigers Low" and #TTN37031 "...Low vs...High") —
// either the schedule feed listed the game twice in one pass, or the cron
// double-fired (Vercel occasionally retries a slow invocation). Read-then-
// write on a plain GET/SET can't stop that: two callers can both see no
// mapping and both create. Fixed with a real claim — SET NX on the SAME
// mapping key, short-lived, BEFORE any expensive work — so only one caller
// per game ever proceeds to createWager.
const CLAIM_SENTINEL = 'creating';
const CLAIM_TTL_SECONDS = 180; // generous for one game's forecast fetch + wager creation; expires on its own if a run crashes mid-claim

async function getMappedWagerId(league: SiteLeague, gameId: string): Promise<string | null> {
  try {
    const v = await getRedis().get(mapKey(league, gameId));
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}
/** Atomically claims this game for wager creation. Returns true only for the
 * ONE caller that wins the race; every other concurrent/duplicate caller
 * gets false and must not create anything. */
async function claimGameForCreation(league: SiteLeague, gameId: string): Promise<boolean> {
  try {
    const res = await getRedis().set(mapKey(league, gameId), CLAIM_SENTINEL, { nx: true, ex: CLAIM_TTL_SECONDS });
    return res === 'OK';
  } catch {
    return false; // Redis error — safer to skip this run than risk a duplicate
  }
}
async function setMappedWagerId(league: SiteLeague, gameId: string, wagerId: string): Promise<void> {
  try {
    await getRedis().set(mapKey(league, gameId), wagerId, { ex: MAP_TTL_SECONDS });
  } catch {
    /* best-effort — the claim sentinel will simply expire and the next run retries cleanly */
  }
}

export type AutoHvLAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'error';
export interface AutoHvLOutcome {
  league: SiteLeague;
  gameId: string;
  action: AutoHvLAction;
  reason?: string;
  wagerId?: string;
}

async function processGame(league: SiteLeague, g: EnrichedScheduleGame): Promise<AutoHvLOutcome> {
  const base = { league, gameId: g.id };
  if (g.state !== 'pre') return { ...base, action: 'skipped', reason: 'not pre-game' };
  if (!g.venue || !g.awayVenue) return { ...base, action: 'skipped', reason: 'missing venue data' };
  if (Math.abs(g.venue.lat - g.awayVenue.lat) < SAME_VENUE_TOLERANCE_DEG && Math.abs(g.venue.lon - g.awayVenue.lon) < SAME_VENUE_TOLERANCE_DEG) {
    return { ...base, action: 'skipped', reason: 'both teams share one venue' };
  }

  const gameDateStr = gameEtDateStr(g.kickoffUTC);
  if (!gameDateStr) return { ...base, action: 'skipped', reason: 'invalid kickoff time' };

  const lockTimeIso = localTimeToUTC(gameDateStr, '02:00', ET).toISOString();
  if (Date.now() >= new Date(lockTimeIso).getTime()) return { ...base, action: 'skipped', reason: 'past 2am ET lock time' };

  // Check the mapping BEFORE doing any forecast work — most runs hit this
  // update path, and there's no point fetching forecasts for a game about
  // to be skipped/no-op anyway (mapping missing/locked/graded).
  const existingId = await getMappedWagerId(league, g.id);
  if (!existingId) {
    // No mapping yet — atomically claim this game before any expensive work.
    // If another (concurrent or duplicate) invocation already claimed it,
    // back off entirely rather than risk creating a second wager.
    const claimed = await claimGameForCreation(league, g.id);
    if (!claimed) return { ...base, action: 'skipped', reason: 'lost creation race (already claimed)' };
  }

  try {
    if (existingId) {
      const existing = await getWager(existingId);
      if (!existing || existing.kind !== 'pointspread' || !(existing as PointspreadWager).autoManaged) {
        return { ...base, action: 'skipped', reason: 'mapped wager missing or not auto-managed' };
      }
      if (existing.status !== 'open') return { ...base, action: 'skipped', reason: `wager already ${existing.status}`, wagerId: existing.id };
      if (Date.now() >= new Date(existing.lockTime).getTime()) return { ...base, action: 'skipped', reason: 'past lock time', wagerId: existing.id };

      const [homeForecast, awayForecast] = await Promise.all([
        getForecast(g.venue.lat, g.venue.lon, FORECAST_HORIZON_DAYS),
        getForecast(g.awayVenue.lat, g.awayVenue.lon, FORECAST_HORIZON_DAYS),
      ]);
      const homeHigh = findDailyValue(homeForecast, gameDateStr, 'highF');
      const homeLow = findDailyValue(homeForecast, gameDateStr, 'lowF');
      const awayHigh = findDailyValue(awayForecast, gameDateStr, 'highF');
      const awayLow = findDailyValue(awayForecast, gameDateStr, 'lowF');
      if (homeHigh == null || homeLow == null || awayHigh == null || awayLow == null) {
        return { ...base, action: 'skipped', reason: 'forecast not yet available for this date' };
      }
      // The side assignment (which venue is High vs. Low) is fixed at
      // creation time and never re-decided — only the number moves. See the
      // module doc comment for why.
      const existingPs = existing as PointspreadWager;
      const aIsHome = Math.abs(existingPs.locationA.lat - g.venue.lat) < SAME_VENUE_TOLERANCE_DEG;
      const highValue = aIsHome ? homeHigh : awayHigh;
      const lowValue = aIsHome ? awayLow : homeLow;
      const spread = -roundHalfPointFavoringDog(highValue - lowValue);

      if (existingPs.spread === spread) return { ...base, action: 'unchanged', wagerId: existing.id };
      await updateWager(existing.id, { spread });
      return { ...base, action: 'updated', wagerId: existing.id };
    }

    const [homeForecast, awayForecast] = await Promise.all([
      getForecast(g.venue.lat, g.venue.lon, FORECAST_HORIZON_DAYS),
      getForecast(g.awayVenue.lat, g.awayVenue.lon, FORECAST_HORIZON_DAYS),
    ]);
    const homeHigh = findDailyValue(homeForecast, gameDateStr, 'highF');
    const homeLow = findDailyValue(homeForecast, gameDateStr, 'lowF');
    const awayHigh = findDailyValue(awayForecast, gameDateStr, 'highF');
    const awayLow = findDailyValue(awayForecast, gameDateStr, 'lowF');
    if (homeHigh == null || homeLow == null || awayHigh == null || awayLow == null) {
      return { ...base, action: 'skipped', reason: 'forecast not yet available for this date' };
    }

    const homeIsHighSide = homeHigh >= awayHigh;
    const highVenue = homeIsHighSide ? g.venue : g.awayVenue;
    const lowVenue = homeIsHighSide ? g.awayVenue : g.venue;
    const highValue = homeIsHighSide ? homeHigh : awayHigh;
    const lowValue = homeIsHighSide ? awayLow : homeLow;

    const rawDiff = highValue - lowValue;
    const magnitude = roundHalfPointFavoringDog(rawDiff);
    // locationA = the High side; negative = A favored (nws-grading.ts convention).
    const spread = -magnitude;

    // Per Derek (2026-08-24): "you need the venues in there" — the venue's
    // own name (e.g. "Tropicana Field"), not its city/state, since that's
    // what a weather bettor actually recognizes a market by.
    const highLocName = highVenue.name;
    const lowLocName = lowVenue.name;
    const created = await createWager({
      kind: 'pointspread',
      title: `${highLocName} High vs ${lowLocName} Low — Wager on Weather`,
      metric: 'high_temp',
      metricA: 'high_temp',
      metricB: 'low_temp',
      targetDate: gameDateStr,
      lockTime: lockTimeIso,
      locationA: { name: highLocName, lat: highVenue.lat, lon: highVenue.lon },
      locationB: { name: lowLocName, lat: lowVenue.lat, lon: lowVenue.lon },
      spread,
      locationAOdds: FIXED_ODDS,
      locationBOdds: FIXED_ODDS,
      autoManaged: true,
    });
    await setMappedWagerId(league, g.id, created.id);
    return { ...base, action: 'created', wagerId: created.id };
  } catch (err: any) {
    return { ...base, action: 'error', reason: err?.message ?? 'unknown error' };
  }
}

export interface AutoHvLPassSummary {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  outcomes: AutoHvLOutcome[];
}

/** Entry point for the cron (see /api/cron/auto-hvl-pricing.ts). Sweeps every
 * tracked league's upcoming schedule and creates/re-prices this game's
 * "Wager on Weather - HvL" market as needed. Bulletproof per-game — one
 * game's failure never blocks the rest. */
export async function runAutoHvLPricingPass(): Promise<AutoHvLPassSummary> {
  const summary: AutoHvLPassSummary = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, outcomes: [] };
  for (const league of LEAGUES) {
    const { games } = await getScheduleGames(league, FORECAST_HORIZON_DAYS).catch(() => ({ games: [] as EnrichedScheduleGame[] }));
    // Defensive: never process the same game id twice in one pass, in case
    // the schedule feed ever lists it more than once. The claim in
    // processGame already makes a true duplicate harmless, but this avoids
    // the wasted forecast fetches entirely.
    const seenIds = new Set<string>();
    const uniqueGames = games.filter((g) => (seenIds.has(g.id) ? false : (seenIds.add(g.id), true)));
    for (const g of uniqueGames) {
      const outcome = await processGame(league, g);
      summary.outcomes.push(outcome);
      if (outcome.action === 'created') summary.created++;
      else if (outcome.action === 'updated') summary.updated++;
      else if (outcome.action === 'unchanged') summary.unchanged++;
      else if (outcome.action === 'error') summary.errors++;
      else summary.skipped++;
    }
  }
  return summary;
}
