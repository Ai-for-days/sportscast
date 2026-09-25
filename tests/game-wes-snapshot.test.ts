import test from 'node:test';
import assert from 'node:assert/strict';
import { wesSnapshotKey, withWesSnapshot, type WesSnapshotRecord } from '../src/lib/game-wes-snapshot';
import { gameStartNoun } from '../src/lib/league-schedule';
import { getVenueById } from '../src/lib/venue-data';
import type { WesResult } from '../src/lib/wes';

// ── The WES a game was played in, kept for good ───────────────────────────
//
// Per Derek (2026-09-24): "WES numbers are not showing up for every game.
// WES needs to always be there, even after the game has started and
// finished."
//
// The forecast a game is scored from is trimmed to "current hour onward", so
// the game's own window drains out of it as the game is played and
// computeGameWes has nothing left to score. These pin the freeze that keeps
// the score, and in particular the boundary: a mid-game recompute scores
// whatever is left of the window rather than the game, and looks exactly like
// a correct number while doing it.

const score = (final: number): WesResult => ({
  wesVersion: '1.0',
  wesRaw: final,
  wesFinal: final,
  environmental: final + 2,
  fanFeel: final - 1,
  playerFeel: final + 1,
  severeWeatherCap: null,
  severeWeatherReason: null,
  environmentalSubScores: {} as WesResult['environmentalSubScores'],
  fanSubScores: {} as WesResult['fanSubScores'],
  playerSubScores: {} as WesResult['playerSubScores'],
});

const frozen = (w: WesResult): WesSnapshotRecord => ({ wes: w, capturedAt: '2026-09-24T22:55:00Z' });

test('before a game starts the live computation wins, so a revised forecast keeps revising', () => {
  const shown = withWesSnapshot(score(71), 'pre', frozen(score(64)));
  assert.equal(shown.wes?.wesFinal, 71);
  assert.equal(shown.isFrozen, false, 'a pre-game score is not yet locked in');
});

test('once a game starts the frozen score wins OUTRIGHT, not just when live is missing', () => {
  // This is the boundary that matters. A half-elapsed window still computes a
  // number. It just describes the rest of the evening rather than the game.
  const shown = withWesSnapshot(score(52), 'in', frozen(score(71)));
  assert.equal(shown.wes?.wesFinal, 71, 'the game keeps the score its full window was forecast to have');
  assert.equal(shown.isFrozen, true);
});

test('a finished game still has a score, which is the whole point', () => {
  // The live side is null here because the game's window fell out of the
  // hourly forecast hours ago. That is the case that was blanking the board.
  const shown = withWesSnapshot(null, 'post', frozen(score(68)));
  assert.equal(shown.wes?.wesFinal, 68);
  assert.equal(shown.isFrozen, true);
});

test('a started game with nothing frozen shows what it can, and does not claim it was locked in', () => {
  // No 'pre' enrichment ever ran for this one (a feed that published it late,
  // or a cold start with no Redis). Half a window beats an empty cell, but it
  // must not be labelled as a locked-in score.
  const shown = withWesSnapshot(score(49), 'post', undefined);
  assert.equal(shown.wes?.wesFinal, 49);
  assert.equal(shown.isFrozen, false);
});

test('nothing live and nothing frozen stays null rather than inventing a score', () => {
  const shown = withWesSnapshot(null, 'post', undefined);
  assert.equal(shown.wes, null);
  assert.equal(shown.isFrozen, false);
});

test('the key is venue plus kickoff hour, so it survives the game changing feeds', () => {
  const a = wesSnapshotKey('mlb-nyy', '2026-09-24T23:05:00Z');
  const b = wesSnapshotKey('mlb-nyy', '2026-09-24T23:40:00Z');
  assert.equal(a, b, 'a kickoff nudged within the hour is the same game');
  assert.notEqual(a, wesSnapshotKey('mlb-nyy', '2026-09-25T23:05:00Z'), 'tomorrow is a different game');
  assert.notEqual(a, wesSnapshotKey('mlb-bos', '2026-09-24T23:05:00Z'), 'another park is a different game');
});

// Per Derek (2026-09-24): "you've got 'first pitch' as a football term. 'first
// pitch' is baseball, football and soccer are 'kick offs'." The boards carry
// all four leagues off one component, so the label has to come from the game.
test("the frozen-score label uses the league's own word for the start of a game", () => {
  const venueOf = (id: string) => {
    const v = getVenueById(id);
    assert.ok(v, `${id} must exist in venue-data for this test to mean anything`);
    return { venue: v! };
  };
  assert.equal(gameStartNoun(venueOf('mlb-nyy')), 'first pitch', 'baseball has a first pitch');
  assert.equal(gameStartNoun(venueOf('nfl-gb')), 'kickoff', 'pro football kicks off');
  assert.equal(gameStartNoun(venueOf('ncaa-alabama')), 'kickoff', 'college football kicks off');
  assert.equal(gameStartNoun(venueOf('mls-atl')), 'kickoff', 'soccer kicks off');
});

test('an unusable identity gets no key rather than a key that collides', () => {
  assert.equal(wesSnapshotKey('', '2026-09-24T23:05:00Z'), null);
  assert.equal(wesSnapshotKey('mlb-nyy', 'not a date'), null);
});
