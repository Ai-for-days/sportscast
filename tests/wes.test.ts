// ── Tests: WES severe-weather cap (added 2026-08-21, still WES 1.0) ────
//
// wesRaw = 0.20*Environmental + 0.35*FanFeel + 0.45*PlayerFeel, unchanged
// from launch. wesFinal = min(wesRaw, severeWeatherCap) when a cap applies,
// else wesRaw — a ceiling, never a floor. These tests pin the classifier
// (classifySevereWeather) and the end-to-end cap behavior via
// computeGameWes, without touching any Environmental/FanFeel/PlayerFeel
// sub-score formula.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGameWes, classifySevereWeather, DEFAULT_WES_CONFIG } from '../src/lib/wes';
import type { ForecastPoint, WeatherAlert } from '../src/lib/types';

const KICKOFF_MS = Date.parse('2026-08-19T18:00:00Z');
const KICKOFF_ISO = new Date(KICKOFF_MS).toISOString();
const LAT = 33.75;
const LON = -84.39;

function point(overrides: Partial<ForecastPoint> = {}): ForecastPoint {
  return {
    time: '', tempK: 300, tempF: 78, tempC: 25.5, humidity: 55, dewPointF: 60,
    precipMm: 0, precipProbability: 5, windSpeedMph: 6, windDirectionDeg: 180,
    windGustMph: 12, cloudCover: 20, pressure: 1013, feelsLikeF: 80, uvIndex: 6,
    visibility: 10, description: 'Clear', icon: '01d',
    ...overrides,
  };
}

/** Near-ideal conditions — well above every cap threshold (85/70/50/30/10) with no alert, so any cap engaged below comes purely from the alert, not from marginal weather. */
function idealHourly(): ForecastPoint[] {
  return Array.from({ length: 8 }, (_, h) => point({ time: new Date(KICKOFF_MS + h * 3600000).toISOString().slice(0, 16) }));
}

/** Genuinely terrible conditions with wesRaw ~22 (well under even the harshest 30 cap) and no alert — the "already-low WES" fixture. */
function terribleHourly(): ForecastPoint[] {
  return Array.from({ length: 8 }, (_, h) => point({
    time: new Date(KICKOFF_MS + h * 3600000).toISOString().slice(0, 16),
    tempF: 10, feelsLikeF: -10, humidity: 95, dewPointF: 8,
    precipMm: 40, precipProbability: 99,
    windSpeedMph: 55, windGustMph: 75,
    cloudCover: 100, pressure: 985, uvIndex: 0, visibility: 0.05,
  }));
}

function alert(overrides: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    id: '1', event: 'Special Weather Statement', headline: '', description: '',
    severity: 'Minor', urgency: 'Expected',
    onset: KICKOFF_ISO, expires: new Date(KICKOFF_MS + 3600000).toISOString(),
    senderName: 'NWS',
    ...overrides,
  };
}

const windowStart = KICKOFF_MS;
const windowEnd = KICKOFF_MS + 3.5 * 3600000;

// ── classifySevereWeather (pure classifier) ─────────────────────────────

test('no alerts classify as "none" — no cap', () => {
  const c = classifySevereWeather([], windowStart, windowEnd);
  assert.equal(c.bucket, 'none');
  assert.equal(c.reason, null);
});

test('an alert entirely outside the event window is ignored', () => {
  const c = classifySevereWeather(
    [alert({ event: 'Tornado Warning', severity: 'Extreme', onset: '2026-08-19T00:00:00Z', expires: '2026-08-19T01:00:00Z' })],
    windowStart, windowEnd,
  );
  assert.equal(c.bucket, 'none');
});

test('Minor/Unknown severity classifies as "minor"', () => {
  const c = classifySevereWeather([alert({ event: 'Special Weather Statement', severity: 'Minor' })], windowStart, windowEnd);
  assert.equal(c.bucket, 'minor');
  assert.equal(c.reason, 'Special Weather Statement');
});

test('Moderate severity classifies as "significant"', () => {
  const c = classifySevereWeather([alert({ event: 'Wind Advisory', severity: 'Moderate' })], windowStart, windowEnd);
  assert.equal(c.bucket, 'significant');
});

test('Severe severity (generic thunderstorm/lightning) classifies as "thunderstorm"', () => {
  const c = classifySevereWeather([alert({ event: 'Thunderstorm Warning', severity: 'Severe' })], windowStart, windowEnd);
  assert.equal(c.bucket, 'thunderstorm');
});

test('"severe thunderstorm" in the event text classifies as "severe", worse than generic Severe', () => {
  const c = classifySevereWeather([alert({ event: 'Severe Thunderstorm Warning', severity: 'Severe' })], windowStart, windowEnd);
  assert.equal(c.bucket, 'severe');
});

test('Extreme severity or "tornado" in the event text classifies as "tornado"', () => {
  const c1 = classifySevereWeather([alert({ event: 'Tornado Warning', severity: 'Extreme' })], windowStart, windowEnd);
  assert.equal(c1.bucket, 'tornado');
  const c2 = classifySevereWeather([alert({ event: 'Tornado Emergency', severity: 'Severe' })], windowStart, windowEnd);
  assert.equal(c2.bucket, 'tornado');
});

