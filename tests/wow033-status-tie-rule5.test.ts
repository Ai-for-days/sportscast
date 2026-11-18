// WOW-033 (e) status text and ties, and both branches of "What stood out" rule 5.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGameRecord, whatStoodOut } from '../src/lib/game-record';
import { buildGamePageView } from '../src/lib/game-record-view';
import { feedLine, game, ouWager, psWager, input } from './helpers/game-record-fixtures';

describe('status text and ties (WOW-033 e)', () => {
  it('a final game reads "Final"', () => {
    const v = buildGamePageView(buildGameRecord(input()));
    assert.equal(v.facts.find((f) => f.label === 'Status')!.value, 'Final');
  });
  it('an NFL tie is graded draw, shown as "Tie", and never an upset, even with the underdog at +150 or longer', () => {
    for (const league of ['nfl', 'ncaa-football'] as const) {
      const rec = buildGameRecord(input({ league, wagers: [], game: game({ homeScore: 20, awayScore: 20 }), feedClose: feedLine({}, { moneylineHome: -300, moneylineAway: 250 }), feedOpen: null }));
      assert.equal(rec.sportsbook.grades!.moneyline!.winner, 'draw');
      const v = buildGamePageView(rec);
      assert.equal(v.grades!.rows[0][1], 'Tie');
      assert.match(v.summary, /tied 20-20/);
      assert.equal(whatStoodOut(rec).some((s) => /moneyline/.test(s)), false);
    }
  });
});

describe('rule 5, both branches (WOW-033 ruling 1)', () => {
  const quiet = { wagers: undefined as any, feedOpen: feedLine() };
  const weather = (w: Parameters<typeof ouWager>[1] | null, ps?: Parameters<typeof psWager>[1]) =>
    whatStoodOut(buildGameRecord(input({ ...quiet, wagers: [ps ? psWager('w2', ps) : ouWager('w1', w ?? {})] }))).filter((s) => s.startsWith('Weather market'));
  const ou = (overOdds: number, underOdds: number, line = 47.5) => ({ capturedAt: '', marketType: 'over-under' as const, overUnder: { line, overOdds, underOdds } });

  it('underdog at lock fires when the winning side had the strictly longer price', () => {
    assert.equal(weather({ winningOutcome: 'under', observedValue: 44, closingLineSnapshot: ou(-125, 105) }).length, 1);
  });
  it('equal prices at lock never fire the underdog branch', () => {
    assert.deepEqual(weather({ winningOutcome: 'under', observedValue: 44, closingLineSnapshot: ou(-110, -110) }), []);
  });
  it('the favourite winning does not fire', () => {
    assert.deepEqual(weather({ winningOutcome: 'over', observedValue: 50, closingLineSnapshot: ou(-125, 105) }), []);
  });
  it('the margin branch fires at exactly 10 and not at 9.9, with equal prices', () => {
    assert.equal(weather({ winningOutcome: 'under', observedValue: 37.5, closingLineSnapshot: ou(-110, -110) }).length, 1);
    assert.deepEqual(weather({ winningOutcome: 'under', observedValue: 37.6, closingLineSnapshot: ou(-110, -110) }), []);
  });
  it('the margin branch works for wind in mph', () => {
    const s = weather({ metric: 'actual_gust', title: 'Gust at Kickoff', winningOutcome: 'over', observedValue: 31, line: 18.5, closingLineSnapshot: ou(-110, -110, 18.5) } as any);
    assert.deepEqual(s, ['Weather market "Gust at Kickoff": the observed value was 31 mph against a line of 18.5 mph.']);
  });
  it('pointspread: underdog side and margin branches, equal prices do not fire the underdog branch', () => {
    const snap = (a: number, b: number) => ({ capturedAt: '', marketType: 'pointspread' as const, pointspread: { spread: -6.5, locationAOdds: a, locationBOdds: b } });
    // 52 - 39 - 6.5 = 6.5: under the 10 margin.
    assert.equal(weather(null, { closingLineSnapshot: snap(120, -140) }).length, 1);
    assert.deepEqual(weather(null, { closingLineSnapshot: snap(-110, -110) }), []);
    // 60 - 39 - 6.5 = 14.5: margin branch.
    assert.equal(weather(null, { observedValueA: 60, observedValue: 60, closingLineSnapshot: snap(-110, -110) }).length, 1);
  });
  it('a push or a pending market never fires', () => {
    assert.deepEqual(weather({ winningOutcome: 'push', observedValue: 47.5, closingLineSnapshot: ou(-125, 105) }), []);
    assert.deepEqual(weather({ status: 'locked', closingLineSnapshot: ou(-125, 105) }), []);
  });
});
