// ── Tests: pointspread wager grading (favorite/underdog spread convention) ──
//
// Reported live (2026-08-23): Derek flagged 4 already-graded pointspread
// tickets as mis-scored (#QMR35607, #RQX41246, #ZUF32418, #LBJ53608). All
// three independent grading code paths (nws-grading.ts's daily cron,
// wager-resolution.ts's manual Wager Resolution Center, and
// wager-auto-grade.ts's "Auto-Grade from NWS" button) compared the raw
// observed diff straight against `spread`, but `spread` is locationA's own
// line in favorite/underdog notation (mirrors locationAOdds/locationBOdds,
// and how PointspreadDisplay.tsx shows spreadA=spread, spreadB=-spread) —
// the same convention weather-market-idea-generator.ts's balancedSpreadF
// and weather-market-pricing.ts's priceSpread already used correctly. The
// fix: A wins when (observedValueA - observedValueB) + spread > 0.
//
// These are the exact 4 real tickets Derek flagged (previously graded the
// wrong way) plus 2 he did not flag (previously graded the right way even
// under the broken formula, and must NOT flip under the fix).
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradePointspreadWager } from '../src/lib/nws-grading';
import { computePointspread } from '../src/lib/wager-resolution';
import type { PointspreadWager, WagerLocation } from '../src/lib/wager-types';

function loc(name: string): WagerLocation {
  return { name, lat: 0, lon: 0, stationId: 'KTST', timeZone: 'America/New_York' };
}

function pointspreadWager(spread: number, metricB?: 'low_temp'): PointspreadWager {
  return {
    id: 'w_test', ticketNumber: 'TST00001', title: 'Test pointspread',
    status: 'locked', metric: 'high_temp', targetDate: '2026-01-01',
    lockTime: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'pointspread', locationA: loc('Location A'), locationB: loc('Location B'),
    spread, locationAOdds: -110, locationBOdds: -110,
    ...(metricB ? { metricB } : {}),
  };
}

// [ticket, observedValueA, observedValueB, spread, expectedWinner]
const REAL_CASES: [string, number, number, number, 'locationA' | 'locationB'][] = [
  ['QMR35607 (flagged wrong)', 96.8, 55.4, -43.5, 'locationB'],
  ['RQX41246 (flagged wrong)', 81, 93, 20, 'locationA'],
  ['ZUF32418 (flagged wrong)', 99, 68, -32, 'locationB'],
  ['LBJ53608 (flagged wrong)', 72, 72, 20, 'locationA'],
  ['VCS71553 (was already correct)', 72, 97, 20, 'locationB'],
  ['ZFA71643 (was already correct)', 78, 111, 30, 'locationB'],
];

test('gradePointspreadWager (nws-grading.ts, the daily cron) matches Derek’s corrected expectations for every real flagged/unflagged ticket', () => {
  for (const [label, a, b, spread, expected] of REAL_CASES) {
    const winner = gradePointspreadWager(pointspreadWager(spread), a, b);
    assert.equal(winner, expected, `${label}: A=${a} B=${b} spread=${spread}`);
  }
});

test('computePointspread (wager-resolution.ts, manual grading) matches the same corrected expectations', () => {
  for (const [label, a, b, spread, expected] of REAL_CASES) {
    const result = computePointspread(pointspreadWager(spread), { observedValueA: a, observedValueB: b });
    assert.equal(result.winner, expected, `${label}: A=${a} B=${b} spread=${spread}`);
  }
});

test('a pointspread pushes when the adjusted difference is exactly zero', () => {
  // A=80, B=70, spread=-10: (80-70)+(-10) = 0 -> push
  assert.equal(gradePointspreadWager(pointspreadWager(-10), 80, 70), 'push');
  const preview = computePointspread(pointspreadWager(-10), { observedValueA: 80, observedValueB: 70 });
  assert.equal(preview.winner, null);
  assert.ok(preview.warnings.some(w => /push/i.test(w)));
});

test('locationA favored by a large negative spread still needs to actually cover it', () => {
  // A favored by 20 (spread=-20): A must beat B by MORE than 20 to win.
  // A=85, B=70 -> A only won by 15, short of the 20 needed -> B covers.
  assert.equal(gradePointspreadWager(pointspreadWager(-20), 85, 70), 'locationB');
  // A=95, B=70 -> A won by 25, more than the 20 needed -> A covers.
  assert.equal(gradePointspreadWager(pointspreadWager(-20), 95, 70), 'locationA');
});
