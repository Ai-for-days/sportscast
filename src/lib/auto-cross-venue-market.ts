// ── Automated "Degrees HvH" / "Degrees LvL" pricing engine ──────────────────
//
// Added 2026-08-25 per Derek: alongside the existing "Wager on Weather -
// HvL" auto-market (auto-hvl-market.ts), automatically publish and keep
// re-pricing two more cross-venue pointspreads per game — the two teams'
// own daily HIGHS against each other ("Degrees HvH"), and their own daily
// LOWS against each other ("Degrees LvL"). These feed the "Degree Diff:
// High v High" / "Low v Low" columns Weatherboard Extended has shown since
// the 2026-08-23 redesign (see weatherboard-markets.ts's
// degreeDiffCategory()) — previously only ever populated by an
// operator-created wager, never auto-priced.
//
// One parametrized engine (see CrossVenueMarketConfig below) instead of two
// near-duplicate files: HvH and LvL differ only in which daily value both
// sides compare (highF vs lowF) and their display labels — everything else
// (dedup/claim, side-assignment convention, lock timing, safety rails) must
// stay identical, and duplicating ~100 lines of that logic in two files
// would let a future fix land in one copy and not the other.
//
// Same deliberate, scoped exception to "market creation is always
// operator-initiated" as the original HvL engine (see CLAUDE.md §Safety
// model) — narrow, documented, per explicit instruction. Odds fixed at
// -110/-110 both sides, no vig modeling, matching every other auto-managed
// market.

import { createWager, updateWager, getWager, localTimeToUTC } from './wager-store';
import { getScheduleGames, type SiteLeague, type EnrichedScheduleGame } from './league-schedule';
import type { PointspreadWager, WagerMetric } from './wager-types';
import {
  ET, LEAGUES, FORECAST_HORIZON_DAYS, FIXED_ODDS, SAME_VENUE_TOLERANCE_DEG,
  gameEtDateStr, roundHalfPointFavoringDog, findDailyValue, prefetchVenueForecasts,
  getMappedWagerId, claimGameForCreation, setMappedWagerId, markPermanentlyUnsupported, PERMANENT_FAILURE_SENTINEL,
  emptyPassSummary, tallyOutcome, newCreationBudget,
  type AutoMarketOutcome, type AutoMarketPassSummary, type CreationBudget, type VenueForecastMap,
} from './auto-market-shared';

export interface CrossVenueMarketConfig {
  /** Redis mapping namespace — must be unique per market type. */
  namespace: string;
  /** Which daily value both sides compare. */
  dailyKey: 'highF' | 'lowF';
  metric: WagerMetric;
  /** e.g. "High" / "Low" — used in the auto-generated title. */
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

  const gameDateStr = gameEtDateStr(g.kickoffUTC);
  if (!gameDateStr) return { ...base, action: 'skipped', reason: 'invalid kickoff time' };

  const lockTimeIso = localTimeToUTC(gameDateStr, '02:00', ET).toISOString();
  if (Date.now() >= new Date(lockTimeIso).getTime()) return { ...base, action: 'skipped', reason: 'past 2am ET lock time' };

