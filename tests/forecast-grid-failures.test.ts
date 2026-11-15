// WOW-018: forecast-grid failure handling. Open-Meteo and Redis are faked;
// no network, no Redis.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getForecastGrid, __setForecastGridDepsForTests, EMPTY_TTL_MS } from '../src/lib/forecast-grid';
import { cacheInvalidateAll } from '../src/lib/performance-cache';

type Behaviour = (batchIndex: number, n: number) => Response | Promise<Response>;

let calls: { url: string; n: number }[] = [];
let redisSets: string[] = [];

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
const refused = () => new Response('{"error":true}', { status: 429 });

function windRows(n: number, over: Partial<Record<string, unknown>> = {}) {
  return Array.from({ length: n }, () => ({ current: { wind_speed_10m: 12, wind_gusts_10m: 20, wind_direction_10m: 180, ...over } }));
}
function tempRows(n: number) {
  return Array.from({ length: n }, () => ({ current: { temperature_2m: 55.4 } }));
}
function aqiRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ latitude: 30 + i * 0.01, longitude: -95, current: { us_aqi: 42 } }));
}

function install(behaviour: Behaviour) {
  __setForecastGridDepsForTests({
    fetch: (async (url: string) => {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length;
      const idx = calls.length;
      calls.push({ url, n });
      return behaviour(idx, n);
    }) as any,
    redis: () => ({
      get: async () => null,
      set: async (k: string) => { redisSets.push(k); return 'OK'; },
    }),
  });
}

// Big viewport at zoom 6 → wind grid near the 400-point cap (4 batches of 100).
const WIND = ['wind', 50, 24, -66, -125, 6] as const;

beforeEach(() => { calls = []; redisSets = []; cacheInvalidateAll(); });
afterEach(() => { __setForecastGridDepsForTests(null); });

test('wow018-7: a successful wind grid uses exactly ceil(points/100) fetches (4 at the cap)', async () => {
  install((_i, n) => ok(windRows(n)));
  const pts = await getForecastGrid(...WIND);
  const sent = calls.reduce((a, c) => a + c.n, 0);
  assert.equal(pts.length, sent);
  assert.ok(sent > 300 && sent <= 400, `points ${sent}`);
  assert.equal(calls.length, 4);
  assert.equal(redisSets.length, 1);
});

test('wow018-1: refused middle batch + successful later batch gives [], never misaligned points', async () => {
  install((i, n) => (i === 1 ? refused() : ok(windRows(n))));
  const pts = await getForecastGrid(...WIND);
  assert.deepEqual(pts, []);
});

test('wow018-2: refused first batch gives [] and no later batch is fetched', async () => {
  install((i, n) => (i === 0 ? refused() : ok(windRows(n))));
  const pts = await getForecastGrid(...WIND);
  assert.deepEqual(pts, []);
  assert.equal(calls.length, 1);
});

test('wow018-3: a failed (partial) grid is never written to Redis', async () => {
  install((i, n) => (i === 3 ? refused() : ok(windRows(n))));
  const pts = await getForecastGrid(...WIND);
  assert.deepEqual(pts, []);
  assert.equal(redisSets.length, 0);
});

test('wow018-4: an empty grid is recomputed after 30 s, not held for 600 s', async (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  install(() => refused());
  await getForecastGrid(...WIND);
  assert.equal(calls.length, 1);
  now += 10_000;
  await getForecastGrid(...WIND); // inside 30 s: served from memory
  assert.equal(calls.length, 1);
  now += EMPTY_TTL_MS; // past 30 s
  install((_i, n) => ok(windRows(n)));
  const pts = await getForecastGrid(...WIND);
  assert.ok(pts.length > 0);
  assert.equal(EMPTY_TTL_MS, 30_000);
});

test('wow018-5: a missing gust fails the wind grid, never gust 0', async () => {
  install((i, n) => ok(i === 2 ? windRows(n, { wind_gusts_10m: null }) : windRows(n)));
  const pts = await getForecastGrid(...WIND) as any[];
  assert.deepEqual(pts, []);
  assert.equal((pts as any[]).filter((p: any) => p.gust === 0).length, 0);
});

test('wow018-5b: a missing direction fails the wind grid, never 0 degrees', async () => {
  install((_i, n) => ok(windRows(n, { wind_direction_10m: undefined })));
  assert.deepEqual(await getForecastGrid(...WIND), []);
});

