import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditForecastValue } from '../src/lib/auto-market-line-audit';

// ── Simulated weather must never reach a price ────────────────────────────
//
// Open-Meteo rate-limits us, and the fallback for that has always been a
// seeded pseudo-random generator (mock-data.ts). Until 2026-08-29 the
// generated forecast came back stamped `source: 'open-meteo'`, so nothing
// downstream could tell it from real weather, and it fired inside five
// separate /api/cron/auto-hvl-pricing runs in 45 minutes on the evening it
// was found.
//
// The part worth pinning is the one that is counter-intuitive: the
// plausibility audit added the day before CANNOT catch this on its own. It
// corroborates a line against the same venue's hourly forecast, which on a
// simulated response is the same invented series. A generator produces
// internally consistent numbers by construction, so the audit passes with
// full confidence and means nothing.

/** A forecast carrying one day of hourly temperatures. */
function forecastWith(dateStr: string, temps: number[], extra: Record<string, unknown> = {}): any {
  return {
    hourly: temps.map((t, i) => ({
      time: `${dateStr}T${String(i).padStart(2, '0')}:00`,
      tempF: t,
    })),
    ...extra,
  };
}

const DATE = '2026-09-11';
const PLAUSIBLE_HOURS = [78, 80, 85, 88, 86, 82];

test('a simulated forecast is refused even when the line looks perfectly reasonable', () => {
  const fc = forecastWith(DATE, PLAUSIBLE_HOURS, { synthetic: true });
  const audit = auditForecastValue(84, fc, DATE);
  assert.equal(audit.ok, false, 'a line off invented weather must not be priced');
  assert.match(audit.reason ?? '', /simulated/);
});

test('the same line on the same numbers passes when the forecast is real', () => {
  // Proves the refusal above is about provenance, not about the value: this is
  // the identical line against the identical hours.
  const fc = forecastWith(DATE, PLAUSIBLE_HOURS);
  assert.equal(auditForecastValue(84, fc, DATE).ok, true);
});

test('internal consistency is exactly what a generator gives you, which is why the flag is needed', () => {
  // Without the provenance check, this is indistinguishable from real weather:
  // the value sits mid-range against its own hours, so every consistency test
  // it could be given comes back clean.
  const fc = forecastWith(DATE, PLAUSIBLE_HOURS, { synthetic: true });
  const asIfReal = auditForecastValue(84, { ...fc, synthetic: false }, DATE);
  assert.equal(asIfReal.ok, true, 'the numbers themselves raise no suspicion at all');
  assert.equal(auditForecastValue(84, fc, DATE).ok, false, 'only the flag separates them');
});

test('an explicitly false flag is treated as real, not as missing', () => {
  const fc = forecastWith(DATE, PLAUSIBLE_HOURS, { synthetic: false });
  assert.equal(auditForecastValue(84, fc, DATE).ok, true);
});

// ── The engines' own gate ─────────────────────────────────────────────────

import { keepRealForecasts } from '../src/lib/auto-market-shared';

const real = (id: string): any => ({ daily: [], hourly: [], synthetic: false });
const simulated = (id: string): any => ({ daily: [], hourly: [], synthetic: true });

test('a simulated venue forecast is dropped, exactly as a missing one is', () => {
  const { map, simulated: count } = keepRealForecasts([
    ['coors', real('coors')],
    ['target', simulated('target')],
    ['fenway', null],
  ]);
  assert.deepEqual([...map.keys()], ['coors'], 'only the real forecast survives');
  assert.equal(count, 1, 'and the simulated one is counted, so it can be alerted on');
});

test('a failed fetch is not counted as simulated — they are different problems', () => {
  const { map, simulated: count } = keepRealForecasts([['fenway', null]]);
  assert.equal(map.size, 0);
  assert.equal(count, 0, 'a missing forecast is an outage, not invented data');
});

test('a forecast with no flag at all is trusted', () => {
  // Every path that does not go through the mock fallback leaves this unset.
  const { map, simulated: count } = keepRealForecasts([['coors', { daily: [], hourly: [] } as any]]);
  assert.equal(map.size, 1);
  assert.equal(count, 0);
});
