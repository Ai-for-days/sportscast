// ── Tests: backup rotation numbers from the public schedule file ───────────
//
// 2026-11-06: The Odds API key 401s, so every rotation number was blank.
// Fixture rows below are copied verbatim from the live file that day.
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBraces, parsePublicSchedule, matchPublicRotation, leagueFromHeader } from '../src/lib/public-rotations';

const FIXTURE = '{0,All sports,2026-11-06 20:39:50 Pacific Time}{'
  + '{header5,1,2,1,341238,"COLLEGE FOOTBALL - Friday, November 6th",,2026-11-06}'
  + '{317,,7574764,,2026-11-06,2026-11-06,11-06,00:04,00:04,2026-11-07 00:04:00,,,,,,,{Virginia Tech,VT,,,,SMU,SMU,,,}}'
  + '{header8,1,1,1,1,"NBA - Friday, November 6th",,2026-11-06}'
  + '{501,,7574999,,2026-11-06,2026-11-06,11-06,00:00,00:00,2026-11-07 00:00:00,,,,,,,{Boston,BOS,,,,Atlanta,ATL,,,}}'
  + '{header19,1,1,1,340565,"NFL WEEK 9 - Sunday, November 8th - BYES (PITTSBURGH, TENNESSEE)",,2026-11-08}'
  + '{451,,7570627,,2026-11-08,2026-11-08,11-08,14:30,14:30,2026-11-08 14:30:00,,1,"Santiago Bernabeu Stadium","Madrid",,,{Cincinnati,CIN,,,,Atlanta,ATL,,,}}'
  + '{453,,7570628,,2026-11-08,2026-11-08,11-08,18:00,18:00,2026-11-08 18:00:00,,,,,,,{Cleveland,CLE,,,,New Orleans,NO,,,}}'
  + '{header21,1,1,1,340566,"NFL WEEK 9 - Monday, November 9th",,2026-11-09}'
  + '{477,,7570640,,2026-11-09,2026-11-09,11-09,01:15,01:15,2026-11-10 01:15:00,,,,,,,{Buffalo,BUF,,,,Minnesota,MIN,,,}}'
  + '}';

test('brace parser keeps quoted commas and nesting', () => {
  assert.deepEqual(parseBraces('{a,"b, c",{d,e},}'), [['a', 'b, c', ['d', 'e'], '']]);
});

test('headers map to our leagues only', () => {
  assert.equal(leagueFromHeader('NFL WEEK 9 - Sunday'), 'nfl');
  assert.equal(leagueFromHeader('COLLEGE FOOTBALL - Friday'), 'ncaa-football');
  assert.equal(leagueFromHeader('COLLEGE BASKETBALL - Friday'), null);
  assert.equal(leagueFromHeader('NBA - Friday'), null);
  assert.equal(leagueFromHeader('NWSL - Saturday'), 'mls');
  assert.equal(leagueFromHeader('MAJOR LEAGUE SOCCER - Saturday, November 7th'), 'mls');
  assert.equal(leagueFromHeader('DOMINICAN REPUBLIC BASEBALL - Friday'), null);
});

test('parses our leagues and skips the rest', () => {
  const rows = parsePublicSchedule(FIXTURE);
  assert.deepEqual(rows.map((r) => [r.league, r.rotation, r.away, r.home]), [
    ['ncaa-football', 317, 'Virginia Tech', 'SMU'],
    ['nfl', 451, 'Cincinnati', 'Atlanta'],
    ['nfl', 453, 'Cleveland', 'New Orleans'],
    ['nfl', 477, 'Buffalo', 'Minnesota'],
  ]);
  assert.equal(rows[1].startMs, Date.parse('2026-11-08T14:30:00Z'));
});

const rows = parsePublicSchedule(FIXTURE);

