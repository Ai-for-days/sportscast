// WOW-032 S2: the ingest-time close and open keys (odds-feed-store.ts).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ingestFeed, closeOpenWrites, CLOSE_OPEN_TTL, feedCloseKey, feedOpenKey } from '../src/lib/odds-feed-store';
import { mainLinesFromGame, type FeedGame, type FeedMarket, type FeedPayload } from '../src/lib/odds-feed';
import { FakeRedis } from './helpers/fake-redis';

const KICK = Date.parse('2026-11-20T01:15:00Z'); // 8:15 PM ET
const MIN = 60_000;

function market(id: string, key: string, description: string, outcomes: [string, string, string | null][], live = false): FeedMarket {
  return {
    id, key, description, status: 'O',
    period: { description: 'Game', abbreviation: 'G', live, main: true },
    outcomes: outcomes.map(([type, american, handicap], i) => ({ id: `${id}-${i}`, description: type, type, status: 'O', price: { american, handicap } })),
  };
}

function game(spread = '-3.5', over: Partial<FeedGame> = {}): FeedGame {
  const away = spread.startsWith('-') ? spread.slice(1) : `-${spread}`;
  return {
    id: 'g1', league: 'nfl', description: 'Buffalo Bills @ Kansas City Chiefs', startTime: KICK, live: false, scope: 'full',
    competitors: [{ name: 'Kansas City Chiefs', home: true }, { name: 'Buffalo Bills', home: false }],
    groups: [{
      description: 'Game Lines',
      markets: [
        market('ml', '2W-12', 'Moneyline', [['A', '+150', null], ['H', '-175', null]]),
        market('sp', '2W-HCAP', 'Point Spread', [['A', '-110', away], ['H', '-110', spread]]),
        market('tot', '2W-OU', 'Total', [['O', '-110', '47.5'], ['U', '-110', '47.5']]),
      ],
    }],
    ...over,
  };
}

function payload(games: FeedGame[], source: 'scraper' | 'live' = 'scraper'): FeedPayload {
  return { v: 1, source, sentAt: 0, games, seen: [] } as FeedPayload;
}

const stored = (r: FakeRedis, key: string) => {
  const v = r.kv.get(key);
  return v ? JSON.parse(String(v)) : null;
};

describe('closeOpenWrites (pure)', () => {
  const now = KICK - 30 * MIN;
  it('a first pre-start full push writes both close and open, with capture time and minutes before start', () => {
    const g = game();
    const w = closeOpenWrites(g, mainLinesFromGame(g, now), null, now);
    assert.ok(w.close && w.open);
    assert.equal(w.close!.capturedAt, now);
    assert.equal(w.close!.startTime, KICK);
    assert.equal(w.close!.minutesBeforeStart, 30);
    assert.equal(w.close!.lines.spreadHome?.point, -3.5);
  });
  it('unchanged main lines write nothing; changed lines write only the close', () => {
    const g = game();
    const prev = mainLinesFromGame(g, now - 60 * MIN);
    assert.deepEqual(closeOpenWrites(g, mainLinesFromGame(g, now), prev, now), { close: null, open: null });
    const moved = game('-4');
    const w = closeOpenWrites(moved, mainLinesFromGame(moved, now), prev, now);
    assert.ok(w.close);
    assert.equal(w.open, null);
  });
  it('refuses a push at or after the feed start time, a live-flagged game, and a main-scope push', () => {
    const g = game('-4');
    assert.deepEqual(closeOpenWrites(g, mainLinesFromGame(g, KICK), null, KICK), { close: null, open: null });
    assert.deepEqual(closeOpenWrites(g, mainLinesFromGame(g, KICK + 5 * MIN), null, KICK + 5 * MIN), { close: null, open: null });
    const liveFlag = game('-4', { live: true });
    assert.deepEqual(closeOpenWrites(liveFlag, mainLinesFromGame(liveFlag, now), null, now), { close: null, open: null });
    const main = game('-4', { scope: 'main' });
    assert.deepEqual(closeOpenWrites(main, mainLinesFromGame(main, now), null, now), { close: null, open: null });
  });
});

