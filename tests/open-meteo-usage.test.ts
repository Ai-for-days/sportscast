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
