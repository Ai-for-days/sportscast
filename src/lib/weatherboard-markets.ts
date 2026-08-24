// ── Weatherboard native-market helpers ──────────────────────────────────────
//
// Shared by WeatherboardTable.astro (the plain, DraftKings-alongside boards)
// and WeatherboardExtendedTable.astro (the detailed, DK-free "Weatherboard
// Extended" boards added 2026-08-23) — both need the same published-wager
// lookup, venue-matching, and pointspread-category logic; extracted here so
// the two boards can never quietly drift out of sync on what counts as
// "this game's High v Low market."

import { getWagersByDate } from './wager-store';
import { formatAmericanOdds } from './odds';
import type { Wager, WagerLocation, OverUnderWager, PointspreadWager } from './wager-types';
import type { Venue } from './types';
import type { EnrichedScheduleGame } from './league-schedule';

const ET = 'America/New_York';

export function targetDateOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: ET });
}

/** One Redis fetch per distinct date across a whole table, not per game. Open/locked only — same customer-visibility rule as everywhere else. */
export async function getPublishedWagersForGames(games: EnrichedScheduleGame[]): Promise<Wager[]> {
  const uniqueDates = [...new Set(games.map((g) => targetDateOf(g.kickoffUTC)))].filter(Boolean);
  const entries = await Promise.all(uniqueDates.map((d) => getWagersByDate(d).catch(() => [] as Wager[])));
  return entries.flat().filter((w) => w.status === 'open' || w.status === 'locked');
}

const LOCATION_TOLERANCE_DEG = 0.05; // ~3-4 miles — city-centroid vs. exact-venue coordinate slop
export function locationMatchesVenue(loc: WagerLocation, venue: Venue | null | undefined): boolean {
  if (!venue) return false;
  return Math.abs(loc.lat - venue.lat) < LOCATION_TOLERANCE_DEG && Math.abs(loc.lon - venue.lon) < LOCATION_TOLERANCE_DEG;
}
function locationsMatch(a: WagerLocation, b: WagerLocation): boolean {
  return Math.abs(a.lat - b.lat) < LOCATION_TOLERANCE_DEG && Math.abs(a.lon - b.lon) < LOCATION_TOLERANCE_DEG;
}
export function isTempMetric(m: string): boolean {
  return m === 'high_temp' || m === 'low_temp';
}
export function metricLabel(m: string): string {
  return m === 'high_temp' ? 'High' : m === 'low_temp' ? 'Low' : m;
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

export function formatPointspreadSide(w: PointspreadWager, side: 'A' | 'B'): string {
  const loc = side === 'A' ? w.locationA : w.locationB;
  const metric = metricLabel(side === 'A' ? (w.metricA ?? w.metric) : (w.metricB ?? w.metric));
  const spreadVal = side === 'A' ? w.spread : -w.spread;
  const spreadStr = spreadVal > 0 ? `+${spreadVal}` : String(spreadVal);
  const odds = side === 'A' ? w.locationAOdds : w.locationBOdds;
  return `${loc.name} ${metric} ${spreadStr} (${formatAmericanOdds(odds)})`;
}

export function formatPointspreadEntry(w: PointspreadWager, sides: ('A' | 'B')[]): string {
  return sides.map((side) => formatPointspreadSide(w, side)).join(' / ');
}

export function formatOverUnderMarket(w: OverUnderWager): string {
  return `${metricLabel(w.metric)}: O ${w.line} (${formatAmericanOdds(w.over.odds)}) / U ${w.line} (${formatAmericanOdds(w.under.odds)})`;
}

/** The plain Weatherboard's single native-market column (2026-08-23 redesign,
 * replacing the earlier 3-way HvH/LvL/HvL split there — that split now lives
 * only on Weatherboard Extended). Cross-venue High-v-Low only. */
export function hvlEntriesForVenue(gamePointspreads: PointspreadWager[], venue: Venue | null | undefined): PointspreadEntry[] {
  const crossVenueHvL = gamePointspreads.filter((w) => degreeDiffCategory(w) === 'hi-lo' && isCrossVenuePointspread(w));
  return pointspreadEntriesForVenue(crossVenueHvL, venue);
}
