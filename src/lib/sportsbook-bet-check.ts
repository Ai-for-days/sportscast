// Server-side check of a sportsbook bet leg against the lines we actually hold
// (DBD 2026-11-20, before adding players to the sportsbook).
//
// /api/bets/place used to accept whatever odds the browser sent, for any game
// id, at any time. Two problems, both found on 2026-11-19/20:
//   1. A player could edit the request and bet Colts +5000.
//   2. The D1 watch saw a game keep showing as "live" for over an hour after it
//      was almost certainly over, with frozen prices (no status or score in the
//      feed). A frozen live price on a finished game is a sure win.
// So a leg is accepted only when: the game is in the feed, it has NOT started,
// the lines are recent, and the side's price and point match ours exactly.
// Live (in-game) betting is therefore off until the feed carries a game status.

import type { FeedLines } from './odds-feed';
import type { FeedSummary } from './odds-feed-store';

export interface BetLegInput {
  gameId: string;
  oddsType: 'moneyline' | 'spread' | 'total';
  side: 'away' | 'home' | 'over' | 'under';
  odds: number;
  line?: number;
}

/** Lines older than this are not bet on: the push from Bovada may have stopped. */
export const MAX_LINE_AGE_MS = 60 * 60 * 1000;

export type LegCheck =
  | { ok: true; odds: number; line?: number; startTime: number; description: string }
  | { ok: false; status: number; error: string; current?: { odds: number; line?: number } };

export function currentPrice(lines: FeedLines | null, oddsType: BetLegInput['oddsType'], side: BetLegInput['side']): { odds: number; line?: number } | null {
  if (!lines) return null;
  if (oddsType === 'moneyline') {
    const v = side === 'home' ? lines.moneylineHome : side === 'away' ? lines.moneylineAway : null;
    return v == null ? null : { odds: v };
  }
  if (oddsType === 'spread') {
    const s = side === 'home' ? lines.spreadHome : side === 'away' ? lines.spreadAway : null;
    return s ? { odds: s.price, line: s.point } : null;
  }
  const t = lines.total;
  if (!t || (side !== 'over' && side !== 'under')) return null;
  return { odds: side === 'over' ? t.overPrice : t.underPrice, line: t.point };
}

export function checkLeg(leg: BetLegInput, summary: FeedSummary | null, now = Date.now()): LegCheck {
  if (!summary) return { ok: false, status: 404, error: 'That game is not on the board.' };
  if (summary.startTime <= now) {
    return { ok: false, status: 409, error: 'This game has started. Betting closed at kickoff.' };
  }
  const freshAt = Math.max(summary.seenAt ?? 0, summary.fullAt ?? 0);
  if (!freshAt || now - freshAt > MAX_LINE_AGE_MS) {
    return { ok: false, status: 409, error: 'These lines are out of date. Try again in a few minutes.' };
  }
  // Pre-game lines only (WOW-036 review finding 6): never price from the live
  // (in-game) push, and refuse lines that are themselves marked live, even if the
  // listed start time is still ahead (a stale or moved kickoff). liveAt is NOT
  // used as a refusal: Bovada's live flag means "live betting will be offered",
  // not "the game has started", so it can be set on games that have not begun.
  const pre = summary.lines && !summary.lines.live ? summary.lines : null;
  if (!pre) return { ok: false, status: 409, error: 'That bet is not offered right now.' };
  const cur = currentPrice(pre, leg.oddsType, leg.side);
  if (!cur) return { ok: false, status: 409, error: 'That bet is not offered right now.' };
  const lineMatches = cur.line === undefined || leg.line === cur.line;
  if (leg.odds !== cur.odds || !lineMatches) {
    const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    const nowStr = cur.line !== undefined ? `${leg.oddsType === 'total' ? cur.line : fmt(cur.line)} (${fmt(cur.odds)})` : fmt(cur.odds);
    return { ok: false, status: 409, error: `The line has moved. It is now ${nowStr}. Re-add the bet at the new price.`, current: cur };
  }
  return { ok: true, odds: cur.odds, line: cur.line, startTime: summary.startTime, description: summary.description };
}
