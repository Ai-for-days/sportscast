// Pitch orientation for MLS/NWSL venues — unlike MLB's surveyed
// stadium-orientations.json (a precise bearing) or football's simple
// team-list rule (Derek's own stated knowledge), this is the result of a
// best-effort web research pass per Derek's request 2026-08-22, since no
// rule or survey data existed for soccer anywhere in this codebase.
//
// src/data/soccer-stadium-orientations.json intentionally only covers
// venues where a real source could be found describing (or closely
// approximating) a north-south or east-west long axis. Two categories of
// venue are DELIBERATELY LEFT OUT rather than guessed:
//  - Genuinely diagonal stadiums (several sources described a
//    northeast-southwest or northwest-southeast axis) — forcing one into
//    this binary north-south/east-west model would misrepresent it, not
//    just approximate it.
//  - Venues with no confirmable source at all, or contradictory sources.
// A venue missing from the JSON file gets `null` here, and venue pages
// fall back to the plain (non-diagram) forecast table — the same honest
// treatment as any other venue with no orientation data.
//
// Confidence varies even among the included venues: some had an explicit,
// specific statement (e.g. "the field runs north to south"); others are
// inferred from a repeated boilerplate phrase used across many stadium fan
// pages, where only the specific category (not the exact wording) is
// venue-specific. Treat this file as a reasonable best effort, not a
// surveyed fact like MLB's stadium-orientations.json — happy to revisit any
// specific venue with better information.

import soccerOrientationsRaw from '../data/soccer-stadium-orientations.json';

export type SoccerFieldAxis = 'east-west' | 'north-south';

const soccerOrientations = soccerOrientationsRaw as Record<string, SoccerFieldAxis>;

/** Null when this venue's orientation isn't confirmed (see file comment above) — callers should fall back to a non-diagram display in that case. */
export function getSoccerFieldAxis(venueId: string): SoccerFieldAxis | null {
  return soccerOrientations[venueId] ?? null;
}
