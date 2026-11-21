// DBD 2026-11-21: sidebar scores, lines and odds stay up until 6 AM ET the next day.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sidebarKeepUntil, keepOnSidebar, sidebarLines, scoresByFeedId } from '../src/lib/sidebar-games';

const at = (iso: string) => Date.parse(iso);
const pre = { moneylineAway: 150, moneylineHome: -170, spreadAway: { point: 3.5, price: -110 }, spreadHome: { point: -3.5, price: -110 }, total: { point: 45.5, overPrice: -110, underPrice: -110 } } as any;
const live = { moneylineAway: -200, moneylineHome: 170, spreadAway: { point: -4.5, price: -115 }, spreadHome: { point: 4.5, price: -105 }, total: { point: 51.5, overPrice: -110, underPrice: -110 } } as any;

describe('sidebar keeps games until 6 AM ET after their game day', () => {
  it('a Saturday noon game stays until Sunday 6 AM ET (EST, UTC-5)', () => {
    assert.equal(new Date(sidebarKeepUntil(at('2026-11-21T17:00:00Z'))).toISOString(), '2026-11-22T11:00:00.000Z');
  });
  it('a late game that ends after midnight still stays until 6 AM', () => {
    const start = at('2026-11-22T03:30:00Z'); // 10:30 PM ET Saturday
    assert.ok(keepOnSidebar(start, at('2026-11-22T10:59:00Z')));
    assert.ok(!keepOnSidebar(start, at('2026-11-22T11:00:00Z')));
  });
  it('a 1 AM ET start belongs to the previous game day', () => {
    assert.equal(new Date(sidebarKeepUntil(at('2026-11-22T06:00:00Z'))).toISOString(), '2026-11-22T11:00:00.000Z');
  });
  it('summer (EDT, UTC-4)', () => {
    assert.equal(new Date(sidebarKeepUntil(at('2026-07-04T23:00:00Z'))).toISOString(), '2026-07-05T10:00:00.000Z');
  });
  it('across the fall-back DST change', () => {
    assert.equal(new Date(sidebarKeepUntil(at('2026-10-31T23:00:00Z'))).toISOString(), '2026-11-01T11:00:00.000Z');
  });
  it('the 36 h store window is always longer than the sidebar window', () => {
    for (let t = at('2026-11-01T00:00:00Z'); t < at('2026-11-15T00:00:00Z'); t += 17 * 60_000) {
      const keep = sidebarKeepUntil(t) - t;
      assert.ok(keep > 0 && keep <= 36 * 3600_000, new Date(t).toISOString());
    }
  });
});

describe('sidebar lines never go blank', () => {
  it('before kickoff: pre-game', () => assert.deepEqual(sidebarLines(pre, null, false, false), { lines: pre, live: false }));
  it('in progress: in-game prices', () => assert.deepEqual(sidebarLines(pre, live, true, false), { lines: live, live: true }));
  it('in progress with suspended markets: pre-game fills them', () => {
    const r = sidebarLines(pre, { ...live, moneylineAway: null, spreadHome: null, total: null }, true, false);
    assert.equal(r.lines!.moneylineAway, 150);
    assert.deepEqual(r.lines!.spreadAway, pre.spreadAway);
    assert.deepEqual(r.lines!.total, pre.total);
  });
  it('final: the pre-game closing line', () => assert.deepEqual(sidebarLines(pre, live, true, true), { lines: pre, live: false }));
  it('started with no in-game feed: pre-game', () => assert.deepEqual(sidebarLines(pre, null, true, false), { lines: pre, live: false }));
});

describe('sidebar scores', () => {
  it('matches the ESPN game and reads its score; pre-game games carry none', () => {
    const sched = [
      { homeTeam: 'Central Florida Knights', awayTeam: 'Iowa State Cyclones', kickoffUTC: '2026-11-21T17:00:00Z', state: 'post' as const, statusDetail: 'Final', homeScore: 24, awayScore: 10 },
      { homeTeam: 'Toledo Rockets', awayTeam: 'Bowling Green Falcons', kickoffUTC: '2026-11-22T00:00:00Z', state: 'pre' as const, statusDetail: '', homeScore: null, awayScore: null },
    ];
    const feed = [
      { id: 'f1', startTime: at('2026-11-21T17:00:00Z'), home: 'Central Florida', away: 'Iowa State', homeShort: 'UCF', awayShort: 'ISU' },
      { id: 'f2', startTime: at('2026-11-22T00:00:00Z'), home: 'Toledo', away: 'Bowling Green', homeShort: null, awayShort: null },
    ];
    const m = scoresByFeedId('ncaa-football', sched, feed);
    assert.deepEqual(m.get('f1'), { away: 10, home: 24, state: 'post', detail: 'Final' });
    assert.equal(m.has('f2'), false);
  });
  it('the games API filters by the sidebar window and uses sidebarLines', () => {
    const src = readFileSync(new URL('../src/pages/api/sportsbook/games.ts', import.meta.url), 'utf8');
    assert.match(src, /filter\(\(s\) => keepOnSidebar\(s\.startTime, now\)\)/);
    assert.match(src, /sidebarLines\(summary\.lines, summary\.liveLines, started, score\?\.state === 'post'\)/);
  });
});
