// WOW-032 S2: the record store and the hourly writer, against a fake Redis.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeGameRecordsForSlate, refreshPendingGameRecords, selectGameWagers, type GameRecordWriterDeps } from '../src/lib/game-record-writer';
import { writeGameRecord, getSitemapGameEntries, gameRecordKeysInRange, RECORD_PENDING_KEY, recordIndexKey, recordSitemapKey } from '../src/lib/game-record-store';
import { buildGameRecord, serializeGameRecord, type GameRecord } from '../src/lib/game-record';
import { feedCloseKey, feedOpenKey } from '../src/lib/odds-feed-store';
import type { EnrichedScheduleGame } from '../src/lib/league-schedule';
import type { Wager } from '../src/lib/wager-types';
import { FakeRedis } from './helpers/fake-redis';
import { KICK, MIN, game, feedLine, lines, ouWager, psWager, input, venue } from './helpers/game-record-fixtures';

const KEY = 'gamerec:nfl:2026-11-16:buffalo-at-kansas-city';

function boardGame(over: Partial<EnrichedScheduleGame> = {}): EnrichedScheduleGame {
  return { ...(game() as any), lines: lines(), linesAreClosing: true, ...over } as EnrichedScheduleGame;
}

function deps(r: FakeRedis, wagers: Wager[] | Error = [ouWager('w1'), psWager('w2')], now = KICK + 20 * 3600_000): GameRecordWriterDeps & { logs: string[]; observed: number } {
  const logs: string[] = [];
  const d = {
    redis: r as any,
    getWagersByDate: async () => { if (wagers instanceof Error) throw wagers; return wagers; },
    observe: async () => { d.observed += 1; return { tempF: 44, windSpeedMph: 14, precipMmLastHour: 0, textDescription: 'Mostly Cloudy', stationId: 'KMKC' }; },
    now: () => now,
    log: (m: string) => { logs.push(m); },
    logs,
    observed: 0,
  };
  return d;
}

function seedFeed(r: FakeRedis) {
  r.kv.set(feedCloseKey('f1'), JSON.stringify(feedLine()));
  r.kv.set(feedOpenKey('f1'), JSON.stringify(feedLine({ capturedAt: KICK - 4 * 86400_000 }, { spreadHome: { point: -2.5, price: -110 }, spreadAway: { point: 2.5, price: -110 } })));
}

const recAt = (r: FakeRedis, key = KEY): GameRecord => JSON.parse(String(r.kv.get(key)));

describe('writeGameRecord (store)', () => {
  it('a frozen indexable record: no TTL, indexed by kickoff, in the sitemap by frozenAt, not pending', async () => {
    const r = new FakeRedis();
    const rec = buildGameRecord(input());
    const out = await writeGameRecord(rec, r as any, () => {});
    assert.equal(out.outcome, 'written');
    assert.equal(r.ttl.has(KEY), false);
    assert.equal(r.zsets.get(recordIndexKey('nfl'))!.get(KEY), KICK);
    assert.equal(r.zsets.get(recordSitemapKey('nfl'))!.get('/games/nfl/2026-11-16/buffalo-at-kansas-city'), Date.parse(rec.frozenAt!));
    assert.equal(r.zsets.get(RECORD_PENDING_KEY)?.has(KEY) ?? false, false);
    assert.deepEqual(await getSitemapGameEntries(['nfl'], r as any), [{ path: '/games/nfl/2026-11-16/buffalo-at-kansas-city', lastmod: rec.frozenAt }]);
    assert.deepEqual(await gameRecordKeysInRange('nfl', KICK - 1, KICK + 1, r as any), [KEY]);
  });
  it('an unfrozen record goes to pending and not the sitemap', async () => {
    const r = new FakeRedis();
    await writeGameRecord(buildGameRecord(input({ wagers: [ouWager('w1', { status: 'locked' })] })), r as any, () => {});
    assert.equal(r.zsets.get(RECORD_PENDING_KEY)!.get(KEY), KICK);
    assert.equal(r.zsets.has(recordSitemapKey('nfl')), false);
  });
  it('a frozen record missing its close is not in the sitemap', async () => {
    const r = new FakeRedis();
    await writeGameRecord(buildGameRecord(input({ feedClose: null })), r as any, () => {});
    assert.equal(r.zsets.has(recordSitemapKey('nfl')), false);
  });
  it('a record over 8 KB is never written, and the writer logs it', async () => {
    const r = new FakeRedis();
    const logs: string[] = [];
    const big = buildGameRecord(input({ wagers: Array.from({ length: 60 }, (_, i) => psWager(`w${i}`)) }));
    const out = await writeGameRecord(big, r as any, (m) => logs.push(m));
    assert.equal(out.outcome, 'too-large');
    assert.ok(out.bytes > 8192);
    assert.equal(r.calls.filter((c) => c.cmd !== 'get').length, 0);
    assert.equal(r.kv.size, 0);
    assert.match(logs[0], /not written: gamerec:nfl:2026-11-16:buffalo-at-kansas-city is \d+ bytes, over the 8192-byte cap/);
  });
});

