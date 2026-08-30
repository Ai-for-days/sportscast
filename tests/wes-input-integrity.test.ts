import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWesNow, computeGameWes, DEFAULT_WES_CONFIG } from '../src/lib/wes';
import { getWesBand } from '../src/lib/wes-scale';
import type { ForecastPoint } from '../src/lib/types';

// WES declines to score a forecast it cannot see all of (2026-08-29).
//
// The bug this closes was not a crash. interpolate() looked a value up by
// comparing it against each breakpoint in a curve; every comparison against a
// non-finite number is false, so a missing value matched no row, fell off the
// end of the loop, and came back as the LAST breakpoint's score. A `null` was
// worse, because JS coerces it to 0 in a relational comparison, so it matched
// the FIRST row instead. Either way a gap in the forecast produced a
// confident, plausible, mid-range number with nothing to reveal it — and the
// direction it failed in depended on which flavour of missing arrived.
//
// Measured before the fix, on the healthy day below (a true WES 100):
//   missing feels-like  -> 64 "Fair"      (both flavours)
//   missing wind        -> 99 as dead calm (null) / 90 as a 50 mph gale (undefined)
//   missing visibility  -> 94 as zero vis  (null) / 99 as PERFECT (undefined)
//   missing precip rate -> 99 as bone dry  (null) / 80 as an inch an hour (undefined)
// Failing toward good news is the wrong direction for a product people bet on.

const perfectDay = {
  time: '2026-08-29T18:00',
  tempK: 297, tempF: 75, tempC: 24,
  humidity: 50, dewPointF: 55,
  precipMm: 0, precipProbability: 0,
  windSpeedMph: 5, windDirectionDeg: 180, windGustMph: 8,
  cloudCover: 20, pressure: 1015, feelsLikeF: 75,
  uvIndex: 5, visibility: 10,
  description: 'Sunny', icon: 'sunny',
} as ForecastPoint;

const wesFor = (pt: ForecastPoint) => computeWesNow(pt, 39.1, -84.5, [], DEFAULT_WES_CONFIG);

test('a healthy 75F day still scores exactly as it always did', () => {
  const r = wesFor(perfectDay);
  assert.ok(r, 'a complete forecast must produce a score');
  assert.equal(r.wesFinal, 100, 'the fixture is a flawless day and must still score 100');
  assert.equal(getWesBand(r.wesFinal).label, 'Perfect');
});

// Every field the Environmental scorer reads, in both flavours of missing.
// `null` and `undefined` used to take different paths to different wrong
// answers, so both are pinned here rather than one standing in for the other.
const SCORED_FIELDS = [
  'feelsLikeF', 'windSpeedMph', 'windGustMph', 'dewPointF',
  'visibility', 'cloudCover', 'uvIndex', 'precipMm',
] as const;

for (const field of SCORED_FIELDS) {
  for (const [flavour, value] of [['null', null], ['undefined', undefined], ['NaN', Number.NaN]] as const) {
    test(`a ${flavour} ${field} produces no score at all, not a wrong one`, () => {
      const r = wesFor({ ...perfectDay, [field]: value } as ForecastPoint);
      assert.equal(r, null, `${field}=${flavour} scored ${r?.wesFinal} instead of declining`);
    });
  }
}

test('computeWesNow stamps its own timestamp, so a bad one on the point cannot poison it', () => {
  // Worth pinning: computeWesNow builds its slot with Date.now(), NOT with the
  // forecast point's own time field. A garbage timestamp on the point is therefore
  // harmless here — the guard that matters is on the fields, not the clock.
  const r = wesFor({ ...perfectDay, time: 'not a date' } as ForecastPoint);
  assert.ok(r, 'current conditions are scored against the wall clock');
});

test('a complete forecast is never refused by accident', () => {
  // The guard must reject gaps, not plausible extremes. A genuine -30F
  // subzero night and a genuine 115F afternoon both still score.
  for (const feelsLikeF of [-30, 0, 32, 75, 115]) {
    const r = wesFor({ ...perfectDay, feelsLikeF } as ForecastPoint);
    assert.ok(r, `${feelsLikeF}F was refused, but it is a real temperature`);
    assert.ok(Number.isFinite(r.wesFinal) && r.wesFinal >= 0 && r.wesFinal <= 100);
  }
});

// ── A game window is sampled repeatedly, so one gap need not cost the score ──

const hourAt = (iso: string, over: Partial<ForecastPoint> = {}) =>
  ({ ...perfectDay, time: iso, ...over }) as ForecastPoint;

test('a game window drops the unscoreable hour and scores the rest', () => {
  const hourly = [
    hourAt('2026-09-11T19:00'),
    hourAt('2026-09-11T20:00', { windGustMph: null as unknown as number }),
    hourAt('2026-09-11T21:00'),
    hourAt('2026-09-11T22:00'),
    hourAt('2026-09-11T23:00'),
  ];
  const r = computeGameWes(hourly, '2026-09-11T19:00:00Z', 0, 39.1, -84.5, [], DEFAULT_WES_CONFIG);
  assert.ok(r, 'one bad hour in a five-hour window must not cost the whole score');
  assert.ok(r.wesFinal >= 95, `the surviving hours are still a perfect day, got ${r.wesFinal}`);
});

test('a game window with nothing scoreable in it declines', () => {
  const hourly = [
    hourAt('2026-09-11T19:00', { windGustMph: null as unknown as number }),
    hourAt('2026-09-11T20:00', { windGustMph: null as unknown as number }),
  ];
  const r = computeGameWes(hourly, '2026-09-11T19:00:00Z', 0, 39.1, -84.5, [], DEFAULT_WES_CONFIG);
  assert.equal(r, null);
});
