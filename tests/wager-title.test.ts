// ── Tests: patching city/state wager titles to venue names for display ────
//
// Reported live (2026-08-25): "it needs to be venue vs. venue not town vs.
// town" — a market titled "Arlington, TX High vs Chicago, IL Low — Wager on
// Weather" (at Globe Life Field vs. Rate Field) still showed the city/state
// name it was created with, since a wager's title is a plain string set once
// at creation and never regenerated. venueifyWagerTitle patches the
// DISPLAYED title by substituting a location's stored name with its tracked
// venue's real name, whenever one matches by coordinate — without mutating
// any stored record.
//
// Run with `npm test`. No network — venue lookup is a pure coordinate match
// against the static venues table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { venueifyWagerTitle } from '../src/lib/wager-title';
import type { PointspreadWager, OverUnderWager, WagerLocation } from '../src/lib/wager-types';

// Real venue coordinates from venue-data.ts (mlb-tex Globe Life Field, mlb-cws Rate Field).
const ARLINGTON_CITY: WagerLocation = { name: 'Arlington, TX', lat: 32.7473, lon: -97.0845, stationId: 'KTST', timeZone: 'America/Chicago' };
const CHICAGO_CITY: WagerLocation = { name: 'Chicago, IL', lat: 41.8299, lon: -87.6338, stationId: 'KTST', timeZone: 'America/Chicago' };

function pointspreadWager(overrides: Partial<PointspreadWager> = {}): PointspreadWager {
  return {
    id: 'w_test', ticketNumber: 'TST00001', title: 'Arlington, TX High vs Chicago, IL Low — Wager on Weather',
    status: 'locked', metric: 'high_temp', targetDate: '2026-08-24',
    lockTime: '2026-08-24T06:00:00Z', createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-20T00:00:00Z',
    kind: 'pointspread', locationA: ARLINGTON_CITY, locationB: CHICAGO_CITY,
    spread: -48.5, locationAOdds: -110, locationBOdds: -110,
    ...overrides,
  };
}

test('venueifyWagerTitle swaps both sides\' city names for their real venue names', () => {
  const w = pointspreadWager();
  assert.equal(
    venueifyWagerTitle(w.title, w),
    'Globe Life Field High vs Rate Field Low — Wager on Weather',
  );
});

test('venueifyWagerTitle leaves a title untouched when the location name does not appear in it', () => {
  const w = pointspreadWager({ title: 'Rangers vs White Sox Temperature Spread' });
  assert.equal(venueifyWagerTitle(w.title, w), 'Rangers vs White Sox Temperature Spread');
});

test('venueifyWagerTitle leaves a title untouched when no tracked venue matches the coordinates', () => {
  const w = pointspreadWager({
    title: 'Nowhere High vs Chicago, IL Low — Wager on Weather',
    locationA: { ...ARLINGTON_CITY, lat: 0, lon: 0, name: 'Nowhere' },
  });
  assert.equal(venueifyWagerTitle(w.title, w), 'Nowhere High vs Rate Field Low — Wager on Weather');
});

test('venueifyWagerTitle handles an over-under wager\'s single location', () => {
  const w: OverUnderWager = {
    id: 'w_test2', ticketNumber: 'TST00002', title: 'Arlington, TX Daily High Temperature',
    status: 'open', metric: 'high_temp', targetDate: '2026-08-24',
    lockTime: '2026-08-24T06:00:00Z', createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-20T00:00:00Z',
    kind: 'over-under', location: ARLINGTON_CITY, line: 100, over: { odds: -110 }, under: { odds: -110 },
  };
  assert.equal(venueifyWagerTitle(w.title, w), 'Globe Life Field Daily High Temperature');
});

test('venueifyWagerTitle is a no-op when the location name already matches the venue name', () => {
  const w = pointspreadWager({
    title: 'Globe Life Field High vs Rate Field Low — Wager on Weather',
    locationA: { ...ARLINGTON_CITY, name: 'Globe Life Field' },
    locationB: { ...CHICAGO_CITY, name: 'Rate Field' },
  });
  assert.equal(venueifyWagerTitle(w.title, w), 'Globe Life Field High vs Rate Field Low — Wager on Weather');
});
