// ── Tests: hardcoded non-US venue exclusion for the auto-market engines ────
//
// Found live 2026-08-25: inferring "this venue can never work" from a 404
// error message (the original PERMANENT_FAILURE_SENTINEL approach) also
// caught genuinely TRANSIENT NWS failures during a chaotic debugging
// session, silently blacklisting most of MLB's real games for a full week
// even though nothing was wrong with them. Replaced with this hardcoded
// list: the only 4 tracked venues NWS's US-only api.weather.gov can never
// resolve a station for (Toronto Blue Jays, and the 3 Canada-based MLS
// teams), which can never be wrong about a working US venue no matter how
// NWS behaves on a given day.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNonUsVenue, NON_US_VENUE_IDS } from '../src/lib/auto-market-shared';

test('isNonUsVenue flags exactly the 4 known non-US venues', () => {
  assert.equal(isNonUsVenue('mlb-tor'), true);   // Toronto Blue Jays, Rogers Centre
  assert.equal(isNonUsVenue('mls-van'), true);   // Vancouver Whitecaps, BC Place
  assert.equal(isNonUsVenue('mls-tor'), true);   // Toronto FC, BMO Field
  assert.equal(isNonUsVenue('mls-mtl'), true);   // CF Montréal, Saputo Stadium
  assert.equal(NON_US_VENUE_IDS.size, 4);
});

test('isNonUsVenue does not flag ordinary US venues', () => {
  assert.equal(isNonUsVenue('mlb-tb'), false);
  assert.equal(isNonUsVenue('mlb-det'), false);
  assert.equal(isNonUsVenue('nfl-ne'), false);
});

test('isNonUsVenue handles missing/undefined input safely', () => {
  assert.equal(isNonUsVenue(undefined), false);
  assert.equal(isNonUsVenue(null), false);
  assert.equal(isNonUsVenue(''), false);
});
