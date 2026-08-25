// ── Automated per-venue "Temp at Game Start" O/U pricing engine ─────────────
//
// Added 2026-08-25 per Derek: for every tracked game, automatically publish
// and keep re-pricing TWO over/under markets — one for the home team's own
// venue, one for the away team's own venue — on the temperature forecast at
// the exact instant the game starts. Feeds the "O/U at Venue" column
// Weatherboard Extended has shown since the 2026-08-23 redesign (see
// weatherboard-markets.ts's overUndersForVenue()) — previously only ever
// populated by an operator-created wager.
//
// "At game start" is ONE real-world UTC instant (g.kickoffUTC) applied to
// BOTH venues' own forecasts — per Derek (2026-08-25): "it should be time
// 'at start of game' because it holds true for all 4 sports, but it is the
// temp at that venue eastern time when the game starts." Concretely: the
// wager's stored `targetTime` is that instant's ET wall-clock time (the
// site's canonical reference clock, same as every lock-time display
// elsewhere), and `location.timeZone` is forced to ET (not each venue's own
// real zone) so nws-grading.ts's targetDate+targetTime+timeZone round-trip
// reconstructs the exact same kickoff instant for grading, regardless of
// which physical venue the wager is for. See auto-market-shared.ts's
// etWallClockHHMM() doc comment for the same reasoning.
//
// The pricing side reuses mlb-game-forecast.ts's getGameWindowForecast()
// (a fully generic hourly-interpolation helper despite its filename/module
// framing) with hoursAfter=0 to get the interpolated forecast temp exactly
// at kickoff — the same mechanism that already powers firstPitchWeather and
// weatherNarrative for the live Weatherboard/Wager Schedule.
//
// Away-side wagers are skipped when both teams share one venue — the
// home-side wager already covers it, and a second identical O/U on the same
// venue/date/time would be a pure duplicate.
//
// Same deliberate, scoped exception to "market creation is always
// operator-initiated" as the HvL/HvH/LvL engines (see CLAUDE.md §Safety
// model) — narrow, documented, per explicit instruction. Odds fixed at
// -110/-110 both sides, no vig modeling, matching every other auto-managed
// market. Line is rounded to the nearest half-degree, never a whole number,
// so a push is never possible (see roundHalfPointAvoidingPush).

import { getGameWindowForecast } from './mlb-game-forecast';
import { createWager, updateWager, getWager } from './wager-store';
import { getScheduleGames, type SiteLeague, type EnrichedScheduleGame } from './league-schedule';
import type { OverUnderWager } from './wager-types';
import type { Venue } from './types';
import {
  ET, LEAGUES, FORECAST_HORIZON_DAYS, FIXED_ODDS, SAME_VENUE_TOLERANCE_DEG,
  gameEtDateStr, roundHalfPointAvoidingPush, etWallClockHHMM, prefetchVenueForecasts,
  getMappedWagerId, claimGameForCreation, setMappedWagerId, markPermanentlyUnsupported, PERMANENT_FAILURE_SENTINEL,
  emptyPassSummary, tallyOutcome, newCreationBudget,
  type AutoMarketOutcome, type AutoMarketPassSummary, type CreationBudget, type VenueForecastMap,
} from './auto-market-shared';

export type VenueSide = 'home' | 'away';

function namespaceFor(side: VenueSide): string {
  return side === 'home' ? 'autoou:home:game' : 'autoou:away:game';
}

