// WOW-025 C2: interim wind / cold / heat ceilings on wesFinal (WES 1.2). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGameWes, computeWesNow, computeWesForDay, computeConditionsCap, DEFAULT_WES_CONFIG,
} from '../src/lib/wes';
import type { ForecastPoint } from '../src/lib/types';
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
function hourly(o: Partial<ForecastPoint> = {}, perHour?: (h: number) => Partial<ForecastPoint>): ForecastPoint[] {
  return Array.from({ length: 8 }, (_, h) => point({
    time: new Date(KICKOFF_MS + h * 3600000).toISOString().slice(0, 16), ...o, ...(perHour ? perHour(h) : {}),
  }));
}
const game = (hs: ForecastPoint[]) => computeGameWes(hs, KICKOFF_ISO, 0, LAT, LON, [], DEFAULT_WES_CONFIG)!;

function slot(o: Partial<GameForecastSlot> = {}): GameForecastSlot {
  return {
    minutesFromFirstPitch: 0, timeUTC: KICKOFF_ISO, tempF: 70, windSpeedMph: 5, windGustMph: 10,
    windDirectionDeg: 0, precipProbability: 10, humidityPercent: 50, description: '', feelsLikeF: 70,
    dewPointF: 45, cloudCoverPct: 50, visibilityMiles: 10, uvIndex: 2, precipMmPerHr: 0, ...o,
  } as GameForecastSlot;
}
const cap = (o: Partial<GameForecastSlot>) => computeConditionsCap([slot(o)]);

test('W1: Texas A&M @ Oklahoma reconstruction: raw 90-97, final 79 "breezy"', () => {
  const r = game(hourly({ feelsLikeF: 63, tempF: 63, windSpeedMph: 19, windGustMph: 28, dewPointF: 45, visibility: 10, cloudCover: 50, precipMm: 0, precipProbability: 5 }));
  assert.ok(r.wesRaw >= 90 && r.wesRaw <= 97, `raw ${r.wesRaw}`);
  assert.equal(r.wesFinal, 79);
  assert.equal(r.conditionsCapReason, 'breezy');
});

test('W2: the WOW-022 windy day (65F, 25 mph, gust 40): final 69 "windy"', () => {
  const r = game(hourly({ feelsLikeF: 65, tempF: 65, windSpeedMph: 25, windGustMph: 40 }));
  assert.equal(r.wesFinal, 69);
  assert.equal(r.conditionsCapReason, 'windy');
});

test('W3: a 20F calm dry night: final 54', () => {
  const r = game(hourly({ feelsLikeF: 20, tempF: 20, windSpeedMph: 3, windGustMph: 5, uvIndex: 0, cloudCover: 0 }));
  assert.equal(r.wesFinal, 54);
  assert.equal(r.conditionsCapReason, 'very cold');
});

test('W4: boundary pairs at every threshold', () => {
  const pairs: Array<[Partial<GameForecastSlot>, number | null, Partial<GameForecastSlot>, number]> = [
    [{ windSpeedMph: 14.9 }, null, { windSpeedMph: 15 }, 79],
    [{ windGustMph: 24.9 }, null, { windGustMph: 25 }, 79],
    [{ windSpeedMph: 19.9 }, 79, { windSpeedMph: 20 }, 69],
    [{ windGustMph: 34.9 }, 79, { windGustMph: 35 }, 69],
    [{ windSpeedMph: 29.9 }, 69, { windSpeedMph: 30 }, 54],
    [{ windGustMph: 45.9 }, 69, { windGustMph: 46 }, 54],
    [{ windSpeedMph: 39.9 }, 54, { windSpeedMph: 40 }, 39],
    [{ windGustMph: 57.9 }, 54, { windGustMph: 58 }, 39],
    [{ feelsLikeF: 45.1 }, null, { feelsLikeF: 45 }, 79],
    [{ feelsLikeF: 32.1 }, 79, { feelsLikeF: 32 }, 64],
    [{ feelsLikeF: 20.1 }, 64, { feelsLikeF: 20 }, 54],
    [{ feelsLikeF: 5.1 }, 54, { feelsLikeF: 5 }, 44],
    [{ feelsLikeF: -9.9 }, 44, { feelsLikeF: -10 }, 34],
    [{ feelsLikeF: 89.9 }, null, { feelsLikeF: 90 }, 64],
    [{ feelsLikeF: 102.9 }, 64, { feelsLikeF: 103 }, 44],
    [{ feelsLikeF: 124.9 }, 44, { feelsLikeF: 125 }, 24],
  ];
  for (const [below, wantBelow, at, wantAt] of pairs) {
    assert.equal(cap(below).cap, wantBelow, JSON.stringify(below));
    assert.equal(cap(at).cap, wantAt, JSON.stringify(at));
  }
  assert.equal(cap({ feelsLikeF: 125 }).reason, 'extreme heat');
  assert.equal(cap({ feelsLikeF: -10 }).reason, 'dangerous cold');
  assert.equal(cap({ windGustMph: 58 }).reason, 'high wind');
});