test('matches our full names; away gets the listed number, home +1', () => {
  assert.deepEqual(matchPublicRotation(rows, 'nfl', 'Atlanta Falcons', 'Cincinnati Bengals', '2026-11-08T14:30:00Z'), { away: 451, home: 452 });
  assert.deepEqual(matchPublicRotation(rows, 'nfl', 'Minnesota Vikings', 'Buffalo Bills', '2026-11-10T01:15:00Z'), { away: 477, home: 478 });
  assert.deepEqual(matchPublicRotation(rows, 'ncaa-football', 'SMU Mustangs', 'Virginia Tech Hokies', '2026-11-07T00:00:00Z'), { away: 317, home: 318 });
});

test('a game listed the other way round swaps the numbers', () => {
  assert.deepEqual(matchPublicRotation(rows, 'nfl', 'Cincinnati Bengals', 'Atlanta Falcons', '2026-11-08T14:30:00Z'), { away: 452, home: 451 });
});

test('the file\'s abbreviations match our names', () => {
  const extra = parsePublicSchedule('{{header1,1,1,1,1,"NFL WEEK 9 - Sunday",,2026-11-08}'
    + '{465,,1,,2026-11-08,2026-11-08,11-08,18:00,18:00,2026-11-08 18:00:00,,,,,,,{N.Y. Jets,NYJ,,,,Kansas City,KC,,,}}'
    + '{467,,2,,2026-11-08,2026-11-08,11-08,21:05,21:05,2026-11-08 21:05:00,,,,,,,{L.A. Rams,LAR,,,,Washington,WAS,,,}}'
    + '{header2,1,1,1,1,"COLLEGE FOOTBALL - Saturday",,2026-11-07}'
    + '{301,,3,,2026-11-07,2026-11-07,11-07,17:00,17:00,2026-11-07 17:00:00,,,,,,,{Miami Florida,MIA,,,,Notre Dame,ND,,,}}'
    + '{303,,4,,2026-11-07,2026-11-07,11-07,17:00,17:00,2026-11-07 17:00:00,,,,,,,{Western Kentucky,WKU,,,,Middle Tennessee St.,MTU,,,}}}');
  assert.deepEqual(matchPublicRotation(extra, 'nfl', 'Kansas City Chiefs', 'New York Jets', '2026-11-08T18:00:00Z'), { away: 465, home: 466 });
  assert.deepEqual(matchPublicRotation(extra, 'nfl', 'Washington Commanders', 'Los Angeles Rams', '2026-11-08T21:05:00Z'), { away: 467, home: 468 });
  assert.deepEqual(matchPublicRotation(extra, 'ncaa-football', 'Notre Dame Fighting Irish', 'Miami Hurricanes', '2026-11-07T17:00:00Z'), { away: 301, home: 302 });
  assert.deepEqual(matchPublicRotation(extra, 'ncaa-football', 'Middle Tennessee Blue Raiders', 'Western Kentucky Hilltoppers', '2026-11-07T17:00:00Z'), { away: 303, home: 304 });
  assert.deepEqual(matchPublicRotation(extra, 'ncaa-football', 'Middle Tennessee State Blue Raiders', 'Western Kentucky Hilltoppers', '2026-11-07T17:00:00Z'), { away: 303, home: 304 });
});

test('no match: wrong league, far kickoff, or one team different', () => {
  assert.equal(matchPublicRotation(rows, 'mlb', 'Atlanta Falcons', 'Cincinnati Bengals', '2026-11-08T14:30:00Z'), null);
  assert.equal(matchPublicRotation(rows, 'nfl', 'Atlanta Falcons', 'Cincinnati Bengals', '2026-11-15T14:30:00Z'), null);
  assert.equal(matchPublicRotation(rows, 'nfl', 'Atlanta Falcons', 'Cleveland Browns', '2026-11-08T14:30:00Z'), null);
  // An NBA game with the same city pair is never used for football.
  assert.equal(matchPublicRotation(rows, 'nfl', 'Atlanta Falcons', 'Boston Celtics', '2026-11-07T00:00:00Z'), null);
});
