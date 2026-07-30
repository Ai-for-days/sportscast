// ── Tests: historical climatology aggregation ───────────────────────────
//
// Reported 2026-07-30: the game-day impact card showed the SAME conditions for
// noon and 11pm on the same future date. Beyond the forecast horizon it called
// /api/weather/historical-averages with month and day only, and that endpoint
// returned day-level figures — temperature as the midpoint of average high and
// low, wind as the daily MAXIMUM, humidity averaged over all 24 hours. Every
// time of day was identical by construction.
//
// Run with `npm test`. No network — the aggregator is pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateHistorical, type ArchiveYear } from '../src/lib/historical-averages';

/**
 * One synthetic archive year for Dec 25 across `days` days.
 * Warm, breezy, dry at 13:00; cold, calm, wet at 23:00 — a normal diurnal cycle.
 */
function fakeYear(year: number, days = 3): ArchiveYear {
  const time: string[] = [];
  const temperature_2m: number[] = [];
  const relative_humidity_2m: number[] = [];
  const wind_speed_10m: number[] = [];
  const wind_gusts_10m: number[] = [];
  const precipitation: number[] = [];

  for (let d = 24; d < 24 + days; d++) {
    for (let h = 0; h < 24; h++) {
      time.push(`${year}-12-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`);
      const afternoon = h === 13;
      const lateNight = h === 23;
      temperature_2m.push(afternoon ? 58 : lateNight ? 34 : 45);
      relative_humidity_2m.push(afternoon ? 40 : lateNight ? 90 : 65);
      wind_speed_10m.push(afternoon ? 14 : lateNight ? 2 : 7);
      wind_gusts_10m.push(afternoon ? 25 : lateNight ? 5 : 12);
      precipitation.push(lateNight ? 0.05 : 0); // only ever wet at 23:00
    }
  }

  return {
    daily: {
      temperature_2m_max: Array(days).fill(58),
      temperature_2m_min: Array(days).fill(34),
      precipitation_sum: Array(days).fill(0.05),
      wind_speed_10m_max: Array(days).fill(14),
      wind_gusts_10m_max: Array(days).fill(25),
    },
    hourly: { time, temperature_2m, relative_humidity_2m, wind_speed_10m, wind_gusts_10m, precipitation },
  };
}

const YEARS = [fakeYear(2024), fakeYear(2023), fakeYear(2022)];

// ── The reported bug ───────────────────────────────────────────────────

test('THE BUG: noon and 11pm must not return identical conditions', () => {
  const noon = aggregateHistorical(YEARS, 13)!;
  const lateNight = aggregateHistorical(YEARS, 23)!;
  assert.notEqual(noon.tempF, lateNight.tempF, 'temperature must differ by hour');
  assert.notEqual(noon.windSpeedMph, lateNight.windSpeedMph, 'wind must differ by hour');
  assert.notEqual(noon.humidity, lateNight.humidity, 'humidity must differ by hour');
});

test('each hour returns that hour\'s own values', () => {
  const noon = aggregateHistorical(YEARS, 13)!;
  assert.equal(noon.tempF, 58);
  assert.equal(noon.windSpeedMph, 14);
  assert.equal(noon.windGustMph, 25);
  assert.equal(noon.humidity, 40);

  const lateNight = aggregateHistorical(YEARS, 23)!;
  assert.equal(lateNight.tempF, 34);
  assert.equal(lateNight.windSpeedMph, 2);
  assert.equal(lateNight.windGustMph, 5);
  assert.equal(lateNight.humidity, 90);
});

test('precip probability is per-hour, not per-day', () => {
  // Only 23:00 is ever wet in the fixture.
  assert.equal(aggregateHistorical(YEARS, 23)!.precipProbability, 100);
  assert.equal(aggregateHistorical(YEARS, 13)!.precipProbability, 0);
  // Day-level asks a different question and gets a different answer: every DAY
  // saw measurable precip, so 100% — which is why the two must not be mixed.
  assert.equal(aggregateHistorical(YEARS, null)!.precipProbability, 100);
});

test('hourResolved reports which question was answered', () => {
  assert.equal(aggregateHistorical(YEARS, 13)!.hourResolved, true);
  assert.equal(aggregateHistorical(YEARS, 13)!.hourUsed, 13);
  assert.equal(aggregateHistorical(YEARS, null)!.hourResolved, false);
  assert.equal(aggregateHistorical(YEARS, null)!.hourUsed, null);
});

// ── Day-level behaviour is preserved ───────────────────────────────────

test('without an hour, the old day-level figures come back', () => {
  const day = aggregateHistorical(YEARS, null)!;
  assert.equal(day.tempF, 46, 'midpoint of avg high 58 and avg low 34');
  assert.equal(day.highTempF, 58);
  assert.equal(day.lowTempF, 34);
  assert.equal(day.windSpeedMph, 14, 'daily maximum');
});

test('day high/low stay day figures even when an hour is requested', () => {
  const lateNight = aggregateHistorical(YEARS, 23)!;
  assert.equal(lateNight.highTempF, 58);
  assert.equal(lateNight.lowTempF, 34);
  assert.equal(lateNight.tempF, 34, 'but tempF is the hour, not the midpoint');
});

// ── Degradation ────────────────────────────────────────────────────────

test('an hour with no samples falls back to day level rather than dividing by zero', () => {
  const dailyOnly: ArchiveYear[] = [{ daily: YEARS[0].daily }];
  const out = aggregateHistorical(dailyOnly, 13)!;
  assert.equal(out.hourResolved, false);
  assert.ok(Number.isFinite(out.tempF));
  assert.equal(out.tempF, 46);
});

test('nulls in the series are skipped, not counted as zero', () => {
  const withGaps: ArchiveYear[] = [{
    hourly: {
      time: ['2024-12-25T13:00', '2024-12-25T13:00'],
      temperature_2m: [60, null],
      relative_humidity_2m: [50, null],
      wind_speed_10m: [10, null],
      wind_gusts_10m: [20, null],
      precipitation: [0, null],
    },
  }];
  const out = aggregateHistorical(withGaps, 13)!;
  assert.equal(out.tempF, 60, 'a null must not drag the mean toward zero');
  assert.equal(out.hourSamples, 1);
});

test('no usable data returns null instead of NaN', () => {
  assert.equal(aggregateHistorical([], 13), null);
  assert.equal(aggregateHistorical([null, null], null), null);
});

test('failed year fetches are tolerated and counted', () => {
  const out = aggregateHistorical([fakeYear(2024), null, fakeYear(2022)], 13)!;
  assert.equal(out.yearsUsed, 2);
  assert.equal(out.tempF, 58);
});
