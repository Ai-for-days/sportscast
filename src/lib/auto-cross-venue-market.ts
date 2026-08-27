// ── Automated "Degrees HvH" / "Degrees LvL" pricing engine ──────────────────
//
// Added 2026-08-25 per Derek: alongside the existing "Wager on Weather -
// HvL" auto-market (auto-hvl-market.ts), automatically publish and keep
// re-pricing two more cross-venue pointspreads per game, the two teams'
// own daily HIGHS against each other ("Degrees HvH"), and their own daily
// LOWS against each other ("Degrees LvL"). These feed the "Degree Diff:
// High v High" / "Low v Low" columns Weatherboard Extended has shown since
// the 2026-08-23 redesign (see weatherboard-markets.ts's
// degreeDiffCategory()), previously only ever populated by an
// operator-created wager, never auto-priced.
//
// One parametrized engine (see CrossVenueMarketConfig below) instead of two
// near-duplicate files: HvH and LvL differ only in which daily value both
// sides compare (highF vs lowF) and their display labels; everything else
// (dedup/claim, side-assignment convention, lock timing, safety rails) must
// stay identical, and duplicating ~100 lines of that logic in two files
// would let a future fix land in one copy and not the other.
//
// Same deliberate, scoped exception to "market creation is always
// operator-initiated" as the original HvL engine (see CLAUDE.md §Safety
// model): narrow, documented, per explicit instruction. Odds fixed at
// -110/-110 both sides, no vig modeling, matching every other auto-managed
// market.

import { createWager, updateWager, getWager } from './wager-store';
import { getScheduleGames, type SiteLeague, type EnrichedScheduleGame } from './league-schedule';
import type { PointspreadWager, WagerMetric } from './wager-types';
import {
  LEAGUES, FORECAST_HORIZON_DAYS, FIXED_ODDS, SAME_VENUE_TOLERANCE_DEG,
  gameEtDateStr, roundHalfPointFavoringDog, findDailyValue, prefetchVenueForecasts, isNonUsVenue,
  lockTimeBeforeKickoff, getMappedWagerId, claimGameForCreation, setMappedWagerId,
  emptyPassSummary, tallyOutcome, newCreationBudget,
  type AutoMarketOutcome, type AutoMarketPassSummary, type CreationBudget, type VenueForecastMap,
} from './auto-market-shared';

export interface CrossVenueMarketConfig {
  /** Redis mapping namespace, must be unique per market type. */
  namespace: string;
  /** Which daily value both sides compare. */
  dailyKey: 'highF' | 'lowF';
  metric: WagerMetric;
  /** e.g. "High" / "Low", used in the auto-generated title. */
  labelSuffix: string;
}

export const HVH_CONFIG: CrossVenueMarketConfig = {
  namespace: 'autohvh:game',
  dailyKey: 'highF',
  metric: 'high_temp',
  labelSuffix: 'High',
};

export const LVL_CONFIG: CrossVenueMarketConfig = {
  namespace: 'autolvl:game',
  dailyKey: 'lowF',
  metric: 'low_temp',
  labelSuffix: 'Low',
};

