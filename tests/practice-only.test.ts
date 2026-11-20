// WOW-036 A(1): card deposits and withdrawals are off. Neither endpoint may
// call Stripe, change a balance or write Redis; signed-out callers still get 401.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CountingRedis } from './helpers/counting-redis';
import { setRedisForTests } from '../src/lib/redis';
import { POST as checkoutPOST } from '../src/pages/api/payments/create-checkout';
import { POST as withdrawPOST } from '../src/pages/api/payments/withdraw';
import { PAYMENTS_ENABLED, PRACTICE_ONLY_ERROR } from '../src/lib/practice-only';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const READS = new Set(['get', 'mget', 'hget', 'hgetall', 'exists', 'ttl', 'zcard', 'zrange', 'smembers', 'lrange', 'scard']);

describe('practice play only: deposits and withdrawals refused', () => {
  let r: CountingRedis;
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  before(() => {
    globalThis.fetch = (async () => { fetchCalls++; throw new Error('network disabled in test'); }) as typeof fetch;
  });
  after(() => { globalThis.fetch = realFetch; setRedisForTests(null); });

  const seed = () => {
    r = new CountingRedis();
    setRedisForTests(r);
    r.kv.set('user-session:sess1', JSON.stringify({ userId: 'u1', createdAt: new Date().toISOString() }));
    r.kv.set('user:u1', JSON.stringify({ id: 'u1', playerNumber: '1', email: 'a@example.com', displayName: 'A', createdAt: '' }));
    r.kv.set('balance:u1', 10_000_000);
    r.reset();
  };
  const req = (path: string, cookie?: string) => new Request(`https://wageronweather.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ amountCents: 10_000_000 }),
  });

  it('the switch is off', () => assert.equal(PAYMENTS_ENABLED, false));

  for (const [name, handler, path] of [['create-checkout', checkoutPOST, '/api/payments/create-checkout'], ['withdraw', withdrawPOST, '/api/payments/withdraw']] as const) {
    it(`${name}: signed out is 401`, async () => {
      seed();
      const res = await handler({ request: req(path) } as any);
      assert.equal(res.status, 401);
    });
    it(`${name}: signed in is 403, with no Stripe call, no balance change and no Redis write`, async () => {
      seed();
      fetchCalls = 0;
      const res = await handler({ request: req(path, 'wow_user_session=sess1.u1') } as any);
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: PRACTICE_ONLY_ERROR });
      assert.equal(fetchCalls, 0, 'no network (Stripe) call');
      assert.equal(r.kv.get('balance:u1'), 10_000_000);
      const writes = r.calls.filter((c) => !READS.has(c.cmd));
      assert.deepEqual(writes, [], `no Redis writes, saw ${JSON.stringify(writes)}`);
    });
  }

  it('the webhook is unchanged (still records Stripe-signed payments)', () => {
    assert.doesNotMatch(read('src/pages/api/payments/webhook.ts'), /practice-only/);
  });
  it('deposit and withdraw buttons render only when payments are enabled', () => {
    const pd = read('src/components/player/PlayerDashboard.tsx');
    assert.match(pd, /\{PAYMENTS_ENABLED && <button onClick=\{onShowDeposit\}/);
    assert.match(pd, /\{PAYMENTS_ENABLED && <div className="border-t border-slate-100 pt-4">/);
    assert.match(pd, /\{PAYMENTS_ENABLED && showDeposit && \(/);
    const ad = read('src/components/account/AccountDashboard.tsx');
    assert.match(ad, /\{PAYMENTS_ENABLED && showDeposit && \(/);
    assert.equal((ad.match(/PAYMENTS_ENABLED && \(/g) ?? []).length, 1);
  });
});