describe('writeGameRecordsForSlate', () => {
  it('writes a final NFL game from the ingest close and open, and freezes it once markets are settled', async () => {
    const r = new FakeRedis();
    seedFeed(r);
    const d = deps(r);
    const sum = await writeGameRecordsForSlate([{ league: 'nfl', game: boardGame() }], d);
    assert.equal(sum.written, 1);
    assert.equal(sum.frozen, 1);
    const rec = recAt(r);
    assert.equal(rec.sportsbook.close!.origin, 'ingest');
    assert.equal(rec.sportsbook.close!.minutesBeforeKickoff, 18);
    assert.equal(rec.sportsbook.open!.lines.spreadHome!.point, -2.5);
    assert.equal(rec.sportsbook.grades!.spread!.result, 'home_cover');
    assert.equal(rec.weather.observed!.stationId, 'KMKC');
    assert.equal(rec.markets.length, 2);
  });
  it('skips MLB, MLS, unfinished games and teams without a venue; never writes indoor sports', async () => {
    const r = new FakeRedis();
    const sum = await writeGameRecordsForSlate([
      { league: 'mlb', game: boardGame() },
      { league: 'mls', game: boardGame() },
      { league: 'nfl', game: boardGame({ state: 'in', statusDetail: 'Q3 1:00' }) },
      { league: 'nfl', game: boardGame({ awayVenue: null }) },
    ], deps(r));
    assert.equal(sum.written, 0);
    assert.equal(sum.considered, 1);
    assert.equal(sum.skipped[0].reason, 'a team without a tracked venue');
    assert.equal([...r.kv.keys()].filter((k) => k.startsWith('gamerec:')).length, 0);
  });
  it('a frozen record is never rewritten, and an unchanged one is not rewritten', async () => {
    const r = new FakeRedis();
    seedFeed(r);
    await writeGameRecordsForSlate([{ league: 'nfl', game: boardGame() }], deps(r));
    const first = String(r.kv.get(KEY));
    const sum = await writeGameRecordsForSlate([{ league: 'nfl', game: boardGame({ homeScore: 50 }) }], deps(r, [], KICK + 40 * 3600_000));
    assert.equal(sum.alreadyFrozen, 1);
    assert.equal(String(r.kv.get(KEY)), first);

    const r2 = new FakeRedis();
    seedFeed(r2);
    await writeGameRecordsForSlate([{ league: 'nfl', game: boardGame() }], deps(r2, [ouWager('w1', { status: 'locked' })]));
    const sets = r2.writes('gamerec:').length;
    const again = await writeGameRecordsForSlate([{ league: 'nfl', game: boardGame() }], deps(r2, [ouWager('w1', { status: 'locked' })]));
    assert.equal(again.unchanged, 1);
    assert.equal(r2.writes('gamerec:').length, sets);
  });
  it('wagers that cannot be read: the record is written but not frozen', async () => {
    const r = new FakeRedis();
    seedFeed(r);
    await writeGameRecordsForSlate([{ league: 'nfl', game: boardGame() }], deps(r, new Error('redis down')));
    assert.equal(recAt(r).frozenAt, null);
    assert.equal(r.zsets.get(RECORD_PENDING_KEY)!.has(KEY), true);
  });
  it('falls back to the board freeze when there is no ingest close', async () => {
    const r = new FakeRedis();
    const key = `closing-line:nfl-kc:${Math.floor(KICK / 3_600_000)}`;
    r.kv.set(key, JSON.stringify({ lines: lines({ bookmaker: 'Bovada' }), capturedAt: new Date(KICK - 50 * MIN).toISOString() }));
    await writeGameRecordsForSlate([{ league: 'nfl', game: boardGame() }], deps(r));
    const rec = recAt(r);
    assert.equal(rec.sportsbook.close!.origin, 'board-freeze');
    assert.equal(rec.sportsbook.close!.minutesBeforeKickoff, 50);
    assert.equal(/bovada/i.test(String(r.kv.get(KEY))), false);
  });
  it('a second game on the same date and matchup gets -g2', async () => {
    const r = new FakeRedis();
    await writeGameRecordsForSlate([
      { league: 'nfl', game: boardGame() },
      { league: 'nfl', game: boardGame({ id: '401772999', kickoffUTC: new Date(KICK + 4 * 3600_000).toISOString() }) },
    ], deps(r));
    assert.ok(r.kv.has(KEY));
    assert.equal(recAt(r, `${KEY}-g2`).espnId, '401772999');
  });
  it('a postponed game gets a record that is never graded', async () => {
    const r = new FakeRedis();
    seedFeed(r);
    await writeGameRecordsForSlate([{ league: 'nfl', game: boardGame({ statusDetail: 'Postponed', homeScore: 0, awayScore: 0 }) }], deps(r, []));
    const rec = recAt(r);
    assert.equal(rec.result.status, 'postponed');
    assert.equal(rec.sportsbook.grades, null);
    assert.equal(rec.result.homeScore, null);
  });
});

