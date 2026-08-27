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
    assert.match(src, /&& !lockNeedsFix\) return \{ \.\.\.base, action: 'unchanged'/,
      `${name} lost its unchanged fast path`);
  });
}

test('the correction target for a NON-daily market is 3 hours before kickoff', () => {
  const kickoff = '2026-09-11T23:05:00Z';
  const lock = lockTimeBeforeKickoff(kickoff);
  const gapHours = (Date.parse(kickoff) - Date.parse(lock)) / 3_600_000;
  assert.equal(gapHours, 3);
});

test('the old conventions the book was migrated off were both wrong by hours', () => {
  // A 7:05 PM ET kickoff. Old venue O/U locked 15 minutes out; old pointspread
  // locked at 2 AM ET the same day. Neither matched the rule then in force.
  //
  // Note the daily engines moved again on 2026-08-27, to 6 AM venue-local. This
  // test is about the 15-minute and 2 AM conventions that were actually in the
  // live data, not about which rule replaced them.
  const kickoff = '2026-09-11T23:05:00Z';
  const target = Date.parse(lockTimeBeforeKickoff(kickoff));

  const oldOverUnder = Date.parse(kickoff) - 15 * 60_000;
  const oldPointspread = Date.parse('2026-09-11T06:00:00Z'); // 2 AM ET

  assert.ok(oldOverUnder > target, 'old O/U lock should sit later than the rule, closing too late');
  assert.ok(oldPointspread < target, 'old pointspread lock should sit earlier than the rule, closing too early');
});
