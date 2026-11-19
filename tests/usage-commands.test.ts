// WOW-034: Redis commands per operation, counted the way Upstash bills them
// (each pipelined command is one, an MGET of N keys is one), plus
// output-equality checks so a command cut cannot change what callers get.
//
// Library-level: these call the functions the pages and routes call, against
// a seeded CountingRedis, with the network disabled and the clock frozen. The
// two page renders (ZIP page, /wagers) are in usage-render.test.ts.
//
// Golden outputs live in tests/fixtures/usage-golden/. They were written from
// the code as it stood BEFORE the cuts (6c6233b + this harness), so every
// later refactor is checked against pre-cut behaviour. Regenerate only on
// purpose: WOW034_WRITE_GOLDEN=1 npm test.

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CountingRedis, strict } from './helpers/counting-redis';
import { NOW, BOARD_LEAGUES, seedWorld, seedWagers, rawGamesFor, forecastKey } from './helpers/usage-fixtures';
import { setRedisForTests } from '../src/lib/redis';
import { scheduleDeps, getScheduleGames } from '../src/lib/league-schedule';
import { lockExpiredWagers, getWagersByDate } from '../src/lib/wager-store';
import { listPublicWagers } from '../src/lib/public-wager-view';
import { getMappedWagerId } from '../src/lib/auto-market-shared';
import { GET as balanceGET } from '../src/pages/api/account/balance';
import { GET as gamesGET } from '../src/pages/api/sportsbook/games';

/** Billed commands per operation on this fixture world. Updated per cut. */
export const EXPECTED = {
  leagueBoardCold: 39, // before the cuts: 54
  leagueBoardWarm: 15, // before the cuts: 30
  weatherboardCold: 131, // before the cuts: 168
  weatherboardWarm: 53, // before the cuts: 90
  balancePoll: 3,
  sportsbookGames: 23,
  wagersViewData: 68,
  wagersByDate: 11,
  lockExpired: 81,
  mappedWagerIdProbe: 26,
};

const GOLDEN_DIR = join(process.cwd(), 'tests', 'fixtures', 'usage-golden');
const WRITE = !!process.env.WOW034_WRITE_GOLDEN;

function golden(name: string, value: unknown) {
  const file = join(GOLDEN_DIR, `${name}.json`);
  const json = JSON.stringify(value, null, 1);
  if (WRITE) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, json);
    return;
  }
  assert.ok(existsSync(file), `missing golden ${name}`);
  assert.deepEqual(JSON.parse(json), JSON.parse(readFileSync(file, 'utf8')), `output of ${name} changed`);
}

const counts: Record<string, number> = {};
function record(name: keyof typeof EXPECTED, r: CountingRedis) {
  counts[name] = r.count();
  console.log(`WOW034-COUNT ${name}=${r.count()} ${JSON.stringify(r.byCmd())}`);
}

const realFetch = globalThis.fetch;
const savedDeps = { ...scheduleDeps };
/**
 * A fresh seeded world on the frozen clock, at NOW + `minute` minutes. Each
 * test has its own fixed minute (so its golden does not depend on test
 * order), a minute apart, which also puts every in-process cache out of date.
 */
function world(minute: number): CountingRedis {
  const r = new CountingRedis();
  seedWorld(r);
  setRedisForTests(strict(r));
  mock.timers.setTime(NOW + minute * 60_000);
  return r;
}

before(() => {
  (globalThis as any).fetch = async () => { throw new Error('network disabled in test'); };
  process.env.ODDS_API_KEY = 'fixture-not-a-key';
  mock.timers.enable({ apis: ['Date'], now: NOW });
  scheduleDeps.getRawGames = async (league: any) => rawGamesFor(league);
});
after(() => {
  (globalThis as any).fetch = realFetch;
  delete process.env.ODDS_API_KEY;
  mock.timers.reset();
  Object.assign(scheduleDeps, savedDeps);
  setRedisForTests(null);
});

const boardOpts = { onlyDate: '2026-11-22' };

