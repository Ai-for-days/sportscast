// WOW-037 hotfix: player sessions fail closed; Google sign-in mints no fallback
// cookies and enforces its CSRF state.
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setRedisForTests } from '../src/lib/redis';
import { validateUserSession, requireUser, createUserSession } from '../src/lib/user-auth';
import { GET as callbackGET } from '../src/pages/api/auth/google/callback';

const SID = 'abcdefghijklmnopqrstuvwxyz012345'; // 32 chars [a-z0-9]
const UID = 'u_m3abc_def123';

class TinyRedis {
  kv = new Map<string, unknown>();
  calls: string[] = [];
  throwOn: ((cmd: string, key: string) => boolean) | null = null;
  private chk(cmd: string, key: string) {
    this.calls.push(`${cmd} ${key}`);
    if (this.throwOn?.(cmd, key)) throw new Error('redis down');
  }
  async get(k: string) { this.chk('get', k); return this.kv.has(k) ? this.kv.get(k) : null; }
  async set(k: string, v: unknown) { this.chk('set', k); this.kv.set(k, v); return 'OK'; }
  async del(k: string) { this.chk('del', k); return this.kv.delete(k) ? 1 : 0; }
}

let r: TinyRedis;
const realFetch = globalThis.fetch;
beforeEach(() => {
  r = new TinyRedis();
  setRedisForTests(r);
  globalThis.fetch = realFetch;
});
after(() => { setRedisForTests(null); globalThis.fetch = realFetch; });

const userJson = (id = UID) => JSON.stringify({ id, playerNumber: '123456', email: 'p@example.com', displayName: 'P', createdAt: '', emailVerified: true });
const cookieReq = (value: string) => new Request('https://wageronweather.com/api/x', { headers: { cookie: `wow_user_session=${value}` } });

describe('validateUserSession fails closed', () => {
  it('a valid stored session still validates (with and without the embedded id)', async () => {
    r.kv.set(`user-session:${SID}`, JSON.stringify({ userId: UID, createdAt: 'x' }));
    assert.equal((await validateUserSession(`${SID}.${UID}`))?.userId, UID);
    assert.equal((await validateUserSession(SID))?.userId, UID);
  });
  it('a forged cookie: well-formed session id not in Redis, real user id after the dot -> null', async () => {
    r.kv.set(`user:${UID}`, userJson());
    assert.equal(await validateUserSession(`${SID}.${UID}`), null);
    assert.equal(await requireUser(cookieReq(`${SID}.${UID}`)), null);
  });
  it('Redis throwing -> null', async () => {
    r.throwOn = () => true;
    assert.equal(await validateUserSession(`${SID}.${UID}`), null);
  });
  it('embedded id that differs from the stored session -> null', async () => {
    r.kv.set(`user-session:${SID}`, JSON.stringify({ userId: UID, createdAt: 'x' }));
    assert.equal(await validateUserSession(`${SID}.u_someone_else`), null);
  });
  it('a badly formed session id -> null with no Redis call (old fs_ fallback cookies included)', async () => {
    for (const bad of ['fs_m3abc_x1y2z3', 'short', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', `${SID}x`, '', '../../etc']) {
      assert.equal(await validateUserSession(`${bad}.${UID}`), null, bad);
    }
    assert.deepEqual(r.calls, []);
  });
  it('createUserSession writes a 32-char [a-z0-9] id that then validates', async () => {
    const cookie = await createUserSession(UID);
    const [sid, uid] = cookie.split('.');
    assert.match(sid, /^[a-z0-9]{32}$/);
    assert.equal(uid, UID);
    assert.equal((await validateUserSession(cookie))?.userId, UID);
  });
});

describe('requireUser fails closed', () => {
  it('user fetch throwing -> null (no flagless stand-in user)', async () => {
    r.kv.set(`user-session:${SID}`, JSON.stringify({ userId: UID, createdAt: 'x' }));
    r.throwOn = (cmd, key) => cmd === 'get' && key === `user:${UID}`;
    assert.equal(await requireUser(cookieReq(`${SID}.${UID}`)), null);
  });
  it('a good session returns the stored user', async () => {
    r.kv.set(`user-session:${SID}`, JSON.stringify({ userId: UID, createdAt: 'x' }));
    r.kv.set(`user:${UID}`, userJson());
    assert.equal((await requireUser(cookieReq(`${SID}.${UID}`)))?.id, UID);
  });
});

describe('Google callback', () => {
  const STATE = 'st8';
  const call = () => callbackGET({ request: new Request(`https://www.wageronweather.com/api/auth/google/callback?code=c0de&state=${STATE}`) } as any);
  const googleOk = () => {
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at' }));
      if (u.includes('userinfo')) return new Response(JSON.stringify({ sub: 'g123', email: 'p@example.com', name: 'P' }));
      throw new Error('unexpected fetch ' + u);
    }) as typeof fetch;
  };
  const seedUser = () => {
    r.kv.set('user:by-google:g123', UID);
    r.kv.set(`user:${UID}`, userJson());
  };

  it('missing state in Redis -> 302 oauth_invalid, no cookie, no Google call', async () => {
    let fetched = 0;
    globalThis.fetch = (async () => { fetched++; throw new Error('no'); }) as typeof fetch;
    const res = await call();
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/bettheforecast?error=oauth_invalid');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(fetched, 0);
  });
  it('Redis error while checking state -> 302 oauth_invalid, no cookie', async () => {
    r.throwOn = (cmd, key) => key.startsWith('oauth-state:');
    const res = await call();
    assert.equal(res.headers.get('location'), '/bettheforecast?error=oauth_invalid');
    assert.equal(res.headers.get('set-cookie'), null);
  });
  it('session cannot be stored -> 302 oauth_session_failed, no cookie', async () => {
    r.kv.set(`oauth-state:${STATE}`, 'valid');
    seedUser();
    googleOk();
    r.throwOn = (cmd, key) => cmd === 'set' && key.startsWith('user-session:');
    const res = await call();
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/bettheforecast?error=oauth_session_failed');
    assert.equal(res.headers.get('set-cookie'), null);
  });
  it('user lookup failing -> 302 oauth_session_failed, no cookie (no g_ fallback)', async () => {
    r.kv.set(`oauth-state:${STATE}`, 'valid');
    googleOk();
    r.throwOn = (cmd, key) => cmd === 'get' && key.startsWith('user:by-google:');
    const res = await call();
    assert.equal(res.headers.get('location'), '/bettheforecast?error=oauth_session_failed');
    assert.equal(res.headers.get('set-cookie'), null);
  });
  it('honest login: valid state -> cookie for a stored session, state consumed', async () => {
    r.kv.set(`oauth-state:${STATE}`, 'valid');
    seedUser();
    googleOk();
    const res = await call();
    assert.equal(res.headers.get('location'), '/bettheforecast');
    const sc = res.headers.get('set-cookie') ?? '';
    const value = /wow_user_session=([^;]+)/.exec(sc)?.[1] ?? '';
    assert.equal((await validateUserSession(value))?.userId, UID);
    assert.equal(r.kv.has(`oauth-state:${STATE}`), false);
  });
});
