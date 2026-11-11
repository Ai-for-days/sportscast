// ── Tests: FCS venues (2026-11-11) ───────────────────────────────────────
//
// Derek: "for the FCS schools like Charleston Southern, The Citadel, Elon,
// etc., we have to put their venues and the zip codes of those venues in the
// system." FBS-vs-FCS games had no HvL market because the visitor had no
// venue. FCS venues are AWAY ONLY: they stand for the visitor's home city and
// never put an FCS-hosted game on the board.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { venues, getVenueById, getVenueEspnTeam, isFcsVenue } from '../src/lib/venue-data';
import { FCS_VENUES } from '../src/lib/fcs-venues';
import { getVenueSlug, findVenueBySlug } from '../src/lib/venue-slug';
import { mergeOddsScheduleFallback } from '../src/lib/league-schedule';
import type { Venue } from '../src/lib/types';

test('the three schools from 10/17 have venues, ZIPs and ESPN ids', () => {
  const cases: Array<[string, string, string, string]> = [
    ['fcs-charleston-southern', 'Charleston Southern Buccaneers', '29406', '2127'],
    ['fcs-the-citadel', 'The Citadel Bulldogs', '29403', '2643'],
    ['fcs-elon', 'Elon Phoenix', '27244', '2210'],
  ];
  for (const [id, team, zip, espnId] of cases) {
    const v = getVenueById(id);
    assert.ok(v, `${id} missing`);
    assert.equal(v!.team, team);
    assert.equal(v!.zip, zip);
    assert.equal(getVenueEspnTeam(id)?.teamId, espnId);
    assert.equal(getVenueEspnTeam(id)?.leaguePath, 'football/college-football');
  }
});

test('every FCS venue is a real US place with a ZIP', () => {
  assert.ok(FCS_VENUES.length >= 120, `only ${FCS_VENUES.length}`);
  for (const v of FCS_VENUES) {
    assert.ok(isFcsVenue(v), v.id);
    assert.equal(v.league, 'ncaa-football', v.id);
    assert.match(v.zip ?? '', /^\d{5}$/, v.id);
    assert.ok(v.lat > 18 && v.lat < 50 && v.lon > -125 && v.lon < -66, `${v.id} at ${v.lat},${v.lon}`);
    assert.ok(getVenueEspnTeam(v.id), `${v.id} has no ESPN id`);
  }
});

test('FCS venues come after every other venue, so first-match lookups are unchanged', () => {
  const firstFcs = venues.findIndex((v) => isFcsVenue(v));
  assert.ok(venues.slice(firstFcs).every((v) => isFcsVenue(v)));
});

test('venue ids, ESPN ids and page URLs are all unique', () => {
  assert.equal(new Set(venues.map((v) => v.id)).size, venues.length);
  const college = venues.filter((v) => v.league === 'ncaa-football');
  const espnIds = college.map((v) => getVenueEspnTeam(v.id)?.teamId).filter(Boolean);
  assert.equal(new Set(espnIds).size, espnIds.length, 'two college venues share an ESPN team id');
  const slugs = college.map((v) => getVenueSlug(v));
  assert.equal(new Set(slugs).size, slugs.length, 'two college venues share a URL');
  for (const v of FCS_VENUES) {
    assert.equal(findVenueBySlug(venues, 'college-football', getVenueSlug(v)!)?.id, v.id);
  }
});

test('two-word FCS mascots are stripped from the URL', () => {
  assert.equal(getVenueSlug(getVenueById('fcs-ualbany')!), 'ualbany');
  assert.equal(getVenueSlug(getVenueById('fcs-gardner-webb')!), 'gardner-webb');
  assert.equal(getVenueSlug(getVenueById('fcs-mississippi-valley-state')!), 'mississippi-valley-state');
});

test('an FCS host never puts a game on the board, but an FCS visitor gets its venue', () => {
  const teamNameToVenue = new Map<string, Venue>();
  for (const v of venues) if (v.league === 'ncaa-football' && v.team) teamNameToVenue.set(v.team.toLowerCase().replace(/[^a-z0-9]/g, ''), v);
  const window: [number, number] = [Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-12-01T00:00:00Z')];
  const merged = mergeOddsScheduleFallback([], [
    { homeTeam: 'Clemson Tigers', awayTeam: 'Charleston Southern Buccaneers', commenceTimeISO: '2026-11-14T17:00:00Z' },
    { homeTeam: 'Elon Phoenix', awayTeam: 'The Citadel Bulldogs', commenceTimeISO: '2026-11-14T18:00:00Z' },
  ], window[0], window[1], teamNameToVenue);
  assert.equal(merged.length, 1, 'the FCS-vs-FCS game must stay off the board');
  assert.equal(merged[0].homeTeam, 'Clemson Tigers');
  assert.equal(merged[0].awayVenue?.id, 'fcs-charleston-southern');
});
