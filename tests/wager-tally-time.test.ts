// ── Tests: when a wager is tallied ─────────────────────────────────────────
//
// Derek's rule, 2026-08-27: "if the wager is day temp, then the time would be
// 11:59pm local time at the venue in the time zone with the earliest time.
// Other wagers would have the same eastern time as the start of the game."
// And: "lock time isn't the same as the time we put on the wagers because the
// time we put on the wagers is when that wager is tallied."
//
// Run with `npm test`. No network, no Redis.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wagerTallyTime,
  westernmostLocation,
  zoneOffsetMinutes,
  formatTallyLabel,
} from '../src/lib/wager-tally-time';
import type { Wager } from '../src/lib/wager-types';

const SEP = new Date('2026-09-11T12:00:00Z');

const loc = (name: string, timeZone: string, lat = 39, lon = -92) =>
  ({ name, lat, lon, stationId: 'KTEST', timeZone });

/** A daily-high pointspread across two venues, the HvL/HvH/LvL shape. */
function dayTempPointspread(zoneA: string, zoneB: string): Wager {
  return {
    id: 'w1', ticketNumber: 'T1', title: 'A High vs B Low', kind: 'pointspread',
    status: 'open', metric: 'high_temp', metricA: 'high_temp', metricB: 'low_temp',
    targetDate: '2026-09-11', lockTime: '2026-09-11T21:00:00Z',
    locationA: loc('A', zoneA), locationB: loc('B', zoneB),
    spread: 3, locationAOdds: -110, locationBOdds: -110,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  } as unknown as Wager;
}

/** An "at game start" venue over/under, whose location zone is ET by design. */
function gameStartOverUnder(targetTime: string): Wager {
  return {
    id: 'w2', ticketNumber: 'T2', title: 'Venue Temp at Game Start', kind: 'over-under',
    status: 'open', metric: 'actual_temp', targetDate: '2026-09-11', targetTime,
    lockTime: '2026-09-11T21:00:00Z',
    location: loc('Venue', 'America/New_York'),
    line: 77.5, over: { odds: -110 }, under: { odds: -110 },
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  } as unknown as Wager;
}

// ── Zone maths ─────────────────────────────────────────────────────────

test('offsets place western zones further behind UTC', () => {
  assert.equal(zoneOffsetMinutes('America/New_York', SEP), -240);
  assert.equal(zoneOffsetMinutes('America/Chicago', SEP), -300);
  assert.equal(zoneOffsetMinutes('America/Los_Angeles', SEP), -420);
});

test('the westernmost venue is the one whose day ends last', () => {
  const west = westernmostLocation(
    [loc('Baltimore', 'America/New_York'), loc('Columbia MO', 'America/Chicago')], SEP);
  assert.equal(west?.name, 'Columbia MO');
});

test('the label carries the zone, so 11:59 is never ambiguous', () => {
  assert.equal(formatTallyLabel('2026-09-11', '23:59', 'America/Chicago'), '11:59 PM CDT');
  assert.equal(formatTallyLabel('2026-09-11', '20:00', 'America/New_York'), '8:00 PM EDT');
});

// ── The two rules ──────────────────────────────────────────────────────

test('a day-temp wager is tallied at 11:59 PM local', () => {
  const t = wagerTallyTime(dayTempPointspread('America/New_York', 'America/New_York'));
  assert.equal(t?.time, '23:59');
  assert.equal(t?.basis, 'end-of-day');
  assert.equal(t?.label, '11:59 PM EDT');
});

test('across two zones it waits for the venue whose day ends last', () => {
  // Eastern hits 11:59 PM first, but Central still has an hour of daylight
  // left to set a new daily high, so the tally has to be the Central one.
  const t = wagerTallyTime(dayTempPointspread('America/New_York', 'America/Chicago'));
  assert.equal(t?.timeZone, 'America/Chicago');
  assert.equal(t?.label, '11:59 PM CDT');
});

test('venue order does not change the answer', () => {
  const a = wagerTallyTime(dayTempPointspread('America/Chicago', 'America/New_York'));
  const b = wagerTallyTime(dayTempPointspread('America/New_York', 'America/Chicago'));
  assert.equal(a?.label, b?.label);
});

test('an at-game-start wager is tallied at the game time, in Eastern', () => {
  const t = wagerTallyTime(gameStartOverUnder('20:00'));
  assert.equal(t?.basis, 'game-time');
  assert.equal(t?.time, '20:00');
  assert.equal(t?.label, '8:00 PM EDT');
});

test('the tally time is not the lock time', () => {
  // The whole point of Derek's correction. This market locks at 21:00Z, which
  // is 5 PM ET, and is tallied three hours later at kickoff.
  const w = gameStartOverUnder('20:00');
  const t = wagerTallyTime(w);
  assert.notEqual(t?.label, '5:00 PM EDT');
  assert.equal(t?.label, '8:00 PM EDT');
});

test('a wager with no time basis at all reports nothing rather than guessing', () => {
  const w = gameStartOverUnder('20:00') as any;
  delete w.targetTime;
  w.metric = 'actual_wind';
  assert.equal(wagerTallyTime(w), null);
});
