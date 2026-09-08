import test from 'node:test';
import assert from 'node:assert/strict';
import { closingOddsKey, withClosingOdds, type ClosingOddsRecord } from '../src/lib/game-closing-odds';
import { gameDayFor } from '../src/lib/game-archive';
import type { GameLines } from '../src/lib/sportsbook-odds';

// ── The line a game started with, kept for good ───────────────────────────
//
// Per Derek (2026-09-08): "keep the odds betting information up the entire
// time, locked in to what the lines were when the games started."
//
// The Odds API drops a game from /odds at kickoff, so without a frozen copy
// every price on a started game renders as an em dash. What makes the frozen
// copy honest is that the freezing instant is defined: the last price seen
// while the game was still 'pre'. These pin that boundary, because getting it
// wrong is invisible — a mid-game price labelled "closing line" looks exactly
// like a correct one.

const lines = (spread: number, total: number): GameLines => ({
  bookmaker: 'DraftKings',
  lastUpdate: '2026-09-07T18:00:00Z',
  moneylineHome: -150,
  moneylineAway: +130,
  spreadHome: { point: spread, price: -110 },
  spreadAway: { point: -spread, price: -110 },
  total: { point: total, overPrice: -110, underPrice: -110 },
  homeRotation: 924,
  awayRotation: 923,
});

const frozen = (l: GameLines): ClosingOddsRecord => ({ lines: l, capturedAt: '2026-09-07T19:55:00Z' });

test('before kickoff the live market wins, so a moving line keeps moving', () => {
  const live = lines(-3.5, 44.5);
  const shown = withClosingOdds(live, 'pre', frozen(lines(-2.5, 41.5)));
  assert.equal(shown.lines?.spreadHome?.point, -3.5);
  assert.equal(shown.isClosing, false, 'a pre-game price is not a closing line');
});

test('once a game starts the frozen line wins OUTRIGHT, not just when live is missing', () => {
  // The important case. A book leaving a stale or in-play number up after
  // kickoff must not overwrite what the game actually started at.
  const stillQuoted = lines(-7.5, 51.5);
  const shown = withClosingOdds(stillQuoted, 'in', frozen(lines(-3.5, 44.5)));
  assert.equal(shown.lines?.spreadHome?.point, -3.5, 'the price at kickoff, not the price now');
  assert.equal(shown.lines?.total?.point, 44.5);
  assert.equal(shown.isClosing, true);
});

test('a finished game whose odds are gone still shows the line it started at', () => {
  // The em-dash case Derek reported: /odds no longer carries the game at all.
  const shown = withClosingOdds(null, 'post', frozen(lines(-3.5, 44.5)));
  assert.equal(shown.lines?.spreadHome?.point, -3.5);
  assert.equal(shown.lines?.total?.point, 44.5);
  assert.equal(shown.isClosing, true);
});

test('a game we never captured is not labelled a closing line', () => {
  // Games that finished before this shipped have nothing frozen. Showing
  // whatever the feed has is fine; calling it a closing line would be a claim
  // we cannot support.
  const shown = withClosingOdds(null, 'post', undefined);
  assert.equal(shown.lines, null);
  assert.equal(shown.isClosing, false);
});

test('the key is stable across a game, and independent of which feed named it', () => {
  // ESPN and The Odds API give the same game different ids, and a game can
  // switch between those sources between renders — so the key is venue plus
  // kickoff hour, matching rotation-numbers.ts.
  const a = closingOddsKey('fenway-park', '2026-09-07T23:10:00Z');
  const b = closingOddsKey('fenway-park', '2026-09-07T23:47:00Z');
  assert.equal(a, b, 'the same game an hour bucket apart is the same key');
  assert.notEqual(a, closingOddsKey('fenway-park', '2026-09-08T02:10:00Z'));
  assert.notEqual(a, closingOddsKey('wrigley-field', '2026-09-07T23:10:00Z'));
});

test('an unusable identity produces no key rather than a wrong one', () => {
  assert.equal(closingOddsKey('', '2026-09-07T23:10:00Z'), null);
  assert.equal(closingOddsKey('fenway-park', 'not a date'), null);
});

// ── Which game day a finished game belongs to ─────────────────────────────

test('a late finish still belongs to the game day it started on', () => {
  // The ET game day runs 6am to 6am (gameDayDateStr), which is the whole
  // reason a West Coast night game does not land in tomorrow's archive.
  // 2026-09-08T02:10:00Z is 10:10pm ET on the 7th.
  assert.equal(gameDayFor('2026-09-08T02:10:00Z'), '2026-09-07');
  // 4am ET on the 8th is still the 7th's game day.
  assert.equal(gameDayFor('2026-09-08T08:00:00Z'), '2026-09-07');
  // 8am ET on the 8th has rolled over.
  assert.equal(gameDayFor('2026-09-08T12:00:00Z'), '2026-09-08');
});

test('an unparseable kickoff is archived nowhere rather than on the wrong day', () => {
  assert.equal(gameDayFor('whenever'), null);
});
