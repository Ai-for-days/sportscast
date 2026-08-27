// ── Tests: the lock-only sweep cron stays lock-only ────────────────────────
//
// Added 2026-08-27 with /api/cron/lock-expired. The whole reason that route
// exists is that the flip from `open` to `locked` is harmless and wants to run
// often, while the grading and settlement it used to be bundled with move real
// money and must stay on their once-a-day schedule.
//
// That safety property lives in what the route imports, so that is what these
// assert. If someone later adds grading, settlement, or a wallet call to this
// route, it stops being safe to run every 30 minutes and one of these fails.
//
// Run with `npm test`. No network, no Redis: this reads the source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = join(process.cwd(), 'src', 'pages', 'api', 'cron', 'lock-expired.ts');
const source = readFileSync(ROUTE, 'utf8');

/**
 * Code only. The route's own header comment says in prose that it does not
 * touch a wallet or settle anything, and scanning that would match the very
 * words the checks below forbid.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every import specifier the route pulls in. */
function importedModules(src: string): string[] {
  return [...src.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
}

test('the lock cron imports exactly one thing: lockExpiredWagers', () => {
  const modules = importedModules(code).filter(m => !m.startsWith('astro'));
  assert.deepEqual(modules, ['../../../lib/wager-store']);
  assert.match(code, /import \{ lockExpiredWagers \} from/);
});

test('the lock cron never reaches grading, settlement, or a wallet', () => {
  // Named rather than pattern-matched, so the failure message says which
  // money-moving thing crept in.
  const forbidden = [
    'nws-grading',
    'bet-settlement',
    'wager-auto-grade',
    'settleWagerBets',
    'gradeWager',
    'runDailyGrading',
    'wallet',
    'balance',
  ];
  for (const needle of forbidden) {
    assert.equal(
      code.includes(needle),
      false,
      `/api/cron/lock-expired must not reference "${needle}": it runs every 30 minutes`,
    );
  }
});

test('the lock cron is behind the same cron-secret check as the others', () => {
  assert.match(code, /CRON_SECRET/);
  assert.match(code, /status: 401/);
});

test('the lock cron is registered on a schedule that does not collide', () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
  const entry = vercel.crons.find((c: { path: string }) => c.path === '/api/cron/lock-expired');
  assert.ok(entry, '/api/cron/lock-expired must be registered in vercel.json');

  // The four auto-market engines already own :00/:30, :05/:35, :10/:40 and
  // :15/:45. Sharing a minute would pile several heavy Redis passes into the
  // same tick, which is what caused the 2026-08-25 timeouts.
  const minutes = entry.schedule.split(' ')[0];
  const taken = ['*/30', '5,35', '10,40', '15,45'];
  assert.equal(taken.includes(minutes), false, `lock sweep must not share a minute slot (got ${minutes})`);
});
