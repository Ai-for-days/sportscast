// ── Tests: Forecast Performance aggregation ────────────────────────────────
//
// Pure functions behind /admin/forecast-performance. No network, no Redis.
// Run with `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toRows, filterRows, totals, unitFor, seriesByDate, byDimension,
  previousPeriod, deltaOf, facetOptions, weekStart, autoGranularity, valueOf,
} from '../src/lib/forecast-analytics';
import type { ForecastEntry } from '../src/lib/forecast-tracker-types';

function entry(o: Partial<ForecastEntry> = {}): ForecastEntry {
  return {
    id: 'fc_1', locationName: 'Houston, TX', stationId: 'KHOU', lat: 29.7, lon: -95.4,
    timeZone: 'America/Chicago', metric: 'high_temp' as ForecastEntry['metric'],
    targetDate: '2026-09-01', forecastValue: 90, inputAt: '2026-08-29T12:00:00Z',
    leadTimeHours: 60, actualValue: 88, absError: 2, signedError: 2,
    accuracyScoreV2: 80, sourceNormalized: 'nws', leadBucket: '1-3d',
    metricGroup: 'temperature',
    ...o,
  } as ForecastEntry;
}

test('an unverified entry still counts as a forecast but scores nothing', () => {
  // It has no sourceNormalized/leadBucket either — those are written at
  // verification — so this also pins the derive-rather-than-trust behaviour.
  const rows = toRows([entry({
    actualValue: undefined, absError: undefined, signedError: undefined,
    accuracyScoreV2: undefined, sourceNormalized: undefined, leadBucket: undefined,
    metricGroup: undefined, source: ['accuweather'],
  })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verified, false);
  assert.equal(rows[0].source, 'accuweather', 'source must be derived, not dropped');
  assert.equal(rows[0].leadBucket, '1-3d', 'lead bucket must be derived from hours');
  assert.equal(rows[0].metricGroup, 'temperature');
  const t = totals(rows);
  assert.equal(t.forecasts, 1);
  assert.equal(t.verified, 0);
  assert.equal(t.accuracy, null, 'an unscored forecast must not average in as a zero');
});

test('totals average only the verified rows', () => {
  const rows = toRows([
    entry({ id: 'a', absError: 2, signedError: 2, accuracyScoreV2: 80 }),
    entry({ id: 'b', absError: 4, signedError: -4, accuracyScoreV2: 60 }),
    entry({ id: 'c', actualValue: undefined, absError: undefined, signedError: undefined, accuracyScoreV2: undefined }),
  ]);
  const t = totals(rows);
  assert.equal(t.forecasts, 3);
  assert.equal(t.verified, 2);
  assert.equal(t.accuracy, 70);
  assert.equal(t.mae, 3);
  assert.equal(t.bias, -1, 'bias keeps its sign: +2 and -4 average to -1');
});

test('unitFor refuses to put a unit on a temperature/wind mix', () => {
  const temp = toRows([entry({ metric: 'high_temp' as ForecastEntry['metric'], metricGroup: 'temperature' })]);
  const wind = toRows([entry({ metric: 'wind_speed' as ForecastEntry['metric'], metricGroup: 'wind' })]);
  assert.equal(unitFor(temp), '°F');
  assert.equal(unitFor(wind), 'mph');
  assert.equal(unitFor([...temp, ...wind]), 'mixed', 'averaging °F with mph has no unit and no meaning');
});

test('filterRows narrows on every facet', () => {
  const rows = toRows([
    entry({ id: 'a', targetDate: '2026-09-01', sourceNormalized: 'nws' }),
    entry({ id: 'b', targetDate: '2026-09-10', sourceNormalized: 'wageronweather-consensus' }),
    entry({ id: 'c', targetDate: '2026-09-20', sourceNormalized: 'nws', locationName: 'Denver, CO' }),
  ]);
  assert.equal(filterRows(rows, { from: '2026-09-05' }).length, 2);
  assert.equal(filterRows(rows, { to: '2026-09-05' }).length, 1);
  assert.equal(filterRows(rows, { sources: ['nws'] }).length, 2);
  assert.equal(filterRows(rows, { locations: ['Denver, CO'] }).length, 1);
  assert.equal(filterRows(rows, {}).length, 3, 'empty filters must not filter anything out');
});

test('seriesByDate emits null, not zero, for a source with no data in a bucket', () => {
  const rows = toRows([
    entry({ id: 'a', targetDate: '2026-09-01', sourceNormalized: 'nws', accuracyScoreV2: 80 }),
    entry({ id: 'b', targetDate: '2026-09-02', sourceNormalized: 'accuweather', accuracyScoreV2: 60 }),
  ]);
  const s = seriesByDate(rows, 'accuracy', 'day', ['nws', 'accuweather']);
  assert.equal(s.length, 2);
  assert.equal(s[0].date, '2026-09-01');
  assert.equal(s[0].nws, 80);
  // A zero here would draw a line plunging to the floor on a day that simply
  // had no accuweather forecast, inventing a catastrophic miss out of absence.
  assert.equal(s[0].accuweather, null);
  assert.equal(s[1].accuweather, 60);
});

test('weekly granularity buckets to the Monday', () => {
  assert.equal(weekStart('2026-09-09'), '2026-09-07'); // Wed -> Mon
  assert.equal(weekStart('2026-09-07'), '2026-09-07'); // Mon -> itself
  assert.equal(weekStart('2026-09-13'), '2026-09-07'); // Sun -> that Mon
  const rows = toRows([
    entry({ id: 'a', targetDate: '2026-09-08', accuracyScoreV2: 90 }),
    entry({ id: 'b', targetDate: '2026-09-10', accuracyScoreV2: 70 }),
  ]);
  const s = seriesByDate(rows, 'accuracy', 'week', ['nws']);
  assert.equal(s.length, 1, 'both days fall in one week');
  assert.equal(s[0].nws, 80);
});

test('autoGranularity switches to weekly only for a long range', () => {
  assert.equal(autoGranularity('2026-08-01', '2026-08-28'), 'day');
  assert.equal(autoGranularity('2026-03-01', '2026-09-01'), 'week');
});

test('byDimension groups and orders by volume', () => {
  const rows = toRows([
    entry({ id: 'a', sourceNormalized: 'nws' }),
    entry({ id: 'b', sourceNormalized: 'nws' }),
    entry({ id: 'c', sourceNormalized: 'accuweather' }),
  ]);
  const d = byDimension(rows, 'source');
  assert.equal(d.length, 2);
  assert.equal(d[0].key, 'nws');
  assert.equal(d[0].verified, 2);
});

test('previousPeriod is the equally long window ending the day before', () => {
  // 7 days inclusive (01..07) -> the 7 days before it (Aug 25..31).
  assert.deepEqual(previousPeriod({ from: '2026-09-01', to: '2026-09-07' }),
    { from: '2026-08-25', to: '2026-08-31' });
});

test('deltaOf reads direction per metric, not by sign', () => {
  // Accuracy up is good.
  assert.equal(deltaOf(80, 70, 'accuracy').direction, 'better');
  // The same rise in error is bad.
  assert.equal(deltaOf(4, 3, 'mae').direction, 'worse');
  assert.equal(deltaOf(3, 4, 'mae').direction, 'better');
  // Bias is judged on distance from zero, so a RISE from -3 to -1 is better
  // even though it is also a rise, and -1 to +2 is worse though also a rise.
  assert.equal(deltaOf(-1, -3, 'bias').direction, 'better');
  assert.equal(deltaOf(2, -1, 'bias').direction, 'worse');
  assert.equal(deltaOf(5, 5, 'accuracy').direction, 'flat');
  assert.equal(deltaOf(5, null, 'accuracy').direction, 'flat', 'no baseline is not a regression');
});

test('valueOf maps count to the verified tally', () => {
  const t = totals(toRows([entry({ id: 'a' }), entry({ id: 'b', actualValue: undefined })]));
  assert.equal(valueOf(t, 'count'), 1);
  assert.equal(valueOf(t, 'accuracy'), 80);
});

test('facetOptions orders lead buckets as a progression, not alphabetically', () => {
  const rows = toRows([
    entry({ id: 'a', leadBucket: '7-10d' }),
    entry({ id: 'b', leadBucket: '0-1h' }),
    entry({ id: 'c', leadBucket: '1-3d' }),
  ]);
  const f = facetOptions(rows);
  assert.deepEqual(f.leadBuckets, ['0-1h', '1-3d', '7-10d']);
  assert.equal(f.minDate, '2026-09-01');
});
