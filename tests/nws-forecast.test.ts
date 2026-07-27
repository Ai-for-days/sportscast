// ── Tests: NWS forecast helper ──────────────────────────────────────────
//
// Covers the /points gridpoint cache added to stop the weather-market
// idea generator from blowing its 60s function limit, plus the existing
// wind-speed parser.
//
// Run with `npm test`. No network: global.fetch is stubbed per test.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchNWSForecast,
  fetchNWSHourlyForecast,
  clearNWSPointsCache,
  parseNwsWindSpeedMph,
} from '../src/lib/nws-forecast';

const LAT = 34.0007;
const LON = -81.0348;

const POINTS_BODY = {
  properties: {
    forecast: 'https://api.weather.gov/gridpoints/CAE/50,60/forecast',
    forecastHourly: 'https://api.weather.gov/gridpoints/CAE/50,60/forecast/hourly',
  },
};

const PERIODS_BODY = {
  properties: {
    periods: [
      { number: 1, name: 'Today', isDaytime: true, temperature: 91, temperatureUnit: 'F' },
    ],
  },
};

/** Record every URL fetched so we can assert on call counts. */
function stubFetch(handler?: (url: string) => { ok?: boolean; status?: number; body?: unknown }) {
  const calls: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    calls.push(String(url));
    const r = handler?.(String(url)) ?? {};
    const ok = r.ok ?? true;
    return {
      ok,
      status: r.status ?? (ok ? 200 : 500),
      json: async () => r.body ?? (String(url).includes('/points/') ? POINTS_BODY : PERIODS_BODY),
    } as any;
  };
  return calls;
}

const realFetch = globalThis.fetch;
beforeEach(() => clearNWSPointsCache());
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('daily + hourly for the same location share ONE /points lookup', async () => {
  const calls = stubFetch();

  await fetchNWSForecast(LAT, LON);
  await fetchNWSHourlyForecast(LAT, LON);

  const points = calls.filter((u) => u.includes('/points/'));
  assert.equal(
    points.length,
    1,
    `expected the gridpoint lookup to be cached and reused, got ${points.length} /points calls`,
  );
  // Still fetched both gridpoint products.
  assert.equal(calls.filter((u) => u.endsWith('/forecast')).length, 1);
  assert.equal(calls.filter((u) => u.endsWith('/forecast/hourly')).length, 1);
  assert.equal(calls.length, 3, 'total round trips should be 3, not 4');
});

test('repeat calls for the same location do not re-hit /points', async () => {
  const calls = stubFetch();

  await fetchNWSForecast(LAT, LON);
  await fetchNWSForecast(LAT, LON);
  await fetchNWSForecast(LAT, LON);

  assert.equal(calls.filter((u) => u.includes('/points/')).length, 1);
});

test('distinct locations get their own gridpoint entries', async () => {
  const calls = stubFetch();

  await fetchNWSForecast(LAT, LON);
  await fetchNWSForecast(40.7128, -74.006);

  assert.equal(calls.filter((u) => u.includes('/points/')).length, 2);
});

test('a failed /points lookup is NOT cached, so a retry can succeed', async () => {
  let first = true;
  const calls = stubFetch((url) => {
    if (url.includes('/points/') && first) {
      first = false;
      return { ok: false, status: 503 };
    }
    return {};
  });

  await assert.rejects(() => fetchNWSForecast(LAT, LON), /503/);

  // The transient failure must not have poisoned the cache.
  const periods = await fetchNWSForecast(LAT, LON);
  assert.equal(periods.length, 1);
  assert.equal(calls.filter((u) => u.includes('/points/')).length, 2);
});

test('a /points response missing the URL is not cached either', async () => {
  const calls = stubFetch((url) =>
    url.includes('/points/') ? { body: { properties: {} } } : {},
  );

  await assert.rejects(() => fetchNWSForecast(LAT, LON), /missing forecast URL/);
  await assert.rejects(() => fetchNWSForecast(LAT, LON), /missing forecast URL/);
  assert.equal(calls.filter((u) => u.includes('/points/')).length, 2);
});

test('cache key matches the 4-decimal precision actually sent to NWS', async () => {
  const calls = stubFetch();

  // These differ only past the 4th decimal, so they round to the same
  // request URL and must therefore share one cache entry.
  await fetchNWSForecast(34.00071, -81.03481);
  await fetchNWSForecast(34.00072, -81.03482);

  assert.equal(calls.filter((u) => u.includes('/points/')).length, 1);
});

test('non-array periods degrade to an empty list rather than throwing', async () => {
  stubFetch((url) =>
    url.includes('/points/') ? {} : { body: { properties: { periods: null } } },
  );
  assert.deepEqual(await fetchNWSForecast(LAT, LON), []);
});

test('parseNwsWindSpeedMph takes the upper bound of a range', () => {
  assert.equal(parseNwsWindSpeedMph('5 to 10 mph'), 10);
  assert.equal(parseNwsWindSpeedMph('12 mph'), 12);
  assert.equal(parseNwsWindSpeedMph('7.5 mph'), 7.5);
  assert.equal(parseNwsWindSpeedMph(''), undefined);
  assert.equal(parseNwsWindSpeedMph(undefined), undefined);
  assert.equal(parseNwsWindSpeedMph(42), undefined);
});