async function processCrossVenueGame(
  config: CrossVenueMarketConfig,
  league: SiteLeague,
  g: EnrichedScheduleGame,
  budget: CreationBudget,
  forecasts: VenueForecastMap,
): Promise<AutoMarketOutcome> {
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

  const lockTimeIso = lockTimeBeforeKickoff(g.kickoffUTC);
  if (Date.now() >= new Date(lockTimeIso).getTime()) return { ...base, action: 'skipped', reason: 'past lock time (3 hours before kickoff)' };

  const existingId = await getMappedWagerId(config.namespace, league, g.id);
  if (!existingId) {
    if (budget.remaining <= 0) return { ...base, action: 'skipped', reason: 'creation budget exhausted this run, will retry next tick' };
    budget.remaining--;
    const claimed = await claimGameForCreation(config.namespace, league, g.id);
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
      const homeValue = findDailyValue(homeForecast, gameDateStr, config.dailyKey);
      const awayValue = findDailyValue(awayForecast, gameDateStr, config.dailyKey);
      if (homeValue == null || awayValue == null) {
        return { ...base, action: 'skipped', reason: 'forecast not yet available for this date' };
      }
      // The side assignment is fixed at creation time and never re-decided,
      // only the number moves. See auto-hvl-market.ts's module doc comment
      // for why (a market whose meaning silently flips between runs would
      // be unrecognizable to anyone who already bet it).
      const existingPs = existing as PointspreadWager;
      const aIsHome = Math.abs(existingPs.locationA.lat - g.venue.lat) < SAME_VENUE_TOLERANCE_DEG;
      const aValue = aIsHome ? homeValue : awayValue;
      const bValue = aIsHome ? awayValue : homeValue;
      // A's own favorite/underdog sign can flip run-to-run if the forecast
      // gap narrows past zero, recomputed fresh every time from whichever
      // side is currently greater, same convention as the create path below.
      const magnitude = roundHalfPointFavoringDog(Math.abs(aValue - bValue));
      const signedSpread = aValue >= bValue ? -magnitude : magnitude;

      // ── Bring an existing wager onto the current lock rule (2026-08-27) ──
      //
      // The 3-hour lock shipped 2026-08-26 but only applied to markets this
      // engine CREATED after it. The update path re-priced the line and never
      // touched lockTime, so the whole existing book kept its old convention:
      // measured live, 247 of 262 open pointspreads still locked at 2:00 AM ET
      // and 178 of 188 at-game-start markets still locked 15 minutes out.
      //
      // Both this and existing.lockTime are already known to be in the future
      // at this point (both were checked above), so correcting it can never
      // reopen a market that has closed.
      //
      // Note this DOES overwrite a manual lock-time override on an
      // auto-managed market, on the next tick. That is the cost of the rule
      // being enforced rather than merely applied at creation.
      const lockNeedsFix = existing.lockTime !== lockTimeIso;

      if (existingPs.spread === signedSpread && !lockNeedsFix) return { ...base, action: 'unchanged', wagerId: existing.id };
      await updateWager(existing.id, lockNeedsFix ? { spread: signedSpread, lockTime: lockTimeIso } : { spread: signedSpread });
      return { ...base, action: 'updated', wagerId: existing.id };
    }

    const homeForecast = forecasts.get(g.venue.id);
    const awayForecast = forecasts.get(g.awayVenue.id);
    if (!homeForecast || !awayForecast) {
      return { ...base, action: 'skipped', reason: 'forecast fetch failed for one of these venues this run' };
    }
    const homeValue = findDailyValue(homeForecast, gameDateStr, config.dailyKey);
    const awayValue = findDailyValue(awayForecast, gameDateStr, config.dailyKey);
    if (homeValue == null || awayValue == null) {
      return { ...base, action: 'skipped', reason: 'forecast not yet available for this date' };
    }

    // A = whichever venue has the greater forecasted value for this metric
    // (the natural "favorite," mirrors HvL's own "warmer side" convention,
    // just without the cross-metric High-vs-Low framing).
    const homeIsA = homeValue >= awayValue;
    const aVenue = homeIsA ? g.venue : g.awayVenue;
    const bVenue = homeIsA ? g.awayVenue : g.venue;
    const aValue = homeIsA ? homeValue : awayValue;
    const bValue = homeIsA ? awayValue : homeValue;

    const magnitude = roundHalfPointFavoringDog(aValue - bValue);
    const spread = -magnitude; // locationA favored; negative = A favored (nws-grading.ts convention)

    const aName = aVenue.name;
    const bName = bVenue.name;
    const created = await createWager({
      kind: 'pointspread',
      title: `${aName} ${config.labelSuffix} vs ${bName} ${config.labelSuffix} — Wager on Weather`,
      metric: config.metric,
      metricA: config.metric,
      metricB: config.metric,
      targetDate: gameDateStr,
      lockTime: lockTimeIso,
      locationA: { name: aName, lat: aVenue.lat, lon: aVenue.lon },
      locationB: { name: bName, lat: bVenue.lat, lon: bVenue.lon },
      spread,
      locationAOdds: FIXED_ODDS,
      locationBOdds: FIXED_ODDS,
      autoManaged: true,
    });
    await setMappedWagerId(config.namespace, league, g.id, created.id);
    return { ...base, action: 'created', wagerId: created.id };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error(`[${config.namespace}] ${league} ${g.id} creation error: ${message}`);
    return { ...base, action: 'error', reason: message };
  }
}

/** Sweeps every tracked league's upcoming schedule and creates/re-prices
 * this game's cross-venue same-metric pointspread (HvH or LvL, per
 * `config`) as needed. Bulletproof per-game: one game's failure never
 * blocks the rest. */
export async function runCrossVenuePricingPass(config: CrossVenueMarketConfig): Promise<AutoMarketPassSummary> {
  const summary = emptyPassSummary();
  const budget = newCreationBudget();
  for (const league of LEAGUES) {
    const { games } = await getScheduleGames(league, FORECAST_HORIZON_DAYS, undefined, { lite: true }).catch(() => ({ games: [] as EnrichedScheduleGame[] }));
    const seenIds = new Set<string>();
    const uniqueGames = games.filter((g) => (seenIds.has(g.id) ? false : (seenIds.add(g.id), true)));
    // Fetch every distinct venue's forecast ONCE, concurrently, instead of
    // once per game sequentially inside the loop below, see
    // prefetchVenueForecasts's own doc comment for the 167s MLB run this
    // fixes.
    const forecasts = await prefetchVenueForecasts(uniqueGames, FORECAST_HORIZON_DAYS);
    for (const g of uniqueGames) {
      tallyOutcome(summary, await processCrossVenueGame(config, league, g, budget, forecasts));
    }
  }
  return summary;
}
