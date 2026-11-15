// WOW-023: interim rain / cold-rain ceiling on wesFinal (WES 1.1). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGameWes, computeWesNow, computeWesForDay, computeConditionsCap, DEFAULT_WES_CONFIG, WES_VERSION,
} from '../src/lib/wes';
import type { ForecastPoint, WeatherAlert } from '../src/lib/types';
import type { GameForecastSlot } from '../src/lib/mlb-game-forecast';

const KICKOFF_MS = Date.parse('2026-11-14T18:00:00Z');
const KICKOFF_ISO = new Date(KICKOFF_MS).toISOString();
const LAT = 40.0, LON = -83.0;

function point(o: Partial<ForecastPoint> = {}): ForecastPoint {
  return {
    time: '', tempK: 300, tempF: 72, tempC: 22, humidity: 50, dewPointF: 52,
    precipMm: 0, precipProbability: 5, windSpeedMph: 6, windDirectionDeg: 180,
    windGustMph: 12, cloudCover: 20, pressure: 1013, feelsLikeF: 72, uvIndex: 4,
    visibility: 10, description: 'Clear', icon: '01d', ...o,
  };
}
/** Same conditions every hour across the window. */
function hourly(o: Partial<ForecastPoint> = {}, perHour?: (h: number) => Partial<ForecastPoint>): ForecastPoint[] {
  return Array.from({ length: 8 }, (_, h) => point({
    time: new Date(KICKOFF_MS + h * 3600000).toISOString().slice(0, 16), ...o, ...(perHour ? perHour(h) : {}),
  }));
}
const game = (hs: ForecastPoint[], alerts: WeatherAlert[] = []) =>
  computeGameWes(hs, KICKOFF_ISO, 0, LAT, LON, alerts, DEFAULT_WES_CONFIG)!;

function slot(o: Partial<GameForecastSlot> = {}): GameForecastSlot {
  return {
    minutesFromFirstPitch: 0, timeUTC: KICKOFF_ISO, tempF: 60, windSpeedMph: 5, windGustMph: 10,
    windDirectionDeg: 0, precipProbability: 10, humidityPercent: 50, description: '', feelsLikeF: 60,
    dewPointF: 45, cloudCoverPct: 50, visibilityMiles: 10, uvIndex: 2, precipMmPerHr: 0, ...o,
  } as GameForecastSlot;
}
const capOf = (o: Partial<GameForecastSlot>) => computeConditionsCap([slot(o)]).cap;

// DBD's game, reconstructed by the Professor (WOW-023 item 1 / T1).
const DBD_GAME = {
  tempF: 44, feelsLikeF: 40, precipMm: 1.27, precipProbability: 80, dewPointF: 38,
  humidity: 92, windSpeedMph: 8, windGustMph: 18, visibility: 5, cloudCover: 100, uvIndex: 0,
  description: 'Light rain',
};

test('T1: DBD cold-rain game: wesRaw 83±1 (the old public number), wesFinal 44, reason cold rain', () => {
  const r = game(hourly(DBD_GAME));
  assert.ok(r.wesRaw >= 82 && r.wesRaw <= 84, `wesRaw ${r.wesRaw}`);
  assert.equal(r.wesFinal, 44);
  assert.equal(r.conditionsCap, 44);
  assert.equal(r.conditionsCapReason, 'cold rain');
});

test('T2: boundary pairs on amount, probability, cold line and cold tiers', () => {
  assert.equal(capOf({ precipMmPerHr: 0.253 }), null);
  assert.equal(capOf({ precipMmPerHr: 0.254 }), 64);
  assert.equal(capOf({ precipMmPerHr: 2.539 }), 64);
  assert.equal(capOf({ precipMmPerHr: 2.54 }), 54);
  assert.equal(capOf({ precipMmPerHr: 7.619 }), 54);
  assert.equal(capOf({ precipMmPerHr: 7.62 }), 44);
  assert.equal(capOf({ precipProbability: 59 }), null);
  assert.equal(capOf({ precipProbability: 60 }), 64);
  assert.equal(computeConditionsCap([slot({ precipProbability: 60 })]).reason, 'rain likely');
  assert.equal(capOf({ precipMmPerHr: 0.5, feelsLikeF: 45.0 }), 44);
  assert.equal(capOf({ precipMmPerHr: 0.5, feelsLikeF: 45.1 }), 64);
  assert.equal(capOf({ precipMmPerHr: 0.5, feelsLikeF: 40 }), 44);
  assert.equal(capOf({ precipMmPerHr: 3, feelsLikeF: 40 }), 39);
  assert.equal(capOf({ precipMmPerHr: 8, feelsLikeF: 40 }), 34);
});

test('T3: cold and wet must be the same slot', () => {
  const r = computeConditionsCap([slot({ feelsLikeF: 30, precipMmPerHr: 0 }), slot({ feelsLikeF: 50, precipMmPerHr: 1 })]);
  assert.equal(r.cap, 64);
  assert.equal(r.reason, 'rain');
});

