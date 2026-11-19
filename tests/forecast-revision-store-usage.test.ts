// WOW-034 (2): the ZIP revision store returns exactly what it did before the
// command cuts (no second latest-snapshot read, one MGET), on fixtures.
// The ZIP page no longer renders these cards (they moved to the admin
// research tool), so the page-HTML golden cannot see them; this checks the
// store's own outputs and writes. Golden written from the pre-cut store.

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CountingRedis, strict } from './helpers/counting-redis';
import { NOW, forecastAt } from './helpers/usage-fixtures';
import { setRedisForTests } from '../src/lib/redis';
import { captureRevision, listSnapshots, recordSnapshotIfNew, getLatestSnapshot, buildSnapshot, SNAPSHOT_TTL_SECONDS } from '../src/lib/forecast-revision-store';

const GOLDEN = join(process.cwd(), 'tests', 'fixtures', 'usage-golden', 'revision-store.json');
const LOC = 'us:29209';
const realRandom = Math.random;

function seeded() {
  let x = 42;
  Math.random = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

function world(n: number, latestGeneratedAt: string | null): CountingRedis {
  const r = new CountingRedis();
  const z = new Map<string, number>();
  for (let i = n; i >= 1; i--) {
    const id = `frs-fixture-${String(i).padStart(2, '0')}`;
    const capturedAt = new Date(NOW - i * 3600_000).toISOString();
    const generatedAt = i === 1 && latestGeneratedAt ? latestGeneratedAt : new Date(NOW - i * 3600_000 - 600_000).toISOString();
    r.kv.set(`forecast-revision-snapshot:${id}`, JSON.stringify({ id, capturedAt, generatedAt, locationKey: LOC, daily: [{ date: '2026-11-23', highF: 60 + (i % 4), lowF: 40, precipProbability: 10 * (i % 5), windSpeedMph: 8 }], hasActiveSevereAlert: i === 3, intelligence: { confidence: 'moderate', volatility: i % 2 ? 'stable' : 'shifting', hasActiveSevereAlert: i === 3 } }));
    z.set(id, Date.parse(capturedAt));
  }
  if (n) r.zsets.set(`forecast-revision-snapshots:${LOC}`, z);
  setRedisForTests(strict(r));
  return r;
}

const dump = (r: CountingRedis) => ({
  keys: [...r.kv.keys()].filter((k) => k.startsWith('forecast-revision-snapshot:')).sort(),
  index: [...(r.zsets.get(`forecast-revision-snapshots:${LOC}`) ?? new Map()).entries()].sort((a, b) => a[1] - b[1]),
});

before(() => { mock.timers.enable({ apis: ['Date'], now: NOW }); seeded(); });
after(() => { mock.timers.reset(); Math.random = realRandom; setRedisForTests(null); });

describe('forecast revision store, outputs unchanged by the command cuts', () => {
  it('captureRevision + listSnapshots on four histories', async () => {
    const f = forecastAt(33.9659, -80.9355);
    const out: Record<string, unknown> = {};
    for (const [name, n, latestGen] of [
      ['empty', 0, null],
      ['same-run', 12, f.generatedAt],
      ['new-run', 12, null],
      ['full-30-new-run', 30, null],
    ] as const) {
      const r = world(n, latestGen);
      const cap = await captureRevision(f, LOC);
      const list12 = await listSnapshots(LOC, 12);
      const list30 = await listSnapshots(LOC, 30);
      out[name] = { cap, list12, list30, store: dump(r), commands: r.calls.filter((c) => c.cmd !== 'set').length };
    }
    // Missing snapshot keys behind index entries are skipped, as before.
    const r = world(5, null);
    r.kv.delete('forecast-revision-snapshot:frs-fixture-02');
    out.missingKey = { list: await listSnapshots(LOC, 12), latest: await getLatestSnapshot(LOC) };
    // recordSnapshotIfNew without a caller-supplied latest still dedupes by generatedAt.
    const r2 = world(3, f.generatedAt);
    out.recordDedup = { res: await recordSnapshotIfNew(buildSnapshot(f, LOC)), store: dump(r2) };

    // `commands` is not part of the equality check: it is what the cut changes.
    const comparable = JSON.parse(JSON.stringify(out, (k, v) => (k === 'commands' ? undefined : v)));
    if (process.env.WOW034_WRITE_GOLDEN) {
      mkdirSync(join(GOLDEN, '..'), { recursive: true });
      writeFileSync(GOLDEN, JSON.stringify(comparable, null, 1));
    } else {
      assert.ok(existsSync(GOLDEN), 'missing golden');
      assert.deepEqual(comparable, JSON.parse(readFileSync(GOLDEN, 'utf8')));
    }
  });

  it('a NEW snapshot is written with a 30-day TTL; existing snapshot keys get no TTL, no write, no delete', async () => {
    assert.equal(SNAPSHOT_TTL_SECONDS, 30 * 86400);
    const f = forecastAt(33.9659, -80.9355);
    const r = world(30, null);
    const before = new Map(r.kv);
    await captureRevision(f, LOC);
    const sets = r.calls.filter((c) => c.cmd === 'set');
    assert.equal(sets.length, 1);
    assert.ok(!before.has(sets[0].key), 'the write is a new key');
    assert.deepEqual(sets[0].args[1], { ex: SNAPSHOT_TTL_SECONDS });
    assert.equal(r.ttl.get(sets[0].key), SNAPSHOT_TTL_SECONDS);
    for (const k of before.keys()) {
      assert.equal(r.ttl.has(k), false, `existing ${k} got a TTL`);
      assert.equal(r.kv.get(k), before.get(k), `existing ${k} changed`);
    }
    assert.equal(r.calls.filter((c) => ['expire', 'del', 'pexpire', 'persist'].includes(c.cmd)).length, 0);
    // A same-run render writes nothing at all.
    const r2 = world(12, f.generatedAt);
    await captureRevision(f, LOC);
    assert.equal(r2.calls.filter((c) => c.cmd === 'set').length, 0);
  });
});
