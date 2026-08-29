// ── Tests: the plausibility audit, and what it must not suppress ──────────
//
// Derek, after finding two live markets at a 0.5F line: "someone could bet
// that and wipe us out." This is the alarm for that class.
//
// The whole design risk is over-blocking. An absolute range rule would have
// caught the 0.5 markets and then immediately suppressed the genuine 110F
// Lawrence KS and 107F Columbia MO forecasts from that same week, which are
// exactly the extremes the product exists to price. So the test is internal
// consistency against the venue's own hourly forecast, and the cases below are
// weighted toward proving real weather still gets through.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditForecastValue,
  hourlyRangeForDate,
  PLAUSIBLE_MARGIN_F,
} from '../src/lib/auto-market-line-audit';
import { AUTO_MARKET_NAMESPACES } from '../src/lib/auto-market-mapping';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A forecast carrying one day of hourly temperatures. */
function forecastWith(dateStr: string, temps: (number | null)[]): any {
  return {
    hourly: temps.map((t, i) => ({
      time: `${dateStr}T${String(i).padStart(2, '0')}:00`,
      tempF: t as number,
    })),
  };
}

const DATE = '2026-09-11';

// ── The failure it was built for ───────────────────────────────────────

test('a zero degree reading among 80s is refused', () => {
  // The exact 0.5-market shape: a null that became a confident 0.
  const fc = forecastWith(DATE, [78, 80, 85, 88, 86, 82]);
  const audit = auditForecastValue(0, fc, DATE);
  assert.equal(audit.ok, false);
  assert.match(audit.reason ?? '', /outside that day's own hourly range/);
});

test('a date with no usable hours is refused rather than guessed at', () => {
  // Fails closed. Pricing a number nothing can corroborate is how the 0.5
  // markets shipped in the first place.
  const fc = forecastWith(DATE, [null, null, null]);
  const audit = auditForecastValue(85, fc, DATE);
  assert.equal(audit.ok, false);
  assert.match(audit.reason ?? '', /no hourly temperatures/);
});

test('a non-finite value is refused', () => {
  const fc = forecastWith(DATE, [78, 80, 85]);
  assert.equal(auditForecastValue(NaN, fc, DATE).ok, false);
  assert.equal(auditForecastValue(Infinity, fc, DATE).ok, false);
});

// ── What it must never suppress ────────────────────────────────────────

test('a genuine 110F Kansas afternoon passes', () => {
  // Real forecast from 2026-09-04 at David Booth. A range rule would have
  // killed this market; the product exists to price exactly this.
  const fc = forecastWith('2026-09-04', [78, 84, 95, 104, 109, 110, 106, 97, 88]);
  assert.equal(auditForecastValue(110, fc, '2026-09-04').ok, true);
  assert.equal(auditForecastValue(97.5, fc, '2026-09-04').ok, true);
});

test('a genuine hard freeze passes', () => {
  // The other tail. A late-season night game where 0F IS the real reading.
  const fc = forecastWith(DATE, [8, 5, 2, 0, -1, 3]);
  assert.equal(auditForecastValue(0, fc, DATE).ok, true,
    'a real subzero night must price, or the rule is just a range check in disguise');
});

test('a daily high slightly beyond the sampled hours still passes', () => {
  // Daily aggregates legitimately sit a little outside the hourly extremes.
  const fc = forecastWith(DATE, [70, 75, 80, 82]);
  assert.equal(auditForecastValue(82 + PLAUSIBLE_MARGIN_F - 1, fc, DATE).ok, true);
  assert.equal(auditForecastValue(82 + PLAUSIBLE_MARGIN_F + 1, fc, DATE).ok, false);
});

// ── Range helper ───────────────────────────────────────────────────────

test('the range ignores other dates and unusable readings', () => {
  const fc: any = {
    hourly: [
      { time: `${DATE}T10:00`, tempF: 80 },
      { time: `${DATE}T11:00`, tempF: null },
      { time: '2026-09-12T11:00', tempF: 200 },
      { time: `${DATE}T12:00`, tempF: 90 },
    ],
  };
  const r = hourlyRangeForDate(fc, DATE);
  assert.deepEqual(r, { min: 80, max: 90, count: 2 });
});

// ── The orphan-pointer namespace list ──────────────────────────────────

test('every engine namespace is listed for the release tool', () => {
  // If an engine adds a namespace and this list is not updated, orphaned
  // pointers under it become unreachable and that game silently loses its
  // market for 90 days with no way to fix it from the UI.
  const engines = ['auto-hvl-market.ts', 'auto-cross-venue-market.ts', 'auto-venue-ou-market.ts'];
  const used = new Set<string>();
  for (const name of engines) {
    const src = readFileSync(join(process.cwd(), 'src', 'lib', name), 'utf8');
    for (const m of src.matchAll(/'(auto[a-z]+(?::[a-z]+)*:game)'/g)) used.add(m[1]);
  }
  assert.ok(used.size > 0, 'found no namespaces in the engines at all');
  for (const ns of used) {
    assert.ok((AUTO_MARKET_NAMESPACES as readonly string[]).includes(ns),
      `namespace "${ns}" is used by an engine but missing from AUTO_MARKET_NAMESPACES`);
  }
});
