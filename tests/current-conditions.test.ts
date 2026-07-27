// ── Tests: current-conditions correctness ───────────────────────────────
//
// Covers the 2026-07-27 fixes from the 29209 (Columbia SC) report: it rained
// on the ground while the ZIP page showed no rain, and the page then rendered
// a sun icon above the words "Light Rain".
//
// Run with `npm test`. No network: these exercise pure helpers only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeatherIcon } from '../src/lib/weather-utils';
import { getClimateZone } from '../src/lib/local-content';
import { metresPerPixel } from '../src/lib/radar-nowcast';

// ── Icon vs description ────────────────────────────────────────────────
// The description can come from a live station/radar observation while the
// model's WMO code still says clear. The observation has to win, or the page
// shows a sun over "Light Rain" (exactly what 29209 rendered).

test('precipitation description beats a clear WMO code', () => {
  const icon = getWeatherIcon('Light Rain', false, 0); // 0 = clear sky
  assert.ok(!icon.includes('clear-day'), `expected a rain icon, got ${icon}`);
  assert.ok(icon.includes('rain'), `expected a rain icon, got ${icon}`);
});

test('rain description at night resolves to a night rain icon', () => {
  const icon = getWeatherIcon('Rain', true, 1);
  assert.ok(!icon.includes('clear-night'), `expected a rain icon, got ${icon}`);
});

test('thunderstorm description beats a partly-cloudy WMO code', () => {
  const icon = getWeatherIcon('Thunderstorm', false, 2);
  assert.ok(icon.includes('thunder'), `expected a thunderstorm icon, got ${icon}`);
});

test('non-precip description still uses the WMO code mapping', () => {
  // Regression guard: the override must not hijack ordinary conditions.
  assert.ok(getWeatherIcon('Partly cloudy', false, 2).includes('partly-cloudy-day'));
  assert.ok(getWeatherIcon('Clear', false, 0).includes('clear-day'));
});

test('a precipitating WMO code keeps its own richer mapping', () => {
  // Code 65 (heavy rain) already implies precip, so the description override
  // must not fire and flatten it to the generic icon.
  const icon = getWeatherIcon('Rain', false, 65);
  assert.ok(icon.includes('rain'), `expected a rain icon, got ${icon}`);
});

// ── Radar sampling scale ───────────────────────────────────────────────
// The old 3x3 window at zoom 8 covered ~1.5 km around the ZIP centroid. The
// 29209 cell sat 8.6 km away, so the sample saw nothing while it rained.

test('radar sample radius covers ZIP-scale distances', () => {
  const mpp = metresPerPixel(33.9659); // Columbia SC
  const radiusPx = Math.ceil((12 * 1000) / mpp);
  assert.ok(mpp > 400 && mpp < 700, `unexpected resolution ${mpp} m/px`);
  // The echo that was missed sat 8.6 km out, so the window has to clear that
  // with margin — an 8 km radius reproduced the bug by 0.6 km.
  assert.ok((radiusPx * mpp) / 1000 > 8.6, 'sample radius must reach past the 8.6 km miss');
  // And it must be far wider than the old 3x3 (1.5 km) window.
  assert.ok(radiusPx > 3, 'sample must be wider than the old 3x3 window');
});

test('metresPerPixel shrinks toward the poles', () => {
  assert.ok(metresPerPixel(60) < metresPerPixel(0));
});

// ── Climate copy ───────────────────────────────────────────────────────
// Latitude alone put Columbia SC (34°N) in the "temperate" bucket, whose copy
// promises regular snowfall, nor'easters and winter ice storms.

test('Southeast states below 37N are humid subtropical, not temperate', () => {
  assert.equal(getClimateZone(33.9659, 'SC'), 'subtropical'); // Columbia
  assert.equal(getClimateZone(35.2271, 'NC'), 'subtropical'); // Charlotte
  assert.equal(getClimateZone(36.1627, 'TN'), 'subtropical'); // Nashville
});

test('latitude still governs outside the Southeast', () => {
  assert.equal(getClimateZone(40.7128, 'NY'), 'continental'); // New York
  assert.equal(getClimateZone(44.9778, 'MN'), 'continental'); // Minneapolis
  assert.equal(getClimateZone(34.0522, 'CA'), 'temperate');   // LA — not Southeast
});

test('the Southeast rule does not demote tropical south Florida', () => {
  // FL is a Southeast state, so the override has to stay bounded below 33N.
  assert.equal(getClimateZone(24.5553, 'FL'), 'tropical');    // Key West
  assert.equal(getClimateZone(25.7617, 'FL'), 'subtropical'); // Miami
});

test('the Southeast rule does not reach the northern Southeast', () => {
  assert.equal(getClimateZone(38.2527, 'KY'), 'temperate');   // Louisville
});

test('getClimateZone still works without a state', () => {
  assert.equal(getClimateZone(33.9659), 'temperate'); // unchanged legacy behaviour
});
