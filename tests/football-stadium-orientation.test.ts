// ── Tests: football field orientation (axis-relative wind/glare) ───────
//
// Per Derek (2026-08-22): NFL/NCAA football fields run east-west by
// default, except a handful that run north-south. Since we don't have real
// per-venue survey data the way MLB does (stadium-orientations.json), the
// wind/glare phrasing stays in terms of the field's AXIS (lengthwise vs.
// crosswind) plus real compass bearings — never a specific named end zone
// or sideline. Also pins the 4-quarter (1-hour-each) game-window sampling,
// the football equivalent of MLB's 9-inning sampling.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFootballFieldAxis, footballFieldWindLabel, footballSunGlareLabel } from '../src/lib/football-stadium-orientation';
import { quarterAtMinutes, getQuarterForecast, QUARTER_STEP_MINUTES, QUARTERS_PER_GAME } from '../src/lib/football-game-forecast';
import type { ForecastPoint } from '../src/lib/types';

test('the 5 listed exception teams get a north-south axis', () => {
  for (const team of ['Oklahoma State Cowboys', 'Georgia Bulldogs', 'Kentucky Wildcats', 'Minnesota Golden Gophers', 'East Carolina Pirates']) {
    assert.equal(getFootballFieldAxis({ team }), 'north-south', `expected ${team} to be north-south`);
  }
});

test('every other team defaults to an east-west axis', () => {
  for (const team of ['Alabama Crimson Tide', 'Ohio State Buckeyes', 'Kansas City Chiefs', undefined]) {
    assert.equal(getFootballFieldAxis({ team }), 'east-west', `expected ${team} to default to east-west`);
  }
});

test('a wind blowing straight down an east-west field reads as lengthwise', () => {
  // Wind FROM the west (270) blows TOWARD the east — straight down the
  // length of an east-west field.
  const label = footballFieldWindLabel(270, 'east-west');
  assert.match(label, /lengthwise down the field/);
  assert.match(label, /\bE\b/);
});

test('a wind blowing straight down an east-west field is NOT called a crosswind', () => {
  const label = footballFieldWindLabel(270, 'east-west');
  assert.doesNotMatch(label, /crosswind/);
});

test('a wind blowing across an east-west field (north-south) reads as a crosswind', () => {
  // Wind FROM the south (180) blows TOWARD the north — sideline to sideline
  // on an east-west field.
  const label = footballFieldWindLabel(180, 'east-west');
  assert.match(label, /sideline to sideline/);
  assert.match(label, /crosswind/);
});

test('the same wind reading is lengthwise on a north-south field but a crosswind on an east-west field', () => {
  // Wind FROM the south (180) blows TOWARD the north.
  const northSouth = footballFieldWindLabel(180, 'north-south');
  const eastWest = footballFieldWindLabel(180, 'east-west');
  assert.match(northSouth, /lengthwise down the field/);
  assert.match(eastWest, /crosswind/);
});

test('a diagonal wind is neither lengthwise nor a crosswind', () => {
  // Wind FROM the southwest (225) blows TOWARD the northeast (45) — roughly
  // 45 degrees off both axes of an east-west field.
  const label = footballFieldWindLabel(225, 'east-west');
  assert.doesNotMatch(label, /lengthwise down the field/);
  assert.doesNotMatch(label, /crosswind/);
  assert.match(label, /diagonally/);
});

test('sun glare aligned with the field length is called out for players looking downfield', () => {
  const label = footballSunGlareLabel(90, 'east-west'); // sun due east, field runs east-west
  assert.match(label, /down the length of the field/);
  assert.match(label, /downfield/);
});

test('sun glare across the field is called out along one sideline', () => {
  const label = footballSunGlareLabel(0, 'east-west'); // sun due north, field runs east-west (crosswise)
  assert.match(label, /sideline/);
});

test('quarterAtMinutes labels each hour as the next quarter, clamped to 1-4', () => {
  assert.equal(quarterAtMinutes(0), 1);
  assert.equal(quarterAtMinutes(QUARTER_STEP_MINUTES), 2);
  assert.equal(quarterAtMinutes(QUARTER_STEP_MINUTES * 2), 3);
  assert.equal(quarterAtMinutes(QUARTER_STEP_MINUTES * 3), 4);
  assert.equal(quarterAtMinutes(QUARTER_STEP_MINUTES * 10), 4); // never exceeds 4
  assert.equal(quarterAtMinutes(-100), 1); // never below 1
});

function point(localTime: string, overrides: Partial<ForecastPoint> = {}): ForecastPoint {
  return {
    time: localTime,
    tempK: 0, tempF: 70, tempC: 0, humidity: 0, dewPointF: 0, precipMm: 0,
    precipProbability: 0, windSpeedMph: 10, windDirectionDeg: 0, windGustMph: 15,
    cloudCover: 0, pressure: 0, feelsLikeF: 70, uvIndex: 0, visibility: 0,
    description: 'Clear', icon: 'clear',
    ...overrides,
  };
}

test('getQuarterForecast produces exactly 4 samples, one per quarter, an hour apart', () => {
  const hourly = [
    point('2026-11-01T13:00'), point('2026-11-01T14:00'), point('2026-11-01T15:00'),
    point('2026-11-01T16:00'), point('2026-11-01T17:00'),
  ];
  const slots = getQuarterForecast(hourly, '2026-11-01T13:00:00Z', 0);
  assert.equal(slots.length, QUARTERS_PER_GAME);
  assert.deepEqual(slots.map((s) => s.minutesFromFirstPitch), [0, 60, 120, 180]);
});