describe('WOW-034 commands per operation', () => {
  it('one league board render (getScheduleGames, NFL, today): cold, then warm', async () => {
    const r = world(1);
    const cold = await getScheduleGames('nfl', 1, undefined, boardOpts);
    record('leagueBoardCold', r);
    golden('league-board-nfl-cold', cold);
    r.reset();
    mock.timers.setTime(Date.now() + 30_000);
    const warm = await getScheduleGames('nfl', 1, undefined, boardOpts);
    record('leagueBoardWarm', r);
    golden('league-board-nfl-warm', warm);
    assert.equal(counts.leagueBoardCold, EXPECTED.leagueBoardCold);
    assert.equal(counts.leagueBoardWarm, EXPECTED.leagueBoardWarm);
  });

  it('one /weatherboard render (every league, today): cold, then warm', async () => {
    const r = world(2);
    const cold = await Promise.all(BOARD_LEAGUES.map((k) => getScheduleGames(k, 1, undefined, boardOpts)));
    record('weatherboardCold', r);
    golden('weatherboard-cold', cold);
    r.reset();
    mock.timers.setTime(Date.now() + 30_000);
    const warm = await Promise.all(BOARD_LEAGUES.map((k) => getScheduleGames(k, 1, undefined, boardOpts)));
    record('weatherboardWarm', r);
    golden('weatherboard-warm', warm);
    assert.equal(counts.weatherboardCold, EXPECTED.weatherboardCold);
    assert.equal(counts.weatherboardWarm, EXPECTED.weatherboardWarm);
  });

  it('one balance poll (/api/account/balance, logged in)', async () => {
    const r = world(3);
    r.kv.set('user-session:sess1', JSON.stringify({ userId: 'u1', createdAt: new Date(NOW).toISOString() }));
    r.kv.set('user:u1', JSON.stringify({ id: 'u1', playerNumber: 'P1', email: 'a@example.com', displayName: 'A', createdAt: '' }));
    r.kv.set('balance:u1', 12345);
    r.reset();
    const res = await balanceGET({ request: new Request('https://wageronweather.com/api/account/balance', { headers: { cookie: 'wow_user_session=sess1.u1' } }) } as any);
    record('balancePoll', r);
    assert.equal(res.status, 200);
    golden('balance-poll', await res.json());
    assert.equal(counts.balancePoll, EXPECTED.balancePoll);
  });

  it('one /api/sportsbook/games call (NFL)', async () => {
    const r = world(4);
    const res = await gamesGET({ url: new URL('https://wageronweather.com/api/sportsbook/games?sport=football/nfl'), request: new Request('https://wageronweather.com/api/sportsbook/games?sport=football/nfl') } as any);
    record('sportsbookGames', r);
    assert.equal(res.status, 200);
    golden('sportsbook-games-nfl', await res.json());
    assert.equal(counts.sportsbookGames, EXPECTED.sportsbookGames);
  });

  it('one /wagers view data path (listPublicWagers x2, as the page calls it)', async () => {
    const r = world(5);
    seedWagers(r, 60, 4);
    r.reset();
    const pages = await Promise.all([listPublicWagers({ limit: 50, cursor: 0 }), listPublicWagers({ limit: 50, cursor: 50 })]);
    record('wagersViewData', r);
    golden('wagers-view-data', pages);
    assert.equal(counts.wagersViewData, EXPECTED.wagersViewData);
  });

  it('getWagersByDate (the game-record writer and graders)', async () => {
    const r = world(6);
    seedWagers(r, 60, 4);
    r.reset();
    const out = await getWagersByDate('2026-11-23');
    record('wagersByDate', r);
    golden('wagers-by-date', out.slice().sort((a, b) => a.id.localeCompare(b.id)));
    assert.equal(counts.wagersByDate, EXPECTED.wagersByDate);
  });

  it('one lock-expired run (64 open, 4 past their lock time)', async () => {
    const r = world(7);
    seedWagers(r, 60, 4);
    r.reset();
    const locked = await lockExpiredWagers();
    record('lockExpired', r);
    const state = [...r.kv.entries()].filter(([k]) => k.startsWith('wager:')).sort(([a], [b]) => a.localeCompare(b));
    golden('lock-expired', { locked, state, open: [...(r.zsets.get('wagers:by-status:open') ?? new Map()).keys()].sort(), lockedSet: [...(r.zsets.get('wagers:by-status:locked') ?? new Map()).keys()].sort() });
    assert.equal(counts.lockExpired, EXPECTED.lockExpired);
  });

  it('getMappedWagerId hour-key probe (no stable pointer): a miss, then a legacy hour pointer', async () => {
    const r = world(8);
    const g = { id: 'nfl-g0', venue: { id: 'nfl-buf' }, kickoffUTC: '2026-11-22T18:00:00Z' };
    r.reset();
    const none = await getMappedWagerId('hvl', 'nfl', g);
    record('mappedWagerIdProbe', r);
    const probed = r.calls.filter((c) => c.cmd === 'get' || c.cmd === 'mget').flatMap((c) => (c.args.length ? c.args : [c.key])) as string[];
    const hourKeys = probed.filter((k) => k.startsWith('hvl:nfl:v:'));
    assert.ok(hourKeys.length > 3, 'probe reads the hour keys');
    // Plant a legacy hour pointer on a non-first hour key and run again.
    r.kv.set(hourKeys[3], 'w_legacy');
    r.reset();
    const found = await getMappedWagerId('hvl', 'nfl', g);
    const foundCount = r.count();
    console.log(`WOW034-COUNT mappedWagerIdFound=${foundCount}`);
    golden('mapped-wager-id', { none, found, hourKeys, migratedTo: r.kv.get('hvl:nfl:d:nfl-buf:2026-11-22') ?? null });
    assert.equal(counts.mappedWagerIdProbe, EXPECTED.mappedWagerIdProbe);
  });

  it('league board with forecast cache misses: same games (one venue with a last-good copy, one with nothing)', async () => {
    for (const weatherOnly of [false, true]) {
      const r = world(weatherOnly ? 10 : 9);
      const games = rawGamesFor('nfl');
      const k0 = forecastKey(games[0].venue.lat, games[0].venue.lon);
      const k1 = forecastKey(games[1].venue.lat, games[1].venue.lon);
      const kept = r.kv.get(k0);
      r.kv.delete(k0);
      r.kv.delete(k1);
      r.kv.set(`${k0}:lastgood`, kept);
      r.reset();
      const out = await getScheduleGames('nfl', 1, undefined, { ...boardOpts, weatherOnly });
      console.log(`WOW034-COUNT leagueBoardMisses${weatherOnly ? 'WeatherOnly' : ''}=${r.count()} ${JSON.stringify(r.byCmd())}`);
      golden(`league-board-nfl-misses${weatherOnly ? '-weather-only' : ''}`, out);
    }
  });
});