describe('refreshPendingGameRecords', () => {
  it('re-reads markets of a pending record outside the window and freezes it once graded', async () => {
    const r = new FakeRedis();
    seedFeed(r);
    await writeGameRecordsForSlate([{ league: 'nfl', game: boardGame() }], deps(r, [ouWager('w1', { status: 'locked' })]));
    assert.equal(recAt(r).frozenAt, null);
    const out = await refreshPendingGameRecords(new Set(), deps(r, [ouWager('w1')], KICK + 30 * 3600_000));
    assert.equal(out.frozen, 1);
    const rec = recAt(r);
    assert.equal(rec.frozenAt, new Date(KICK + 30 * 3600_000).toISOString());
    assert.equal(rec.markets[0].status, 'graded');
    assert.equal(r.zsets.get(RECORD_PENDING_KEY)!.has(KEY), false);
    assert.ok(r.zsets.get(recordSitemapKey('nfl'))!.has('/games/nfl/2026-11-16/buffalo-at-kansas-city'));
  });
  it('gives up after 21 days without freezing', async () => {
    const r = new FakeRedis();
    await writeGameRecordsForSlate([{ league: 'nfl', game: boardGame() }], deps(r, [ouWager('w1', { status: 'locked' })]));
    const out = await refreshPendingGameRecords(new Set(), deps(r, [ouWager('w1', { status: 'locked' })], KICK + 22 * 86400_000));
    assert.equal(out.gaveUp, 1);
    assert.equal(recAt(r).frozenAt, null);
  });
});

describe('selectGameWagers', () => {
  it('keeps graded and void markets at either venue on temperature metrics', () => {
    const kc = venue('nfl-kc');
    const buf = venue('nfl-buf');
    const picked = selectGameWagers([
      ouWager('a'), ouWager('b', { status: 'void' }), ouWager('c', { metric: 'actual_wind' }), psWager('d'),
      ouWager('e', { location: { name: 'Fenway Park', lat: 42.3467, lon: -71.0972, stationId: 'KBOS', timeZone: 'America/New_York' } } as any),
    ], kc, buf);
    assert.deepEqual(picked.map((w) => w.id), ['a', 'b', 'd']);
  });
});

describe('record sizes from fixtures', () => {
  it('stays near the 4 KB target across fixture shapes', () => {
    const shapes: Record<string, GameRecord> = {
      'no markets, no open': buildGameRecord(input({ wagers: [], feedOpen: null })),
      'typical (2 markets)': buildGameRecord(input()),
      '4 markets': buildGameRecord(input({ wagers: [ouWager('w1'), psWager('w2'), psWager('w3'), ouWager('w4')] })),
      '6 markets': buildGameRecord(input({ wagers: [ouWager('w1'), psWager('w2'), psWager('w3'), ouWager('w4'), psWager('w5'), psWager('w6')] })),
      '10 markets': buildGameRecord(input({ wagers: Array.from({ length: 10 }, (_, i) => (i % 2 ? psWager(`w${i}`) : ouWager(`w${i}`))) })),
      'postponed': buildGameRecord(input({ game: game({ statusDetail: 'Postponed' }), wagers: [] })),
    };
    const sizes = Object.fromEntries(Object.entries(shapes).map(([k, v]) => [k, serializeGameRecord(v).bytes]));
    console.log('game record sizes (bytes):', JSON.stringify(sizes));
    assert.ok(sizes['typical (2 markets)'] <= 4096);
    assert.ok(sizes['6 markets'] <= 4096);
    for (const b of Object.values(sizes)) assert.ok(b <= 8192);
  });
});
