// ── Tests: null temperatures must never become 0 degrees ───────────────────
//
// Live incident, 2026-08-27. Two college football venue over/under markets
// went public with a line of **0.5 degrees F** for a 2026-09-11 8pm kickoff,
// at -110 both ways. Anyone taking the over collects, every time.
//
// Root cause: Open-Meteo pads its hourly series out to the end of the last
// calendar day, past where the model has data, and those trailing hours come
// back `null`. `Math.round(null)` is 0, so the auto venue O/U engine read a
// confident "0 degrees at game start" and priced a market on it. The daily
// series has the same padding on its final day, which put the same hazard in
// front of the pointspread engines reading `highF` / `lowF`.
//
// These tests cover the two places that made a null look like a real reading:
// the interpolation in getGameWindowForecast, and roundHalfPointAvoidingPush
// turning a zero into the exact 0.5 line that shipped. The source fix lives
// in open-meteo.ts, which drops null-temperature points before they are ever
// mapped into a forecast.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGameWindowForecast } from '../src/lib/mlb-game-forecast';
import { roundHalfPointAvoidingPush } from '../src/lib/auto-market-shared';

/** Minimal hourly point; only the fields the interpolator reads matter here. */
function pt(time: string, tempF: number | null) {
  return {
    time,
    tempF: tempF as number,
    tempC: 0,
    tempK: 0,
    humidity: 50,
    dewPointF: 50,
    precipMm: 0,
    precipProbability: 0,
    windSpeedMph: 5,
    windDirectionDeg: 180,
    windGustMph: 8,
    cloudCover: 10,
    pressure: 1013,
    feelsLikeF: tempF as number,
    visibility: 10,
    uvIndex: 0,
    description: 'Clear',
    icon: 'clear',
  } as any;
}

test('the 0.5 line the incident produced comes from a zero temperature', () => {
  // This is the arithmetic that put 0.5 on a live board: Math.round(null) is
  // 0, and a whole number gets bumped to the next half point to avoid a push.
  assert.equal(roundHalfPointAvoidingPush(0), 0.5);
  // Sanity: a real September kickoff temperature lands nowhere near it.
  assert.equal(roundHalfPointAvoidingPush(88), 88.5);
});

test('a kickoff past the last real hourly point yields no slot at all', () => {
  // With null-padded hours dropped at the source, the series simply ends
  // earlier, and the engines' "forecast does not reach game start yet" guard
  // is what fires. That guard only works if no slot is produced.
  const hourly = [
    pt('2026-09-10T18:00', 80),
    pt('2026-09-10T19:00', 78),
  ];
  const slots = getGameWindowForecast(hourly, '2026-09-11T20:00:00Z', 0, 0, 60);
  assert.equal(slots.length, 0);
});

test('a kickoff inside the real series still interpolates normally', () => {
  const hourly = [
    pt('2026-09-11T19:00', 90),
    pt('2026-09-11T21:00', 86),
  ];
  const slots = getGameWindowForecast(hourly, '2026-09-11T20:00:00Z', 0, 0, 60);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].tempF, 88);
  // And the line that would be priced off it is a real football temperature.
  assert.equal(roundHalfPointAvoidingPush(slots[0].tempF), 88.5);
});

test('null-temperature points are dropped, so no slot is built from them', () => {
  // Defense in depth. If a null ever reaches the interpolator despite the
  // source fix, it must not come out the other side as a clean 0. It did,
  // originally: lerp(null, null) coerces to 0 and Math.round(0) is 0, which
  // is finite, so the engine's Number.isFinite guard would have sailed right
  // past it. The interpolator now drops those points instead.
  const hourly = [
    pt('2026-09-11T19:00', null),
    pt('2026-09-11T21:00', null),
  ];
  const slots = getGameWindowForecast(hourly, '2026-09-11T20:00:00Z', 0, 0, 60);
  assert.equal(slots.length, 0);
});

test('a kickoff bracketed by a dropped null falls outside the usable series', () => {
  const hourly = [
    pt('2026-09-11T19:00', 90),
    pt('2026-09-11T21:00', null),
  ];
  // 20:00 now sits past the last usable point, so there is nothing to price.
  const slots = getGameWindowForecast(hourly, '2026-09-11T20:00:00Z', 0, 0, 60);
  assert.equal(slots.length, 0);
});