test('T3b: the worst wet slot sets the cap (minimum, never an average)', () => {
  const r = computeConditionsCap([slot({ precipMmPerHr: 0.5 }), slot({ precipMmPerHr: 8 }), slot({ precipMmPerHr: 0.5 })]);
  assert.equal(r.cap, 44);
  assert.equal(r.reason, 'heavy rain');
  const g = game(hourly({}, (h) => (h === 1 ? { precipMm: 8 } : { precipMm: 0.5 })));
  assert.equal(g.conditionsCap, 44);
});

test('T4: a ceiling, not a floor: a raw score below the cap passes through', () => {
  const r = game(hourly({ tempF: 10, feelsLikeF: -5, precipMm: 1, precipProbability: 90, windSpeedMph: 45, windGustMph: 65, dewPointF: 5, visibility: 0.2, cloudCover: 100, uvIndex: 0 }));
  assert.ok(r.wesRaw < 44, `wesRaw ${r.wesRaw}`);
  assert.equal(r.wesFinal, r.wesRaw);
});

test('T5: with the severe cap, the lower ceiling wins and both reasons are kept', () => {
  const alert: WeatherAlert = {
    id: '1', event: 'Thunderstorm Warning', headline: '', description: '', severity: 'Severe', urgency: 'Expected',
    onset: KICKOFF_ISO, expires: new Date(KICKOFF_MS + 3600000).toISOString(), senderName: 'NWS',
  };
  const r = game(hourly({ precipMm: 0.5, precipProbability: 70 }), [alert]);
  assert.equal(r.severeWeatherCap, 50);
  assert.equal(r.conditionsCap, 64);
  assert.equal(r.wesFinal, 50);
  assert.ok(r.severeWeatherReason);
  assert.equal(r.conditionsCapReason, 'rain');
});

test('T6: Environmental, Fan Feel and Player Feel are never capped', () => {
  const wet = game(hourly(DBD_GAME));
  const sameButProbOnly = game(hourly({ ...DBD_GAME }));
  assert.ok(wet.environmental > 44 && wet.fanFeel > 44 && wet.playerFeel > 44);
  assert.equal(wet.environmental, sameButProbOnly.environmental);
  const raw = 0.20 * wet.environmental + 0.35 * wet.fanFeel + 0.45 * wet.playerFeel;
  assert.ok(Math.abs(raw - wet.wesRaw) < 1e-9, 'sub-scores and wesRaw are the uncapped formulas');
});

test('T7: dry conditions are untouched (no cap, wesFinal === wesRaw)', () => {
  for (const o of [{}, { feelsLikeF: 20, tempF: 25 }, { windSpeedMph: 25, windGustMph: 40 }, { precipProbability: 59 }]) {
    const r = game(hourly(o));
    assert.equal(r.conditionsCap, null);
    assert.equal(r.conditionsCapReason, null);
    assert.equal(r.wesFinal, r.wesRaw);
  }
});

test('T8: computeWesNow and computeWesForDay both apply the cap', () => {
  const now = computeWesNow(point(DBD_GAME), LAT, LON, [], DEFAULT_WES_CONFIG)!;
  assert.equal(now.conditionsCap, 44);
  assert.ok(now.wesFinal <= 44);
  const day = computeWesForDay(hourly({}, () => DBD_GAME).map((p, h) => ({ ...p, time: new Date(Date.parse('2026-11-14T08:00:00Z') + h * 3600000).toISOString().slice(0, 16) })),
    '2026-11-14', 0, LAT, LON, [], DEFAULT_WES_CONFIG)!;
  assert.ok(day, 'day score computed');
  assert.equal(day.conditionsCap, 44);
  assert.ok(day.wesFinal <= 44);
});

test('T9: a non-finite probability never triggers or nulls; the amount alone still triggers', () => {
  assert.equal(capOf({ precipProbability: NaN as any, precipMmPerHr: 0 }), null);
  assert.equal(capOf({ precipProbability: null as any, precipMmPerHr: 0 }), null);
  assert.equal(capOf({ precipProbability: undefined as any, precipMmPerHr: 1 }), 64);
  const r = game(hourly({ precipProbability: null as any }));
  assert.ok(r, 'score still computed');
  assert.equal(r.conditionsCap, null);
});

test('T11: property sweep: more rain never raises wesFinal; colder across 45°F never raises the cap', () => {
  const amounts = [0, 0.2, 0.254, 1, 2.54, 5, 7.62, 12];
  for (const slotIdx of [0, 3, 6]) {
    let prev = Infinity;
    for (const mm of amounts) {
      const r = game(hourly({}, (h) => (h === slotIdx ? { precipMm: mm } : {})));
      assert.ok(r.wesFinal <= prev + 1e-9, `slot ${slotIdx} mm ${mm}: ${r.wesFinal} > ${prev}`);
      prev = r.wesFinal;
    }
  }
  for (const mm of [0.3, 3, 8]) {
    let prev = Infinity;
    for (const f of [60, 50, 45.1, 45, 40, 30]) {
      const c = capOf({ precipMmPerHr: mm, feelsLikeF: f })!;
      assert.ok(c <= prev, `mm ${mm} f ${f}`);
      prev = c;
    }
  }
});

test('version is 1.1', () => {
  assert.equal(WES_VERSION, '1.1');
});
