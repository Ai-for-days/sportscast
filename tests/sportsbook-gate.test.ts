// WOW-039 A: Bovada-line betting is paused until results grading is live.
// The server refuses before any read, debit or write; the sidebar shows the note.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CountingRedis } from './helpers/counting-redis';
import { setRedisForTests } from '../src/lib/redis';
import { POST as placePOST } from '../src/pages/api/bets/place';
import { POST as weatherBetPOST } from '../src/pages/api/bets';
import { SPORTSBOOK_BETTING_OPEN, SPORTSBOOK_PAUSED_ERROR, sportsbookBettingOpen } from '../src/lib/practice-only';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SID = 'gateaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const READS = new Set(['get', 'mget', 'hget', 'hgetall', 'exists', 'ttl', 'zcard', 'zrange', 'smembers', 'lrange', 'scard']);

describe('sportsbook betting paused (server-enforced)', () => {
  let r: CountingRedis;
  const realFetch = globalThis.fetch;
  before(() => { globalThis.fetch = (async () => { throw new Error('network disabled in test'); }) as typeof fetch; });
  after(() => { globalThis.fetch = realFetch; setRedisForTests(null); });
  const seed = () => {
    r = new CountingRedis();
    setRedisForTests(r);
    r.kv.set(`user-session:${SID}`, JSON.stringify({ userId: 'u1', createdAt: new Date().toISOString() }));
    r.kv.set('user:u1', JSON.stringify({ id: 'u1', playerNumber: '1', email: 'a@example.com', displayName: 'A', createdAt: '' }));
    r.kv.set('balance:u1', 10_000_000);
    r.reset();
  };
  const post = (path: string, body: unknown, cookie?: string) => new Request(`https://wageronweather.com${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  const leg = { gameId: '29514763', gameDescription: 'X @ Y', oddsType: 'moneyline', side: 'home', odds: -150 };

  it('the switch is off and nothing overrides it here', () => {
    assert.equal(SPORTSBOOK_BETTING_OPEN, false);
    assert.equal(sportsbookBettingOpen(), false);
  });
  it('signed in: 403 with the note, no balance read, no debit, no transaction, no bet key', async () => {
    seed();
    const res = await placePOST({ request: post('/api/bets/place', { legs: [leg], stake: 10 }, `wow_user_session=${SID}.u1`) } as any);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: SPORTSBOOK_PAUSED_ERROR });
    assert.equal(r.kv.get('balance:u1'), 10_000_000);
    assert.deepEqual(r.calls.filter((c) => !READS.has(c.cmd)), [], 'no writes');
    assert.ok(!r.calls.some((c) => c.key.startsWith('balance:')), 'balance not even read');
    assert.ok(![...r.kv.keys()].some((k) => k.startsWith('bet:') || k.startsWith('transaction')), 'no bet or transaction');
  });
  it('signed out: still 401', async () => {
    seed();
    const res = await placePOST({ request: post('/api/bets/place', { legs: [leg], stake: 10 }) } as any);
    assert.equal(res.status, 401);
  });
  it('weather bets are not gated', () => {
    assert.doesNotMatch(read('src/pages/api/bets.ts'), /sportsbookBettingOpen|SPORTSBOOK_BETTING_OPEN/);
    assert.equal(typeof weatherBetPOST, 'function');
  });
  it('the refusal comes before the balance read and the debit in place.ts', () => {
    const src = read('src/pages/api/bets/place.ts');
    const gate = src.indexOf('if (!sportsbookBettingOpen())');
    assert.ok(gate > 0);
    assert.ok(gate < src.indexOf('getBalance(user.id)'));
    assert.ok(gate < src.indexOf('debitBalance(user.id'));
  });
  it('the sidebar shows the note and returns before addLeg, for game lines and props', () => {
    const src = read('src/components/betting/GamesList.tsx');
    for (const fn of ['const handleAddLeg', 'const handlePropMarketSelect']) {
      const start = src.indexOf(fn);
      const body = src.slice(start, src.indexOf('addLeg(leg)', start));
      assert.match(body, /if \(!SPORTSBOOK_BETTING_OPEN\) \{\s*setError\(GRADING_NOTE\);\s*return;/, fn);
    }
  });
});
