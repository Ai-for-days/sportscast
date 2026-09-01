import test from 'node:test';
import assert from 'node:assert/strict';
import { rotationKey, withRememberedRotations } from '../src/lib/rotation-numbers';

// ── Rotation numbers outlive the odds that carried them ───────────────────
//
// Per Derek: "don't erase the rotation numbers when the games end."
//
// The `#` column comes off `lines.homeRotation` / `awayRotation`, which arrive
// attached to a game in The Odds API's /odds response. That endpoint only
// lists games a bookmaker is still taking action on, so the moment a game
// starts the game drops out, getGameLines returns null, and the whole lines
// object goes with it — including the two numbers in it that were never
// prices. A rotation number is an identifier: it is assigned before the game
// and does not change.

type Lines = { homeRotation: number | null; awayRotation: number | null; total?: { point: number } | null };

const live = (home: number | null, away: number | null): Lines => ({ homeRotation: home, awayRotation: away, total: { point: 8.5 } });

test('a finished game keeps its rotation numbers after the market closes', () => {
  // The exact case: odds gone entirely, numbers remembered from before.
  const shown = withRememberedRotations<Lines>(null, { home: 924, away: 923 });
  assert.ok(shown, 'the board still needs something to print in the # column');
  assert.equal(shown!.homeRotation, 924);
  assert.equal(shown!.awayRotation, 923);
});

test('a live line still wins over what we remember', () => {
  // So a corrected rotation number propagates instead of being pinned to the
  // first one we ever saw.
  const shown = withRememberedRotations<Lines>(live(950, 949), { home: 924, away: 923 });
  assert.equal(shown!.homeRotation, 950);
  assert.equal(shown!.awayRotation, 949);
});

test('remembering fills only the side the feed is missing', () => {
  const shown = withRememberedRotations<Lines>(live(950, null), { home: 924, away: 923 });
  assert.equal(shown!.homeRotation, 950);
  assert.equal(shown!.awayRotation, 923);
});

test('nothing remembered changes nothing', () => {
  assert.equal(withRememberedRotations<Lines>(null, undefined), null);
  const l = live(950, 949);
  assert.equal(withRememberedRotations<Lines>(l, undefined), l);
});

test('the rest of the lines object survives the fill', () => {
  // Prices must not be disturbed by a rotation lookup.
  const shown = withRememberedRotations<Lines>(live(null, null), { home: 924, away: 923 });
  assert.deepEqual(shown!.total, { point: 8.5 });
});

test('a game is keyed by where and when, not by which feed described it', () => {
  // The ESPN id and the Odds API id differ for one game, and a game can switch
  // between those sources between one render and the next.
  const a = rotationKey('mlb-nyy', '2026-09-03T17:05:00Z');
  const b = rotationKey('mlb-nyy', '2026-09-03T17:35:00Z');
  assert.ok(a);
  assert.equal(a, b, 'half an hour of feed disagreement is the same game');
  assert.notEqual(a, rotationKey('mlb-bos', '2026-09-03T17:05:00Z'), 'different venue, different game');
  assert.notEqual(a, rotationKey('mlb-nyy', '2026-09-03T22:35:00Z'), 'the nightcap is its own game');
});

test('an unusable game produces no key rather than a wrong one', () => {
  assert.equal(rotationKey('', '2026-09-03T17:05:00Z'), null);
  assert.equal(rotationKey('mlb-nyy', 'not a date'), null);
});
