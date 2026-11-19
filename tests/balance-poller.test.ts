// WOW-034 (1): one shared balance poller, 60 s, paused while hidden.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBalancePoller, BALANCE_POLL_MS, type BalanceEnv } from '../src/lib/balance-poller';

function fakeEnv(opts: { status?: number; balance?: number } = {}) {
  let hidden = false;
  const vis = new Set<() => void>();
  const changed = new Set<() => void>();
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  const env: BalanceEnv & { fetches: number; hide(v: boolean): void; tick(): void; fireChanged(): void; timers: typeof timers } = {
    fetches: 0,
    timers,
    fetch: async () => {
      env.fetches += 1;
      const status = opts.status ?? 200;
      return { ok: status === 200, status, json: async () => ({ balanceDollars: opts.balance ?? 12.5 }) };
    },
    isHidden: () => hidden,
    onVisibilityChange: (fn) => { vis.add(fn); return () => vis.delete(fn); },
    onBalanceChanged: (fn) => { changed.add(fn); return () => changed.delete(fn); },
    setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearInterval: (h) => { timers.delete(h as number); },
    hide(v) { hidden = v; for (const f of vis) f(); },
    tick() { for (const t of [...timers.values()]) t.fn(); },
    fireChanged() { for (const f of changed) f(); },
  };
  return env;
}

const settle = () => new Promise((r) => setImmediate(r));

describe('balance poller (WOW-034 1)', () => {
  it('polls every 60 s, not 5 s', () => {
    assert.equal(BALANCE_POLL_MS, 60_000);
    const env = fakeEnv();
    const p = createBalancePoller(env);
    p.subscribe(() => {});
    assert.deepEqual([...env.timers.values()].map((t) => t.ms), [60_000]);
  });

  it('two components on one page share ONE poller: one request per tick, one timer', async () => {
    const env = fakeEnv();
    const p = createBalancePoller(env);
    const seenA: (number | null)[] = [];
    const seenB: (number | null)[] = [];
    p.subscribe((s) => seenA.push(s.balanceDollars));
    p.subscribe((s) => seenB.push(s.balanceDollars));
    await settle();
    assert.equal(env.fetches, 1);
    assert.equal(env.timers.size, 1);
    env.tick();
    await settle();
    assert.equal(env.fetches, 2);
    assert.equal(seenA.at(-1), 12.5);
    assert.equal(seenB.at(-1), 12.5);
  });

  it('pauses while the tab is hidden and refetches once when it is visible again', async () => {
    const env = fakeEnv();
    const p = createBalancePoller(env);
    p.subscribe(() => {});
    await settle();
    assert.equal(env.fetches, 1);
    env.hide(true);
    assert.equal(env.timers.size, 0, 'no timer while hidden');
    env.tick();
    await settle();
    assert.equal(env.fetches, 1, 'nothing fetched while hidden');
    env.hide(false);
    await settle();
    assert.equal(env.fetches, 2, 'one refetch on becoming visible');
    assert.equal(env.timers.size, 1, 'polling resumes');
  });

  it('a page opened in a background tab does not fetch until it is shown', async () => {
    const env = fakeEnv();
    env.hide(true);
    const p = createBalancePoller(env);
    p.subscribe(() => {});
    await settle();
    assert.equal(env.fetches, 0);
    assert.equal(env.timers.size, 0);
    env.hide(false);
    await settle();
    assert.equal(env.fetches, 1);
  });

  it('refetches right after a bet (refresh() and the wow:balance-changed event)', async () => {
    const env = fakeEnv();
    const p = createBalancePoller(env);
    p.subscribe(() => {});
    await settle();
    await p.refresh();
    assert.equal(env.fetches, 2);
    env.fireChanged();
    await settle();
    assert.equal(env.fetches, 3);
  });

  it('concurrent refreshes share one request', async () => {
    const env = fakeEnv();
    const p = createBalancePoller(env);
    p.subscribe(() => {});
    await Promise.all([p.refresh(), p.refresh(), p.refresh()]);
    assert.equal(env.fetches, 1);
  });

  it('reports 401 as unauthenticated, once per completed request', async () => {
    const env = fakeEnv({ status: 401 });
    const p = createBalancePoller(env);
    const seqs: number[] = [];
    p.subscribe((s) => { if (s.status === 'unauthenticated') seqs.push(s.seq); });
    await settle();
    assert.equal(p.getState().status, 'unauthenticated');
    assert.equal(p.getState().balanceDollars, null);
    assert.ok(seqs.includes(1));
  });

  it('stops entirely when the last component unmounts', async () => {
    const env = fakeEnv();
    const p = createBalancePoller(env);
    const off = p.subscribe(() => {});
    await settle();
    off();
    assert.equal(env.timers.size, 0);
    env.hide(true);
    env.hide(false);
    await settle();
    assert.equal(env.fetches, 1, 'no visibility listener left behind');
  });

  it('UserMenu and BettingContext no longer run their own balance polls', () => {
    for (const f of ['src/components/UserMenu.tsx', 'src/components/betting/BettingContext.tsx']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      assert.ok(!src.includes("/api/account/balance"), `${f} fetches the balance itself`);
      assert.ok(!/setInterval\(/.test(src), `${f} runs its own interval`);
      assert.match(src, /getBalancePoller\(\)/);
    }
  });
});
