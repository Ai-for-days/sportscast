// ── Tests: league schedule fallback via The Odds API ────────────────────
//
// ESPN's free scoreboard has repeatedly 403'd our egress IP (see
// venue-schedule.ts's top comment), which took a whole league's section
// dark site-wide (Weatherboard tab, venue "Next Game" cards) even though we
// were already fetching that same league's game list from The Odds API for
// lines. These two pure functions are the fallback: mergeOddsScheduleFallback
// fills gaps in the Weatherboard's league-wide schedule, pickNextHomeGameFromOdds
// does the same for one venue's "Next Game" card. Both are league-agnostic —
// used for NFL, NCAA football, and MLS (not NWSL, which the Odds API doesn't
// track at all). Pinned here so it's testable without touching the network.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOddsScheduleFallback, type RawGame } from '../src/lib/league-schedule';
import { pickNextHomeGameFromOdds } from '../src/lib/venue-schedule';
import type { Venue } from '../src/lib/types';

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 'nfl-den', name: 'Empower Field at Mile High', team: 'Denver Broncos',
    sport: 'football', lat: 39.7439, lon: -105.0201, city: 'Denver', state: 'CO',
    capacity: 76125, type: 'outdoor', league: 'nfl',
    ...overrides,
  } as Venue;
}

function espnGame(overrides: Partial<RawGame> = {}): RawGame {
  return {
    id: 'espn-1', homeTeam: 'Seattle Seahawks', awayTeam: 'New England Patriots',
    kickoffUTC: '2026-09-10T00:15:00Z', state: 'pre', statusDetail: '7:15 PM',
    homeScore: null, awayScore: null, venue: venue({ id: 'nfl-sea', team: 'Seattle Seahawks' }),
    awayVenue: null, inning: null, inningState: null, homePitcher: null, awayPitcher: null,
    livePeriodClock: null,
    ...overrides,
  };
}

