// ── Tests: the definitive lock rule ────────────────────────────────────────
//
// Derek, 2026-08-27, after several earlier passes had left three different
// conventions in the code and a fourth in the live data:
//
//   "for all wagers that measure daily highs or lows, those all lock at 6am
//    at the time of the venue where the game is played. for wagers that do
//    not measure daily, those all close 3 hours before the game starts."
//
// Which rule applies is decided by the METRIC, not the market type, and the
// 6 AM one is venue-local, not Eastern. Both of those are easy to get subtly
// wrong later, so they are pinned here.
//
// Run with `npm test`. No network, no Redis.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lockTimeDailyMetric,
  lockTimeBeforeKickoff,
  venueLocalDateStr,
  LOCK_MINUTES_BEFORE_KICKOFF,
  lockTimeDailyGame,
  DAILY_LOCK_LOCAL_TIME,
} from '../src/lib/auto-market-shared';

// ── The non-daily half ─────────────────────────────────────────────────

// DBD 2026-11-21: "15 minutes before kick off" for every wager, daily
// high/low included; only a TBD kickoff keeps the 6 AM venue-local lock.
test('a wager closes exactly 15 minutes before the game starts', () => {
  assert.equal(lockTimeBeforeKickoff('2026-08-28T23:05:00.000Z'), '2026-08-28T22:50:00.000Z');
  assert.equal(LOCK_MINUTES_BEFORE_KICKOFF, 15);
});

test('a kickoff just after midnight UTC pushes its lock onto the previous UTC day', () => {
  assert.equal(lockTimeBeforeKickoff('2026-08-28T00:10:00.000Z'), '2026-08-27T23:55:00.000Z');
});

test('a daily high/low market locks 15 minutes before a timed kickoff', () => {
  assert.equal(lockTimeDailyGame('2026-11-22T00:30:00.000Z', false, '2026-11-21', 'America/Chicago'), '2026-11-22T00:15:00.000Z');
});

test('a daily high/low market with a TBD kickoff keeps 6 AM at the venue', () => {
  assert.equal(lockTimeDailyGame('2026-11-21T05:00:00.000Z', true, '2026-11-21', 'America/Chicago'), '2026-11-21T12:00:00.000Z');
});

// ── The daily half ─────────────────────────────────────────────────────

test('a daily wager locks at 6 AM local at the venue, not 6 AM Eastern', () => {
  assert.equal(DAILY_LOCK_LOCAL_TIME, '06:00');
  // 6 AM Central on 2026-08-28 is 11:00Z. 6 AM Eastern would be 10:00Z, and
  // taking the venue's own zone is the whole point of the rule.
  assert.equal(lockTimeDailyMetric('2026-08-28', 'America/Chicago'), '2026-08-28T11:00:00.000Z');
  assert.equal(lockTimeDailyMetric('2026-08-28', 'America/New_York'), '2026-08-28T10:00:00.000Z');
});

test('every US zone gets its own 6 AM, three hours apart coast to coast', () => {
  const zones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
  const instants = zones.map(z => Date.parse(lockTimeDailyMetric('2026-08-28', z)));
  for (let i = 1; i < instants.length; i++) {
    assert.equal(instants[i] - instants[i - 1], 3_600_000, `${zones[i]} is not one hour behind ${zones[i - 1]}`);
  }
});

test('the 6 AM lock survives a DST boundary', () => {
  // US DST ends 2026-11-01. 6 AM Eastern is 10:00Z in October and 11:00Z in
  // November. A fixed offset would be an hour wrong on one side of this.
  assert.equal(lockTimeDailyMetric('2026-10-30', 'America/New_York'), '2026-10-30T10:00:00.000Z');
  assert.equal(lockTimeDailyMetric('2026-11-05', 'America/New_York'), '2026-11-05T11:00:00.000Z');
});

// ── The venue's own game day ───────────────────────────────────────────

test('the game day is the venue\'s, not Eastern\'s', () => {
  // A 10:00 PM Pacific first pitch on 2026-08-28 is 05:00Z on the 29th, which
  // Eastern already calls 1 AM on the 29th. The 6 AM lock has to land on the
  // 28th in Los Angeles, before that game, not on the 29th after it.
  // (A 7 PM Pacific start would NOT show this: 02:10Z is still 10:10 PM the
  // same day in Eastern, so both zones agree and the bug stays hidden.)
  const kickoff = '2026-08-29T05:00:00.000Z';
  assert.equal(venueLocalDateStr(kickoff, 'America/Los_Angeles'), '2026-08-28');
  assert.equal(venueLocalDateStr(kickoff, 'America/New_York'), '2026-08-29');

  const lock = lockTimeDailyMetric(venueLocalDateStr(kickoff, 'America/Los_Angeles'), 'America/Los_Angeles');
  assert.ok(Date.parse(lock) < Date.parse(kickoff),
    'the lock must fall before first pitch, or the market never closes in time');
});

test('a daily lock always precedes its own game', () => {
  // Spot-check the shape across a normal slate: afternoon and evening starts
  // in four zones. Every one must close that morning.
  const cases: [string, string][] = [
    ['2026-08-28T17:10:00.000Z', 'America/New_York'],    // 1:10 PM ET
    ['2026-08-28T23:05:00.000Z', 'America/New_York'],    // 7:05 PM ET
    ['2026-08-29T00:10:00.000Z', 'America/Chicago'],     // 7:10 PM CT
    ['2026-08-29T01:40:00.000Z', 'America/Denver'],      // 7:40 PM MT
    ['2026-08-29T02:10:00.000Z', 'America/Los_Angeles'], // 7:10 PM PT
  ];
  for (const [kickoff, zone] of cases) {
    const lock = lockTimeDailyMetric(venueLocalDateStr(kickoff, zone), zone);
    assert.ok(Date.parse(lock) < Date.parse(kickoff), `${zone} ${kickoff} locks after its own game`);
  }
});

test('since 2026-11-21 a timed game daily and by-time markets close together', () => {
  // Same game, two markets on it. Both now close 15 minutes before kickoff
  // (DBD 2026-11-21); the 6 AM lock remains only for TBD kickoffs.
  const kickoff = '2026-08-28T23:05:00.000Z';
  const daily = Date.parse(lockTimeDailyGame(kickoff, false, venueLocalDateStr(kickoff, 'America/New_York'), 'America/New_York'));
  const byTime = Date.parse(lockTimeBeforeKickoff(kickoff));
  assert.equal(daily, byTime);
  assert.equal(Date.parse(kickoff) - daily, 15 * 60_000);
});
