// What the public game page shows from the Bovada feed, and what a click on a
// price does (DBD 2026-11-20, WOW-038). Pure functions, tested in
// tests/game-page-odds.test.ts.
import type { FeedGroup, FeedMarket } from './odds-feed';

/** In-game markets ("Live First Half", "Live 3rd Quarter", ...). We offer no in-game betting. */
export function isLiveMarket(m: FeedMarket): boolean {
  return /^live\b/i.test((m.period?.description ?? '').trim()) || /^live\b/i.test((m.description ?? '').trim());
}

const isOpen = (status: string | null | undefined) => (status ?? 'O') === 'O';

/**
 * The groups with only what a visitor can act on: no in-game markets, no
 * suspended markets, no suspended outcomes, and no market left with no open
 * outcome. Groups that end up empty are dropped.
 */
export function publicGroups(groups: FeedGroup[]): FeedGroup[] {
  return groups
    .map((g) => ({
      ...g,
      markets: g.markets
        .filter((m) => !isLiveMarket(m) && isOpen(m.status))
        .map((m) => ({ ...m, outcomes: m.outcomes.filter((o) => isOpen(o.status)) }))
        .filter((m) => m.outcomes.length > 0),
    }))
    .filter((g) => g.markets.length > 0);
}

export type PriceClick = 'signup' | 'grading-note' | 'closed' | 'wait';

/**
 * What clicking a sportsbook price does.
 * - after kickoff: nothing (betting closed at kickoff);
 * - signed-in state not known yet: nothing;
 * - signed out: the sign-up prompt;
 * - signed in: a note. Sportsbook bets are not graded yet (WOW-036), so the
 *   page does NOT add them to a bet slip.
 */
export function priceClick(signedIn: boolean | null, startTime: number | null | undefined, now = Date.now()): PriceClick {
  if (startTime != null && startTime <= now) return 'closed';
  if (signedIn === null) return 'wait';
  return signedIn ? 'grading-note' : 'signup';
}

export const GRADING_NOTE = 'Game-line betting opens once results grading is live. Weather wagers on this game are open now.';
