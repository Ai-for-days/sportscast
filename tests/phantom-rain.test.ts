// ── Tests: a rain label the model does not stand behind ────────────────────
//
// Derek, 2026-08-27, at ZIP 29209: "radar shows nothing but hourly forecast
// says rain in 5 minutes?"
//
// Open-Meteo can emit a drizzle or rain weather_code alongside 0.0mm of its
// own forecast precipitation and a low chance of any. Every override in
// open-meteo.ts is deliberately upgrade-only, written that way after a false
// rain incident at this same ZIP where the radar sampler read a placeholder
// tile and put "light rain" on a clear day. The upside of upgrade-only is that
// real weather is never hidden. The cost was that a phantom code survived to
// the UI, so an hourly row read "Light rain" beside its own "18%".
//
// The suppression is narrow on purpose, and these tests are mostly about
// pinning how narrow, since the dangerous direction here is hiding real
// weather, not showing a contradictory label.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPhantomRain,
  cloudCoverDescription,
  PHANTOM_RAIN_MAX_PROBABILITY,
} from '../src/lib/open-meteo';

// ── What counts as a phantom ───────────────────────────────────────────

test('a rain code with no precipitation and a low chance is a phantom', () => {
  assert.equal(isPhantomRain('Light rain', 0, 18), true);
  assert.equal(isPhantomRain('Drizzle', 0, 10), true);
});

test('any actual precipitation means it is real, however little', () => {
  assert.equal(isPhantomRain('Light rain', 0.1, 5), false);
});

test('a meaningful chance means it is real, even at 0.0mm', () => {
  assert.equal(isPhantomRain('Light rain', 0, PHANTOM_RAIN_MAX_PROBABILITY), false);
  assert.equal(isPhantomRain('Light rain', 0, 60), false);
});

test('a missing probability is never treated as a phantom', () => {
  // Absence of evidence is not evidence the model is wrong. Fail toward
  // showing the weather.
  assert.equal(isPhantomRain('Light rain', 0, undefined), false);
});

// ── What is deliberately left alone ────────────────────────────────────

test('escalated conditions are never suppressed, phantom or not', () => {
  // Under-reporting these is far worse than a contradictory label, so they
  // keep the old upgrade-only behavior even at 0.0mm and a low chance.
  assert.equal(isPhantomRain('Thunderstorm', 0, 5), false);
  assert.equal(isPhantomRain('Freezing rain', 0, 5), false);
  assert.equal(isPhantomRain('Snow', 0, 5), false);
  assert.equal(isPhantomRain('Heavy rain with hail', 0, 5), false);
});

test('a non-precipitation description is untouched', () => {
  assert.equal(isPhantomRain('Overcast', 0, 5), false);
  assert.equal(isPhantomRain('Clear', 0, 0), false);
  assert.equal(isPhantomRain('Fog', 0, 5), false);
});

// ── What replaces it ───────────────────────────────────────────────────

test('a suppressed row falls back to the sky, not to nothing', () => {
  assert.equal(cloudCoverDescription(100), 'Overcast');
  assert.equal(cloudCoverDescription(70), 'Mostly cloudy');
  assert.equal(cloudCoverDescription(40), 'Partly cloudy');
  assert.equal(cloudCoverDescription(10), 'Mostly clear');
  assert.equal(cloudCoverDescription(0), 'Clear');
});

test('the 29209 case reads as the sky, not as rain', () => {
  // The exact shape reported: a rain code, no precipitation, 18 percent, and
  // an overcast sky. The row should say Overcast.
  const phantom = isPhantomRain('Light rain', 0, 18);
  assert.equal(phantom, true);
  assert.equal(cloudCoverDescription(95), 'Overcast');
});