async function processVenueOUGame(side: VenueSide, league: SiteLeague, g: EnrichedScheduleGame, budget: CreationBudget, forecasts: VenueForecastMap): Promise<AutoMarketOutcome> {
  const base = { league, gameId: g.id };
  if (g.state !== 'pre') return { ...base, action: 'skipped', reason: 'not pre-game' };

  const venue: Venue | null = side === 'home' ? g.venue : g.awayVenue;
  if (!venue) return { ...base, action: 'skipped', reason: 'missing venue data' };

  if (side === 'away' && g.venue && g.awayVenue
      && Math.abs(g.venue.lat - g.awayVenue.lat) < SAME_VENUE_TOLERANCE_DEG
      && Math.abs(g.venue.lon - g.awayVenue.lon) < SAME_VENUE_TOLERANCE_DEG) {
    return { ...base, action: 'skipped', reason: 'both teams share one venue — home side already covers it' };
  }

  const gameDateStr = gameEtDateStr(g.kickoffUTC);
  if (!gameDateStr) return { ...base, action: 'skipped', reason: 'invalid kickoff time' };

  const kickoffMs = Date.parse(g.kickoffUTC);
  if (!Number.isFinite(kickoffMs)) return { ...base, action: 'skipped', reason: 'invalid kickoff time' };

  // Lock 15 minutes before the literal game-start instant — no timezone
  // round-trip needed here since we already hold the exact UTC instant.
  const lockTimeIso = new Date(kickoffMs - 15 * 60_000).toISOString();
  if (Date.now() >= new Date(lockTimeIso).getTime()) return { ...base, action: 'skipped', reason: 'past lock time (15 min before game start)' };

  const namespace = namespaceFor(side);
  const existingId = await getMappedWagerId(namespace, league, g.id);
  if (existingId === PERMANENT_FAILURE_SENTINEL) {
    return { ...base, action: 'skipped', reason: 'permanently unsupported location (e.g. non-US venue NWS can\'t resolve) — cached, not retried' };
  }
  if (!existingId) {
    if (budget.remaining <= 0) return { ...base, action: 'skipped', reason: 'creation budget exhausted this run — will retry next tick' };
    budget.remaining--;
    const claimed = await claimGameForCreation(namespace, league, g.id);
    if (!claimed) return { ...base, action: 'skipped', reason: 'lost creation race (already claimed)' };
  }

  try {
    const forecast = forecasts.get(venue.id);
    if (!forecast) return { ...base, action: 'skipped', reason: 'forecast fetch failed for this venue this run' };
    const slot = getGameWindowForecast(forecast.hourly, g.kickoffUTC, forecast.utcOffsetSeconds, 0, 60)[0];
    if (!slot) return { ...base, action: 'skipped', reason: 'forecast does not reach game start yet' };
    const line = roundHalfPointAvoidingPush(slot.tempF);

    if (existingId) {
      const existing = await getWager(existingId);
      if (!existing || existing.kind !== 'over-under' || !(existing as OverUnderWager).autoManaged) {
        return { ...base, action: 'skipped', reason: 'mapped wager missing or not auto-managed' };
      }
      if (existing.status !== 'open') return { ...base, action: 'skipped', reason: `wager already ${existing.status}`, wagerId: existing.id };
      if (Date.now() >= new Date(existing.lockTime).getTime()) return { ...base, action: 'skipped', reason: 'past lock time', wagerId: existing.id };

      const existingOu = existing as OverUnderWager;
      if (existingOu.line === line) return { ...base, action: 'unchanged', wagerId: existing.id };
      await updateWager(existing.id, { line });
      return { ...base, action: 'updated', wagerId: existing.id };
    }

    const created = await createWager({
      kind: 'over-under',
      title: `${venue.name} Temp at Game Start`,
      metric: 'actual_temp',
      targetDate: gameDateStr,
      targetTime: etWallClockHHMM(g.kickoffUTC),
      lockTime: lockTimeIso,
      location: { name: venue.name, lat: venue.lat, lon: venue.lon, timeZone: ET },
      line,
      over: { odds: FIXED_ODDS },
      under: { odds: FIXED_ODDS },
      autoManaged: true,
    });
    await setMappedWagerId(namespace, league, g.id, created.id);
    return { ...base, action: 'created', wagerId: created.id };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    // See auto-cross-venue-market.ts's identical check for why: a non-US
    // venue (Toronto/MLS-Canada teams) can never resolve an NWS station,
    // so without this a doomed game would burn budget forever.
    if (!existingId && /NWS (points|stations) API failed: 404|No observation stations found/.test(message)) {
      await markPermanentlyUnsupported(namespace, league, g.id);
      return { ...base, action: 'skipped', reason: `permanently unsupported location, cached: ${message}` };
    }
    return { ...base, action: 'error', reason: message };
  }
}

/** Sweeps every tracked league's upcoming schedule and creates/re-prices
 * the home-venue and away-venue "Temp at Game Start" O/U markets as needed.
 * Bulletproof per-game — one game's failure never blocks the rest. */
export async function runVenueOUPricingPass(): Promise<AutoMarketPassSummary> {
  const summary = emptyPassSummary();
  const budget = newCreationBudget();
  for (const league of LEAGUES) {
    const { games } = await getScheduleGames(league, FORECAST_HORIZON_DAYS, undefined, { lite: true }).catch(() => ({ games: [] as EnrichedScheduleGame[] }));
    const seenIds = new Set<string>();
    const uniqueGames = games.filter((g) => (seenIds.has(g.id) ? false : (seenIds.add(g.id), true)));
    // One fetch per unique venue in this league, concurrently, instead of
    // once per game sequentially — see prefetchVenueForecasts's doc comment.
    const forecasts = await prefetchVenueForecasts(uniqueGames, FORECAST_HORIZON_DAYS);
    for (const g of uniqueGames) {
      tallyOutcome(summary, await processVenueOUGame('home', league, g, budget, forecasts));
      tallyOutcome(summary, await processVenueOUGame('away', league, g, budget, forecasts));
    }
  }
  return summary;
}
