// Admin session check fails closed (2026-11-15). Before this, validateSession
// always returned true, so any value of the wow_admin_session cookie passed
// requireAdmin on every admin page and /api/admin route. No network, no Redis.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateSession, requireAdmin, createSession, __setAdminAuthStoreForTests } from '../src/lib/admin-auth';

function store(keys: Record<string, unknown> = {}, opts: { throws?: boolean } = {}) {
  const data = new Map(Object.entries(keys));
  return () => ({
    get: async (k: string) => { if (opts.throws) throw new Error('redis down'); return data.has(k) ? data.get(k) : null; },
    set: async (k: string, v: unknown) => { data.set(k, v); return 'OK'; },
    del: async (k: string) => { data.delete(k); return 1; },
  });
}
const req = (cookie?: string) => new Request('https://wageronweather.com/admin/wagers', { headers: cookie ? { cookie } : {} });
const REAL = 'abcdefghij0123456789abcdefghij01';

afterEach(() => __setAdminAuthStoreForTests(null));

test('a1: an arbitrary cookie value is rejected (the 46f4e52 hole)', async () => {
  __setAdminAuthStoreForTests(store());
  assert.equal(await validateSession('anything'), false);
  assert.equal(await validateSession('abcdefghij0123456789abcdefghij99'), false);
  assert.equal(await requireAdmin(req('wow_admin_session=letmein')), null);
  assert.equal(await requireAdmin(req(`wow_admin_session=${'x'.repeat(32)}`)), null);
});

test('a2: a session that exists in the store is accepted', async () => {
  __setAdminAuthStoreForTests(store({ [`session:${REAL}`]: { operatorId: 'primary-admin', readOnly: false } }));
  assert.equal(await validateSession(REAL), true);
  assert.equal(await requireAdmin(req(`other=1; wow_admin_session=${REAL}`)), REAL);
});

test('a3: store unreachable → not logged in (fail closed)', async () => {
  __setAdminAuthStoreForTests(store({ [`session:${REAL}`]: {} }, { throws: true }));
  assert.equal(await validateSession(REAL), false);
  assert.equal(await requireAdmin(req(`wow_admin_session=${REAL}`)), null);
});

test('a4: no cookie, empty cookie, or malformed id → null', async () => {
  __setAdminAuthStoreForTests(store({ 'session:': {} }));
  assert.equal(await requireAdmin(req()), null);
  assert.equal(await requireAdmin(req('wow_admin_session=')), null);
  assert.equal(await validateSession('../../etc'), false);
  assert.equal(await validateSession('UPPERCASE0123456789ABCDEFGHIJKL'), false);
});

test('a5: a session created by login validates; ids are 32 chars [a-z0-9] and not repeated', async () => {
  __setAdminAuthStoreForTests(store());
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const id = await createSession('primary-admin', false);
    assert.match(id, /^[a-z0-9]{32}$/);
    assert.equal(await validateSession(id), true);
    ids.add(id);
  }
  assert.equal(ids.size, 50);
});

test('a6: session ids come from crypto, not Math.random', async () => {
  __setAdminAuthStoreForTests(store());
  const real = Math.random;
  (Math as any).random = () => 0;
  try {
    const a = await createSession(), b = await createSession();
    assert.notEqual(a, b, 'ids must not depend on Math.random');
  } finally {
    (Math as any).random = real;
  }
});

test('a7: an unexpected error inside requireAdmin is never a login', async () => {
  __setAdminAuthStoreForTests(store());
  let calls = 0;
  const flaky = { headers: { get: () => { calls++; if (calls === 1) throw new Error('boom'); return 'wow_admin_session=letmein'; } } } as unknown as Request;
  assert.equal(await requireAdmin(flaky), null);
});
