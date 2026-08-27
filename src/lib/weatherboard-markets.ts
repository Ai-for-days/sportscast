// ── Weatherboard native-market helpers ──────────────────────────────────────
//
// Shared by WeatherboardTable.astro (the plain, DraftKings-alongside boards)
// and WeatherboardExtendedTable.astro (the detailed, DK-free "Weatherboard
// Extended" boards added 2026-08-23) — both need the same published-wager
// lookup, venue-matching, and pointspread-category logic; extracted here so
// the two boards can never quietly drift out of sync on what counts as
// "this game's High v Low market."

import { getWagersByDate } from './wager-store';
import { isPubliclyVisible } from './public-wager-view';
import { formatAmericanOdds } from './odds';
import { findVenueByCoords, VENUE_COORDINATE_TOLERANCE_DEG } from './venue-data';
import type { Wager, WagerLocation, OverUnderWager, PointspreadWager } from './wager-types';
import type { Venue } from './types';
import type { EnrichedScheduleGame } from './league-schedule';

const ET = 'America/New_York';

export function targetDateOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: ET });
}

/**
 * One Redis fetch per distinct date across a whole table, not per game.
 *
 * Open and locked markets, never graded or voided. Per Derek (2026-08-27),
 * the board is the one public surface where a locked market stays VISIBLE:
 * the three hours before kickoff plus game time are peak interest, and a
 * blank cell there reads as "no market for this game" rather than "this one
 * closed." Callers must render anything isClosedMarket() flags as closed and
 * must not link it, since the market pages themselves stay gated.
 */
export async function getPublishedWagersForGames(games: EnrichedScheduleGame[]): Promise<Wager[]> {
  const uniqueDates = [...new Set(games.map((g) => targetDateOf(g.kickoffUTC)))].filter(Boolean);
  const entries = await Promise.all(uniqueDates.map((d) => getWagersByDate(d).catch(() => [] as Wager[])));
  return entries.flat().filter((w) => w.status === 'open' || w.status === 'locked');
}

/**
 * A market that is on the board but no longer accepting action: locked, or
 * an open record that has drifted past its own lock time. Same predicate the
 * rest of the public surface uses to decide visibility, just used here to
 * decide presentation instead.
 */
export function isClosedMarket(w: Pick<Wager, 'status' | 'lockTime'>): boolean {
  return !isPubliclyVisible(w);
}

const LOCATION_TOLERANCE_DEG = VENUE_COORDINATE_TOLERANCE_DEG;
export function locationMatchesVenue(loc: WagerLocation, venue: Venue | null | undefined): boolean {
  if (!venue) return false;
  return Math.abs(loc.lat - venue.lat) < LOCATION_TOLERANCE_DEG && Math.abs(loc.lon - venue.lon) < LOCATION_TOLERANCE_DEG;
}
function locationsMatch(a: WagerLocation, b: WagerLocation): boolean {
  return Math.abs(a.lat - b.lat) < LOCATION_TOLERANCE_DEG && Math.abs(a.lon - b.lon) < LOCATION_TOLERANCE_DEG;
}
export function isTempMetric(m: string): boolean {
  return m === 'high_temp' || m === 'low_temp' || m === 'actual_temp';
}
export function metricLabel(m: string): string {
  return m === 'high_temp' ? 'High' : m === 'low_temp' ? 'Low' : m === 'actual_temp' ? 'Temp' : m;
}

/** Any published pointspread market touching either of this game's two venues. */
export function pointspreadsForGame(allWagers: Wager[], g: EnrichedScheduleGame): PointspreadWager[] {
  return allWagers.filter((w): w is PointspreadWager =>
    w.kind === 'pointspread' &&
    isTempMetric(w.metricA ?? w.metric) && isTempMetric(w.metricB ?? w.metric) &&
    (locationMatchesVenue(w.locationA, g.venue) || locationMatchesVenue(w.locationA, g.awayVenue) ||
     locationMatchesVenue(w.locationB, g.venue) || locationMatchesVenue(w.locationB, g.awayVenue)),
  );
}

/** Any published over/under market at this specific venue (the away row's own park, or the home row's) — not the whole game, since each side has its own city. */
export function overUndersForVenue(allWagers: Wager[], venue: Venue | null | undefined): OverUnderWager[] {
  if (!venue) return [];
  return allWagers.filter((w): w is OverUnderWager =>
    w.kind === 'over-under' && isTempMetric(w.metric) && locationMatchesVenue(w.location, venue),
  );
}

/** Per Derek (2026-08-23): a pointspread's two sides belong on the away/home
 * team's own rows, not merged into one spanning cell — a bettor looking at
 * the away row wants that side's own line, not the whole market's summary.
 * Returns which side(s) of `w` belong to `venue` — normally just one, but
 * both if it's a same-venue High-vs-Low pointspread (both sides = that venue). */
export function pointspreadSidesForVenue(w: PointspreadWager, venue: Venue | null | undefined): ('A' | 'B')[] {
  if (!venue) return [];
  const sides: ('A' | 'B')[] = [];
  if (locationMatchesVenue(w.locationA, venue)) sides.push('A');
  if (locationMatchesVenue(w.locationB, venue)) sides.push('B');
  return sides;
}

export interface PointspreadEntry {
  wager: PointspreadWager;
  sides: ('A' | 'B')[];
}

export function pointspreadEntriesForVenue(gamePointspreads: PointspreadWager[], venue: Venue | null | undefined): PointspreadEntry[] {
  const entries: PointspreadEntry[] = [];
  for (const w of gamePointspreads) {
    const sides = pointspreadSidesForVenue(w, venue);
    if (sides.length > 0) entries.push({ wager: w, sides });
  }
  return entries;
}

