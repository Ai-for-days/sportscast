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

import { getForecast } from './weather-queries';
import { getGameWindowForecast } from './mlb-game-forecast';
import { createWager, updateWager, getWager } from './wager-store';
import { getScheduleGames, type SiteLeague, type EnrichedScheduleGame } from './league-schedule';
import type { OverUnderWager } from './wager-types';
import type { Venue } from './types';
import {
  ET, LEAGUES, FORECAST_HORIZON_DAYS, FIXED_ODDS, SAME_VENUE_TOLERANCE_DEG,
  gameEtDateStr, roundHalfPointAvoidingPush, etWallClockHHMM,
  getMappedWagerId, claimGameForCreation, setMappedWagerId,
  emptyPassSummary, tallyOutcome,
  type AutoMarketOutcome, type AutoMarketPassSummary,
} from './auto-market-shared';

export type VenueSide = 'home' | 'away';

function namespaceFor(side: VenueSide): string {
  return side === 'home' ? 'autoou:home:game' : 'autoou:away:game';
}

async function processVenueOUGame(side: VenueSide, league: SiteLeague, g: EnrichedScheduleGame): Promise<AutoMarketOutcome> {
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
  if (!existingId) {
    const claimed = await claimGameForCreation(namespace, league, g.id);
    if (!claimed) return { ...base, action: 'skipped', reason: 'lost creation race (already claimed)' };
  }

  try {
    const forecast = await getForecast(venue.lat, venue.lon, FORECAST_HORIZON_DAYS);
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
    return { ...base, action: 'error', reason: err?.message ?? 'unknown error' };
  }
}

/** Sweeps every tracked league's upcoming schedule and creates/re-prices
 * the home-venue and away-venue "Temp at Game Start" O/U markets as needed.
 * Bulletproof per-game — one game's failure never blocks the rest. */
export async function runVenueOUPricingPass(): Promise<AutoMarketPassSummary> {
  const summary = emptyPassSummary();
  for (const league of LEAGUES) {
    const { games } = await getScheduleGames(league, FORECAST_HORIZON_DAYS).catch(() => ({ games: [] as EnrichedScheduleGame[] }));
    const seenIds = new Set<string>();
    const uniqueGames = games.filter((g) => (seenIds.has(g.id) ? false : (seenIds.add(g.id), true)));
    for (const g of uniqueGames) {
      tallyOutcome(summary, await processVenueOUGame('home', league, g));
      tallyOutcome(summary, await processVenueOUGame('away', league, g));
    }
  }
  return summary;
}
