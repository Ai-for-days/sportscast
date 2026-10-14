// Where the Weatherboard's sportsbook lines come from (2026-10-13).
//
// ODDS_SOURCE=bovada (the default): prices from the feed Derek's scraper
// pushes to /api/odds/ingest (odds-feed*.ts). Rotation numbers still come from
// The Odds API, which the feed does not carry; that call costs what it always
// did. ODDS_SOURCE=oddsapi: the previous behaviour, The Odds API for
// everything. One environment change flips between them, for when the scraper
// is down or the feed's site changes.
//
// Staleness: a feed game not confirmed within FEED_STALE_MS shows no line
// rather than an old number. In-game lines need a much fresher confirmation
// (LIVE_STALE_MS); past that the row falls back to the pre-game view.
//
// Until the feed has delivered anything at all (first deploy, before the
// scraper's token is set), the board keeps using The Odds API so the switch
// does not open with an empty board.

import { getGameLines, oddsApiConfigured, type GameLines } from './sportsbook-odds';
import { getFeedSummaries, getLastIngest, type FeedSummary } from './odds-feed-store';
import { matchFeedGame, type OurGame } from './odds-feed-match';
import { recordSourceFailure } from './data-source-health';
import type { FeedLines } from './odds-feed';

export type OddsSource = 'bovada' | 'oddsapi';

export const FEED_STALE_MS = 45 * 60_000;
export const LIVE_STALE_MS = 3 * 60_000;

export function oddsSource(): OddsSource {
  const v = String((import.meta as any).env?.ODDS_SOURCE ?? (typeof process !== 'undefined' ? process.env?.ODDS_SOURCE : '') ?? '')
    .trim()
    .toLowerCase();
  return v === 'oddsapi' ? 'oddsapi' : 'bovada';
}

function swapSides(l: FeedLines): FeedLines {
  return {
    ...l,
    moneylineHome: l.moneylineAway,
    moneylineAway: l.moneylineHome,
    spreadHome: l.spreadAway,
    spreadAway: l.spreadHome,
  };
}

/**
 * The lines to show for one matched feed game, or null when stale. Pure.
 * A started game with a recent in-game update shows those prices, flagged
 * live; otherwise the latest full-scrape lines if confirmed recently.
 */
export function chooseFeedLines(s: FeedSummary, nowMs = Date.now()): FeedLines | null {
  const started = s.startTime <= nowMs;
  const liveSeen = s.liveSeenAt ?? s.liveAt;
  if (started && s.liveLines && liveSeen && nowMs - liveSeen <= LIVE_STALE_MS) {
    return { ...s.liveLines, live: true, lastUpdate: new Date(s.liveAt ?? liveSeen).toISOString() };
  }
  if (s.lines && nowMs - s.seenAt <= FEED_STALE_MS) {
    return { ...s.lines, live: started && s.lines.live, lastUpdate: new Date(s.fullAt ?? s.seenAt).toISOString() };
  }
  return null;
}

/** Feed lines for one league's games, matched by name and kickoff, plus Odds API rotation numbers. */
async function feedLines(league: string, games: OurGame[]): Promise<(GameLines | null)[]> {
  const now = Date.now();
  const [summaries, rotations] = await Promise.all([
    getFeedSummaries(league),
    oddsApiConfigured()
      ? Promise.all(games.map((g) => getGameLines(league, g.homeTeam, g.awayTeam, g.kickoffUTC).catch(() => null)))
      : Promise.resolve(games.map(() => null)),
  ]);
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const candidates = summaries.map((s) => ({ id: s.id, startTime: s.startTime, home: s.home, away: s.away, homeShort: s.homeShort, awayShort: s.awayShort }));
  return games.map((g, i) => {
    const m = matchFeedGame(league, g, candidates);
    const s = m ? byId.get(m.id) : undefined;
    let lines = s ? chooseFeedLines(s, now) : null;
    if (lines && m?.swapped) lines = swapSides(lines);
    const rot = rotations[i];
    if (!lines) {
      // Rotation numbers survive without prices; the board already renders a
      // lines object carrying only the two numbers (see rotation-numbers.ts).
      return rot && (rot.homeRotation || rot.awayRotation)
        ? { ...rot, moneylineHome: null, moneylineAway: null, spreadHome: null, spreadAway: null, total: null, feedGameId: s?.id ?? null }
        : null;
    }
    return { ...lines, homeRotation: rot?.homeRotation ?? null, awayRotation: rot?.awayRotation ?? null, feedGameId: lines.feedGameId };
  });
}

/** Board lines for a league's games, from whichever source is selected. */
export async function getBoardLines(league: string, games: OurGame[]): Promise<(GameLines | null)[]> {
  if (oddsSource() === 'bovada') {
    const last = await getLastIngest();
    if (last) {
      if (Date.now() - last.at > FEED_STALE_MS) {
        void recordSourceFailure('odds-feed', `no odds push for ${Math.round((Date.now() - last.at) / 60_000)} minutes`);
      }
      return feedLines(league, games);
    }
  }
  if (!oddsApiConfigured()) return games.map(() => null);
  return Promise.all(games.map((g) => getGameLines(league, g.homeTeam, g.awayTeam, g.kickoffUTC).catch(() => null)));
}
