// WOW-033 (c): at most 12 markets per record, chosen by id, with marketsOmitted.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGameRecord, capMarkets, serializeGameRecord, settleGameRecordMarkets, MARKET_CAP } from '../src/lib/game-record';
import { buildGamePageView, visibleText } from '../src/lib/game-record-view';
import { ouWager, psWager, input } from './helpers/game-record-fixtures';

const many = (n: number, status: 'graded' | 'locked' = 'graded') =>
  Array.from({ length: n }, (_, i) => (i % 2 ? psWager(`w${String(n - i).padStart(2, '0')}`, { status }) : ouWager(`w${String(n - i).padStart(2, '0')}`, { status })));

describe('market cap (WOW-033 c)', () => {
  it('12 markets: all kept, none omitted, no note', () => {
    const rec = buildGameRecord(input({ wagers: many(12) }));
    assert.equal(MARKET_CAP, 12);
    assert.equal(rec.markets.length, 12);
    assert.equal(rec.marketsOmitted, 0);
    assert.equal(buildGamePageView(rec).marketsNote, null);
  });
  it('13 markets: the first 12 by id are kept, 1 omitted, the page says so', () => {
    const rec = buildGameRecord(input({ wagers: many(13) }));
    assert.equal(rec.markets.length, 12);
    assert.equal(rec.marketsOmitted, 1);
    assert.deepEqual(rec.markets.map((m) => m.id), Array.from({ length: 12 }, (_, i) => `w${String(i + 1).padStart(2, '0')}`));
    const v = buildGamePageView(rec);
    assert.equal(v.marketsNote, '1 more market not shown.');
    assert.ok(visibleText(v).includes('1 more market not shown.'));
    assert.equal(buildGamePageView(buildGameRecord(input({ wagers: many(15) }))).marketsNote, '3 more markets not shown.');
  });
  it('the choice is the same whatever order the wagers arrive in', () => {
    const w = many(14);
    const a = buildGameRecord(input({ wagers: w }));
    const b = buildGameRecord(input({ wagers: [...w].reverse() }));
    assert.equal(serializeGameRecord(a).json, serializeGameRecord(b).json);
  });
  it('an omitted market still open keeps the record unfrozen', () => {
    const w = [...many(12), ouWager('w99', { status: 'locked' })];
    const rec = buildGameRecord(input({ wagers: w }));
    assert.equal(rec.markets.every((m) => m.status === 'graded'), true);
    assert.equal(rec.frozenAt, null);
    assert.equal(capMarkets(w).allSettled, false);
    const later = settleGameRecordMarkets(rec, [...many(12), ouWager('w99')], Date.parse('2026-11-18T12:00:00Z'));
    assert.ok(later.frozenAt);
    assert.equal(later.marketsOmitted, 1);
  });
  it('the capped record stays under the 8 KB cap', () => {
    const { bytes, ok } = serializeGameRecord(buildGameRecord(input({ wagers: many(20) })));
    console.log(`12-market capped record: ${bytes} bytes`);
    assert.equal(ok, true);
  });
});
