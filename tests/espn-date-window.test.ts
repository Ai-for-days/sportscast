import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreboardDateRange } from '../src/lib/venue-schedule';
import { currentWeekWindow } from '../src/lib/espn-football-schedule';

// Both of these windows were built from UTC calendar dates, which name
// TOMORROW from about 8pm ET onward — precisely the hours when the games
// people are watching are in progress. Measured live on 2026-08-29 at 10:31pm
// ET: the Weatherboard's college football window asked ESPN for 20260830
// onward, got 444 games back, and not one of them was being played at that
// moment. The board fell through to The Odds API, which carries a score but no
// period or clock, so every live game read a bare "In Progress".

test('a late-evening range still starts today, not tomorrow', () => {
  // 10:31pm ET on Saturday Aug 29 — already Aug 30 in UTC.
  const saturdayNight = new Date('2026-08-30T02:31:00Z');
  assert.equal(scoreboardDateRange(saturdayNight, 45).split('-')[0], '20260829');
});

test('after ET midnight the range still covers the game day that is finishing', () => {
  // 1:00am ET Sunday. A West Coast game that kicked off Saturday night is
  // still being played; startOfGameDayET keeps it on Saturday until 6am ET.
  const afterMidnight = new Date('2026-08-30T05:00:00Z');
  assert.equal(scoreboardDateRange(afterMidnight, 45).split('-')[0], '20260829');
});

test('once the game day rolls over at 6am ET, so does the range', () => {
  const sundayMorning = new Date('2026-08-30T11:00:00Z'); // 7am ET
  assert.equal(scoreboardDateRange(sundayMorning, 45).split('-')[0], '20260830');
});

test('the range end is the requested number of days out, in ET', () => {
  const saturdayNight = new Date('2026-08-30T02:31:00Z');
  assert.equal(scoreboardDateRange(saturdayNight, 45), '20260829-20261013');
  assert.equal(scoreboardDateRange(saturdayNight, 7), '20260829-20260905');
});

test('Monday Night Football is inside the week window, not the next one', () => {
  // 9pm ET Monday Sep 14 is Tuesday in UTC, which used to roll the
  // Tuesday-through-Monday window forward and drop the game being played.
  const mondayNight = new Date('2026-09-15T01:00:00Z');
  const { start, end } = currentWeekWindow(mondayNight);
  assert.equal(start, '20260908');
  assert.equal(end, '20260914');
});

test('a Saturday afternoon sits in the same Tuesday-to-Monday week', () => {
  const saturdayAfternoon = new Date('2026-08-29T18:00:00Z'); // 2pm ET
  const { start, end } = currentWeekWindow(saturdayAfternoon);
  assert.equal(start, '20260825');
  assert.equal(end, '20260831');
});