test('wow018-6: a town with no temperature is dropped, never 0°F', async () => {
  install((i, n) => {
    const rows: any[] = tempRows(n);
    if (i === 0) rows[0] = { current: { temperature_2m: null } }; // one town only
    return ok(rows);
  });
  const pts = await getForecastGrid('towns', 50, 24, -66, -125, 6) as any[];
  const sent = calls.reduce((a, c) => a + c.n, 0);
  assert.ok(sent > 1);
  assert.equal(pts.length, sent - 1);
  assert.ok(pts.every((p) => p.tempF === 55));
});

test('wow018-6b: AQI grid with one missing AQI fails the whole grid (client lattice would draw it as 0)', async () => {
  install((i, n) => {
    const rows: any[] = aqiRows(n);
    if (i === 0) rows[0] = { latitude: 1, longitude: 1, current: { us_aqi: null } };
    return ok(rows);
  });
  assert.deepEqual(await getForecastGrid('aqi', 38, 33, -93, -102, 6, 35.5, -97.5), []);
});

test('wow018-6c: AQI towns drop a town with no AQI, never AQI 0', async () => {
  install((i, n) => {
    const rows: any[] = aqiRows(n);
    if (i === 0) rows[0] = { latitude: 1, longitude: 1, current: { us_aqi: null } };
    return ok(rows);
  });
  const towns = await getForecastGrid('aqitowns', 50, 24, -66, -125, 6) as any[];
  const sent = calls.reduce((a, c) => a + c.n, 0);
  assert.equal(towns.length, sent - 1);
  assert.ok(towns.every((p) => p.aqi === 42));
});

test('wow018-9: a non-empty Redis hit is returned with 0 fetches, and again from memory', async () => {
  const stored = [{ lat: 1, lon: 2, speed: 3, gust: 4, dir: 5 }];
  __setForecastGridDepsForTests({
    fetch: (async (url: string) => { calls.push({ url, n: 0 }); return ok([]); }) as any,
    redis: () => ({ get: async () => stored, set: async (k: string) => { redisSets.push(k); return 'OK'; } }),
  });
  assert.deepEqual(await getForecastGrid(...WIND), stored);
  assert.deepEqual(await getForecastGrid(...WIND), stored);
  assert.equal(calls.length, 0);
});

test('wow018-9b: an empty Redis entry is not trusted; the grid is computed', async () => {
  __setForecastGridDepsForTests({
    fetch: (async (url: string) => {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length;
      calls.push({ url, n });
      return ok(windRows(n));
    }) as any,
    redis: () => ({ get: async () => [], set: async (k: string) => { redisSets.push(k); return 'OK'; } }),
  });
  const pts = await getForecastGrid(...WIND);
  assert.ok(pts.length > 0);
  assert.equal(calls.length, 4);
});

test('wow018-7b: request counts per successful grid are unchanged for towns (250/batch) and AQI (100/batch)', async () => {
  install((_i, n) => ok(tempRows(n)));
  await getForecastGrid('towns', 50, 24, -66, -125, 6);
  const townPts = calls.reduce((a, c) => a + c.n, 0);
  assert.equal(calls.length, Math.ceil(townPts / 250));
  assert.ok(calls.every((c) => c.n <= 250));

  calls = []; cacheInvalidateAll();
  install((_i, n) => ok(aqiRows(n)));
  await getForecastGrid('aqi', 50, 24, -66, -125, 6, 35.5, -97.5);
  const aqiPts = calls.reduce((a, c) => a + c.n, 0);
  assert.equal(calls.length, Math.ceil(aqiPts / 100));
  assert.ok(aqiPts <= 250);
});

test('wow018-8: a batch returning fewer rows than points sent fails the grid', async () => {
  install((i, n) => ok(windRows(i === 1 ? n - 1 : n)));
  assert.deepEqual(await getForecastGrid(...WIND), []);
  assert.equal(calls.length, 2);
});

test('wow018-8b: a thrown or unparseable batch fails the grid', async () => {
  install((i, n) => (i === 0 ? new Response('not json', { status: 200 }) : ok(windRows(n))));
  assert.deepEqual(await getForecastGrid(...WIND), []);
  calls = []; cacheInvalidateAll();
  install(() => { throw new Error('network'); });
  assert.deepEqual(await getForecastGrid(...WIND), []);
});