  const existingId = await getMappedWagerId(config.namespace, league, g.id);
  if (existingId === PERMANENT_FAILURE_SENTINEL) {
    return { ...base, action: 'skipped', reason: 'permanently unsupported location (e.g. non-US venue NWS can\'t resolve) — cached, not retried' };
  }
  if (!existingId) {
    if (budget.remaining <= 0) return { ...base, action: 'skipped', reason: 'creation budget exhausted this run — will retry next tick' };
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
      // The side assignment is fixed at creation time and never re-decided —
      // only the number moves. See auto-hvl-market.ts's module doc comment
      // for why (a market whose meaning silently flips between runs would
      // be unrecognizable to anyone who already bet it).
      const existingPs = existing as PointspreadWager;
      const aIsHome = Math.abs(existingPs.locationA.lat - g.venue.lat) < SAME_VENUE_TOLERANCE_DEG;
      const aValue = aIsHome ? homeValue : awayValue;
      const bValue = aIsHome ? awayValue : homeValue;
      // A's own favorite/underdog sign can flip run-to-run if the forecast
      // gap narrows past zero — recomputed fresh every time from whichever
      // side is currently greater, same convention as the create path below.
      const magnitude = roundHalfPointFavoringDog(Math.abs(aValue - bValue));
      const signedSpread = aValue >= bValue ? -magnitude : magnitude;

      if (existingPs.spread === signedSpread) return { ...base, action: 'unchanged', wagerId: existing.id };
      await updateWager(existing.id, { spread: signedSpread });
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
    // (the natural "favorite" — mirrors HvL's own "warmer side" convention,
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
    // Found live 2026-08-25: this was ALWAYS Toronto (Rogers Centre, Canada
    // — outside NWS's US-only coverage), and without this check every run
    // burned its ENTIRE creation budget retrying the same permanently
    // doomed games, starving every other MLB game that would have
    // succeeded. Only mark permanent for a brand-new creation that fails
    // this specific "NWS can't resolve this location at all" way — a
    // re-price error on an EXISTING wager (existingId truthy) is a
    // different, likely-transient problem and must not poison the mapping.
    if (!existingId && /NWS (points|stations) API failed: 404|No observation stations found/.test(message)) {
      await markPermanentlyUnsupported(config.namespace, league, g.id);
      return { ...base, action: 'skipped', reason: `permanently unsupported location, cached: ${message}` };
    }
    return { ...base, action: 'error', reason: message };
  }
}

/** Sweeps every tracked league's upcoming schedule and creates/re-prices
 * this game's cross-venue same-metric pointspread (HvH or LvL, per
 * `config`) as needed. Bulletproof per-game — one game's failure never
 * blocks the rest. */
export async function runCrossVenuePricingPass(config: CrossVenueMarketConfig): Promise<AutoMarketPassSummary> {
  // Temporary timing instrumentation (2026-08-25): HvH/LvL's first-ever
  // population sweep is still failing (odd "status 0" in Vercel logs, not
  // a clean 504) even after the 300s timeout bump and a 12-per-run
  // creation budget — logging elapsed time per league here so the NEXT
  // failure's Vercel runtime logs show exactly where the time goes instead
  // of guessing again. Safe to remove once the cause is confirmed.
  const t0 = Date.now();
  const summary = emptyPassSummary();
  const budget = newCreationBudget();
  for (const league of LEAGUES) {
    const tLeague = Date.now();
    const { games } = await getScheduleGames(league, FORECAST_HORIZON_DAYS, undefined, { lite: true }).catch(() => ({ games: [] as EnrichedScheduleGame[] }));
    const seenIds = new Set<string>();
    const uniqueGames = games.filter((g) => (seenIds.has(g.id) ? false : (seenIds.add(g.id), true)));
    // Fetch every distinct venue's forecast ONCE, concurrently, instead of
    // once per game sequentially inside the loop below — see
    // prefetchVenueForecasts's own doc comment for the 167s MLB run this
    // fixes.
    const forecasts = await prefetchVenueForecasts(uniqueGames, FORECAST_HORIZON_DAYS);
    console.log(`[${config.namespace}] ${league}: schedule fetch + venue prefetch ${Date.now() - tLeague}ms, ${games.length} games, ${forecasts.size} venues, budget remaining=${budget.remaining}, total elapsed=${Date.now() - t0}ms`);
    for (const g of uniqueGames) {
      tallyOutcome(summary, await processCrossVenueGame(config, league, g, budget, forecasts));
    }
    console.log(`[${config.namespace}] ${league}: done processing, budget remaining=${budget.remaining}, total elapsed=${Date.now() - t0}ms`);
  }
  console.log(`[${config.namespace}] DONE total=${Date.now() - t0}ms created=${summary.created} updated=${summary.updated} unchanged=${summary.unchanged} skipped=${summary.skipped} errors=${summary.errors}`);
  return summary;
}
