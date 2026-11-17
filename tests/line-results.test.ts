// DBD 2026-11-17: track favorites that covered and how accurate our numbers were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineResultRow, lineResults, summarize } from '../src/lib/line-results';
import type { Wager } from '../src/lib/wager-types';

const loc = (name: string) => ({ name, lat: 0, lon: 0, stationId: 'K' + name });
const base = { ticketNumber: 'WKT00001', lockTime: '2026-11-10T00:00:00Z', createdAt: '', updatedAt: '' };

function ps(id: string, spread: number, a: number, b: number, mA = 'high_temp', mB = 'high_temp', extra: object = {}): Wager {
  return { ...base, id, title: id, status: 'graded', kind: 'pointspread', metric: 'high_temp', metricA: mA, metricB: mB,
    targetDate: '2026-11-10', locationA: loc('A'), locationB: loc('B'), spread, locationAOdds: -110, locationBOdds: -110,
    observedValueA: a, observedValueB: b, autoManaged: true, ...extra } as unknown as Wager;
}
function ou(id: string, line: number, actual: number, extra: object = {}): Wager {
  return { ...base, id, title: id, status: 'graded', kind: 'over-under', metric: 'actual_temp', targetDate: '2026-11-11',
    location: loc('V'), line, over: { odds: -110 }, under: { odds: -110 }, observedValue: actual, autoManaged: true, ...extra } as unknown as Wager;
}

test('favorite A (spread -5) covers when A wins by more than 5', () => {
  const r = lineResultRow(ps('w1', -5, 70, 62))!;   // A - B = 8, line says 5 -> error +3
  assert.equal(r.family, 'Degrees HvH');
  assert.equal(r.error, 3);
  assert.equal(r.favorite, 'A');
  assert.equal(r.favoriteCovered, true);
});

test('favorite A fails to cover; favorite B covers; pick-em has no favorite; push', () => {
  assert.equal(lineResultRow(ps('w2', -5, 64, 62))!.favoriteCovered, false);            // margin 2 < 5
  const b = lineResultRow(ps('w3', 4, 50, 60, 'low_temp', 'low_temp'))!;                 // B favored by 4, B wins by 10
  assert.equal(b.family, 'Degrees LvL');
  assert.equal(b.favorite, 'B');
  assert.equal(b.favoriteCovered, true);
  assert.equal(b.error, -6);
  const pk = lineResultRow(ps('w4', 0, 60, 58, 'high_temp', 'low_temp'))!;
  assert.equal(pk.family, 'Degrees HvL');
  assert.equal(pk.favorite, null);
  assert.equal(pk.favoriteCovered, null);
  const push = lineResultRow(ps('w5', -3, 63, 60))!;
  assert.equal(push.push, true);
  assert.equal(push.favoriteCovered, null);
});

test('over/under: error = actual - line, opening line error', () => {
  const r = lineResultRow(ou('o1', 61.5, 64, { openingLineSnapshot: { capturedAt: '', marketType: 'over-under', overUnder: { line: 60, overOdds: -110, underOdds: -110 } } }))!;
  assert.equal(r.family, 'Venue Degrees O/U');
  assert.equal(r.error, 2.5);
  assert.equal(r.overUnder, 'over');
  assert.equal(r.openingLine, 60);
  assert.equal(r.openingError, 4);
});

test('ungraded, voided, odds-type or incomplete markets are skipped', () => {
  assert.equal(lineResultRow({ ...(ps('x', -1, 1, 0) as object), status: 'void' } as Wager), null);
  assert.equal(lineResultRow({ ...(ps('x', -1, 1, 0) as object), observedValueB: undefined } as unknown as Wager), null);
  assert.equal(lineResultRow({ ...base, id: 'od', title: '', status: 'graded', kind: 'odds', metric: 'high_temp', targetDate: '2026-11-10', location: loc('Z'), outcomes: [] } as unknown as Wager), null);
});

test('summary: miss, bias, cover rate, over rate, pushes, open vs close', () => {
  const s = summarize([ps('a', -5, 70, 62), ps('b', -5, 64, 62), ps('c', -3, 63, 60)].map((w) => lineResultRow(w)!), 'All');
  // errors +3, -3, 0
  assert.equal(s.markets, 3);
  assert.equal(s.bias, 0);
  assert.equal(s.mae, 2);
  assert.equal(s.favorites, 2);
  assert.equal(s.favoritesCovered, 1);
  assert.equal(s.favoriteCoverRate, 0.5);
  assert.equal(s.pushes, 1);
  assert.equal(s.within2, 0.33);
  const o = summarize([ou('x', 60, 62), ou('y', 60, 59), ou('z', 60, 65)].map((w) => lineResultRow(w)!), 'Venue Degrees O/U');
  assert.equal(o.overs, 2);
  assert.equal(o.unders, 1);
  assert.equal(o.overRate, 0.67);
});

test('lineResults: date filter, newest first, one summary per family present', () => {
  const out = lineResults([ps('a', -5, 70, 62), ou('o', 60, 62), ps('v', -1, 1, 0, 'high_temp', 'high_temp', { status: 'void' })], { from: '2026-11-10' });
  assert.deepEqual(out.rows.map((r) => r.id), ['o', 'a']);
  assert.deepEqual(out.summaries.map((s) => s.family), ['All', 'Degrees HvH', 'Venue Degrees O/U']);
  assert.equal(lineResults([ps('a', -5, 70, 62)], { from: '2026-11-11' }).rows.length, 0);
});
