// ── Tests: Weatherboard/Extended market display formatting ─────────────────
//
// Reported live (2026-08-24), per Derek: "for the wagers, they should read
// like this. You need the venues in there" — the Weatherboard's per-side
// pointspread and over/under text was showing city/state ("Atlanta, GA")
// instead of the actual tracked venue ("Tropicana Field"), and didn't spell
// out the full matchup or "Day Temp" wording. Pinned here against Derek's
// own example strings so the exact format can't silently drift.
//
// Run with `npm test`. No network — venue-name resolution is a pure
// coordinate lookup against the static venues table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPointspreadSide, formatOverUnderMarket } from '../src/lib/weatherboard-markets';
import type { PointspreadWager, OverUnderWager, WagerLocation } from '../src/lib/wager-types';

// Real venue coordinates from venue-data.ts (mlb-tb, mlb-det) — the lookup
// is coordinate-based, so these must match closely enough to fall inside
// LOCATION_TOLERANCE_DEG for the venue name to resolve.
const TROPICANA: WagerLocation = { name: 'St. Petersburg, FL', lat: 27.7682, lon: -82.6534, stationId: 'KTST', timeZone: 'America/New_York' };
const COMERICA: WagerLocation = { name: 'Detroit, MI', lat: 42.3390, lon: -83.0485, stationId: 'KTST', timeZone: 'America/New_York' };

function pointspreadWager(): PointspreadWager {
  return {
    id: 'w_test', ticketNumber: 'TST00001', title: 'Test pointspread',
    status: 'open', metric: 'high_temp', targetDate: '2026-08-26',
    lockTime: '2026-08-26T06:00:00Z', createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z',
    kind: 'pointspread',
    locationA: TROPICANA, locationB: COMERICA,
    metricA: 'high_temp', metricB: 'low_temp',
    spread: -34.5, locationAOdds: -110, locationBOdds: -110,
  };
}

test('formatPointspreadSide (side A) reads venue vs venue with the full matchup', () => {
  const w = pointspreadWager();
  assert.equal(
    formatPointspreadSide(w, 'A'),
    'Tropicana Field High Day Temp vs. Comerica Park Low Day Temp -34.5 (-110)',
  );
});

test('formatPointspreadSide (side B) mirrors the matchup with the opposite spread sign', () => {
  const w = pointspreadWager();
  assert.equal(
    formatPointspreadSide(w, 'B'),
    'Comerica Park Low Day Temp vs. Tropicana Field High Day Temp +34.5 (-110)',
  );
});

test('formatOverUnderMarket reads venue name, metric, and full "Over"/"Under" wording', () => {
  const w: OverUnderWager = {
    id: 'w_test2', ticketNumber: 'TST00002', title: 'Test over-under',
    status: 'open', metric: 'low_temp', targetDate: '2026-08-26',
    lockTime: '2026-08-26T06:00:00Z', createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z',
    kind: 'over-under',
    location: TROPICANA, line: 75, over: { odds: -175 }, under: { odds: 155 },
  };
  assert.equal(
    formatOverUnderMarket(w),
    'Tropicana Field Low Day Temp 75: Over 75 (-175) / Under 75 (+155)',
  );
});

test('formatPointspreadSide falls back to the stored location name when no tracked venue matches', () => {
  const w = pointspreadWager();
  w.locationA = { ...TROPICANA, lat: 0, lon: 0, name: 'Nowhere, XX' }; // no venue anywhere near (0,0)
  assert.equal(
    formatPointspreadSide(w, 'A'),
    'Nowhere, XX High Day Temp vs. Comerica Park Low Day Temp -34.5 (-110)',
  );
});
