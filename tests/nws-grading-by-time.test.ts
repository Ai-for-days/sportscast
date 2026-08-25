// ── Tests: by-time (actual_temp) grading against the nearest hourly reading ─
//
// Found 2026-08-25 while building the "Temp at Game Start" venue O/U
// markets (auto-venue-ou-market.ts): actual_temp wagers with a targetTime
// were always graded against the day's overall high (obs.highTemp),
// regardless of targetTime — the code comment claimed "graded against
// observation closest to target time" but there was no hourly observation
// data captured to grade against. A bettor betting "Over 82 at first pitch"
// could lose to a 95° peak hours later that had nothing to do with the bet.
//
// Fixed: fetchNWSObservations now also captures each reading's own
// timestamp (NWSObservation.hourly); getObservedValue() uses the reading
// nearest wager.targetTime (resolved via the wager location's own timeZone)
// for actual_temp, falling back to the day's high only when no hourly data
// is available — so existing/cached observations without it keep grading
// exactly as before (no silent behavior change for data that predates this
// fix).
//
// Run with `npm test`. No network — NWSObservation objects are constructed
// directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getObservedValue } from '../src/lib/nws-grading';
import type { NWSObservation } from '../src/lib/wager-types';

function obsWithHourly(): NWSObservation {
  return {
    stationId: 'KTPA',
    date: '2026-08-28',
    highTemp: 95.0,
    lowTemp: 78.0,
    observationCount: 4,
    fetchedAt: '2026-08-29T00:00:00Z',
    hourly: [
      { time: '2026-08-28T17:00:00Z', tempF: 86.0 }, // 1pm ET
      { time: '2026-08-28T23:05:00Z', tempF: 91.0 }, // 7:05pm ET — the target instant
      { time: '2026-08-29T20:00:00Z', tempF: 95.0 }, // next-day peak — NOT this reading
    ],
  };
}

test('actual_temp with targetTime grades against the nearest hourly reading, not the day high', () => {
  const obs = obsWithHourly();
  // 23:05 UTC = 19:05 ET on 2026-08-28 (EDT, UTC-4)
  const value = getObservedValue(obs, 'actual_temp', '19:05', 'America/New_York');
  assert.equal(value, 91.0);
  assert.notEqual(value, obs.highTemp);
});

test('actual_temp picks the closest reading even when it is not an exact match', () => {
  const obs = obsWithHourly();
  // 19:10 ET is 5 minutes from the 19:05 reading and ~4h55m from the 13:00 one
  const value = getObservedValue(obs, 'actual_temp', '19:10', 'America/New_York');
  assert.equal(value, 91.0);
});

test('actual_temp falls back to the day high when there is no hourly data (pre-fix cached observation)', () => {
  const obs: NWSObservation = { ...obsWithHourly(), hourly: [] };
  const value = getObservedValue(obs, 'actual_temp', '19:05', 'America/New_York');
  assert.equal(value, obs.highTemp);
});

test('actual_temp falls back to the day high when targetTime/timeZone are missing', () => {
  const obs = obsWithHourly();
  assert.equal(getObservedValue(obs, 'actual_temp', undefined, 'America/New_York'), obs.highTemp);
  assert.equal(getObservedValue(obs, 'actual_temp', '19:05', undefined), obs.highTemp);
});

test('high_temp/low_temp/wind/gust ignore targetTime entirely — unaffected by this fix', () => {
  const obs = obsWithHourly();
  obs.windSpeed = 12.3;
  obs.windGust = 20.1;
  assert.equal(getObservedValue(obs, 'high_temp', '19:05', 'America/New_York'), obs.highTemp);
  assert.equal(getObservedValue(obs, 'low_temp', '19:05', 'America/New_York'), obs.lowTemp);
  assert.equal(getObservedValue(obs, 'actual_wind', '19:05', 'America/New_York'), obs.windSpeed);
  assert.equal(getObservedValue(obs, 'actual_gust', '19:05', 'America/New_York'), obs.windGust);
});
