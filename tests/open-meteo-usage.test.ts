import test from 'node:test';
import assert from 'node:assert/strict';
import { billedCalls, usageHourKey } from '../src/lib/open-meteo-usage';

// Open-Meteo bills by weight, not by request (open-meteo.com/en/pricing):
// per location, more than 10 variables or more than 2 weeks counts extra.

test("Open-Meteo's own examples: 15 variables over 2 weeks is 1.5, over 4 weeks is 3", () => {
  const vars = Array.from({ length: 15 }, (_, i) => `v${i}`).join(',');
  assert.equal(billedCalls(`https://api.open-meteo.com/v1/forecast?latitude=1&longitude=1&hourly=${vars}&forecast_days=14`), 1.5);
  assert.equal(billedCalls(`https://api.open-meteo.com/v1/forecast?latitude=1&longitude=1&hourly=${vars}&forecast_days=28`), 3);
});

test('a small single-location request is one call', () => {
  assert.equal(billedCalls('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=1&longitude=2&current=us_aqi,pm2_5'), 1);
});

test('a multi-location map-grid request counts once per location', () => {
  const lats = Array.from({ length: 400 }, () => '1').join(',');
  assert.equal(billedCalls(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lats}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m`), 400);
});

test('hour buckets are UTC and sortable', () => {
  assert.equal(usageHourKey(Date.parse('2026-10-11T19:42:00Z')), '2026-10-11T19');
});

// 2026-10-11: background jobs accept a forecast up to an hour old instead of
// re-fetching every venue ~5 times an hour against a 10-minute cache.
import { isFreshEnough, BACKGROUND_FORECAST_MAX_AGE_SECONDS } from '../src/lib/weather-queries';

test('the freshness check honours its window exactly', () => {
  const now = Date.parse('2026-10-11T21:00:00Z');
  assert.equal(BACKGROUND_FORECAST_MAX_AGE_SECONDS, 3 * 3600);
  assert.ok(BACKGROUND_FORECAST_MAX_AGE_SECONDS < 6 * 3600, 'must stay inside the 6h last-good window it reads from');
  assert.equal(isFreshEnough({ generatedAt: '2026-10-11T20:05:00Z' }, 3600, now), true);
  assert.equal(isFreshEnough({ generatedAt: '2026-10-11T19:55:00Z' }, 3600, now), false);
  assert.equal(isFreshEnough({ generatedAt: 'garbage' }, 3600, now), false);
  assert.equal(isFreshEnough(null, 3600, now), false);
});
