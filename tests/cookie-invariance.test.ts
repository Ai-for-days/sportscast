// WOW-034: a route may carry a shared (public, s-maxage) cache header only
// if what it returns does not depend on who is asking. For each route whose
// cache header this batch adds or lengthens, render it with no cookie, a
// valid user session cookie, a valid admin session cookie, and both, from
// identical seeded state, and require:
//   - byte-identical bodies,
//   - identical status and headers,
//   - no Set-Cookie,
//   - no Redis read of any session, user or wallet key (so the route never
//     even looked at who was asking).
// The sessions are REAL in the fake store: had the route checked the
// cookie, it would have found a logged-in user or admin.

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CountingRedis, strict } from './helpers/counting-redis';
import { NOW, forecastAt, forecastKey } from './helpers/usage-fixtures';
import { bootAstro, type AstroHarness } from './helpers/astro-render';

const USER_SID = 'usersess0001';
const ADMIN_SID = 'adminsessionabcdef0123456789';
export const COOKIE_VARIANTS: Record<string, Record<string, string>> = {
  none: {},
  user: { cookie: `wow_user_session=${USER_SID}.u1` },
  admin: { cookie: `wow_admin_session=${ADMIN_SID}` },
  both: { cookie: `wow_user_session=${USER_SID}.u1; wow_admin_session=${ADMIN_SID}; _ga=GA1.1.123` },
};
const IDENTITY_KEY = /^(user-session:|session:|user:|balance:|transactions:)/;

export function seedSessions(r: CountingRedis) {
  r.kv.set(`user-session:${USER_SID}`, JSON.stringify({ userId: 'u1', createdAt: new Date(NOW).toISOString() }));
  r.kv.set('user:u1', JSON.stringify({ id: 'u1', playerNumber: 'P1', email: 'a@example.com', displayName: 'Player One', createdAt: '' }));
  r.kv.set('balance:u1', 12345);
  r.kv.set(`session:${ADMIN_SID}`, { createdAt: new Date(NOW).toISOString(), operatorId: 'primary-admin', readOnly: false });
}

let h: AstroHarness;
let setRedis: (r: unknown) => void;
const realFetch = globalThis.fetch;

interface Captured { status: number; headers: [string, string][]; body: string; identityReads: string[] }

async function capture(res: Response, r: CountingRedis): Promise<Captured> {
  const body = await res.text();
  return {
    status: res.status,
    headers: [...res.headers.entries()].sort(),
    body,
    identityReads: r.calls.filter((c) => IDENTITY_KEY.test(c.key)).map((c) => `${c.cmd} ${c.key}`),
  };
}

export function assertInvariant(results: Record<string, Captured>, route: string) {
  const base = results.none;
  assert.ok(base.body.length > 0, `${route}: empty body`);
  for (const [name, got] of Object.entries(results)) {
    assert.equal(got.status, base.status, `${route}: status differs with ${name} cookie`);
    assert.deepEqual(got.headers, base.headers, `${route}: headers differ with ${name} cookie`);
    assert.ok(!got.headers.some(([k]) => k.toLowerCase() === 'set-cookie'), `${route}: Set-Cookie with ${name} cookie`);
    assert.deepEqual(got.identityReads, [], `${route}: read identity keys with ${name} cookie`);
    assert.ok(got.body === base.body, `${route}: body differs with ${name} cookie`);
  }
}

before(async () => {
  (globalThis as any).fetch = async () => { throw new Error('network disabled in test'); };
  h = await bootAstro();
  setRedis = (await h.load('/src/lib/redis.ts')).setRedisForTests;
  mock.timers.enable({ apis: ['Date'], now: NOW });
});
after(async () => {
  mock.timers.reset();
  setRedis?.(null);
  await h?.close();
  (globalThis as any).fetch = realFetch;
});

describe('cookie invariance of routes given a shared cache header (WOW-034)', () => {
  it('ZIP page: same HTML and headers with no cookie, a user cookie, an admin cookie, both', async () => {
    const { lookupZip } = await h.load('/src/lib/zip-lookup.ts');
    const geo = lookupZip('29209');
    const slug = 'united-states-south-carolina-columbia-29209';
    const results: Record<string, Captured> = {};
    for (const [name, headers] of Object.entries(COOKIE_VARIANTS)) {
      const r = new CountingRedis();
      r.kv.set(forecastKey(geo.lat, geo.lon), JSON.stringify(forecastAt(geo.lat, geo.lon)));
      seedSessions(r);
      setRedis(strict(r));
      const res = await h.render('/src/pages/[...slug].astro', `https://wageronweather.com/${slug}`, { params: { slug }, headers });
      results[name] = await capture(res, r);
    }
    assert.equal(results.none.status, 200);
    assert.match(results.none.headers.find(([k]) => k === 'cache-control')?.[1] ?? '', /^public, s-maxage=/);
    assertInvariant(results, 'ZIP page');
  });

  it('middleware passes a GET page request straight through, cookies or not, adding nothing', async () => {
    const { onRequest } = await h.load('/src/middleware.ts');
    for (const [name, headers] of Object.entries(COOKIE_VARIANTS)) {
      const r = new CountingRedis();
      seedSessions(r);
      setRedis(strict(r));
      const page = new Response('<html>page</html>', { headers: { 'Cache-Control': 'public, s-maxage=600' } });
      const out: Response = await onRequest({ request: new Request('https://wageronweather.com/wagers', { headers }) } as any, async () => page);
      assert.equal(out, page, `middleware replaced the response with ${name} cookie`);
      assert.equal(out.headers.get('set-cookie'), null);
      assert.equal(r.count(), 0, `middleware touched Redis with ${name} cookie`);
    }
  });
});
