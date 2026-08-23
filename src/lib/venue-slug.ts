// ── Venue URL slugs (/venues/weather/{league}/{slug}) ────────────────────
//
// Per Derek (2026-08-23): the slug is the team's MARKET name, not the
// stadium's literal municipality — "Dallas Cowboys" -> "dallas" even though
// AT&T Stadium is in Arlington; "Oklahoma State Cowboys" -> "oklahoma-state"
// even though the campus is in Stillwater. Mechanically, that's "the team
// name with its mascot word(s) stripped off."
//
// Two exceptions to plain mascot-stripping:
//  - Soccer clubs: strip only a generic trailing/leading "FC"/"SC"/"CF"
//    token (matches Derek's own example: "Charlotte FC" -> "charlotte").
//    Everything else in a club's name (United, Dynamo, Galaxy, Sporting,
//    Crew, Current, Dash, Sounders, Reign, Thorns, Wave, Pride, Courage,
//    Spirit...) is treated as real brand identity, not a strippable mascot
//    — which also happens to keep every MLS/NWSL market collision-free
//    without needing a single explicit override (verified against the full
//    venue list below).
//  - A handful of two-word mascots (e.g. "Crimson Tide", "Red Sox") need
//    listing explicitly, or the generic "strip the last word" rule would
//    wrongly leave half the mascot attached to the market name.
//
// The one real structural problem: multiple teams per league sharing a
// market collide onto the same slug once the mascot is stripped (Giants/
// Jets, Rams/Chargers, Yankees/Mets, Cubs/White Sox, Angels/Dodgers — every
// case checked against the full venue-data.ts roster). Per Derek: keep the
// clean market slug everywhere else, and only append the mascot back on for
// these specific collisions (SLUG_OVERRIDES below) rather than doing it
// everywhere.
//
// Venues with no `team` (community fields, and the two special soccer-only
// venues with no home team) aren't part of this new URL scheme at all —
// they keep their existing /venues/{id} URL, since there's no team name to
// derive a market slug from and no real SEO reason to move them.

import type { Venue } from './types';

function slugify(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents (Montréal -> Montreal)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const MULTI_WORD_MASCOTS = [
  'Crimson Tide', 'Red Sox', 'White Sox', 'Blue Jays', 'Yellow Jackets', 'Rainbow Warriors',
  'Fighting Illini', 'Golden Flashes', 'Thundering Herd', 'Blue Raiders',
  'Golden Gophers', 'Tar Heels', 'Mean Green', 'Fighting Irish', 'Nittany Lions',
  'Scarlet Knights', 'Golden Eagles', 'Horned Frogs', 'Red Raiders', 'Green Wave',
  'Golden Hurricane', 'Demon Deacons', 'Ragin\' Cajuns', 'Golden Bears', 'Blue Devils',
  'Wolf Pack', 'Black Knights', 'Sun Devils', 'Red Wolves', 'Blue Hens',
];

/**
 * Soccer clubs get different treatment from every other sport: only a
 * literal "FC"/"SC"/"CF" token is a strippable generic suffix — everything
 * else in a club's name (United, Dynamo, Galaxy, Sporting, Crew, Current,
 * Dash, Sounders, Reign, Thorns, Wave, Pride, Courage, Spirit, Red Bulls...)
 * is real brand identity, not a mascot, and stays. Applying the generic
 * "strip the mascot" rule below to soccer would wrongly chop "LA Galaxy"
 * down to "LA" or "Columbus Crew" down to "Columbus."
 */
function soccerMarketName(team: string): string {
  for (const prefix of ['FC ', 'CF ']) {
    if (team.startsWith(prefix)) return team.slice(prefix.length);
  }
  for (const suffix of [' FC', ' SC', ' CF']) {
    if (team.endsWith(suffix)) return team.slice(0, -suffix.length);
  }
  return team;
}

function marketNameFromTeam(team: string): string {
  for (const mascot of MULTI_WORD_MASCOTS) {
    if (team.endsWith(` ${mascot}`)) return team.slice(0, -(mascot.length + 1));
  }
  const lastSpace = team.lastIndexOf(' ');
  return lastSpace === -1 ? team : team.slice(0, lastSpace);
}

/** Same-league market-name collisions — the mascot stays attached here instead. */
const SLUG_OVERRIDES: Record<string, string> = {
  'mlb-chc': 'chicago-cubs',
  'mlb-cws': 'chicago-white-sox',
  'mlb-laa': 'los-angeles-angels',
  'mlb-lad': 'los-angeles-dodgers',
  'mlb-nym': 'new-york-mets',
  'mlb-nyy': 'new-york-yankees',
  'nfl-lar': 'los-angeles-rams',
  'nfl-lac': 'los-angeles-chargers',
  'nfl-nyg': 'new-york-giants',
  'nfl-nyj': 'new-york-jets',
};

export const LEAGUE_URL_SEGMENT: Record<string, string> = {
  mlb: 'mlb',
  nfl: 'nfl',
  'ncaa-football': 'college-football',
  mls: 'mls',
};

/** Null for venues outside the new scheme (no `team` — community fields and the two team-less soccer venues) — callers should keep the old /venues/{id} URL for those. */
export function getVenueSlug(venue: Venue): string | null {
  if (!venue.team) return null;
  if (SLUG_OVERRIDES[venue.id]) return SLUG_OVERRIDES[venue.id];
  const market = venue.sport === 'soccer' ? soccerMarketName(venue.team) : marketNameFromTeam(venue.team);
  return slugify(market);
}

/** Null when the venue isn't in the new scheme, or its league has no URL segment (community). */
export function getVenueUrlPath(venue: Venue): string | null {
  const segment = venue.league ? LEAGUE_URL_SEGMENT[venue.league] : undefined;
  const slug = getVenueSlug(venue);
  if (!segment || !slug) return null;
  return `/venues/weather/${segment}/${slug}`;
}

export function leagueSegmentToKey(segment: string): string | undefined {
  return Object.entries(LEAGUE_URL_SEGMENT).find(([, seg]) => seg === segment)?.[0];
}

/** Reverse lookup for the /venues/weather/[league]/[city] route. */
export function findVenueBySlug(venues: Venue[], leagueSegment: string, slug: string): Venue | undefined {
  const league = leagueSegmentToKey(leagueSegment);
  if (!league) return undefined;
  return venues.find((v) => v.league === league && getVenueSlug(v) === slug);
}

/** A venue's canonical URL — the new scheme when it has one, the old /venues/{id} otherwise (community fields, and the two team-less soccer venues). */
export function getVenueHref(venue: Venue): string {
  return getVenueUrlPath(venue) ?? `/venues/${venue.id}`;
}
