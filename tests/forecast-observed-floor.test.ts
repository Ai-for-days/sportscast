// ── Tests: observed floor for today's high/low ──────────────────────────
//
// Reported 2026-07-27 for 29209: the page showed "Today expect a high of
// 93°F" while the nearest station had already measured 95°F that afternoon.
// A forecast high the day has already beaten must not be displayed.
//
// Run with `npm test`. No network: the pure reducer is tested directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyObservedExtremes } from '../src/lib/forecast-observed-floor';
import type { DailyForecast } from '../src/lib/types';

function day(date: string, highF: number, lowF: number): DailyForecast {
  return {
    date,
    highF,
    lowF,
    feelsLikeHighF: highF,
    feelsLikeLowF: lowF,
    precipMm: 0,
    precipProbability: 0,
    windSpeedMph: 0,
    windGustMph: 0,
    humidity: 0,
    uvIndexMax: 0,
    sunrise: '',
    sunset: '',
    description: 'Clear',
    icon: '',
    dayDescription: '',
    nightDescription: '',
  } as DailyForecast;
}

test("today's high is lifted to an observation that already beat it", () => {
  // The exact 29209 case: forecast 93, station already recorded 95.
  const out = applyObservedExtremes([day('2026-07-27', 93, 73)], { maxF: 95, minF: 74 });
  assert.equal(out[0].highF, 95);
});

test("today's low is pulled down to a colder observation", () => {
  const out = applyObservedExtremes([day('2026-07-27', 93, 73)], { maxF: 90, minF: 69 });
  assert.equal(out[0].lowF, 69);
});

test('a forecast that still leads the observations is left alone', () => {
  // Mid-morning: it will get hotter than anything measured so far, and the
  // forecast is still the better number. Never pull the high DOWN.
  const out = applyObservedExtremes([day('2026-07-27', 97, 70)], { maxF: 84, minF: 72 });
  assert.equal(out[0].highF, 97);
  assert.equal(out[0].lowF, 70);
});

test('future days are never touched', () => {
  const input = [day('2026-07-27', 93, 73), day('2026-07-28', 98, 75), day('2026-07-29', 95, 73)];
  const out = applyObservedExtremes(input, { maxF: 105, minF: 60 });
  assert.equal(out[0].highF, 105); // today reconciled
  assert.equal(out[1].highF, 98);  // tomorrow untouched
  assert.equal(out[1].lowF, 75);
  assert.equal(out[2].highF, 95);
});

test('observations are rounded to whole degrees', () => {
  const out = applyObservedExtremes([day('2026-07-27', 93, 73)], { maxF: 95.4, minF: 72.6 });
  assert.equal(out[0].highF, 95);
  assert.equal(out[0].lowF, 73);
});

test('the input array is not mutated', () => {
  const input = [day('2026-07-27', 93, 73)];
  applyObservedExtremes(input, { maxF: 95, minF: 70 });
  assert.equal(input[0].highF, 93, 'caller\'s object must be untouched');
  assert.equal(input[0].lowF, 73);
});

test('missing or unusable observations degrade to the forecast unchanged', () => {
  const input = [day('2026-07-27', 93, 73)];
  assert.equal(applyObservedExtremes(input, null)[0].highF, 93);
  assert.equal(applyObservedExtremes(input, { maxF: NaN, minF: 70 })[0].highF, 93);
  assert.equal(applyObservedExtremes(input, { maxF: Infinity, minF: 70 })[0].highF, 93);
});

test('an empty daily array is returned as-is', () => {
  assert.deepEqual(applyObservedExtremes([], { maxF: 95, minF: 70 }), []);
});
