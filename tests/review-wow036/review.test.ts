// Independent review of WOW-036 / nov20: add players, the mustChangePassword
// gate, server-priced sportsbook legs, practice-only payments. Closure round
// (WOW-037): every former FINDING is now a requirement test named "CLOSED #n:"
// that FAILS if the defect returns. Tests named "INFO:" or "OPEN:" document
// current behaviour that is deferred or newly found; they pass while that
// behaviour is present.
//
// Every test runs against an in-memory fake Redis with the network stubbed.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CountingRedis } from '../helpers/counting-redis';
import { setRedisForTests } from '../../src/lib/redis';
import { POST as createPOST } from '../../src/pages/api/admin/users/create';
import { POST as loginPOST } from '../../src/pages/api/auth/login';
import { POST as registerPOST } from '../../src/pages/api/auth/register';
import { POST as logoutPOST } from '../../src/pages/api/auth/logout';
import { POST as changePwPOST } from '../../src/pages/api/auth/change-password';
import { POST as betsPOST } from '../../src/pages/api/bets';
import { POST as placePOST } from '../../src/pages/api/bets/place';
import { setSportsbookOpenForTests } from '../../src/lib/practice-only';
// Bovada-line betting is paused in production (WOW-039 A); these tests check the
// rules behind that gate, so they run with it open. tests/sportsbook-gate.test.ts
// checks the gate itself with the real constant.
setSportsbookOpenForTests(true);
import { POST as checkoutPOST } from '../../src/pages/api/payments/create-checkout';
import { POST as withdrawPOST } from '../../src/pages/api/payments/withdraw';
import { checkLeg, MAX_LINE_AGE_MS } from '../../src/lib/sportsbook-bet-check';

// ── Fake Redis extended for this review (helper left untouched) ─────────────
class ReviewRedis extends CountingRedis {
  failGetOnce = new Set<string>();
  failSetPrefix: string | null = null;
  failSaddOnce = false;
  failPipelineOnce = false;
  failExpireOncePrefix: string | null = null;
  failZaddPrefix: string | null = null;
  failDelPrefix: string | null = null;
  override async expire(key: string, seconds: number) {
    if (this.failExpireOncePrefix && key.startsWith(this.failExpireOncePrefix)) { this.failExpireOncePrefix = null; throw new Error('simulated EXPIRE failure'); }
    return super.expire(key, seconds);
  }
  override async zadd(key: string, ...members: { score: number; member: string }[]) {
    if (this.failZaddPrefix && key.startsWith(this.failZaddPrefix)) throw new Error('simulated ZADD failure');
    return super.zadd(key, ...members);
  }
  override async del(...keys: string[]) {
    if (this.failDelPrefix && keys.some((k) => k.startsWith(this.failDelPrefix!))) throw new Error('simulated DEL failure');
    return super.del(...keys);
  }
  override async get(key: string) {
    if (this.failGetOnce.has(key)) { this.failGetOnce.delete(key); throw new Error('simulated Upstash timeout'); }
    return super.get(key);
  }
  override async set(key: string, value: unknown, opts: { ex?: number; nx?: boolean } = {}) {
    if (this.failSetPrefix && key.startsWith(this.failSetPrefix)) throw new Error('simulated Upstash write failure');
    return super.set(key, value, opts);
  }
  override async sadd(key: string, ...members: string[]) {
    if (this.failSaddOnce) { this.failSaddOnce = false; throw new Error('simulated SADD failure'); }
    return super.sadd(key, ...members);
  }
  override pipeline() {
    const p = super.pipeline();
    if (!this.failPipelineOnce) return p;
    this.failPipelineOnce = false;
    return new Proxy(p, { get: (t, prop) => prop === 'exec' ? async () => { throw new Error('simulated pipeline failure'); } : Reflect.get(t, prop) });
  }
  // Real Redis stores hash fields as strings, so HGET h 21543210 == HGET h "21543210".
  override async hget(key: string, field: any) { return super.hget(key, String(field)); }
  /** Models the debitBalance Lua script as Redis would run it. */
  async eval(_script: string, keys: string[], argv: string[]) {
    this.calls.push({ cmd: 'eval', key: keys[0], args: argv });
    const amt = /^-?\d+(\.\d+)?$/.test(argv[0]) ? Number(argv[0]) : null;
    if (amt === null) throw new Error('ERR user_script:3: attempt to compare number with nil script: 1a2b3c, on @user_script:3.');
    const cur = Number(this.kv.get(keys[0]) ?? 0);
    if (cur < amt) return -1;
    const v = cur - amt;
    this.kv.set(keys[0], v);
    return v;
  }
}

const READS = new Set(['get', 'mget', 'hget', 'hgetall', 'hmget', 'exists', 'zcard', 'zrange', 'smembers', 'lrange']);
const writesOf = (r: ReviewRedis) => r.calls.filter((c) => !READS.has(c.cmd));

const ADMIN_SID = 'adminsessionid000001';
const ADMIN_COOKIE = `wow_admin_session=${ADMIN_SID}`;
const GAME = '21543210';
const GAME2 = '21543211';
let r: ReviewRedis;
const realFetch = globalThis.fetch;
let fetchCalls = 0;

