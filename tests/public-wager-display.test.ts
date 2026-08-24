// ── Tests: outcome tile temperature/spread display ─────────────────────────
//
// Reported live (2026-08-24): the /wagers cards and the market detail page
// both showed each outcome as just a label + big odds number, with no
// temperature/line/spread number anywhere — "Over" / "+132", nothing to
// actually bet on. outcomeTarget derives the missing number.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeTarget } from '../src/lib/public-wager-display';
import type { PublicWagerView } from '../src/lib/public-wager-view';

function baseView(overrides: Partial<PublicWagerView> = {}): PublicWagerView {
  return {
    id: 'w_test', ticketNumber: 'TST00001', title: 'Test', kind: 'over-under',
    status: 'open', metric: 'high_temp', targetDate: '2026-08-26', lockTime: '2026-08-26T06:00:00Z',
    locationSummary: '', termsSummary: '', outcomes: [], displayedOdds: '',
    resolutionRules: '', weatherDataExplanation: '', winConditionSummary: '', tieOrPushSummary: '',
    lockSummary: '', resolutionSourceSummary: '', responsiblePlayNote: '', lastUpdatedAt: '', createdAt: '',
    unit: '°F',
    ...overrides,
  };
}

test('outcomeTarget shows the line for an over/under wager (same for both outcome indices)', () => {
  const view = baseView({ kind: 'over-under', line: 92 });
  assert.equal(outcomeTarget(view, 0), '92°F');
  assert.equal(outcomeTarget(view, 1), '92°F');
});

test('outcomeTarget shows the signed spread for a pointspread wager, flipped for side B', () => {
  const view = baseView({ kind: 'pointspread', spread: -34.5 });
  assert.equal(outcomeTarget(view, 0), '-34.5°F');
  assert.equal(outcomeTarget(view, 1), '+34.5°F');
});

test('outcomeTarget uses the wager unit (mph for wind metrics)', () => {
  const view = baseView({ kind: 'over-under', line: 15, unit: 'mph' });
  assert.equal(outcomeTarget(view, 0), '15mph');
});

test('outcomeTarget returns null for range-odds wagers (the range is already in the label)', () => {
  const view = baseView({ kind: 'odds' });
  assert.equal(outcomeTarget(view, 0), null);
});

test('outcomeTarget returns null when the expected number is missing from the view', () => {
  const view = baseView({ kind: 'over-under', line: undefined });
  assert.equal(outcomeTarget(view, 0), null);
});
