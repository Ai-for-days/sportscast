// "Place a Bet" sidebar: how long a game stays up, which prices it shows, and
// its score. DBD 2026-11-21: "leave the scores and lines and odds up until 6am
// eastern the next day".
//
// - A game stays until 6 AM ET after its game day (the same 6 AM-to-6 AM day the
//   Weatherboard uses), then drops off. The feed store keeps summaries 36 h
//   after kickoff, always longer than this, so the filter here decides.
// - Lines never go blank once a game starts: in-game prices are used where
//   Bovada posts them, the pre-game line fills any market it has suspended,
//   and a finished game shows its pre-game (closing) line.
// - The score comes from the ESPN schedule the Weatherboard already reads.
import { startOfGameDayET } from './mlb-schedule';
import type { FeedLines } from './odds-feed';
import { matchFeedGame } from './odds-feed-match';

const HOUR = 3600_000;

/** Epoch ms of 6 AM ET after the game day `startTime` falls in. */
export function sidebarKeepUntil(startTime: number): number {
  const dayStart = startOfGameDayET(new Date(startTime));
  // Noon the next day is always inside the next game day, whatever DST does.
  return startOfGameDayET(new Date(dayStart + 30 * HOUR));
}

export function keepOnSidebar(startTime: number, nowMs = Date.now()): boolean {
  return nowMs < sidebarKeepUntil(startTime);
}

type Lines = Pick<FeedLines, 'moneylineAway' | 'moneylineHome' | 'spreadAway' | 'spreadHome' | 'total'>;

/** The prices to show. `final` = the game is over (pre-game line only). */
export function sidebarLines(pre: Lines | null, live: Lines | null, started: boolean, final: boolean): { lines: Lines | null; live: boolean } {
  if (!started || final || !live) return { lines: pre ?? (final ? null : live), live: false };
  if (!pre) return { lines: live, live: true };
  const ml = live.moneylineAway !== null && live.moneylineHome !== null;
  return {
    lines: {
      moneylineAway: ml ? live.moneylineAway : pre.moneylineAway,
      moneylineHome: ml ? live.moneylineHome : pre.moneylineHome,
      spreadAway: live.spreadAway && live.spreadHome ? live.spreadAway : pre.spreadAway,
      spreadHome: live.spreadAway && live.spreadHome ? live.spreadHome : pre.spreadHome,
      total: live.total ?? pre.total,
    },
    live: true,
  };
}

export interface SidebarScore {
  away: number | null;
  home: number | null;
  state: 'pre' | 'in' | 'post';
  /** ESPN's short status, e.g. "Final", "Q2 10:16", "Halftime". */
  detail: string;
}

interface SchedGame { homeTeam: string; awayTeam: string; kickoffUTC: string; state: 'pre' | 'in' | 'post'; statusDetail: string; homeScore: number | null; awayScore: number | null; neutralSite?: boolean }
interface FeedCand { id: string; startTime: number; home: string; away: string; homeShort: string | null; awayShort: string | null }

/** Feed game id -> score, matched by the same name-and-kickoff rule as the boards. Pure. */
export function scoresByFeedId(league: string, sched: SchedGame[], feed: FeedCand[]): Map<string, SidebarScore> {
  const out = new Map<string, SidebarScore>();
  for (const g of sched) {
    if (g.state === 'pre') continue;
    const m = matchFeedGame(league, g, feed);
    if (!m || out.has(m.id)) continue;
    out.set(m.id, {
      away: m.swapped ? g.homeScore : g.awayScore,
      home: m.swapped ? g.awayScore : g.homeScore,
      state: g.state,
      detail: g.statusDetail || (g.state === 'post' ? 'Final' : 'Live'),
    });
  }
  return out;
}
