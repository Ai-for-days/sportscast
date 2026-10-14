import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentFromHourly, localQuarterHour } from '../src/lib/open-meteo-current';
import { billedCalls } from '../src/lib/open-meteo-usage';

// 2026-10-13 20:40 UTC; at UTC-4 that is 16:40 local, floored to 16:30.
const NOW = Date.parse('2026-10-13T20:40:00Z');
const OFFSET = -4 * 3600;

const hourly = {
  time: ['2026-10-13T15:00', '2026-10-13T16:00', '2026-10-13T17:00'],
  temperature_2m: [60, 62, 66],
  relative_humidity_2m: [50, 50, 60],
  dew_point_2m: [40, 40, 42],
  precipitation: [0, 0, 1.2],
  wind_speed_10m: [5, 10, 20],
  wind_direction_10m: [350, 350, 10],
  wind_gusts_10m: [10, 15, 25],
  cloud_cover: [20, 40, 60],
  surface_pressure: [1010, 1010, 1008],
  apparent_temperature: [59, 61, 65],
  uv_index: [3, 2, 1],
  visibility: [10000, 10000, 8000],
  weather_code: [1, 2, 61],
};

test('local quarter hour floors to 15 minutes at the location', () => {
  assert.equal(localQuarterHour(NOW, OFFSET), '2026-10-13T16:30');
});

test('current is interpolated between the hours either side of now', () => {
  const c = currentFromHourly(hourly, OFFSET, NOW)!;
  assert.equal(c.time, '2026-10-13T16:30');
  assert.equal(c.temperature_2m, 64);
  assert.equal(c.wind_speed_10m, 15);
  // 350 -> 10 goes the short way round through north, not through 180.
  assert.equal(Math.round(c.wind_direction_10m), 0);
  // The hour now falls in is the one ending at 17:00.
  assert.equal(c.precipitation, 1.2);
  // 16:30 is exactly half way; ties go to the later hour.
  assert.equal(c.weather_code, 61);
});

test('no current block when the series does not cover now', () => {
  assert.equal(currentFromHourly({ ...hourly, time: ['2026-10-14T00:00'] }, OFFSET, NOW), null);
  assert.equal(currentFromHourly({ time: [] }, OFFSET, NOW), null);
});

test('missing temperature refuses rather than inventing a zero', () => {
  assert.equal(currentFromHourly({ ...hourly, temperature_2m: [null, null, null] as any }, OFFSET, NOW), null);
});

test('the forecast request bills about a third less without the current block', () => {
  const hourlyVars = 'temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,surface_pressure,apparent_temperature,uv_index,visibility,weather_code';
  const dailyVars = 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,weather_code,sunrise,sunset';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=40&longitude=-75&hourly=${hourlyVars}&daily=${dailyVars}&forecast_days=16`;
  assert.ok(billedCalls(url) < 3.1, `billed ${billedCalls(url)}`);
});
