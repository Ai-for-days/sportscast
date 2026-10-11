import test from 'node:test';
import assert from 'node:assert/strict';
import { etDateKey, mergeRangeResponses, monthsCovering } from '../src/lib/espn-scoreboard';

// On 2026-10-10 ESPN stopped accepting `dates=YYYYMMDD-YYYYMMDD` (400 on both
// hosts, every league), which took ESPN off the whole site because both callers
// ask for ranges. The client now fetches each month a range touches and filters
// back to the requested days. These pin the split and the boundary.

test('a range inside one month is one month call', () => {
  assert.deepEqual(monthsCovering('20261006', '20261012'), ['202610']);
});

test('a range across a year end walks into the next year', () => {
  assert.deepEqual(monthsCovering('20261124', '20270203'), ['202611', '202612', '202701', '202702']);
});

test('the 220-day off-season window is a bounded number of calls', () => {
  assert.equal(monthsCovering('20261010', '20270518').length, 8);
});

test('an event is dated by its ET day, so a late kickoff stays on its game day', () => {
  // 10:30pm ET Saturday is already Sunday in UTC.
  assert.equal(etDateKey('2026-10-11T02:30Z'), '20261010');
  assert.equal(etDateKey('not a date'), '');
});

test('merge keeps only the requested days, dedupes, and sorts by kickoff', () => {
  const oct = {
    leagues: [{ slug: 'nfl' }],
    events: [
      { id: '3', date: '2026-10-11T17:00Z' },
      { id: '1', date: '2026-10-06T00:15Z' }, // Monday 10-05 ET: before the window
      { id: '2', date: '2026-10-07T00:15Z' }, // Tuesday 10-06 ET: first day in
      { id: '4', date: '2026-10-13T00:15Z' }, // Monday 10-12 ET: last day in
      { id: '5', date: '2026-10-14T00:15Z' }, // after the window
    ],
  };
  const dupe = { events: [{ id: '3', date: '2026-10-11T17:00Z' }] };
  const merged = mergeRangeResponses([oct, dupe], '20261006', '20261012');
  assert.deepEqual(merged.events.map((e: any) => e.id), ['2', '3', '4']);
  assert.deepEqual(merged.leagues, [{ slug: 'nfl' }]);
});
