// WOW-033 (a): the close's capture time is refreshed near kickoff when the
// line holds steady, on both the ingest path and the board-freeze path. Every
// live and start-time guard is unchanged.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ingestFeed, closeOpenWrites, feedCloseKey } from '../src/lib/odds-feed-store';
import { closingWriteCandidates, closeRefreshDue, CLOSE_REFRESH_WINDOW_MS, CLOSE_REFRESH_EVERY_MS, type ClosingOddsRecord } from '../src/lib/game-closing-odds';
import { mainLinesFromGame, type FeedGame, type FeedMarket, type FeedPayload } from '../src/lib/odds-feed';
import type { GameLines } from '../src/lib/sportsbook-odds';
import { FakeRedis } from './helpers/fake-redis';

const KICK = Date.parse('2026-11-20T01:15:00Z');
const MIN = 60_000;

function market(id: string, key: string, description: string, outcomes: [string, string, string | null][]): FeedMarket {
  return {
    id, key, description, status: 'O',
    period: { description: 'Game', abbreviation: 'G', live: false, main: true },
    outcomes: outcomes.map(([type, american, handicap], i) => ({ id: `${id}-${i}`, description: type, type, status: 'O', price: { american, handicap } })),
  };
}
function game(spread = '-3.5', over: Partial<FeedGame> = {}): FeedGame {
  const away = spread.startsWith('-') ? spread.slice(1) : `-${spread}`;
  return {
    id: 'g1', league: 'nfl', description: 'Buffalo Bills @ Kansas City Chiefs', startTime: KICK, live: false, scope: 'full',
    competitors: [{ name: 'Kansas City Chiefs', home: true }, { name: 'Buffalo Bills', home: false }],
    groups: [{ description: 'Game Lines', markets: [
      market('ml', '2W-12', 'Moneyline', [['A', '+150', null], ['H', '-175', null]]),
      market('sp', '2W-HCAP', 'Point Spread', [['A', '-110', away], ['H', '-110', spread]]),
      market('tot', '2W-OU', 'Total', [['O', '-110', '47.5'], ['U', '-110', '47.5']]),
    ] }],
    ...over,
  };
}
const payload = (games: FeedGame[]): FeedPayload => ({ v: 1, source: 'scraper', sentAt: 0, games, seen: [] } as FeedPayload);
const close = (r: FakeRedis) => JSON.parse(String(r.kv.get(feedCloseKey('g1'))));

describe('closeRefreshDue', () => {
  it('180-minute window, 30-minute cadence, start must be ahead', () => {
    assert.equal(CLOSE_REFRESH_WINDOW_MS, 180 * MIN);
    assert.equal(CLOSE_REFRESH_EVERY_MS, 30 * MIN);
    assert.equal(closeRefreshDue(KICK, KICK - 100 * MIN, KICK - 60 * MIN), true);
    assert.equal(closeRefreshDue(KICK, KICK - 89 * MIN, KICK - 60 * MIN), false); // 29 min old
    assert.equal(closeRefreshDue(KICK, KICK - 300 * MIN, KICK - 181 * MIN), false); // outside window
    assert.equal(closeRefreshDue(KICK, KICK - 300 * MIN, KICK - 180 * MIN), true); // window edge
    assert.equal(closeRefreshDue(KICK, KICK - 300 * MIN, KICK), false); // at start
    assert.equal(closeRefreshDue(KICK, KICK - 300 * MIN, KICK + MIN), false);
    assert.equal(closeRefreshDue(null, KICK - 300 * MIN, KICK - 60 * MIN), false);
    assert.equal(closeRefreshDue(KICK, undefined, KICK - 60 * MIN), false);
  });
});