/** Per Derek (2026-08-23): the pointspread column split into 3 on Weatherboard
 * Extended — a bettor comparing two highs shouldn't have to pick that market
 * out of a cross-metric high-vs-low line mixed into the same cell. */
export type DegreeDiffCategory = 'hi-hi' | 'lo-lo' | 'hi-lo';
export function degreeDiffCategory(w: PointspreadWager): DegreeDiffCategory {
  const mA = w.metricA ?? w.metric;
  const mB = w.metricB ?? w.metric;
  if (mA === 'high_temp' && mB === 'high_temp') return 'hi-hi';
  if (mA === 'low_temp' && mB === 'low_temp') return 'lo-lo';
  return 'hi-lo';
}
export function pointspreadsByCategory(gamePointspreads: PointspreadWager[]): Record<DegreeDiffCategory, PointspreadWager[]> {
  const out: Record<DegreeDiffCategory, PointspreadWager[]> = { 'hi-hi': [], 'lo-lo': [], 'hi-lo': [] };
  for (const w of gamePointspreads) out[degreeDiffCategory(w)].push(w);
  return out;
}

/** True when both sides of a pointspread are the SAME city/coordinates (e.g.
 * "Atlanta High vs Atlanta Low") — a different kind of bet than the plain
 * Weatherboard's single "Wager on Weather - HvL" column, which per Derek
 * (2026-08-23) is always the two DIFFERENT venues in this game, warm side's
 * high vs. the other side's low. Same-venue High-v-Low pointspreads still
 * show on Weatherboard Extended's "Degrees HvL" column, just not here. */
export function isCrossVenuePointspread(w: PointspreadWager): boolean {
  return !locationsMatch(w.locationA, w.locationB);
}

/** Per Derek (2026-08-24): "you need the venues in there" — bettors think in
 * terms of ballparks/stadiums, not the wager record's stored location label
 * (which may be a plain city name for an older or manually-created wager).
 * Resolves to the actual tracked venue's name (e.g. "Tropicana Field") by
 * coordinate match when one exists at this location, falling back to
 * whatever name the wager record itself carries otherwise. */
function resolveVenueName(loc: WagerLocation): string {
  return findVenueByCoords(loc.lat, loc.lon)?.name ?? loc.name;
}

/** Per Derek (2026-08-24): each side reads as the full matchup, not just its
 * own number — e.g. "Tropicana Field High Day Temp vs. Comerica Park Low Day
 * Temp -34.5 (-110)" on the High side's row, and the mirrored "Comerica Park
 * Low Day Temp vs. Tropicana Field High Day Temp +34.5 (-110)" on the Low
 * side's row. Venue names always (see resolveVenueName); "Day Temp" is safe
 * to hardcode here since every wager this file handles is filtered to
 * high_temp/low_temp already (see isTempMetric). */
export function formatPointspreadSide(w: PointspreadWager, side: 'A' | 'B'): string {
  const myLoc = side === 'A' ? w.locationA : w.locationB;
  const otherLoc = side === 'A' ? w.locationB : w.locationA;
  const myMetric = metricLabel(side === 'A' ? (w.metricA ?? w.metric) : (w.metricB ?? w.metric));
  const otherMetric = metricLabel(side === 'A' ? (w.metricB ?? w.metric) : (w.metricA ?? w.metric));
  const spreadVal = side === 'A' ? w.spread : -w.spread;
  const spreadStr = spreadVal > 0 ? `+${spreadVal}` : String(spreadVal);
  const odds = side === 'A' ? w.locationAOdds : w.locationBOdds;
  return `${resolveVenueName(myLoc)} ${myMetric} Day Temp vs. ${resolveVenueName(otherLoc)} ${otherMetric} Day Temp ${spreadStr} (${formatAmericanOdds(odds)})`;
}

export function formatPointspreadEntry(w: PointspreadWager, sides: ('A' | 'B')[]): string {
  return sides.map((side) => formatPointspreadSide(w, side)).join(' / ');
}

/** e.g. "Tropicana Field Low Day Temp 75: Over 75 (-175) / Under 75 (+155)".
 * See formatPointspreadSide's doc comment for the venue-naming rationale.
 * `actual_temp` (a by-time market, e.g. the auto-created "at game start"
 * venue O/U, see auto-venue-ou-market.ts) reads "Temp at Game Start"
 * instead of "Temp Day Temp", since it isn't a whole-day aggregate. */
export function formatOverUnderMarket(w: OverUnderWager): string {
  const label = w.metric === 'actual_temp' ? 'Temp at Game Start' : `${metricLabel(w.metric)} Day Temp`;
  return `${resolveVenueName(w.location)} ${label} ${w.line}: Over ${w.line} (${formatAmericanOdds(w.over.odds)}) / Under ${w.line} (${formatAmericanOdds(w.under.odds)})`;
}

/** The plain Weatherboard's single native-market column (2026-08-23 redesign,
 * replacing the earlier 3-way HvH/LvL/HvL split there — that split now lives
 * only on Weatherboard Extended). Cross-venue High-v-Low only. */
export function hvlEntriesForVenue(gamePointspreads: PointspreadWager[], venue: Venue | null | undefined): PointspreadEntry[] {
  const crossVenueHvL = gamePointspreads.filter((w) => degreeDiffCategory(w) === 'hi-lo' && isCrossVenuePointspread(w));
  return pointspreadEntriesForVenue(crossVenueHvL, venue);
}