test('ties report rain, then wind, then cold, then heat', () => {
  assert.equal(cap({ precipMmPerHr: 3, feelsLikeF: 60, windSpeedMph: 30 }).reason, 'moderate rain'); // rain 54 vs wind 54
  assert.equal(cap({ windSpeedMph: 30, feelsLikeF: 20 }).reason, 'very windy'); // wind 54 vs cold 54
  assert.equal(cap({ windSpeedMph: 15, feelsLikeF: 45 }).reason, 'breezy'); // wind 79 vs cold 79
  assert.equal(cap({ feelsLikeF: 32 }).reason, 'cold');
});

test('the worst slot in the window binds, across slots and families', () => {
  const r = computeConditionsCap([slot({ windSpeedMph: 16 }), slot({ feelsLikeF: 4 }), slot({ feelsLikeF: 91 })]);
  assert.equal(r.cap, 44);
  assert.equal(r.reason, 'bitter cold');
  const g = game(hourly({}, (h) => (h === 1 ? { windSpeedMph: 31, windGustMph: 40 } : {})));
  assert.equal(g.conditionsCap, 54);
});

test('non-finite wind or feels-like never triggers', () => {
  assert.equal(cap({ windSpeedMph: NaN as any, windGustMph: NaN as any }).cap, null);
  assert.equal(cap({ feelsLikeF: NaN as any }).cap, null);
});

test('W6: property sweep: more wind or gust, colder below 65, hotter above 75 never raises wesFinal', () => {
  const sweep = (vals: number[], f: (v: number) => Partial<ForecastPoint>) => {
    let prev = Infinity;
    for (const v of vals) {
      const r = game(hourly(f(v)));
      assert.ok(r.wesFinal <= prev + 1e-9, `${JSON.stringify(f(v))}: ${r.wesFinal} > ${prev}`);
      prev = r.wesFinal;
    }
  };
  sweep([0, 5, 10, 14.9, 15, 19.9, 20, 25, 29.9, 30, 35, 39.9, 40, 50], (v) => ({ windSpeedMph: v, windGustMph: v }));
  sweep([5, 15, 24.9, 25, 34.9, 35, 45.9, 46, 57.9, 58, 70], (v) => ({ windGustMph: v }));
  sweep([65, 55, 45.1, 45, 32.1, 32, 20.1, 20, 5.1, 5, -9.9, -10, -20], (v) => ({ feelsLikeF: v, tempF: v }));
  sweep([75, 85, 89.9, 90, 102.9, 103, 115, 124.9, 125, 130], (v) => ({ feelsLikeF: v, tempF: v }));
});

test('Environmental, Fan Feel and Player Feel are never capped', () => {
  const r = game(hourly({ windSpeedMph: 25, windGustMph: 40, feelsLikeF: 65, tempF: 65 }));
  const raw = 0.20 * r.environmental + 0.35 * r.fanFeel + 0.45 * r.playerFeel;
  assert.ok(Math.abs(raw - r.wesRaw) < 1e-9);
  assert.ok(r.environmental > 69 && r.fanFeel > 69 && r.playerFeel > 69, 'sub-scores uncapped');
});

test('W8: computeWesNow and computeWesForDay apply the caps', () => {
  const now = computeWesNow(point({ windSpeedMph: 25, windGustMph: 40, feelsLikeF: 65, tempF: 65 }), LAT, LON, [], DEFAULT_WES_CONFIG)!;
  assert.equal(now.conditionsCap, 69);
  assert.ok(now.wesFinal <= 69);
  const day = computeWesForDay(
    hourly({ feelsLikeF: 20, tempF: 20 }).map((p, h) => ({ ...p, time: new Date(Date.parse('2026-11-14T08:00:00Z') + h * 3600000).toISOString().slice(0, 16) })),
    '2026-11-14', 0, LAT, LON, [], DEFAULT_WES_CONFIG)!;
  assert.ok(day, 'day score computed');
  assert.equal(day.conditionsCap, 54);
  assert.ok(day.wesFinal <= 54);
});