describe('ingest path', () => {
  it('a stable line held for 4 h ends with a capturedAt within 30 min of the last pre-start push', async () => {
    const r = new FakeRedis();
    let last = 0;
    for (let t = KICK - 240 * MIN; t < KICK; t += 15 * MIN) {
      await ingestFeed(payload([game()]), t, r as any);
      last = t;
    }
    assert.equal(last, KICK - 15 * MIN);
    const c = close(r);
    assert.ok(last - c.capturedAt <= 30 * MIN, `captured ${(last - c.capturedAt) / MIN} min before the last push`);
    assert.ok(c.minutesBeforeStart <= 45);
    // Bounded: the first write plus refreshes inside the 180-minute window only.
    assert.ok(r.writes(feedCloseKey('g1')).length <= 8, `${r.writes(feedCloseKey('g1')).length} writes`);
  });
  it('a changed line writes at once, even right after a write and outside the window', async () => {
    const r = new FakeRedis();
    await ingestFeed(payload([game('-3')]), KICK - 600 * MIN, r as any);
    await ingestFeed(payload([game('-4')]), KICK - 595 * MIN, r as any);
    assert.equal(close(r).capturedAt, KICK - 595 * MIN);
    assert.equal(close(r).lines.spreadHome.point, -4);
  });
  it('a post-start push never writes, changed or unchanged', async () => {
    const r = new FakeRedis();
    await ingestFeed(payload([game()]), KICK - 90 * MIN, r as any);
    await ingestFeed(payload([game()]), KICK + 5 * MIN, r as any);
    await ingestFeed(payload([game('+7')]), KICK + 20 * MIN, r as any);
    assert.equal(r.writes(feedCloseKey('g1')).length, 1);
    assert.equal(close(r).capturedAt, KICK - 90 * MIN);
  });
  it('a live-flagged game never writes, even when a refresh would be due', async () => {
    const r = new FakeRedis();
    await ingestFeed(payload([game()]), KICK - 170 * MIN, r as any);
    await ingestFeed(payload([game('-3.5', { live: true })]), KICK - 60 * MIN, r as any);
    assert.equal(r.writes(feedCloseKey('g1')).length, 1);
    const g = game();
    const liveLines = { ...mainLinesFromGame(g, KICK - 60 * MIN)!, live: true };
    assert.equal(closeOpenWrites(g, liveLines, mainLinesFromGame(g, KICK - 170 * MIN), KICK - 60 * MIN, KICK - 170 * MIN).close, null);
  });
});

describe('board-freeze path (closingWriteCandidates)', () => {
  const now = KICK - 60 * MIN;
  const L = (over: Partial<GameLines> = {}): GameLines => ({
    bookmaker: 'feed', lastUpdate: '', moneylineHome: -175, moneylineAway: 150,
    spreadHome: { point: -3.5, price: -110 }, spreadAway: { point: 3.5, price: -110 },
    total: { point: 47.5, overPrice: -110, underPrice: -110 }, homeRotation: null, awayRotation: null,
    live: false, feedGameId: 'g1', feedStartTime: KICK, ...over,
  });
  const known = (ageMin: number) => new Map<string, ClosingOddsRecord>([['k', { lines: L(), capturedAt: new Date(now - ageMin * MIN).toISOString() }]]);
  it('an unchanged line inside the window is rewritten once the stored copy is 30 min old', () => {
    assert.equal(closingWriteCandidates([{ key: 'k', state: 'pre', lines: L() }], known(30), now).length, 1);
    assert.equal(closingWriteCandidates([{ key: 'k', state: 'pre', lines: L() }], known(29), now).length, 0);
  });
  it('outside the window an unchanged line is not rewritten; a changed one always is', () => {
    const early = KICK - 200 * MIN;
    const k = new Map<string, ClosingOddsRecord>([['k', { lines: L(), capturedAt: new Date(early - 120 * MIN).toISOString() }]]);
    assert.equal(closingWriteCandidates([{ key: 'k', state: 'pre', lines: L() }], k, early).length, 0);
    assert.equal(closingWriteCandidates([{ key: 'k', state: 'pre', lines: L({ moneylineHome: -180 }) }], known(1), now).length, 1);
  });
  it('lines without a feed start use the entry start; no start at all never refreshes', () => {
    const noFeed = L({ feedStartTime: null });
    assert.equal(closingWriteCandidates([{ key: 'k', state: 'pre', lines: noFeed, startMs: KICK }], known(40), now).length, 1);
    assert.equal(closingWriteCandidates([{ key: 'k', state: 'pre', lines: noFeed }], known(40), now).length, 0);
    // ESPN still 'pre' after the scheduled start: no refresh.
    assert.equal(closingWriteCandidates([{ key: 'k', state: 'pre', lines: noFeed, startMs: now - MIN }], known(40), now).length, 0);
  });
  it('started, live or past-feed-start lines never write on either path', () => {
    assert.equal(closingWriteCandidates([{ key: 'k', state: 'in', lines: L() }], known(40), now).length, 0);
    assert.equal(closingWriteCandidates([{ key: 'k', state: 'pre', lines: L({ live: true }) }], known(40), now).length, 0);
    assert.equal(closingWriteCandidates([{ key: 'k', state: 'pre', lines: L({ feedStartTime: now - MIN }) }], known(40), now).length, 0);
  });
});