test('mergeOddsScheduleFallback fills in a game ESPN is missing', () => {
  const teamNameToVenue = new Map([['denverbroncos', venue()]]);
  const espnGames = [espnGame()]; // ESPN only has the Seahawks game
  const oddsGames = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', commenceTimeISO: '2026-08-22T01:00:00Z' }];
  const merged = mergeOddsScheduleFallback(espnGames, oddsGames, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'), teamNameToVenue);

  assert.equal(merged.length, 2);
  const filled = merged.find((g) => g.homeTeam === 'Denver Broncos');
  assert.ok(filled, 'expected the Odds-API-only game to be filled in');
  assert.equal(filled!.awayTeam, 'Green Bay Packers');
  assert.equal(filled!.state, 'pre');
  assert.equal(filled!.venue.id, 'nfl-den');
});

test('mergeOddsScheduleFallback does not duplicate a game ESPN already has', () => {
  const teamNameToVenue = new Map([['seattleseahawks', venue({ id: 'nfl-sea', team: 'Seattle Seahawks' })]]);
  const espnGames = [espnGame()];
  const oddsGames = [{ homeTeam: 'Seattle Seahawks', awayTeam: 'New England Patriots', commenceTimeISO: '2026-09-10T00:20:00Z' }]; // same game, odds' own kickoff estimate
  const merged = mergeOddsScheduleFallback(espnGames, oddsGames, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'), teamNameToVenue);

  assert.equal(merged.length, 1, 'ESPN already has this team pair — no duplicate should be added');
});

test('mergeOddsScheduleFallback drops a fallback game with no tracked venue', () => {
  const teamNameToVenue = new Map<string, Venue>(); // no venues tracked at all
  const oddsGames = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', commenceTimeISO: '2026-08-22T01:00:00Z' }];
  const merged = mergeOddsScheduleFallback([], oddsGames, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'), teamNameToVenue);
  assert.equal(merged.length, 0);
});

test('mergeOddsScheduleFallback drops a fallback game outside the [floor, cutoff] window', () => {
  const teamNameToVenue = new Map([['denverbroncos', venue()]]);
  const tooLate = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', commenceTimeISO: '2026-12-01T01:00:00Z' }];
  const merged = mergeOddsScheduleFallback([], tooLate, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'), teamNameToVenue);
  assert.equal(merged.length, 0);
});

test('mergeOddsScheduleFallback works for a non-NFL league too (MLS)', () => {
  const mlsVenue = venue({ id: 'mls-atl', name: 'Mercedes-Benz Stadium', team: 'Atlanta United FC', league: 'mls', sport: 'soccer' });
  const teamNameToVenue = new Map([['atlantaunitedfc', mlsVenue]]);
  const oddsGames = [{ homeTeam: 'Atlanta United FC', awayTeam: 'Inter Miami CF', commenceTimeISO: '2026-08-22T23:30:00Z' }];
  const merged = mergeOddsScheduleFallback([], oddsGames, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'), teamNameToVenue);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].homeTeam, 'Atlanta United FC');
  assert.equal(merged[0].venue.id, 'mls-atl');
});

test('pickNextHomeGameFromOdds picks the earliest future home game for the team', () => {
  const nowMs = Date.parse('2026-08-21T23:00:00Z');
  const games = [
    { homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', commenceTimeISO: '2026-08-22T01:00:00Z' },
    { homeTeam: 'Denver Broncos', awayTeam: 'Arizona Cardinals', commenceTimeISO: '2026-08-29T01:00:00Z' }, // later home game
    { homeTeam: 'Seattle Seahawks', awayTeam: 'Denver Broncos', commenceTimeISO: '2026-08-20T01:00:00Z' }, // Broncos AWAY, not a home game
  ];
  const next = pickNextHomeGameFromOdds(games, 'Denver Broncos', nowMs);
  assert.ok(next);
  assert.equal(next!.opponent, 'Green Bay Packers');
  assert.equal(next!.state, 'pre');
});

test('pickNextHomeGameFromOdds ignores a home game that already kicked off', () => {
  const nowMs = Date.parse('2026-08-22T02:00:00Z'); // after the 01:00Z kickoff
  const games = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', commenceTimeISO: '2026-08-22T01:00:00Z' }];
  const next = pickNextHomeGameFromOdds(games, 'Denver Broncos', nowMs);
  assert.equal(next, null);
});

test('pickNextHomeGameFromOdds returns null when the team has no home game in the list', () => {
  const nowMs = Date.parse('2026-08-21T23:00:00Z');
  const games = [{ homeTeam: 'Seattle Seahawks', awayTeam: 'New England Patriots', commenceTimeISO: '2026-09-10T00:15:00Z' }];
  const next = pickNextHomeGameFromOdds(games, 'Denver Broncos', nowMs);
  assert.equal(next, null);
});

test('mergeOddsScheduleFallback applies a completed score as state "post"', () => {
  const teamNameToVenue = new Map([['denverbroncos', venue()]]);
  const oddsGames = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', commenceTimeISO: '2026-08-22T01:00:00Z' }];
  const scores = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', homeScore: 24, awayScore: 17, completed: true }];
  const merged = mergeOddsScheduleFallback([], oddsGames, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'), teamNameToVenue, scores);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].state, 'post');
  assert.equal(merged[0].statusDetail, 'Final');
  assert.equal(merged[0].homeScore, 24);
  assert.equal(merged[0].awayScore, 17);
});

test('mergeOddsScheduleFallback applies an in-progress score as state "in"', () => {
  const teamNameToVenue = new Map([['denverbroncos', venue()]]);
  const oddsGames = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', commenceTimeISO: '2026-08-22T01:00:00Z' }];
  const scores = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', homeScore: 7, awayScore: 3, completed: false }];
  const merged = mergeOddsScheduleFallback([], oddsGames, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'), teamNameToVenue, scores);

  assert.equal(merged[0].state, 'in');
  assert.equal(merged[0].statusDetail, 'In Progress');
  assert.equal(merged[0].homeScore, 7);
  assert.equal(merged[0].awayScore, 3);
});

test('mergeOddsScheduleFallback defaults to "pre" with no score when the game has not started', () => {
  const teamNameToVenue = new Map([['denverbroncos', venue()]]);
  const oddsGames = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', commenceTimeISO: '2026-08-22T01:00:00Z' }];
  const scores = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', homeScore: null, awayScore: null, completed: false }];
  const merged = mergeOddsScheduleFallback([], oddsGames, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'), teamNameToVenue, scores);

  assert.equal(merged[0].state, 'pre');
  assert.equal(merged[0].statusDetail, '');
  assert.equal(merged[0].homeScore, null);
});

test('mergeOddsScheduleFallback defaults to "pre" with no score when scores are omitted entirely (backwards compatible)', () => {
  const teamNameToVenue = new Map([['denverbroncos', venue()]]);
  const oddsGames = [{ homeTeam: 'Denver Broncos', awayTeam: 'Green Bay Packers', commenceTimeISO: '2026-08-22T01:00:00Z' }];
  const merged = mergeOddsScheduleFallback([], oddsGames, Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'), teamNameToVenue);

  assert.equal(merged[0].state, 'pre');
  assert.equal(merged[0].homeScore, null);
  assert.equal(merged[0].awayScore, null);
});
