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
import { formatPointspreadSide, formatOverUnderMarket, isTempMetric } from '../src/lib/weatherboard-markets';
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

test('isTempMetric includes actual_temp (2026-08-25: the "at Game Start" venue O/U auto-market)', () => {
  assert.equal(isTempMetric('actual_temp'), true);
  assert.equal(isTempMetric('high_temp'), true);
  assert.equal(isTempMetric('low_temp'), true);
  assert.equal(isTempMetric('actual_wind'), false);
  assert.equal(isTempMetric('actual_gust'), false);
});

test('formatOverUnderMarket reads "Temp at Game Start" for an actual_temp by-time market, not "Temp Day Temp"', () => {
  const w: OverUnderWager = {
    id: 'w_test3', ticketNumber: 'TST00003', title: 'Test by-time over-under',
    status: 'open', metric: 'actual_temp', targetDate: '2026-08-28', targetTime: '19:05',
    lockTime: '2026-08-28T22:50:00Z', createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
    kind: 'over-under',
    location: TROPICANA, line: 91.5, over: { odds: -110 }, under: { odds: -110 },
  };
  assert.equal(
    formatOverUnderMarket(w),
    'Tropicana Field Temp at Game Start 91.5: Over 91.5 (-110) / Under 91.5 (-110)',
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

// ── A market belongs to the venue it NAMES, not the one nearby ──────────────
//
// Reported live 2026-09-12 (Derek: "you've got two wagers on team 926", then
// 917, then the Reds). MLS and NWSL markets were appearing on MLB game rows:
// an Audi Field market on the Washington Nationals row, two Shell Energy
// Stadium markets on the Houston Astros row.
//
// locationMatchesVenue compared coordinates within 0.05 degrees (~3.5 miles),
// a tolerance meant to absorb city-centroid slop for markets stored with only
// a city label. But a city's stadiums sit far closer than that: Audi Field is
// 0.005 degrees from Nationals Park, ten times inside it. Identity now wins
// whenever the stored label is itself a tracked venue.

import { locationMatchesVenue } from '../src/lib/weatherboard-markets';
import { getVenueById } from '../src/lib/venue-data';

test('a named venue matches only itself, not the stadium a mile away', () => {
  const nationalsPark = getVenueById('mlb-wsh')!;
  const audiField = getVenueById('mls-dc')!;
  assert.ok(nationalsPark && audiField, 'both venues must exist in venue-data');

  // Sanity: these really are inside the old coordinate tolerance, which is
  // why the bug fired. If venue-data ever moves them apart this test still
  // holds, but the regression it guards would no longer be reachable.
  assert.ok(Math.abs(nationalsPark.lat - audiField.lat) < 0.05
    && Math.abs(nationalsPark.lon - audiField.lon) < 0.05,
    'Audi Field and Nationals Park sit within the coordinate tolerance');

  const audiMarketLocation = { name: audiField.name, lat: audiField.lat, lon: audiField.lon } as any;
  assert.equal(locationMatchesVenue(audiMarketLocation, audiField), true, 'matches its own venue');
  assert.equal(locationMatchesVenue(audiMarketLocation, nationalsPark), false,
    'an Audi Field market must NOT attach to the Nationals row');
});

test('the Houston pair behaves the same way', () => {
  const daikin = getVenueById('mlb-hou')!;
  const shellEnergy = getVenueById('mls-hou')!;
  const shellMarket = { name: shellEnergy.name, lat: shellEnergy.lat, lon: shellEnergy.lon } as any;
  assert.equal(locationMatchesVenue(shellMarket, shellEnergy), true);
  assert.equal(locationMatchesVenue(shellMarket, daikin), false,
    'a Shell Energy Stadium market must NOT attach to the Astros row');
});

test('a market stored with only a city label still resolves by coordinates', () => {
  // The reason the tolerance exists at all, and the case 74e5e2b preserved.
  const comerica = getVenueById('mlb-det')!;
  const cityLabelled = { name: 'Detroit, MI', lat: comerica.lat, lon: comerica.lon } as any;
  assert.equal(locationMatchesVenue(cityLabelled, comerica), true,
    'a bare city label has no venue identity, so coordinates must still decide');
});
