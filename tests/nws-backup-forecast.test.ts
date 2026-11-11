// ── Tests: NWS backup forecast (2026-11-11) ──────────────────────────────
//
// Derek: "yes, NWS as the backup." When Open-Meteo refuses, the forecast is
// built from NWS instead of falling through to simulated weather that the
// market engines refuse to price. Pure pieces only; no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNwsHourly,
  buildNwsDaily,
  cardinalToDegrees,
  isoOffsetSeconds,
  spliceBackupWithLastGood,
} from '../src/lib/nws-backup-forecast';
import { parseNwsValidTime, type NWSForecastPeriod } from '../src/lib/nws-forecast';
import type { ForecastResponse } from '../src/lib/types';

/** 48 hourly NWS periods from 2026-11-12 00:00 EST, warmest at 3 PM. */
function hourlyPeriods(): NWSForecastPeriod[] {
  const out: NWSForecastPeriod[] = [];
  for (let i = 0; i < 48; i++) {
    const day = 12 + Math.floor(i / 24);
    const hour = i % 24;
    const t = `2026-11-${day}T${String(hour).padStart(2, '0')}:00:00-05:00`;
    out.push({
      number: i + 1, name: '', startTime: t, endTime: t, isDaytime: hour >= 7 && hour < 18,
      temperature: 40 + (hour <= 15 ? hour : 30 - hour) + (day - 12) * 5, temperatureUnit: 'F',
      windSpeed: '5 to 10 mph', windDirection: 'NW', shortForecast: 'Partly Sunny',
      probabilityOfPrecipitation: { value: hour === 15 ? 40 : 10 },
      dewpoint: { value: 0 }, relativeHumidity: { value: 60 },
    });
  }
  return out;
}

test('validTime durations parse, including days', () => {
  assert.deepEqual(parseNwsValidTime('2026-11-12T05:00:00+00:00/PT6H'), { startMs: Date.parse('2026-11-12T05:00:00Z'), hours: 6 });
  assert.equal(parseNwsValidTime('2026-11-12T05:00:00+00:00/P1DT2H')?.hours, 26);
  assert.equal(parseNwsValidTime('garbage'), null);
});

test('helpers: wind direction and UTC offset', () => {
  assert.equal(cardinalToDegrees('NW'), 315);
  assert.equal(cardinalToDegrees('S'), 180);
  assert.equal(isoOffsetSeconds('2026-11-12T00:00:00-05:00'), -18000);
  assert.equal(isoOffsetSeconds('2026-11-12T00:00:00Z'), 0);
});

test('hourly points carry NWS values in the Open-Meteo time shape', () => {
  const grid = {
    // 6 mm over a 6-hour block starting 2026-11-12 20:00 UTC (3 PM EST).
    qpf: [{ startMs: Date.parse('2026-11-12T20:00:00Z'), hours: 6, value: 6 }],
    sky: [{ startMs: Date.parse('2026-11-12T00:00:00Z'), hours: 48, value: 75 }],
    gust: [{ startMs: Date.parse('2026-11-12T00:00:00Z'), hours: 48, value: 40 }],
  };
  const h = buildNwsHourly(hourlyPeriods(), grid, { pressurePa: 101800, visibilityM: 16093 });
  assert.equal(h.length, 48);
  const threePm = h.find((p) => p.time === '2026-11-12T15:00')!;
  assert.ok(threePm, 'local wall time, no offset');
  assert.equal(threePm.tempF, 55);
  assert.equal(threePm.precipMm, 1, 'a 6-hour total is spread across its hours');
  assert.equal(threePm.precipProbability, 40);
  assert.equal(threePm.windSpeedMph, 10);
  assert.equal(threePm.windGustMph, 25);
  assert.equal(threePm.windDirectionDeg, 315);
  assert.equal(threePm.cloudCover, 75);
  assert.equal(threePm.dewPointF, 32);
  assert.equal(threePm.pressure, 1018);
  assert.equal(threePm.visibility, 10);
});

test('daily highs and lows come from the hours of that calendar day', () => {
  const hourly = buildNwsHourly(hourlyPeriods(), { qpf: [], sky: [], gust: [] }, null);
  const daily = buildNwsDaily(hourly, [
    { number: 1, name: 'Thursday', startTime: '2026-11-12T06:00:00-05:00', endTime: '', isDaytime: true, temperature: 55, temperatureUnit: 'F', windSpeed: '', shortForecast: 'Partly Sunny', detailedForecast: 'Partly sunny, with a high near 55.' },
  ]);
  assert.equal(daily.length, 2);
  assert.equal(daily[0].date, '2026-11-12');
  assert.equal(daily[0].highF, 55);
  assert.equal(daily[0].lowF, 40);
  assert.equal(daily[0].precipProbability, 40);
  assert.equal(daily[0].dayDescription, 'Partly sunny, with a high near 55.');
  assert.equal(daily[1].highF, 60);
});

test('a half-covered last day is dropped, but today is kept', () => {
  const hourly = buildNwsHourly(hourlyPeriods().slice(10, 34), { qpf: [], sky: [], gust: [] }, null);
  const daily = buildNwsDaily(hourly, []);
  assert.deepEqual(daily.map((d) => d.date), ['2026-11-12'], 'the 10 hours of the 13th do not make a day');
});

test('days past the backup horizon come from the last full forecast', () => {
  const day = (date: string, highF: number) => ({ date, highF, lowF: highF - 15 }) as any;
  const backup = {
    daily: [day('2026-11-12', 55), day('2026-11-13', 60)],
    hourly: [{ time: '2026-11-13T23:00', tempF: 45 }],
    generatedAt: '2026-11-12T05:00:00Z',
    baseProvider: 'nws',
    source: { provider: 'open-meteo', label: 'NWS', isResearchSample: false, notes: 'NWS.' },
  } as unknown as ForecastResponse;
  const lastGood = {
    daily: [day('2026-11-12', 50), day('2026-11-13', 50), day('2026-11-14', 62), day('2026-11-15', 64)],
    hourly: [{ time: '2026-11-13T23:00', tempF: 1 }, { time: '2026-11-14T00:00', tempF: 44 }],
    generatedAt: '2026-11-12T02:00:00Z',
  } as unknown as ForecastResponse;
  const out = spliceBackupWithLastGood(backup, lastGood);
  assert.deepEqual(out.daily.map((d) => d.highF), [55, 60, 62, 64], 'the backup wins where it has a day');
  assert.deepEqual(out.hourly.map((h) => h.time), ['2026-11-13T23:00', '2026-11-14T00:00']);
  assert.match(out.source!.notes!, /last full forecast/);
  assert.equal(spliceBackupWithLastGood(backup, null), backup);
  assert.equal(spliceBackupWithLastGood(backup, { ...lastGood, synthetic: true }), backup, 'never borrow simulated days');
});
