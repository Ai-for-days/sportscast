// WOW-034: Redis commands for one real page render, and the rendered HTML
// compared against the pre-cut golden.
//
// Renders the project's own .astro pages through Vite + Astro's container
// (tests/helpers/astro-render.ts) against a seeded CountingRedis, with the
// network disabled and the clock frozen. The network being off means the
// page's live NWS/observation lookups fail and degrade exactly as they do
// when those services are down; the counts are the Redis commands of that
// render, not of a fully-networked one.
//
// Goldens (sha256 of the HTML) were written from the code BEFORE the cuts.
// Regenerate only on purpose: WOW034_WRITE_GOLDEN=1.

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CountingRedis, strict } from './helpers/counting-redis';
import { NOW, forecastAt, forecastKey, seedWagers } from './helpers/usage-fixtures';
import { bootAstro, type AstroHarness } from './helpers/astro-render';

export const EXPECTED = {
  zipPageWarm: 6, // before the cuts: 19
  zipPageNewRun: 9, // before the cuts: 22
  wagersPage: 68,
};

const GOLDEN_DIR = join(process.cwd(), 'tests', 'fixtures', 'usage-golden');
const WRITE = !!process.env.WOW034_WRITE_GOLDEN;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function golden(name: string, value: unknown) {
  const file = join(GOLDEN_DIR, `${name}.json`);
  if (WRITE) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(value, null, 1));
    return;
  }
  assert.ok(existsSync(file), `missing golden ${name}`);
  assert.deepEqual(value, JSON.parse(readFileSync(file, 'utf8')), `output of ${name} changed`);
}

const ZIP = '29209';
const ZIP_SLUG = 'united-states-south-carolina-columbia-29209';
const ZIP_URL = `https://wageronweather.com/${ZIP_SLUG}`;
const LOC = 'us:29209';

let h: AstroHarness;
let setRedis: (r: unknown) => void;
let geo: { lat: number; lon: number };
const realFetch = globalThis.fetch;

/** The location's snapshot history: 12 earlier forecast runs, an hour apart. */
function seedSnapshots(r: CountingRedis, latestGeneratedAt: string) {
  const z = new Map<string, number>();
  for (let i = 12; i >= 1; i--) {
    const capturedAt = new Date(NOW - i * 3600_000).toISOString();
    const generatedAt = i === 1 ? latestGeneratedAt : new Date(NOW - i * 3600_000 - 600_000).toISOString();
    const id = `frs-fixture-${String(i).padStart(2, '0')}`;
    const f = forecastAt(geo.lat, geo.lon);
    r.kv.set(`forecast-revision-snapshot:${id}`, JSON.stringify({
      id, capturedAt, generatedAt, locationKey: LOC,
      daily: f.daily.slice(0, 7).map((d, j) => ({ date: d.date, highF: d.highF + ((i + j) % 3), lowF: d.lowF, precipProbability: d.precipProbability, windSpeedMph: d.windSpeedMph })),
      hasActiveSevereAlert: false,
      intelligence: { confidence: 'moderate', volatility: 'stable', hasActiveSevereAlert: false },
    }));
    z.set(id, Date.parse(capturedAt));
  }
  r.zsets.set(`forecast-revision-snapshots:${LOC}`, z);
}

function zipWorld(sameRun: boolean): CountingRedis {
  const r = new CountingRedis();
  const f = forecastAt(geo.lat, geo.lon);
  r.kv.set(forecastKey(geo.lat, geo.lon), JSON.stringify(f));
  seedSnapshots(r, sameRun ? f.generatedAt : new Date(NOW - 3 * 3600_000).toISOString());
  setRedis(strict(r));
  return r;
}

before(async () => {
  (globalThis as any).fetch = async () => { throw new Error('network disabled in test'); };
  h = await bootAstro();
  setRedis = (await h.load('/src/lib/redis.ts')).setRedisForTests;
  const { lookupZip } = await h.load('/src/lib/zip-lookup.ts');
  geo = lookupZip(ZIP);
  mock.timers.enable({ apis: ['Date'], now: NOW });
});
after(async () => {
  mock.timers.reset();
  setRedis?.(null);
  await h?.close();
  (globalThis as any).fetch = realFetch;
});

describe('WOW-034 page renders', () => {
  it('ZIP page, forecast run already recorded (the common crawler visit)', async () => {
    const r = zipWorld(true);
    const res = await h.render('/src/pages/[...slug].astro', ZIP_URL, { params: { slug: ZIP_SLUG } });
    const html = await res.text();
    console.log(`WOW034-COUNT zipPageWarm=${r.count()} ${JSON.stringify(r.byCmd())}`);
    assert.equal(res.status, 200);
    golden('zip-page-warm', { status: res.status, length: html.length, sha256: sha(html) });
    assert.equal(r.count(), EXPECTED.zipPageWarm);
  });

  it('ZIP page, new forecast run (writes a snapshot)', async () => {
    const r = zipWorld(false);
    const res = await h.render('/src/pages/[...slug].astro', ZIP_URL, { params: { slug: ZIP_SLUG } });
    const html = await res.text();
    console.log(`WOW034-COUNT zipPageNewRun=${r.count()} ${JSON.stringify(r.byCmd())}`);
    assert.equal(res.status, 200);
    golden('zip-page-new-run', { status: res.status, length: html.length, sha256: sha(html) });
    const written = r.calls.filter((c) => c.cmd === 'set' && c.key.startsWith('forecast-revision-snapshot:'));
    assert.equal(written.length, 1, 'one new snapshot written');
    assert.equal(r.count(), EXPECTED.zipPageNewRun);
  });

  it('/wagers page (64 open wagers)', async () => {
    const r = new CountingRedis();
    seedWagers(r, 60, 4);
    setRedis(strict(r));
    const res = await h.render('/src/pages/wagers/index.astro', 'https://wageronweather.com/wagers');
    const html = await res.text();
    console.log(`WOW034-COUNT wagersPage=${r.count()} ${JSON.stringify(r.byCmd())}`);
    assert.equal(res.status, 200);
    golden('wagers-page', { status: res.status, length: html.length, sha256: sha(html) });
    assert.equal(r.count(), EXPECTED.wagersPage);
  });
});