test('the worst of several overlapping alerts wins, with its own event text as the reason', () => {
  const c = classifySevereWeather(
    [alert({ event: 'Wind Advisory', severity: 'Moderate' }), alert({ event: 'Tornado Warning', severity: 'Extreme' })],
    windowStart, windowEnd,
  );
  assert.equal(c.bucket, 'tornado');
  assert.equal(c.reason, 'Tornado Warning');
});

// ── computeGameWes end-to-end: wesFinal = min(wesRaw, cap) ──────────────

test('normal weather, no alerts: wesFinal === wesRaw (no cap applied)', () => {
  const r = computeGameWes(idealHourly(), KICKOFF_ISO, 0, LAT, LON, [], DEFAULT_WES_CONFIG);
  assert.ok(r);
  assert.equal(r!.severeWeatherCap, null);
  assert.equal(r!.severeWeatherReason, null);
  assert.equal(r!.wesFinal, r!.wesRaw);
});

test('minor advisory over otherwise-excellent weather: wesFinal = 85', () => {
  const r = computeGameWes(idealHourly(), KICKOFF_ISO, 0, LAT, LON, [alert({ event: 'Special Weather Statement', severity: 'Minor' })], DEFAULT_WES_CONFIG);
  assert.ok(r);
  assert.ok(r!.wesRaw > 85, `expected wesRaw above 85, got ${r!.wesRaw}`);
  assert.equal(r!.severeWeatherCap, 85);
  assert.equal(r!.wesFinal, 85);
});

test('significant advisory over otherwise-excellent weather: wesFinal = 70', () => {
  const r = computeGameWes(idealHourly(), KICKOFF_ISO, 0, LAT, LON, [alert({ event: 'Wind Advisory', severity: 'Moderate' })], DEFAULT_WES_CONFIG);
  assert.ok(r);
  assert.ok(r!.wesRaw > 70, `expected wesRaw above 70, got ${r!.wesRaw}`);
  assert.equal(r!.severeWeatherCap, 70);
  assert.equal(r!.wesFinal, 70);
});

test('thunderstorm/lightning nearby over otherwise-excellent weather: wesFinal = 50', () => {
  const r = computeGameWes(idealHourly(), KICKOFF_ISO, 0, LAT, LON, [alert({ event: 'Thunderstorm Warning', severity: 'Severe' })], DEFAULT_WES_CONFIG);
  assert.ok(r);
  assert.ok(r!.wesRaw > 50, `expected wesRaw above 50, got ${r!.wesRaw}`);
  assert.equal(r!.severeWeatherCap, 50);
  assert.equal(r!.wesFinal, 50);
});

test('severe thunderstorm warning over otherwise-excellent weather: wesFinal = 30', () => {
  const r = computeGameWes(idealHourly(), KICKOFF_ISO, 0, LAT, LON, [alert({ event: 'Severe Thunderstorm Warning', severity: 'Severe' })], DEFAULT_WES_CONFIG);
  assert.ok(r);
  assert.ok(r!.wesRaw > 30, `expected wesRaw above 30, got ${r!.wesRaw}`);
  assert.equal(r!.severeWeatherCap, 30);
  assert.equal(r!.wesFinal, 30);
  assert.equal(r!.severeWeatherReason, 'Severe Thunderstorm Warning');
  // The category scores are NEVER capped — only the overall score is.
  assert.ok(r!.environmental > 30);
  assert.ok(r!.fanFeel > 30);
  assert.ok(r!.playerFeel > 30);
});

test('tornado warning over otherwise-excellent weather: wesFinal = 10', () => {
  const r = computeGameWes(idealHourly(), KICKOFF_ISO, 0, LAT, LON, [alert({ event: 'Tornado Warning', severity: 'Extreme' })], DEFAULT_WES_CONFIG);
  assert.ok(r);
  assert.ok(r!.wesRaw > 10, `expected wesRaw above 10, got ${r!.wesRaw}`);
  assert.equal(r!.severeWeatherCap, 10);
  assert.equal(r!.wesFinal, 10);
});

test('already-low WES: a cap above the raw score never raises it (ceiling, not a forced score)', () => {
  const r = computeGameWes(terribleHourly(), KICKOFF_ISO, 0, LAT, LON, [alert({ event: 'Severe Thunderstorm Warning', severity: 'Severe' })], DEFAULT_WES_CONFIG);
  assert.ok(r);
  assert.ok(r!.wesRaw < 30, `expected wesRaw under the 30 cap, got ${r!.wesRaw}`);
  assert.equal(r!.severeWeatherCap, 30);
  assert.equal(r!.wesFinal, r!.wesRaw, 'wesFinal must stay at wesRaw, not jump up to the cap');
});

test('WES_VERSION stays "1.0" — the cap is part of the 1.0 definition, not a version bump', () => {
  const r = computeGameWes(idealHourly(), KICKOFF_ISO, 0, LAT, LON, [], DEFAULT_WES_CONFIG);
  assert.equal(r!.wesVersion, '1.0');
});
