// Match pushed sportsbook games to our schedule games (2026-10-13).
//
// The feed's names are not ours: "Middle Tennessee State" there, "Middle
// Tennessee Blue Raiders" here; rankings ride along in the name ("Mississippi
// State (#16)"). A game matches when it is the same league, starts within
// MATCH_WINDOW_MS, and BOTH teams match by name. Names match, best first:
//   3  the same words, or an alias from odds-team-aliases.ts
//   2  our name starts with theirs and what follows is a mascot, not a
//      qualifier that makes it a different school ("Alabama" matches
//      "Alabama Crimson Tide" but never "Alabama State Hornets")
//   1  the same once the feed's "State"/"St" is dropped, the brief's fallback,
//      only ever accepted when the other team matched properly
// Among several candidates (an MLB doubleheader) the nearest start time wins.
// Pure: no Redis, no network.

import { TEAM_ALIASES } from './odds-team-aliases';

export const MATCH_WINDOW_MS = 6 * 3600_000;

/** Words that, right after a school's name, make it a different school. */
const QUALIFIERS = new Set([
  'state', 'st', 'tech', 'am', 'southern', 'northern', 'eastern', 'western', 'central',
  'international', 'christian', 'atlantic', 'poly', 'oh', 'ohio', 'fl', 'florida', 'city',
  'baptist', 'methodist', 'pacific', 'carolina', 'kentucky', 'illinois', 'michigan',
  'tennessee', 'texas', 'georgia', 'alabama', 'mississippi', 'louisiana', 'arizona', 'utah',
  'colorado', 'washington', 'oregon', 'new', 'north', 'south', 'east', 'west', 'a', 'and',
  'united',
]);

export function normName(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(#?\d+\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/a and m/g, 'am')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function words(s: string): string[] {
  return s ? s.split(' ') : [];
}

function dropState(s: string): string {
  return words(s).filter((w) => w !== 'state' && w !== 'st').join(' ');
}

/** How well a feed team name fits one of our team names: 0 no match, else 1-3 (see header). Pure. */
export function nameScore(league: string, feedName: string, ourName: string, feedShortName?: string | null): number {
  const ours = normName(ourName);
  const alias = TEAM_ALIASES[league]?.[normName(feedName)];
  const forms = [normName(feedName), feedShortName ? normName(feedShortName) : '', alias ? normName(alias) : '']
    .filter((f, i, all) => f && all.indexOf(f) === i);
  let best = 0;
  for (const f of forms) {
    if (f === ours) return 3;
    if (alias && f === normName(alias) && (ours.startsWith(f + ' ') || ours === f)) best = Math.max(best, 3);
    const fw = words(f);
    const ow = words(ours);
    if (fw.length < ow.length && fw.every((w, i) => w === ow[i]) && !QUALIFIERS.has(ow[fw.length])) {
      best = Math.max(best, 2);
    }
  }
  // Fallback only for a feed name that itself carries State/St ("Middle
  // Tennessee State" for our "Middle Tennessee"); never the other way round,
  // which would let "Alabama" match "Alabama State".
  if (best === 0 && dropState(normName(feedName)) !== normName(feedName)) {
    const a = dropState(normName(feedName));
    const b = dropState(ours);
    if (a && (a === b || (b.startsWith(a + ' ') && words(a).length >= 1))) best = 1;
  }
  return best;
}

export interface FeedCandidate {
  id: string;
  startTime: number;
  home: string;
  away: string;
  homeShort?: string | null;
  awayShort?: string | null;
}

export interface OurGame {
  homeTeam: string;
  awayTeam: string;
  kickoffUTC: string;
  neutralSite?: boolean;
}

export interface FeedMatch {
  id: string;
  /** The feed lists the teams the other way round (neutral sites only); swap home/away prices. */
  swapped: boolean;
  score: number;
}

/** The feed game for one of our games, or null. Pure. */
export function matchFeedGame(league: string, game: OurGame, candidates: FeedCandidate[]): FeedMatch | null {
  const kickoff = Date.parse(game.kickoffUTC);
  if (!Number.isFinite(kickoff)) return null;
  let best: (FeedMatch & { dt: number }) | null = null;
  for (const c of candidates) {
    const dt = Math.abs(c.startTime - kickoff);
    if (dt > MATCH_WINDOW_MS) continue;
    const orientations: [boolean, number, number][] = [
      [false, nameScore(league, c.home, game.homeTeam, c.homeShort), nameScore(league, c.away, game.awayTeam, c.awayShort)],
    ];
    if (game.neutralSite) {
      orientations.push([true, nameScore(league, c.away, game.homeTeam, c.awayShort), nameScore(league, c.home, game.awayTeam, c.homeShort)]);
    }
    for (const [swapped, h, a] of orientations) {
      if (h === 0 || a === 0) continue;
      if (h === 1 && a === 1) continue; // both on the State-stripping fallback: too loose
      const score = h + a;
      if (!best || score > best.score || (score === best.score && dt < best.dt)) {
        best = { id: c.id, swapped, score, dt };
      }
    }
  }
  return best ? { id: best.id, swapped: best.swapped, score: best.score } : null;
}
