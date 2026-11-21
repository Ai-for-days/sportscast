// ── Tests: the lock rule is enforced, not just applied at creation ─────────
//
// The 3-hour lock shipped 2026-08-26, but only for markets created after it.
// Every engine's update path re-priced the line and left lockTime alone, so
// the existing book kept its old conventions. Measured live on 2026-08-27:
// 247 of 262 open pointspreads still locked at 2:00 AM ET, and 178 of 188
// at-game-start markets still locked 15 minutes before kickoff. Derek's rule
// was in the code and absent from almost all the actual inventory.
//
// The engines now correct lockTime alongside the price. These tests read the
// three engines' source, because the thing worth guarding is that all three
// keep doing it: the reason auto-market-shared.ts exists at all is that a fix
// landing in one engine and not the others has already happened here before.
//
// Run with `npm test`. No network, no Redis.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lockTimeBeforeKickoff } from '../src/lib/auto-market-shared';

const ENGINES = [
  'auto-hvl-market.ts',
  'auto-cross-venue-market.ts',
  'auto-venue-ou-market.ts',
];

function engineSource(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'lib', name), 'utf8');
}

for (const name of ENGINES) {
  test(`${name} corrects lockTime on an existing wager, not just the price`, () => {
    const src = engineSource(name);
    assert.match(src, /const lockNeedsFix = existing\.lockTime !== lockTimeIso;/,
      `${name} never compares the stored lock against the current rule`);
    assert.match(src, /lockNeedsFix \? \{[^}]*lockTime: lockTimeIso[^}]*\}/,
      `${name} re-prices without bringing the lock onto the rule`);
  });

  test(`${name} still short-circuits when nothing needs changing`, () => {
    // Without this the engine would write to Redis on every tick for every
    // wager, turning a cheap no-op pass into a full rewrite of the book.
    const src = engineSource(name);
    // Further "nothing to fix" conditions may follow (the O/U engine also
    // checks its start time, 2026-10-10); the fast path itself must remain.
    assert.match(src, /&& !lockNeedsFix(?: && !\w+)*\) return \{ \.\.\.base, action: 'unchanged'/,
      `${name} lost its unchanged fast path`);
  });
}

test('the correction target is 15 minutes before kickoff (DBD 2026-11-21; was 3 hours)', () => {
  const kickoff = '2026-09-11T23:05:00Z';
  const lock = lockTimeBeforeKickoff(kickoff);
  assert.equal((Date.parse(kickoff) - Date.parse(lock)) / 60_000, 15);
});

test('the old 2 AM ET pointspread convention closed far earlier than the current rule', () => {
  // A 7:05 PM ET kickoff. The old pointspread engines locked at 2 AM ET the
  // same day. The 15-minute rule (DBD 2026-11-21) matches the even older venue
  // O/U convention again.
  const kickoff = '2026-09-11T23:05:00Z';
  const target = Date.parse(lockTimeBeforeKickoff(kickoff));
  assert.equal(target, Date.parse(kickoff) - 15 * 60_000);
  assert.ok(Date.parse('2026-09-11T06:00:00Z') < target);
});