const post = (path: string, body: unknown, cookie?: string) => new Request(`https://wageronweather.com${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const call = (h: any, req: Request) => h({ request: req } as any) as Promise<Response>;
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const userIdFor = (email: string) => r.kv.get(`user:by-email:${email}`) as string;
const userRec = (id: string) => JSON.parse(r.kv.get(`user:${id}`) as string);

/** 32-char [a-z0-9] session id derived from the user id (the format the hotfix requires). */
const sidFor = (id: string) => (id.toLowerCase().replace(/[^a-z0-9]/g, '') + '0'.repeat(32)).slice(0, 32);

function summary(id: string, over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id, league: 'nfl', startTime: now + 2 * 3600_000, description: `Away ${id} @ Home ${id}`,
    home: 'Home', away: 'Away', homeShort: null, awayShort: null,
    lines: {
      bookmaker: 'feed', lastUpdate: new Date(now).toISOString(),
      moneylineHome: -150, moneylineAway: 130,
      spreadHome: { point: -3.5, price: -110 }, spreadAway: { point: 3.5, price: -110 },
      total: { point: 44.5, overPrice: -110, underPrice: -105 },
      homeRotation: null, awayRotation: null, live: false, feedGameId: id,
    },
    liveLines: null, marketCount: 3, groups: ['Game Lines'],
    fullAt: now - 5 * 60_000, seenAt: now - 60_000, liveAt: null, liveSeenAt: null,
    ...over,
  };
}
function seedGame(id: string, over: Record<string, unknown> = {}) {
  const s = summary(id, over);
  r.kv.set(`oddsfeed:game:${id}`, JSON.stringify({ id, league: 'nfl', description: s.description, startTime: s.startTime, live: false, competitors: [], groups: [], scope: 'full' }));
  const h = r.hashes.get('oddsfeed:summary:nfl') ?? new Map();
  h.set(id, JSON.stringify(s));
  r.hashes.set('oddsfeed:summary:nfl', h);
}
function seedUser(id: string, extra: Record<string, unknown> = {}, balance = 10_000_000) {
  const sid = sidFor(id);
  r.kv.set(`user-session:${sid}`, JSON.stringify({ userId: id, createdAt: new Date().toISOString() }));
  r.kv.set(`user:${id}`, JSON.stringify({ id, playerNumber: '123456', email: `${id}@example.com`, displayName: id, createdAt: '', emailVerified: false, ...extra }));
  r.kv.set(`user:by-email:${id}@example.com`, id);
  r.kv.set(`balance:${id}`, balance);
  return `wow_user_session=${sid}.${id}`;
}
const ml = (gameId: any = GAME, side = 'home', odds = -150, extra: Record<string, unknown> = {}) => ({ gameId, gameDescription: 'client text', oddsType: 'moneyline', side, odds, ...extra });

async function adminCreate(email: string, extra: Record<string, unknown> = {}) {
  return call(createPOST, post('/api/admin/users/create', { email, ...extra }, ADMIN_COOKIE));
}
async function createAndLogin(email: string) {
  const cr = await (await adminCreate(email)).json();
  const lg = await call(loginPOST, post('/api/auth/login', { email, password: cr.tempPassword }));
  assert.equal(lg.status, 200);
  return { temp: cr.tempPassword as string, cookie: cookieOf(lg) };
}

function fresh() {
  r = new ReviewRedis();
  setRedisForTests(r);
  r.kv.set(`session:${ADMIN_SID}`, { createdAt: new Date().toISOString(), operatorId: 'primary-admin', readOnly: false });
  seedGame(GAME);
  seedGame(GAME2);
}

before(() => {
  globalThis.fetch = (async () => { fetchCalls++; throw new Error('network disabled in test'); }) as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; setRedisForTests(null); });
beforeEach(() => fresh());

// ── R1 / R3 / R4: admin creates a player ────────────────────────────────────
describe('admin create (R1, R3, R4)', () => {
  it('no admin cookie is 401, nothing written', async () => {
    r.reset();
    const res = await call(createPOST, post('/api/admin/users/create', { email: 'p@example.com' }));
    assert.equal(res.status, 401);
    assert.deepEqual(writesOf(r), []);
  });
  it('a forged admin cookie (well-formed, not in the store) is 401', async () => {
    const res = await call(createPOST, post('/api/admin/users/create', { email: 'p@example.com' }, 'wow_admin_session=abcdefghijklmnop1234'));
    assert.equal(res.status, 401);
  });
  it('a player session cookie is not an admin session (401)', async () => {
    const c = seedUser('u_x');
    const res = await call(createPOST, post('/api/admin/users/create', { email: 'p@example.com' }, c));
    assert.equal(res.status, 401);
  });

  it('admin creates: 201, $100,000 default, flag set, bcrypt only, temp password nowhere in storage or logs', async () => {
    const logs: string[] = [];
    const saved = { ...console };
    for (const k of ['log', 'error', 'warn', 'info', 'debug'] as const) (console as any)[k] = (...a: unknown[]) => logs.push(a.map(String).join(' '));
    let res: Response;
    try {
      res = await adminCreate('  New.Player@Example.COM ');
    } finally { Object.assign(console, saved); }
    assert.equal(res!.status, 201);
    assert.equal(res!.headers.get('cache-control'), 'no-store');
    const body = await res!.json();
    const temp: string = body.tempPassword;
    assert.match(temp, /^[A-HJ-NP-Za-km-np-z2-9]{12}$/);
    assert.equal(body.user.email, 'new.player@example.com');
    assert.equal(body.user.passwordHash, undefined, 'hash not returned');
    const id = userIdFor('new.player@example.com');
    assert.match(id, /^u_/, 'by-email points at the user, not the pending-create claim');
    const u = userRec(id);
    assert.equal(u.mustChangePassword, true);
    assert.match(u.passwordHash, /^\$2[aby]\$12\$/);
    assert.equal(r.kv.get(`balance:${id}`), 10_000_000);
    const everything = JSON.stringify([[...r.kv], [...r.hashes].map(([k, h]) => [k, [...h]]), [...r.zsets].map(([k, z]) => [k, [...z]]), [...r.sets].map(([k, s]) => [k, [...s]]), r.calls]);
    assert.ok(!everything.includes(temp), 'temp password appears in a stored value or Redis call');
    assert.ok(!logs.join('\n').includes(temp), 'temp password logged');
    const txId = [...(r.zsets.get(`transactions:${id}`)?.keys() ?? [])][0];
    const tx = JSON.parse(r.kv.get(`transaction:${txId}`) as string);
    assert.equal(tx.type, 'deposit');
    assert.equal(tx.amountCents, 10_000_000);
    assert.doesNotMatch(tx.description, new RegExp(temp));
  });

  it('duplicate email differing only in case or whitespace is 409, no second user', async () => {
    assert.equal((await adminCreate('Dup@Example.com')).status, 201);
    for (const e of ['dup@example.com', 'DUP@EXAMPLE.COM', '  dUp@example.com  ']) {
      assert.equal((await adminCreate(e)).status, 409, e);
    }
    assert.equal([...r.kv.keys()].filter((k) => /^user:u_/.test(k)).length, 1);
  });
  it('duplicate of an existing (self-registered) user is 409', async () => {
    seedUser('u_old');
    assert.equal((await adminCreate('U_OLD@example.com')).status, 409);
  });
  it('bad bankrolls refused: string, negative, over $10M, boolean (null falls back to the default)', async () => {
    for (const v of ['100000', -1, 10_000_001, null, true]) {
      const res = await adminCreate(`b${String(v)}@example.com`.replace(/[^a-z0-9@.]/gi, 'x'), { startingBalanceDollars: v });
      if (v === null) assert.equal(res.status, 201);
      else assert.equal(res.status, 400, String(v));
    }
  });
  it('bankroll 0 creates a player with no balance and no transaction', async () => {
    assert.equal((await adminCreate('zero@example.com', { startingBalanceDollars: 0 })).status, 201);
    assert.equal(r.kv.get(`balance:${userIdFor('zero@example.com')}`), undefined);
  });

  it('CLOSED #9: non-string email or displayName is a JSON 400, nothing written', async () => {
    for (const body of [{ email: 12345 }, { email: ['a@b.co'] }, { email: 'n@example.com', displayName: 7 }, { email: 'n@example.com', displayName: { x: 1 } }]) {
      r.reset();
      const res = await call(createPOST, post('/api/admin/users/create', body, ADMIN_COOKIE));
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok((await res.json()).error);
      assert.deepEqual(writesOf(r), []);
    }
    for (const raw of ['null', '"str"', '42']) {
      assert.equal((await call(createPOST, post('/api/admin/users/create', raw, ADMIN_COOKIE))).status, 400, raw);
    }
  });
  it('CLOSED #10: two concurrent creates for one email: one 201, one 409, one user record', async () => {
    const [a, b] = await Promise.all([adminCreate('race@example.com'), adminCreate('RACE@example.com')]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal([...r.kv.keys()].filter((k) => /^user:u_/.test(k)).length, 1);
    assert.match(userIdFor('race@example.com'), /^u_/);
  });
  it('CLOSED #10 (claim release): if createUser fails the claim is released and a retry works', async () => {
    r.failPipelineOnce = true;
    const first = await adminCreate('retry@example.com');
    assert.equal(first.status, 500);
    assert.equal(r.kv.get('user:by-email:retry@example.com'), undefined, 'claim released');
    assert.equal((await adminCreate('retry@example.com')).status, 201);
  });
  it('CLOSED #11: a read-only (viewer) admin session is 403 in the handler itself, nothing written', async () => {
    r.kv.set('session:viewersession00000001', { createdAt: '', operatorId: 'viewer', readOnly: true });
    r.reset();
    const res = await call(createPOST, post('/api/admin/users/create', { email: 'viewer@example.com' }, 'wow_admin_session=viewersession00000001'));
    assert.equal(res.status, 403);
    assert.deepEqual(writesOf(r), []);
  });
  it('CLOSED (new) B: the admin-create claim is SET NX with ex <= 60, and the final by-email key has NO expiry', async () => {
    assert.equal((await adminCreate('ttl@example.com')).status, 201);
    const claim = r.calls.find((c) => c.cmd === 'set' && c.key === 'user:by-email:ttl@example.com' && c.args[0] === 'pending-create');
    assert.ok(claim, 'claim written');
    const opts = claim!.args[1] as { nx?: boolean; ex?: number };
    assert.equal(opts.nx, true);
    assert.ok(typeof opts.ex === 'number' && opts.ex > 0 && opts.ex <= 60, `ex=${opts.ex}`);
    assert.match(userIdFor('ttl@example.com'), /^u_/);
    assert.equal(r.ttl.get('user:by-email:ttl@example.com'), undefined, 'by-email must not keep the 60 s claim TTL (login would break after a minute)');
  });
  it('CLOSED (new) B: a claim left by a crash expires, after which the email can be created', async () => {
    await r.set('user:by-email:stuck@example.com', 'pending-create', { nx: true, ex: 60 }); // the function died mid-create
    assert.equal((await adminCreate('stuck@example.com')).status, 409, 'blocked only while the claim lives');
    r.kv.delete('user:by-email:stuck@example.com'); r.ttl.delete('user:by-email:stuck@example.com'); // model the expiry
    assert.equal((await adminCreate('stuck@example.com')).status, 201);
  });
  it('CLOSED (new) C: /api/auth/register respects a live pending-create claim (409, no user)', async () => {
    r.kv.set('user:by-email:mid@example.com', 'pending-create');
    const res = await call(registerPOST, post('/api/auth/register', { email: 'MID@example.com', password: 'selfpass123', displayName: 'Mid' }));
    assert.equal(res.status, 409);
    assert.equal(r.kv.get('user:by-email:mid@example.com'), 'pending-create');
    assert.equal([...r.kv.keys()].filter((k) => /^user:u_/.test(k)).length, 0);
  });
  it('CLOSED (new) C: register racing an admin create on one email (both orders): exactly one wins, one user, by-email has no TTL', async () => {
    for (let i = 0; i < 4; i++) {
      fresh();
      const email = `both${i}@example.com`;
      const reg = () => call(registerPOST, post('/api/auth/register', { email, password: 'selfpass123', displayName: 'Both' }));
      const order = i % 2 ? [adminCreate(email), reg()] : [reg(), adminCreate(email)];
      const statuses = (await Promise.all(order)).map((x) => x.status).sort();
      assert.deepEqual(statuses, [201, 409], `round ${i}`);
      assert.equal([...r.kv.keys()].filter((k) => /^user:u_/.test(k)).length, 1);
      assert.match(userIdFor(email), /^u_/);
      assert.equal(r.ttl.get(`user:by-email:${email}`), undefined);
    }
  });
  it('CLOSED (new) C: two concurrent self-registrations on one email: one 201, one 409, one user', async () => {
    const reg = (n: string) => call(registerPOST, post('/api/auth/register', { email: 'dup2@example.com', password: 'selfpass123', displayName: n }));
    const statuses = (await Promise.all([reg('Aa'), reg('Bb')])).map((x) => x.status).sort();
    assert.deepEqual(statuses, [201, 409]);
    assert.equal([...r.kv.keys()].filter((k) => /^user:u_/.test(k)).length, 1);
  });
});

// ── R2: flagged player cannot bet; flag lifecycle; sessions ─────────────────
describe('mustChangePassword gate and sessions (R2)', () => {
  it('flagged: /api/bets POST is 403 with no writes', async () => {
    const c = seedUser('u_f', { mustChangePassword: true });
    r.reset();
    const res = await call(betsPOST, post('/api/bets', { wagerId: 'w1', outcomeLabel: 'Over', amountCents: 1000 }, c));
    assert.equal(res.status, 403);
    assert.deepEqual(writesOf(r), []);
  });
  it('flagged: /api/bets/place POST is 403 with no writes, even with a valid leg', async () => {
    const c = seedUser('u_f', { mustChangePassword: true });
    r.reset();
    const res = await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, c));
    assert.equal(res.status, 403);
    assert.deepEqual(writesOf(r), []);
    assert.equal(r.kv.get('balance:u_f'), 10_000_000);
  });
  it('flagged: deposit and withdraw are still 403 practice-only, no Stripe, no writes', async () => {
    const c = seedUser('u_f', { mustChangePassword: true });
    r.reset(); fetchCalls = 0;
    for (const [h, p] of [[checkoutPOST, '/api/payments/create-checkout'], [withdrawPOST, '/api/payments/withdraw']] as const) {
      assert.equal((await call(h, post(p, { amountCents: 5000 }, c))).status, 403);
    }
    assert.equal(fetchCalls, 0);
    assert.deepEqual(writesOf(r), []);
  });
  it('signed out (or a cookie naming a user who does not exist) is 401 on deposit and withdraw', async () => {
    for (const [h, p] of [[checkoutPOST, '/api/payments/create-checkout'], [withdrawPOST, '/api/payments/withdraw']] as const) {
      assert.equal((await call(h, post(p, { amountCents: 5000 }))).status, 401);
      assert.equal((await call(h, post(p, { amountCents: 5000 }, `wow_user_session=${sidFor('nosuch')}.u_nobody`))).status, 401);
    }
  });

  it('end to end: create, sign in with temp, blocked, wrong current refused, set own, then bet works', async () => {
    const { temp, cookie } = await createAndLogin('flow@example.com');
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, cookie))).status, 403);
    assert.equal((await call(changePwPOST, post('/api/auth/change-password', { currentPassword: 'wrongwrong', newPassword: 'mynewpassword1' }, cookie))).status, 403);
    const id = userIdFor('flow@example.com');
    assert.equal(userRec(id).mustChangePassword, true, 'flag kept after a failed change');
    assert.equal((await call(changePwPOST, post('/api/auth/change-password', { currentPassword: temp, newPassword: 'short' }, cookie))).status, 400);
    assert.equal(userRec(id).mustChangePassword, true, 'flag kept after a too-short password');
    assert.equal((await call(changePwPOST, post('/api/auth/change-password', { currentPassword: temp, newPassword: 'mynewpassword1' }, cookie))).status, 200);
    assert.equal(userRec(id).mustChangePassword, false);
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, cookie))).status, 201, 'the session that changed the password keeps working');
    assert.equal((await call(loginPOST, post('/api/auth/login', { email: 'flow@example.com', password: temp }))).status, 401);
    assert.equal((await call(loginPOST, post('/api/auth/login', { email: 'flow@example.com', password: 'mynewpassword1' }))).status, 200);
  });

  it('CLOSED #7: the new password may not equal the temporary one (400, flag kept, still cannot bet)', async () => {
    const { temp, cookie } = await createAndLogin('same@example.com');
    const res = await call(changePwPOST, post('/api/auth/change-password', { currentPassword: temp, newPassword: temp }, cookie));
    assert.equal(res.status, 400);
    assert.equal(userRec(userIdFor('same@example.com')).mustChangePassword, true);
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, cookie))).status, 403);
  });
  it('CLOSED #7 (types): non-string newPassword or currentPassword is 400, flag kept', async () => {
    const { temp, cookie } = await createAndLogin('types@example.com');
    for (const b of [{ currentPassword: temp, newPassword: 123456789 }, { currentPassword: temp, newPassword: ['abcdefghi'] }, { currentPassword: [temp], newPassword: 'goodpassword1' }]) {
      assert.equal((await call(changePwPOST, post('/api/auth/change-password', b, cookie))).status, 400, JSON.stringify(b));
    }
    assert.equal(userRec(userIdFor('types@example.com')).mustChangePassword, true);
  });

  it('CLOSED #3: setting a password signs out the other sessions (the one opened with the texted temp password)', async () => {
    const { temp, cookie: intercept } = await createAndLogin('two@example.com');
    const player = cookieOf(await call(loginPOST, post('/api/auth/login', { email: 'two@example.com', password: temp })));
    assert.equal((await call(changePwPOST, post('/api/auth/change-password', { currentPassword: temp, newPassword: 'playerspassword' }, player))).status, 200);
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, intercept))).status, 401, 'other session revoked');
    assert.equal((await call(changePwPOST, post('/api/auth/change-password', { currentPassword: 'playerspassword', newPassword: 'attackerpass1' }, intercept))).status, 401);
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, player))).status, 201, 'own session kept');
    const uid = userIdFor('two@example.com');
    assert.deepEqual([...(r.sets.get(`user-sessions:${uid}`) ?? [])], [player.split('=')[1].split('.')[0]]);
  });
  it('CLOSED #3: revocation does not touch another user\'s sessions', async () => {
    const other = seedUser('u_other');
    const { temp, cookie } = await createAndLogin('three@example.com');
    await call(changePwPOST, post('/api/auth/change-password', { currentPassword: temp, newPassword: 'playerspassword' }, cookie));
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, other))).status, 201);
  });
  const liveSessions = () => [...r.kv.keys()].filter((k) => k.startsWith('user-session:'));
  it('CLOSED (new) A: if the index SADD fails, sign-in fails and leaves no usable session; later sessions are revocable', async () => {
    const cr = await (await adminCreate('lost@example.com')).json();
    const before = liveSessions().length;
    r.failSaddOnce = true;
    const lg = await call(loginPOST, post('/api/auth/login', { email: 'lost@example.com', password: cr.tempPassword }));
    assert.notEqual(lg.status, 200);
    assert.equal(lg.headers.get('set-cookie'), null, 'no cookie issued');
    assert.equal(liveSessions().length, before, 'the half-written session key was deleted');
    const s1 = cookieOf(await call(loginPOST, post('/api/auth/login', { email: 'lost@example.com', password: cr.tempPassword })));
    const s2 = cookieOf(await call(loginPOST, post('/api/auth/login', { email: 'lost@example.com', password: cr.tempPassword })));
    assert.equal((await call(changePwPOST, post('/api/auth/change-password', { currentPassword: cr.tempPassword, newPassword: 'playerspassword' }, s2))).status, 200);
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, s1))).status, 401);
  });
  it('CLOSED (new) A: if the index EXPIRE fails, sign-in fails and leaves no usable session', async () => {
    const cr = await (await adminCreate('exp@example.com')).json();
    const before = liveSessions().length;
    r.failExpireOncePrefix = 'user-sessions:';
    const lg = await call(loginPOST, post('/api/auth/login', { email: 'exp@example.com', password: cr.tempPassword }));
    assert.notEqual(lg.status, 200);
    assert.equal(lg.headers.get('set-cookie'), null);
    assert.equal(liveSessions().length, before);
  });
  it('CLOSED (new) A: that login failure is a generic 500 with no internal text', async () => {
    const cr = await (await adminCreate('gen@example.com')).json();
    r.failSaddOnce = true;
    const lg = await call(loginPOST, post('/api/auth/login', { email: 'gen@example.com', password: cr.tempPassword }));
    assert.equal(lg.status, 500);
    assert.doesNotMatch(await lg.text(), /simulated|SADD/);
  });
  it('INFO (new): register when the session index fails: user and $100,000 created, 500 with no cookie; the player can sign in later', async () => {
    r.failSaddOnce = true;
    const res = await call(registerPOST, post('/api/auth/register', { email: 'regfail@example.com', password: 'selfpass123', displayName: 'Rr' }));
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('set-cookie'), null);
    const id = userIdFor('regfail@example.com');
    assert.match(id, /^u_/);
    assert.equal(r.kv.get(`balance:${id}`), 10_000_000);
    assert.equal((await call(loginPOST, post('/api/auth/login', { email: 'regfail@example.com', password: 'selfpass123' }))).status, 200);
  });
  it('INFO (new): if the cleanup DEL also fails, an unindexed session key survives, but its id never reaches the client', async () => {
    const cr = await (await adminCreate('dbl@example.com')).json();
    const before = liveSessions().length;
    r.failSaddOnce = true;
    r.failDelPrefix = 'user-session:';
    const lg = await call(loginPOST, post('/api/auth/login', { email: 'dbl@example.com', password: cr.tempPassword }));
    r.failDelPrefix = null;
    assert.notEqual(lg.status, 200);
    assert.equal(lg.headers.get('set-cookie'), null);
    assert.equal(liveSessions().length, before + 1);
  });
  it('INFO: whoever uses the temp password first can set the password and sign the real player out (inherent to a texted temp password)', async () => {
    const { temp, cookie: attacker } = await createAndLogin('first@example.com');
    const player = cookieOf(await call(loginPOST, post('/api/auth/login', { email: 'first@example.com', password: temp })));
    assert.equal((await call(changePwPOST, post('/api/auth/change-password', { currentPassword: temp, newPassword: 'attackerpass1' }, attacker))).status, 200);
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, player))).status, 401);
  });
  it('INFO: logout deletes the session but leaves its id in the per-user index (harmless; revocation then deletes a missing key)', async () => {
    const { cookie } = await createAndLogin('lo@example.com');
    await call(logoutPOST, post('/api/auth/logout', {}, cookie));
    const uid = userIdFor('lo@example.com');
    assert.equal((r.sets.get(`user-sessions:${uid}`) ?? new Set()).size, 1);
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, cookie))).status, 401);
  });

  it('CLOSED #4: a Redis error on the user fetch is signed out (401), not a flag-less fallback user', async () => {
    const c = seedUser('u_f', { mustChangePassword: true, frozen: true });
    r.failGetOnce.add('user:u_f');
    const res = await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, c));
    assert.equal(res.status, 401);
    assert.equal(r.kv.get('balance:u_f'), 10_000_000);
  });
  it('CLOSED #2: a made-up session id with a real user id is 401', async () => {
    seedUser('u_victim');
    for (const cookie of [`wow_user_session=${'a'.repeat(32)}.u_victim`, 'wow_user_session=anything.u_victim', 'wow_user_session=.u_victim']) {
      assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, cookie))).status, 401, cookie);
    }
    assert.equal(r.kv.get('balance:u_victim'), 10_000_000);
  });
  it('CLOSED #2: a Google-only user cannot have a password set through a forged cookie', async () => {
    seedUser('u_google', { googleId: 'g-1' });
    const res = await call(changePwPOST, post('/api/auth/change-password', { newPassword: 'attackerpass1' }, `wow_user_session=${'z'.repeat(32)}.u_google`));
    assert.equal(res.status, 401);
    assert.equal(userRec('u_google').passwordHash, undefined);
  });
  it('CLOSED #2: a real session id with someone else\'s user id after the dot is 401', async () => {
    seedUser('u_me');
    seedUser('u_victim');
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, `wow_user_session=${sidFor('u_me')}.u_victim`))).status, 401);
  });
  it('CLOSED #2: a Redis error on the session lookup is 401 (fail closed)', async () => {
    const c = seedUser('u_e');
    r.failGetOnce.add(`user-session:${sidFor('u_e')}`);
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, c))).status, 401);
  });
  it('hotfix keeps legitimate flows: register cookie, login cookie, and a stored legacy cookie with no dot all work', async () => {
    const reg = await call(registerPOST, post('/api/auth/register', { email: 'reg@example.com', password: 'selfpass123', displayName: 'Reg' }));
    assert.equal(reg.status, 201);
    const regCookie = cookieOf(reg);
    assert.match(regCookie, /^wow_user_session=[a-z0-9]{32}\.u_/);
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, regCookie))).status, 201);
    const lg = await call(loginPOST, post('/api/auth/login', { email: 'reg@example.com', password: 'selfpass123' }));
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml(GAME2, 'away', 130)], stake: 10 }, cookieOf(lg)))).status, 201);
    const c = seedUser('u_legacy');
    const legacy = c.split('.')[0]; // sessionId only, as old cookies were
    assert.equal((await call(placePOST, post('/api/bets/place', { legs: [ml()], stake: 10 }, legacy))).status, 201);
  });
});

// ── R5 / R7: sportsbook legs priced by the server ───────────────────────────
describe('sportsbook leg checks (R5, R7)', () => {
  const place = async (body: unknown, c: string) => {
    const res = await call(placePOST, post('/api/bets/place', body, c));
    return { res, body: await res.json() };
  };
  const storedBet = () => {
    const k = [...r.kv.keys()].find((x) => x.startsWith('bet:'));
    return k ? JSON.parse(r.kv.get(k) as string) : null;
  };

  it('a correct single is accepted and stored with the server numbers and description', async () => {
    const c = seedUser('u_p');
    const { res } = await place({ legs: [{ gameId: GAME, gameDescription: 'EVIL', oddsType: 'spread', side: 'home', odds: -110, line: -3.5 }], stake: 100 }, c);
    assert.equal(res.status, 201);
    const b = storedBet();
    assert.equal(b.legs[0].odds, -110);
    assert.equal(b.legs[0].line, -3.5);
    assert.equal(b.legs[0].gameDescription, `Away ${GAME} @ Home ${GAME}`);
    assert.equal(b.toWinCents, Math.round(10000 * (100 / 110)));
    assert.equal(r.kv.get('balance:u_p'), 10_000_000 - 10_000);
  });
  for (const [name, leg, status] of [
    ['wrong price (+5000)', ml(GAME, 'home', 5000), 409],
    ['wrong point', { gameId: GAME, oddsType: 'spread', side: 'home', odds: -110, line: -2.5 }, 409],
    ['spread with no point', { gameId: GAME, oddsType: 'spread', side: 'home', odds: -110 }, 409],
    ['point sent as a string', { gameId: GAME, oddsType: 'total', side: 'over', odds: -110, line: '44.5' }, 400],
    ['point null', { gameId: GAME, oddsType: 'total', side: 'over', odds: -110, line: null }, 400],
    ['odds sent as a string', { gameId: GAME, oddsType: 'moneyline', side: 'home', odds: '-150' }, 400],
    ['unknown game', ml('99999999'), 404],
    ['non-digit game id', ml('feed-nfl-g0'), 400],
    ['spread with side over', { gameId: GAME, oddsType: 'spread', side: 'over', odds: -110, line: -3.5 }, 409],
    ['moneyline with side under', { gameId: GAME, oddsType: 'moneyline', side: 'under', odds: -105 }, 409],
    ["oddsType 'prop'", { gameId: GAME, oddsType: 'prop', side: 'home', odds: -150 }, 400],
    ['side not allowed', { gameId: GAME, oddsType: 'moneyline', side: 'draw', odds: -150 }, 400],
    ['side as an array', { gameId: GAME, oddsType: 'moneyline', side: ['home'], odds: -150 }, 400],
    ['leg is null', null, 400],
  ] as const) {
    it(`refused: ${name} (${status}), no debit, no bet`, async () => {
      const c = seedUser('u_p');
      const { res } = await place({ legs: [leg], stake: 100 }, c);
      assert.equal(res.status, status);
      assert.equal(r.kv.get('balance:u_p'), 10_000_000);
      assert.equal(storedBet(), null);
    });
  }
  it('refused: stale lines (61 minutes), and accepted at 59 minutes', async () => {
    const c = seedUser('u_p');
    const old = Date.now() - 61 * 60_000;
    seedGame(GAME, { seenAt: old, fullAt: old });
    assert.equal((await place({ legs: [ml()], stake: 10 }, c)).res.status, 409);
    const ok = Date.now() - 59 * 60_000;
    seedGame(GAME, { seenAt: ok, fullAt: ok });
    assert.equal((await place({ legs: [ml()], stake: 10 }, c)).res.status, 201);
  });
  it('refused: after kickoff, and at exactly kickoff (checkLeg)', async () => {
    const c = seedUser('u_p');
    seedGame(GAME, { startTime: Date.now() - 1000 });
    assert.equal((await place({ legs: [ml()], stake: 10 }, c)).res.status, 409);
    const now = 1_800_000_000_000;
    const s = { ...summary(GAME), startTime: now, seenAt: now } as any;
    assert.equal(checkLeg(ml() as any, s, now).ok, false);
    assert.equal(MAX_LINE_AGE_MS, 3_600_000);
  });
  it('refused: game in the feed but missing from the summary (404)', async () => {
    const c = seedUser('u_p');
    r.hashes.get('oddsfeed:summary:nfl')!.delete(GAME);
    assert.equal((await place({ legs: [ml()], stake: 10 }, c)).res.status, 404);
  });
  it('refused: a parlay with two legs on one game (same string id)', async () => {
    const c = seedUser('u_p');
    assert.equal((await place({ legs: [ml(), { gameId: GAME, oddsType: 'total', side: 'over', odds: -110, line: 44.5 }], stake: 10 }, c)).res.status, 400);
  });
  it('a two-game parlay is accepted with the server prices', async () => {
    const c = seedUser('u_p');
    const { res, body } = await place({ legs: [ml(GAME), ml(GAME2, 'away', 130)], stake: 10 }, c);
    assert.equal(res.status, 201);
    assert.equal(storedBet().type, 'parlay');
    assert.equal(body.bet.decimalOdds, Math.round((1 + 100 / 150) * 2.3 * 10000) / 10000);
  });

  it('CLOSED #1: one game as a string and as a number is refused (400), no debit', async () => {
    const c = seedUser('u_p');
    const { res } = await place({ legs: [ml(GAME, 'away', 130), ml(Number(GAME), 'away', 130)], stake: 100 }, c);
    assert.equal(res.status, 400);
    assert.equal(r.kv.get('balance:u_p'), 10_000_000);
    assert.equal(storedBet(), null);
  });
  it('CLOSED #1: array / nested-array / padded / leading-zero spellings of a game id are refused', async () => {
    const c = seedUser('u_p');
    const ids: any[] = [[GAME], [[GAME]], [Number(GAME)], ` ${GAME}`, `${GAME} `, `0${GAME}`, `${GAME}.0`, `${GAME}\n`];
    for (const id of ids) {
      const { res } = await place({ legs: [ml(GAME, 'away', 130), ml(id, 'away', 130)], stake: 100 }, c);
      assert.ok(res.status === 400 || res.status === 404, `${JSON.stringify(id)} -> ${res.status}`);
    }
    assert.equal(r.kv.get('balance:u_p'), 10_000_000);
  });
  it('CLOSED #1: more than 10 legs is refused', async () => {
    const c = seedUser('u_p');
    const legs = Array.from({ length: 11 }, (_, i) => ml(String(30000000 + i)));
    assert.equal((await place({ legs, stake: 10 }, c)).res.status, 400);
  });
  it('CLOSED #5: the stored leg holds only whitelisted fields with server values (no client line, result, status)', async () => {
    const c = seedUser('u_p');
    const { res } = await place({ legs: [ml(GAME, 'home', -150, { line: undefined, result: 'won', status: 'won', payout: 1e9 })], stake: 10 }, c);
    assert.equal(res.status, 201);
    const leg = storedBet().legs[0];
    assert.deepEqual(Object.keys(leg).sort(), ['gameDescription', 'gameId', 'odds', 'oddsType', 'side', 'startTime']);
    assert.equal(leg.odds, -150);
    assert.equal(typeof leg.startTime, 'number');
  });
  it('CLOSED #5: a numeric client "line" on a moneyline leg is not stored', async () => {
    const c = seedUser('u_p');
    const { res } = await place({ legs: [ml(GAME, 'home', -150, { line: 999 })], stake: 10 }, c);
    assert.equal(res.status, 201);
    assert.ok(!('line' in storedBet().legs[0]));
  });
  it('CLOSED #5: a spread leg stores the server point and price; extra top-level body fields are not stored', async () => {
    const c = seedUser('u_p');
    const { res } = await place({ legs: [{ gameId: GAME, oddsType: 'spread', side: 'away', odds: -110, line: 3.5, payout: 1e9 }], stake: 10, toWinCents: 1e12, status: 'won' }, c);
    assert.equal(res.status, 201);
    const b = storedBet();
    assert.deepEqual(Object.keys(b.legs[0]).sort(), ['gameDescription', 'gameId', 'line', 'odds', 'oddsType', 'side', 'startTime']);
    assert.equal(b.status, 'open');
    assert.equal(b.toWinCents, Math.round(1000 * (100 / 110)));
  });
  it('CLOSED #6: never priced from liveLines (lines null, live lines present, start time ahead) -> 409', async () => {
    const c = seedUser('u_p');
    const live = { ...summary(GAME).lines, moneylineHome: 900, live: true };
    seedGame(GAME, { lines: null, liveLines: live, liveAt: Date.now() - 10_000, liveSeenAt: Date.now() });
    assert.equal((await place({ legs: [ml(GAME, 'home', 900)], stake: 10 }, c)).res.status, 409);
    assert.equal(r.kv.get('balance:u_p'), 10_000_000);
  });
  it('CLOSED #6: pre-game lines marked live are refused even with a future start time', async () => {
    const c = seedUser('u_p');
    seedGame(GAME, { lines: { ...summary(GAME).lines, live: true } });
    assert.equal((await place({ legs: [ml()], stake: 10 }, c)).res.status, 409);
  });
  it('INFO (accepted design): liveAt set, pre-game lines not live, start time ahead -> bettable at the PRE-GAME price only', async () => {
    const c = seedUser('u_p');
    const live = { ...summary(GAME).lines, moneylineHome: 900, live: false };
    seedGame(GAME, { liveLines: live, liveAt: Date.now() - 10_000 });
    assert.equal((await place({ legs: [ml(GAME, 'home', 900)], stake: 10 }, c)).res.status, 409, 'the live price is not honoured');
    assert.equal((await place({ legs: [ml(GAME, 'home', -150)], stake: 10 }, c)).res.status, 201);
  });
  it('CLOSED #8: bad stakes are 400 with no debit attempted: "abc", "10", 0.001, 0.004, null, [10], -5, 0, 1,000,001, 1e309', async () => {
    const c = seedUser('u_p');
    for (const s of ['abc', '10', 0.001, 0.004, null, [10], -5, 0, 1_000_001]) {
      r.reset();
      const { res, body } = await place({ legs: [ml()], stake: s }, c);
      assert.equal(res.status, 400, String(s));
      assert.equal(body.details, undefined);
      assert.ok(!r.calls.some((x) => x.cmd === 'eval'), `debit attempted for ${String(s)}`);
    }
    // 1e309 is Infinity in JSON.parse
    const raw = await call(placePOST, post('/api/bets/place', `{"legs":[{"gameId":"${GAME}","oddsType":"moneyline","side":"home","odds":-150}],"stake":1e309}`, c));
    assert.equal(raw.status, 400);
    assert.equal(r.kv.get('balance:u_p'), 10_000_000);
  });
  it('CLOSED #8: an unexpected server error is a 500 with no internal error text', async () => {
    const c = seedUser('u_p');
    r.failSetPrefix = 'bet:';
    const saved = console.error; console.error = () => {};
    let res: Response, body: any;
    try { ({ res, body } = await place({ legs: [ml()], stake: 10 }, c)); } finally { console.error = saved; }
    assert.equal(res!.status, 500);
    assert.deepEqual(Object.keys(body), ['error']);
    assert.doesNotMatch(JSON.stringify(body), /simulated|Upstash/);
  });
  const quiet = async <T,>(f: () => Promise<T>) => { const s = console.error; console.error = () => {}; try { return await f(); } finally { console.error = s; } };
  it('CLOSED (new) D: SET bet: fails after the debit -> stake refunded, 500 {error} only, no bet, no bet_placed transaction', async () => {
    const c = seedUser('u_p');
    r.failSetPrefix = 'bet:';
    const { res, body } = await quiet(() => place({ legs: [ml()], stake: 10 }, c));
    assert.equal(res.status, 500);
    assert.deepEqual(Object.keys(body), ['error']);
    assert.equal(r.kv.get('balance:u_p'), 10_000_000);
    assert.equal(storedBet(), null);
    assert.equal(r.zsets.get('transactions:u_p'), undefined);
  });
  it('CLOSED (new) D: ZADD user-bets: fails after SET -> stake refunded, 500 {error} only', async () => {
    const c = seedUser('u_p');
    r.failZaddPrefix = 'user-bets:';
    const { res, body } = await quiet(() => place({ legs: [ml()], stake: 10 }, c));
    assert.equal(res.status, 500);
    assert.deepEqual(Object.keys(body), ['error']);
    assert.equal(r.kv.get('balance:u_p'), 10_000_000);
  });
  it('CLOSED (round 2): after a ZADD failure the stake is refunded and no bet:<id> record remains', async () => {
    const c = seedUser('u_p');
    r.failZaddPrefix = 'user-bets:';
    const { res } = await quiet(() => place({ legs: [ml()], stake: 10 }, c));
    assert.equal(res.status, 500);
    assert.equal(storedBet(), null, 'no orphan bet record');
    assert.equal(r.kv.get('balance:u_p'), 10_000_000, 'stake refunded');
  });
  it('CLOSED (round 2): if recordTransaction fails after the bet is stored, the client gets 201 and the bet stands, stake debited once', async () => {
    const c = seedUser('u_p');
    r.failSetPrefix = 'transaction:';
    const { res } = await quiet(() => place({ legs: [ml()], stake: 10 }, c));
    assert.equal(res.status, 201);
    assert.ok(storedBet(), 'bet recorded');
    assert.equal(r.kv.get('balance:u_p'), 10_000_000 - 1000);
  });
  it('CLOSED #8: stake above the balance is 400; concurrent bets cannot overdraw and the loser gets 400', async () => {
    let c = seedUser('u_p', {}, 500);
    assert.equal((await place({ legs: [ml()], stake: 10 }, c)).res.status, 400);
    assert.equal(r.kv.get('balance:u_p'), 500);
    fresh();
    c = seedUser('u_p', {}, 1000);
    const out = await Promise.all([place({ legs: [ml()], stake: 10 }, c), place({ legs: [ml()], stake: 10 }, c)]);
    assert.deepEqual(out.map((o) => o.res.status).sort(), [201, 400]);
    assert.equal(r.kv.get('balance:u_p'), 0);
  });
  it('a stake of 0.015 is charged as 2 cents and the response reports the stake actually charged', async () => {
    const c = seedUser('u_p');
    const { res, body } = await place({ legs: [ml()], stake: 0.015 }, c);
    assert.equal(res.status, 201);
    assert.equal(r.kv.get('balance:u_p'), 10_000_000 - 2);
    assert.equal(body.bet.stake, 0.02);
  });
  it('frozen user is refused on /api/bets/place', async () => {
    const c = seedUser('u_p', { frozen: true });
    assert.equal((await place({ legs: [ml()], stake: 10 }, c)).res.status, 403);
  });
});
