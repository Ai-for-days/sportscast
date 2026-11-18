// WOW-033 (b): "What stood out" says "closing" only for a true closing line,
// and "stored" for the other three label states.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGameRecord, whatStoodOut, closeWord, isTrueClosingLine, sportsbookLineLabel } from '../src/lib/game-record';
import { KICK, MIN, game, feedLine, lines, input } from './helpers/game-record-fixtures';

// Away +170 wins 31-13 against home -3.5 (margin -21.5) with total 47.5 (combined 44): upset and spread sentences fire.
const upsetLines = { moneylineHome: -200, moneylineAway: 170 };
const upsetGame = game({ homeScore: 13, awayScore: 31 });

function states() {
  return {
    closing: buildGameRecord(input({ game: upsetGame, wagers: [], feedOpen: null, feedClose: feedLine({}, upsetLines) })),
    lastSeen: buildGameRecord(input({ game: upsetGame, wagers: [], feedOpen: null, feedClose: feedLine({ capturedAt: KICK - 250 * MIN }, upsetLines) })),
    noTime: buildGameRecord(input({ game: upsetGame, wagers: [], feedOpen: null, feedClose: null, boardClose: { lines: lines(upsetLines), capturedAt: null, origin: 'backfill' } })),
    oldSource: buildGameRecord(input({
      game: game({ homeScore: 13, awayScore: 31, kickoffUTC: '2026-10-05T17:00:00Z' }), wagers: [], feedOpen: null, feedClose: null,
      boardClose: { lines: lines({ ...upsetLines, bookmaker: 'DraftKings' }), capturedAt: '2026-10-05T16:40:00Z', origin: 'board-freeze' },
    })),
  };
}

describe('closing vs stored wording (WOW-033 b)', () => {
  it('the four label states map to closing / stored', () => {
    const s = states();
    assert.match(sportsbookLineLabel(s.closing.sportsbook.close!, 'close', s.closing.date), /^Sportsbook closing line/);
    assert.match(sportsbookLineLabel(s.lastSeen.sportsbook.close!, 'close', s.lastSeen.date), /^Last line seen/);
    assert.match(sportsbookLineLabel(s.noTime.sportsbook.close!, 'close', s.noTime.date), /capture time not recorded/);
    assert.match(sportsbookLineLabel(s.oldSource.sportsbook.close!, 'close', s.oldSource.date), /different data source/);
    assert.deepEqual([s.closing, s.lastSeen, s.noTime, s.oldSource].map(closeWord), ['closing', 'stored', 'stored', 'stored']);
    assert.equal(isTrueClosingLine(s.closing.sportsbook.close, s.closing.date), true);
  });
  it('a true closing line says "closing"', () => {
    const out = whatStoodOut(states().closing);
    assert.ok(out[0].startsWith('Buffalo Bills won at +170 on the closing moneyline'), out[0]);
    assert.ok(out.includes('Against the closing spread (Kansas City Chiefs -3.5), Buffalo Bills covered by 21.5 points.'), out.join('|'));
  });
  for (const k of ['lastSeen', 'noTime', 'oldSource'] as const) {
    it(`${k}: says "stored" and never "closing"`, () => {
      const out = whatStoodOut(states()[k]);
      assert.ok(out[0].startsWith('Buffalo Bills won at +170 on the stored moneyline'), out[0]);
      assert.ok(out.includes('Against the stored spread (Kansas City Chiefs -3.5), Buffalo Bills covered by 21.5 points.'), out.join('|'));
      for (const x of out) assert.doesNotMatch(x, /closing|open to close/i, x);
    });
  }
  it('total and line-move sentences follow the same rule', () => {
    const t = (p: number) => ({ total: { point: p, overPrice: -110, underPrice: -110 } });
    const stored = buildGameRecord(input({ wagers: [], feedOpen: feedLine({ capturedAt: KICK - 3 * 86400_000 }, t(40)), feedClose: feedLine({ capturedAt: KICK - 250 * MIN }, t(47)) }));
    const s = whatStoodOut(stored);
    assert.ok(s.includes('The teams combined for 47 points, exactly the stored total of 47.'), s.join('|'));
    assert.ok(s.includes('From the opening line to the stored line, the total moved from 40 to 47.'), s.join('|'));
    const closing = buildGameRecord(input({ wagers: [], feedOpen: feedLine({ capturedAt: KICK - 3 * 86400_000 }, t(40)), feedClose: feedLine({}, t(47)) }));
    const c = whatStoodOut(closing);
    assert.ok(c.includes('The teams combined for 47 points, exactly the closing total of 47.'), c.join('|'));
    assert.ok(c.includes('From open to close, the total moved from 40 to 47.'), c.join('|'));
  });
});
