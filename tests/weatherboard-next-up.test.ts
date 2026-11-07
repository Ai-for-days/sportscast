// ── Tests: Weatherboard "Next up" day picking ──────────────────────────────
//
// Professor ruling WOW-WB-NEXTUP-001 (2026-11-06): when the default Today
// view is empty, the league board shows the next day with games, looking at
// most 14 days ahead. Expected values below are hand-derived from the
// calendar (2026-11-06 is a Friday), not computed by the code under test.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNextGameDay, addDaysStr, etDateStr, formatBoardDay, NEXT_UP_MAX_DAYS } from '../src/lib/weatherboard-next-up';
import { gameDayDateStr } from '../src/lib/mlb-schedule';

// Real NFL Week 10 kickoffs (UTC). Sunday 2026-11-08 9:30am ET London game,
// 1pm ET games, and Monday 2026-11-09 8:15pm ET (= Tue 01:15 UTC).
const SUN_930 = '2026-11-08T14:30:00Z';
const SUN_1PM = '2026-11-08T18:00:00Z';
const MON_815 = '2026-11-10T01:15:00Z';

test('Friday with no game today picks Sunday, counting only Sunday games', () => {
  assert.deepEqual(pickNextGameDay([MON_815, SUN_1PM, SUN_930], '2026-11-06'), { date: '2026-11-08', count: 2 });
});

test('Monday night 8:15pm ET buckets as Monday even though it is Tuesday in UTC', () => {
  assert.equal(etDateStr(MON_815), '2026-11-09');
  assert.deepEqual(pickNextGameDay([MON_815], '2026-11-09'), { date: '2026-11-09', count: 1 });
});

test('when today has games, today is returned', () => {
  assert.deepEqual(pickNextGameDay([SUN_930, MON_815], '2026-11-08'), { date: '2026-11-08', count: 1 });
});

test('2am ET Saturday with Friday-night finals still treats Friday as today', () => {
  // 2026-11-07 02:00 ET = 07:00 UTC. Before the 6am ET rollover.
  const todayStr = gameDayDateStr(new Date('2026-11-07T07:00:00Z'));
  assert.equal(todayStr, '2026-11-06');
  const fridayNight = '2026-11-07T00:00:00Z'; // Fri 7pm ET
  assert.deepEqual(pickNextGameDay([fridayNight, SUN_1PM], todayStr), { date: '2026-11-06', count: 1 });
});

test('after the 6am ET rollover, Saturday is today', () => {
  assert.equal(gameDayDateStr(new Date('2026-11-07T11:30:00Z')), '2026-11-07'); // 6:30am ET
});

test('nothing in range returns null', () => {
  assert.equal(pickNextGameDay([], '2026-11-06'), null);
  assert.equal(pickNextGameDay(['not a date'], '2026-11-06'), null);
});

test('day 14 is included and day 15 is excluded', () => {
  assert.equal(NEXT_UP_MAX_DAYS, 14);
  // From Fri 2026-11-06: day 14 = Fri 2026-11-20, day 15 = Sat 2026-11-21. Noon ET kickoffs.
  assert.deepEqual(pickNextGameDay(['2026-11-20T17:00:00Z'], '2026-11-06'), { date: '2026-11-20', count: 1 });
  assert.equal(pickNextGameDay(['2026-11-21T17:00:00Z'], '2026-11-06'), null);
});

test('games before the start day are ignored', () => {
  assert.deepEqual(pickNextGameDay(['2026-11-05T17:00:00Z', SUN_1PM], '2026-11-06'), { date: '2026-11-08', count: 1 });
});

test('date helpers', () => {
  assert.equal(addDaysStr('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysStr('2026-03-07', 1), '2026-03-08'); // DST weekend, still one calendar day
  assert.equal(formatBoardDay('2026-11-08'), 'Sunday, November 8');
});
