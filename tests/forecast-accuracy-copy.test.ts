import test from 'node:test';
import assert from 'node:assert/strict';
import { describePrecipMiss, describeTempMiss, describeWindMiss } from '../src/lib/game-forecast-accuracy';

// Per Derek (2026-10-10): "you are overusing 'nailed it'." Every accurate call
// read the identical sentence, row after row on a finished board.

const gameIds = Array.from({ length: 40 }, (_, i) => `game-${i}`);

test('accurate calls do not all read the same', () => {
  const lines = new Set(gameIds.map((id) => describeTempMiss(57, 58, id)));
  assert.ok(lines.size >= 3, `only ${lines.size} distinct phrasings across 40 games`);
});

test('one game always reads the same', () => {
  assert.equal(describeTempMiss(57, 58, 'game-7'), describeTempMiss(57, 58, 'game-7'));
});

test('no "nailed it" and no em dashes anywhere in the recap copy', () => {
  for (const id of gameIds) {
    const all = [
      describeTempMiss(57, 58, id), describeTempMiss(57, 61, id), describeTempMiss(61, 57, id),
      describeWindMiss(5, 3, id), describeWindMiss(5, 15, id), describeWindMiss(15, 5, id),
      describePrecipMiss(70, 3, id), describePrecipMiss(20, 3, id), describePrecipMiss(70, 0, id),
    ].filter((s): s is string => !!s);
    for (const s of all) {
      assert.ok(!/nailed it/i.test(s), s);
      assert.ok(!s.includes('—'), s);
    }
  }
});
