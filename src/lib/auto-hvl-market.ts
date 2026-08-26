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

import { createWager, updateWager, getWager, localTimeToUTC } from './wager-store';
import { getScheduleGames, type SiteLeague, type EnrichedScheduleGame } from './league-schedule';
import type { PointspreadWager } from './wager-types';
import {
  ET, LEAGUES, FORECAST_HORIZON_DAYS, FIXED_ODDS, SAME_VENUE_TOLERANCE_DEG,
  gameEtDateStr, roundHalfPointFavoringDog, findDailyValue, prefetchVenueForecasts, isNonUsVenue,
  getMappedWagerId, claimGameForCreation, setMappedWagerId, newCreationBudget,
  type CreationBudget, type VenueForecastMap,
} from './auto-market-shared';

const NAMESPACE = 'autohvl:game';

export { roundHalfPointFavoringDog };

export type AutoHvLAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'error';
export interface AutoHvLOutcome {
  league: SiteLeague;
  gameId: string;
  action: AutoHvLAction;
  reason?: string;
  wagerId?: string;
}

async function processGame(league: SiteLeague, g: EnrichedScheduleGame, budget: CreationBudget, forecasts: VenueForecastMap): Promise<AutoHvLOutcome> {
  const base = { league, gameId: g.id };
  if (g.state !== 'pre') return { ...base, action: 'skipped', reason: 'not pre-game' };
  if (!g.venue || !g.awayVenue) return { ...base, action: 'skipped', reason: 'missing venue data' };
  if (Math.abs(g.venue.lat - g.awayVenue.lat) < SAME_VENUE_TOLERANCE_DEG && Math.abs(g.venue.lon - g.awayVenue.lon) < SAME_VENUE_TOLERANCE_DEG) {
    return { ...base, action: 'skipped', reason: 'both teams share one venue' };
  }
  if (isNonUsVenue(g.venue.id) || isNonUsVenue(g.awayVenue.id)) {
    return { ...base, action: 'skipped', reason: 'non-US venue, NWS has no coverage there' };
  }

  const gameDateStr = gameEtDateStr(g.kickoffUTC);
  if (!gameDateStr) return { ...base, action: 'skipped', reason: 'invalid kickoff time' };

  const lockTimeIso = localTimeToUTC(gameDateStr, '02:00', ET).toISOString();
  if (Date.now() >= new Date(lockTimeIso).getTime()) return { ...base, action: 'skipped', reason: 'past 2am ET lock time' };

  // Check the mapping BEFORE doing any forecast work — most runs hit this
  // update path, and there's no point fetching forecasts for a game about
  // to be skipped/no-op anyway (mapping missing/locked/graded).
  const existingId = await getMappedWagerId(NAMESPACE, league, g.id);
  if (!existingId) {
    if (budget.remaining <= 0) return { ...base, action: 'skipped', reason: 'creation budget exhausted this run, will retry next tick' };
    budget.remaining--;
    // No mapping yet — atomically claim this game before any expensive work.
    // If another (concurrent or duplicate) invocation already claimed it,
    // back off entirely rather than risk creating a second wager.
    const claimed = await claimGameForCreation(NAMESPACE, league, g.id);
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

      const homeForecast = forecasts.get(g.venue.id);
      const awayForecast = forecasts.get(g.awayVenue.id);
      if (!homeForecast || !awayForecast) {
        return { ...base, action: 'skipped', reason: 'forecast fetch failed for one of these venues this run' };
      }
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

    const homeForecast = forecasts.get(g.venue.id);
    const awayForecast = forecasts.get(g.awayVenue.id);
    if (!homeForecast || !awayForecast) {
      return { ...base, action: 'skipped', reason: 'forecast fetch failed for one of these venues this run' };
    }
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
    await setMappedWagerId(NAMESPACE, league, g.id, created.id);
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
  const budget = newCreationBudget();
  for (const league of LEAGUES) {
    const { games } = await getScheduleGames(league, FORECAST_HORIZON_DAYS, undefined, { lite: true }).catch(() => ({ games: [] as EnrichedScheduleGame[] }));
    // Defensive: never process the same game id twice in one pass, in case
    // the schedule feed ever lists it more than once. The claim in
    // processGame already makes a true duplicate harmless, but this avoids
    // the wasted forecast fetches entirely.
    const seenIds = new Set<string>();
    const uniqueGames = games.filter((g) => (seenIds.has(g.id) ? false : (seenIds.add(g.id), true)));
    // One fetch per unique venue in this league, concurrently, instead of
    // once per game sequentially, see prefetchVenueForecasts's doc comment.
    const forecasts = await prefetchVenueForecasts(uniqueGames, FORECAST_HORIZON_DAYS);
    for (const g of uniqueGames) {
      const outcome = await processGame(league, g, budget, forecasts);
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
