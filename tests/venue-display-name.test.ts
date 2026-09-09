// ── Tests: naming a wager's location ────────────────────────────────────
//
// Derek, 2026-09-08, on a Weatherboard market: "Seattle Mariners play at
// T-mobile but the Seattle Seahawks play at Lumen field."
//
// An NFL pointspread created against Lumen Field was displayed, in its title
// and its terms, as T-Mobile Park. The three display paths resolved a venue
// name by coordinate match, and findVenueByCoords returns the FIRST venue
// within VENUE_COORDINATE_TOLERANCE_DEG (0.05 deg, about 3.5 miles). Lumen
// Field is 0.0038 deg from T-Mobile Park. 61 of 276 venues resolved to a
// different venue this way.
//
// Grading was never affected: it reads the stored location's coordinates and
// NWS station, not the label.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { venues, resolveVenueDisplayName, findVenueByCoords } from '../src/lib/venue-data';

const lumen = venues.find((v) => v.id === 'nfl-sea')!;
const tmobile = venues.find((v) => v.id === 'mlb-sea')!;

test('a stored venue name survives a nearby venue', () => {
  // The bug, exactly: these two are a few thousand feet apart.
  assert.equal(findVenueByCoords(lumen.lat, lumen.lon)?.name, 'T-Mobile Park');
  assert.equal(
    resolveVenueDisplayName({ name: 'Lumen Field', lat: lumen.lat, lon: lumen.lon }),
    'Lumen Field',
  );
  assert.equal(
    resolveVenueDisplayName({ name: 'T-Mobile Park', lat: tmobile.lat, lon: tmobile.lon }),
    'T-Mobile Park',
  );
});

test('a city label is still upgraded to the venue', () => {
  // Why the coordinate lookup exists (Derek, 2026-08-24: "you need the venues
  // in there"). An older or manually-created wager stores a plain city.
  assert.equal(
    resolveVenueDisplayName({ name: 'Seattle, WA', lat: tmobile.lat, lon: tmobile.lon }),
    'T-Mobile Park',
  );
});

test('no tracked venue is displayed as a different venue', () => {
  // The blast-radius guard. Any venue added inside another's tolerance would
  // reintroduce the bug for every market at it.
  const misnamed = venues.filter(
    (v) => resolveVenueDisplayName({ name: v.name, lat: v.lat, lon: v.lon }) !== v.name,
  );
  assert.deepEqual(misnamed.map((v) => v.id), []);
});

test('a location with no usable name degrades rather than throwing', () => {
  assert.equal(resolveVenueDisplayName(undefined), 'Unknown location');
  assert.equal(resolveVenueDisplayName({ lat: 0, lon: 0 }), 'Unknown location');
});
