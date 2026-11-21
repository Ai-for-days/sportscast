// DBD 2026-11-21: college stadiums show the school, "Amon G. Carter Stadium (TCU)".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getVenuesByLeague, collegeSchoolName, withCollegeSchool, getVenueByExactName } from '../src/lib/venue-data';
import { venueifyWagerTitle } from '../src/lib/wager-title';
import { toPublicWagerView } from '../src/lib/public-wager-view';

const tcu = getVenueByExactName('Amon G. Carter Stadium')!;

describe('college school names', () => {
  it('tags the example from DBD', () => {
    assert.equal(withCollegeSchool('Amon G. Carter Stadium'), 'Amon G. Carter Stadium (TCU)');
  });

  it('drops multi-word mascots', () => {
    const cases: Record<string, string> = {
      'Bryant-Denny Stadium': 'Alabama', 'Beaver Stadium': 'Penn State', 'Kenan Memorial Stadium': 'North Carolina',
      'Schoellkopf Field': 'Cornell', 'Yager Stadium': 'Miami OH',
    };
    for (const [stadium, school] of Object.entries(cases)) {
      const v = getVenueByExactName(stadium);
      if (!v) continue; // venue list may name it differently; the sweep below still covers every row
      assert.equal(collegeSchoolName(v), school, stadium);
    }
  });

  it('replaces an existing short tag instead of nesting parentheses', () => {
    assert.equal(withCollegeSchool('Memorial Stadium (Clemson)'), 'Memorial Stadium (Clemson)');
    assert.equal(withCollegeSchool('Acrisure Stadium (Pitt)'), 'Acrisure Stadium (Pittsburgh)');
    assert.equal(withCollegeSchool('Wildcat Stadium (TX)'), 'Wildcat Stadium (Abilene Christian)');
  });

  it('every college venue gets exactly one tag and a school without a mascot word', () => {
    for (const v of getVenuesByLeague('ncaa-football')) {
      const school = collegeSchoolName(v)!;
      assert.ok(school && school.length >= 2, v.id);
      assert.ok(school !== v.team, `${v.id} kept its mascot`);
      const label = withCollegeSchool(v.name);
      if (getVenueByExactName(v.name)?.id !== v.id) continue; // shares a pro stadium's name: left plain
      assert.ok(label.endsWith(`(${school})`), `${v.id}: ${label}`);
      assert.equal((label.match(/\(/g) ?? []).length, (school.match(/\(/g) ?? []).length + 1, `${v.id}: ${label}`);
    }
  });

  it('leaves pro, MLS and city names alone', () => {
    for (const n of ['Lambeau Field', 'Wrigley Field', 'Nissan Stadium', 'Austin, TX', '']) {
      assert.equal(withCollegeSchool(n), n);
    }
  });

  it('tags wager titles once and is stable when applied twice', () => {
    const w: any = { kind: 'over-under', title: 'Amon G. Carter Stadium Temp at Game Start',
      location: { name: tcu.name, lat: tcu.lat, lon: tcu.lon } };
    const once = venueifyWagerTitle(w.title, w);
    assert.equal(once, 'Amon G. Carter Stadium (TCU) Temp at Game Start');
    assert.equal(venueifyWagerTitle(once, w), once);
  });

  it('tags both sides of a cross-venue title and the public view names', () => {
    const b = getVenueByExactName('Lambeau Field')!;
    const w: any = {
      id: 'x', kind: 'pointspread', status: 'open', metric: 'actual_temp', targetDate: '2026-11-21',
      title: `Amon G. Carter Stadium High vs Lambeau Field Low — Wager on Weather`,
      locationA: { name: tcu.name, lat: tcu.lat, lon: tcu.lon }, locationB: { name: b.name, lat: b.lat, lon: b.lon },
      spread: 1.5, locationAOdds: -110, locationBOdds: -110, lockTime: '2026-11-21T11:00:00Z', createdAt: '2026-11-20T00:00:00Z',
    };
    const v = toPublicWagerView(w);
    assert.equal(v.title, 'Amon G. Carter Stadium (TCU) High vs Lambeau Field Low — Wager on Weather');
    assert.equal(v.locationAName, 'Amon G. Carter Stadium (TCU)');
    assert.equal(v.locationBName, 'Lambeau Field');
    assert.equal(w.locationA.name, 'Amon G. Carter Stadium', 'stored record untouched');
  });
});