describe('ingestFeed writes the close and open keys (WOW-031 4, WOW-032 D)', () => {
  it('a pre-start full push stores close and open with the 45-day TTL; open uses SET NX', async () => {
    const r = new FakeRedis();
    const now = KICK - 18 * MIN;
    await ingestFeed(payload([game()]), now, r as any);
    const close = stored(r, feedCloseKey('g1'));
    assert.equal(close.capturedAt, now);
    assert.equal(close.startTime, KICK);
    assert.equal(close.minutesBeforeStart, 18);
    assert.equal(close.home, 'Kansas City Chiefs');
    assert.equal(r.ttl.get(feedCloseKey('g1')), CLOSE_OPEN_TTL);
    assert.equal(CLOSE_OPEN_TTL, 45 * 86400);
    const openSet = r.writes(feedOpenKey('g1'));
    assert.equal(openSet.length, 1);
    assert.deepEqual(openSet[0].args[1], { ex: CLOSE_OPEN_TTL, nx: true });
  });

  it('the open is written once: a later moved line updates the close but never the open', async () => {
    const r = new FakeRedis();
    await ingestFeed(payload([game('-3')]), KICK - 300 * MIN, r as any);
    await ingestFeed(payload([game('-4.5')]), KICK - 20 * MIN, r as any);
    assert.equal(stored(r, feedOpenKey('g1')).lines.spreadHome.point, -3);
    assert.equal(stored(r, feedCloseKey('g1')).lines.spreadHome.point, -4.5);
    assert.equal(r.writes(feedOpenKey('g1')).length, 1);
  });

  it('an unchanged pre-start full push outside the last 180 min does not rewrite the close (WOW-033 a)', async () => {
    const r = new FakeRedis();
    await ingestFeed(payload([game()]), KICK - 400 * MIN, r as any);
    await ingestFeed(payload([game()]), KICK - 300 * MIN, r as any);
    assert.equal(r.writes(feedCloseKey('g1')).length, 1);
    assert.equal(stored(r, feedCloseKey('g1')).capturedAt, KICK - 400 * MIN);
  });

  it('a POST-START full push with new prices must NOT become the close', async () => {
    const r = new FakeRedis();
    await ingestFeed(payload([game('-3.5')]), KICK - 15 * MIN, r as any);
    // 25 minutes after the feed start: a full scrape carries in-play prices (not flagged live by the book).
    const inPlay = game('+6.5');
    await ingestFeed(payload([inPlay]), KICK + 25 * MIN, r as any);
    const close = stored(r, feedCloseKey('g1'));
    assert.equal(close.lines.spreadHome.point, -3.5);
    assert.equal(close.capturedAt, KICK - 15 * MIN);
    assert.equal(r.writes(feedCloseKey('g1')).length, 1);
    // The board summary still takes the newer push, exactly as before.
    const summary = JSON.parse(String(r.hashes.get('oddsfeed:summary:nfl')!.get('g1')));
    assert.equal(summary.lines.spreadHome.point, 6.5);
  });

  it('a post-start full push for a game never seen before writes neither key', async () => {
    const r = new FakeRedis();
    await ingestFeed(payload([game('-3.5')]), KICK + 1 * MIN, r as any);
    assert.equal(r.kv.has(feedCloseKey('g1')), false);
    assert.equal(r.kv.has(feedOpenKey('g1')), false);
  });

  it('a live push never touches the close or open', async () => {
    const r = new FakeRedis();
    const live = game('-7', { scope: 'main', live: true });
    live.groups[0].markets = live.groups[0].markets.map((m) => ({ ...m, period: { ...m.period, live: true } }));
    await ingestFeed(payload([live], 'live'), KICK - 5 * MIN, r as any);
    assert.equal(r.writes('oddsfeed:close:').length, 0);
    assert.equal(r.writes('oddsfeed:open:').length, 0);
  });

  it('a pre-start game the book flags live is not stored as the close', async () => {
    const r = new FakeRedis();
    await ingestFeed(payload([game('-3.5', { live: true })]), KICK - 5 * MIN, r as any);
    assert.equal(r.kv.has(feedCloseKey('g1')), false);
  });
});
