// ── Tests: MLB game-window forecast interpolation ──────────────────────
//
// Two easy-to-get-wrong things pinned here:
//   1. Open-Meteo's hourly `time` strings are LOCAL to the venue with no
//      timezone suffix (timezone=auto — see open-meteo.ts's own comment on
//      this). Treating them as UTC, or letting the server's local TZ leak in
//      via a bare `new Date(str)`, silently shifts every slot by the venue's
//      UTC offset. Verified directly: `new Date('2026-02-18T09:00')` in this
//      Node runtime parses using the SERVER's local offset, not UTC and not
//      the venue's — the only safe move is to force UTC on the wall-clock
//      digits (append 'Z') and then apply the venue's real offset ourselves.
//   2. Wind direction is circular — averaging 350deg and 10deg as plain
//      numbers gives 180deg, exactly backwards.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGameWindowForecast } from '../src/lib/mlb-game-forecast';
import type { ForecastPoint } from '../src/lib/types';

function point(localTime: string, overrides: Partial<ForecastPoint> = {}): ForecastPoint {
  return {
    time: localTime, // Open-Meteo shape: no Z, no offset — local to the venue
    tempK: 0, tempF: 70, tempC: 0, humidity: 0, dewPointF: 0, precipMm: 0,
    precipProbability: 0, windSpeedMph: 10, windDirectionDeg: 0, windGustMph: 15,
    cloudCover: 0, pressure: 0, feelsLikeF: 70, uvIndex: 0, visibility: 0,
    description: 'Clear', icon: 'clear',
    ...overrides,
  };
}

test('local-naive hourly strings are correctly matched to a true-UTC kickoff via the venue offset', () => {
  // Venue is US Eastern in summer: UTC-4 (utcOffsetSeconds = -14400). Hourly
  // point "13:00" local == 17:00Z. First pitch is 17:10Z, i.e. 13:10 local —
  // between the 13:00 and 14:00 local hourly points.
  const utcOffsetSeconds = -14400;
  const hourly = [
    point('2026-08-19T13:00', { tempF: 80 }),
    point('2026-08-19T14:00', { tempF: 90 }),
  ];
  const slots = getGameWindowForecast(hourly, '2026-08-19T17:10:00Z', utcOffsetSeconds, 1);
  assert.ok(slots.length > 0, 'expected at least one slot');
  const first = slots[0];
  assert.equal(first.minutesFromFirstPitch, 0);
  assert.ok(Math.abs(first.tempF - (80 + (90 - 80) / 6)) < 1, `expected ~81.7F, got ${first.tempF}`);
});

test('a venue on the opposite side of UTC (e.g. a positive offset) still lines up correctly', () => {
  const utcOffsetSeconds = 7200; // e.g. UTC+2
  const hourly = [
    point('2026-08-19T20:00', { tempF: 60 }),
    point('2026-08-19T21:00', { tempF: 70 }),
  ];
  const slots = getGameWindowForecast(hourly, '2026-08-19T18:00:00Z', utcOffsetSeconds, 0);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].tempF, 60);
});

test('wind direction crossing 0/360 interpolates through north, not through 180', () => {
  const hourly = [
    point('2026-08-19T18:00', { windDirectionDeg: 350 }),
    point('2026-08-19T19:00', { windDirectionDeg: 10 }),
  ];
  const slots = getGameWindowForecast(hourly, '2026-08-19T18:00:00Z', 0, 1);
  const half = slots.find((s) => s.minutesFromFirstPitch === 30)!;
  assert.ok(half, 'expected a +30min slot');
  const distanceFromNorth = Math.min(half.windDirectionDeg, 360 - half.windDirectionDeg);
  assert.ok(distanceFromNorth <= 1, `expected ~0deg, got ${half.windDirectionDeg}`);
});

test('slots run every 30 minutes across the full window, inclusive of both ends', () => {
  const hourly = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.parse('2026-08-19T18:00:00Z') + i * 3600000);
    return point(d.toISOString().slice(0, 16)); // "YYYY-MM-DDTHH:MM", no Z
  });
  const slots = getGameWindowForecast(hourly, '2026-08-19T18:00:00Z', 0, 5);
  assert.equal(slots.length, 11); // 0, 30, 60, ..., 300 minutes
  assert.equal(slots[0].minutesFromFirstPitch, 0);
  assert.equal(slots[slots.length - 1].minutesFromFirstPitch, 300);
});

test('a game window entirely outside hourly coverage returns nothing', () => {
  const hourly = [point('2026-08-19T18:00'), point('2026-08-19T19:00')];
  const slots = getGameWindowForecast(hourly, '2026-09-19T18:00:00Z', 0, 5);
  assert.deepEqual(slots, []);
});

test('empty hourly data never throws, just returns nothing', () => {
  assert.deepEqual(getGameWindowForecast([], '2026-08-19T18:00:00Z', 0, 5), []);
});

test('a non-finite kickoff time never throws', () => {
  const hourly = [point('2026-08-19T18:00')];
  assert.deepEqual(getGameWindowForecast(hourly, 'not-a-date', 0, 5), []);
});
