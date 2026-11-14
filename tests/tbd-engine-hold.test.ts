// ── Tests: market engines hold off on TBD kickoffs (WOW-009 1(b)) ──────────
//
// Frozen spec (Professor, WOW-009):
//   - Venue O/U ("Temp at Game Start"): a game whose kickoff time is TBD gets
//     no market at all: no create, no reprice. It is skipped before the
//     mapping lookup, the budget and the claim.
//   - HvL / HvH / LvL daily markets: when the kickoff is TBD, the 6 AM lock is
//     placed on the ET game date in the venue's zone, not on the venue-local
//     date of the 05:00Z placeholder. Timed games are unchanged.
// Expected lock instants are hand-derived from the spec (6:00 AM local on
// 2026-11-21, standard time in every zone below), not read off the code.
//
// Run with `npm test`. No network. Redis is never configured under tsx, so a
// code path that reaches the wager/mapping store throws; the engine-level
// tests use that as the signal that a game got PAST the lock check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyLockVenueDate, lockTimeDailyMetric, newCreationBudget } from '../src/lib/auto-market-shared';
import { processGame as processHvlGame } from '../src/lib/auto-hvl-market';
import { processCrossVenueGame, HVH_CONFIG } from '../src/lib/auto-cross-venue-market';
import { processVenueOUGame, venueOUDeps } from '../src/lib/auto-venue-ou-market';
import { venues } from '../src/lib/venue-data';
import { forecastFor, husky } from './fixtures/tbd-kickoff-fixtures';
import type { ForecastResponse, Venue } from '../src/lib/types';

const PLACEHOLDER = '2026-11-21T05:00:00Z';

// ── Lock-date choice, all six zones + the golden ───────────────────────────
const EXPECTED_TBD_LOCKS: [string, string][] = [
  ['America/Chicago', '2026-11-21T12:00:00.000Z'],
  ['America/Denver', '2026-11-21T13:00:00.000Z'],
  ['America/Phoenix', '2026-11-21T13:00:00.000Z'],
  ['America/Los_Angeles', '2026-11-21T14:00:00.000Z'],
  ['America/New_York', '2026-11-21T11:00:00.000Z'],
  ['Pacific/Honolulu', '2026-11-21T16:00:00.000Z'],
];

test('TBD kickoff: the daily 6 AM lock lands on the ET game date in every venue zone', () => {
  for (const [tz, expected] of EXPECTED_TBD_LOCKS) {
    assert.equal(lockTimeDailyMetric(dailyLockVenueDate(PLACEHOLDER, true, tz), tz), expected, tz);
  }
});

test('golden: a timed game at the same instant keeps today\'s venue-local lock (Chicago → 2026-11-20T12:00Z)', () => {
  assert.equal(lockTimeDailyMetric(dailyLockVenueDate(PLACEHOLDER, false, 'America/Chicago'), 'America/Chicago'), '2026-11-20T12:00:00.000Z');
  // And a real evening kickoff is unchanged too (Seattle 2026-11-21T20:00Z = noon local → 6 AM local 11-21).
  assert.equal(lockTimeDailyMetric(dailyLockVenueDate('2026-11-21T20:00:00Z', false, 'America/Los_Angeles'), 'America/Los_Angeles'), '2026-11-21T14:00:00.000Z');
});

// ── Engine level: HvL and cross-venue use the helper ───────────────────────
const nebraska = (venues.find((v) => v.id === 'ncaa-nebraska') ?? venues.find((v) => v.league === 'ncaa-football' && v.state === 'NE')) as Venue;
const ohioState = (venues.find((v) => v.id === 'ncaa-osu') ?? venues.find((v) => v.league === 'ncaa-football' && v.state === 'OH' && v.id !== nebraska?.id)) as Venue;

function dailyGame(tbd: boolean): any {
  return {
    id: 'g-osu-neb', homeTeam: 'Nebraska', awayTeam: 'Ohio State', kickoffUTC: PLACEHOLDER, state: 'pre',
    venue: nebraska, homeTeamVenue: nebraska, awayVenue: ohioState, venueIsGameSite: true, neutralSite: false,
    kickoffTimeTBD: tbd,
  };
}
const chicagoForecasts = new Map<string, ForecastResponse>([
  [nebraska.id, { timeZone: 'America/Chicago' } as unknown as ForecastResponse],
  [ohioState.id, { timeZone: 'America/New_York' } as unknown as ForecastResponse],
]);

async function withNow<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  const real = Date.now;
  Date.now = () => Date.parse(iso);
  try { return await fn(); } finally { Date.now = real; }
}
const PAST_LOCK = /past lock time/;
/** 'past-lock' when the engine stopped at its own lock check, 'reached-store' when it got past it. */
async function lockOutcome(run: () => Promise<{ action: string; reason?: string }>): Promise<string> {
  const r = await run().catch(() => ({ action: 'reached-store', reason: '' }));
  if (r.action === 'skipped' && PAST_LOCK.test(r.reason ?? '')) return 'past-lock';
  if (r.action === 'reached-store') return 'reached-store';
  return `other:${r.action}:${r.reason}`;
}

for (const [name, run] of [
  ['HvL (auto-hvl-market)', (g: any) => processHvlGame('ncaa-football', g, newCreationBudget(), chicagoForecasts)],
  ['cross-venue (auto-cross-venue-market)', (g: any) => processCrossVenueGame(HVH_CONFIG, 'ncaa-football', g, newCreationBudget(), chicagoForecasts)],
] as const) {
  test(`${name}: a TBD game locks at 6 AM Chicago on the ET date (12:00Z 11-21), not a day early`, async () => {
    assert.ok(nebraska && ohioState, 'fixture venues exist');
    // 12:01Z on 11-20: today's (placeholder) lock has passed, the correct one has not.
    assert.equal(await withNow('2026-11-20T12:01:00Z', () => lockOutcome(() => run(dailyGame(true)))), 'reached-store');
    // 12:01Z on 11-21: the correct lock has passed.
    assert.equal(await withNow('2026-11-21T12:01:00Z', () => lockOutcome(() => run(dailyGame(true)))), 'past-lock');
  });
  test(`${name}: a timed game at the same instant is unchanged (locks 12:00Z 11-20)`, async () => {
    assert.equal(await withNow('2026-11-20T12:01:00Z', () => lockOutcome(() => run(dailyGame(false)))), 'past-lock');
    assert.equal(await withNow('2026-11-20T11:59:00Z', () => lockOutcome(() => run(dailyGame(false)))), 'reached-store');
  });
}

// ── Venue O/U: TBD games get no market at all ─────────────────────────────
function stubOU() {
  const saved = { ...venueOUDeps };
  const calls: Record<string, number> = {};
  const args: { created: any[]; updated: { id: string; patch: any }[] } = { created: [], updated: [] };
  const hit = (n: string) => { calls[n] = (calls[n] ?? 0) + 1; };
  Object.assign(venueOUDeps, {
    getMappedWagerId: async () => { hit('getMappedWagerId'); return null; },
    claimGameForCreation: async () => { hit('claimGameForCreation'); return true; },
    setMappedWagerId: async () => { hit('setMappedWagerId'); },
    getWager: async () => { hit('getWager'); return null; },
    createWager: async (input: any) => { hit('createWager'); args.created.push(input); return { id: 'w-new' } as any; },
    updateWager: async (id: string, patch: any) => { hit('updateWager'); args.updated.push({ id, patch }); return null as any; },
    raiseAlert: async () => { hit('raiseAlert'); return null as any; },
  });
  return { calls, args, restore: () => Object.assign(venueOUDeps, saved) };
}
const huskyForecast = { ...forecastFor(husky, -28800, [50, 41], [62, 47]), timeZone: 'America/Los_Angeles' } as ForecastResponse;
function ouGame(tbd: boolean, kickoffUTC: string): any {
  return {
    id: 'g-wash', homeTeam: 'Washington', awayTeam: 'Indiana', kickoffUTC, state: 'pre',
    venue: husky, homeTeamVenue: husky, awayVenue: null, venueIsGameSite: true, neutralSite: false, gameSiteName: husky.name,
    kickoffTimeTBD: tbd,
  };
}

test('venue O/U: a TBD game is skipped with no store call of any kind (no create, no reprice, no claim)', async () => {
  const s = stubOU();
  const budget = newCreationBudget();
  const before = budget.remaining;
  try {
    const r = await withNow('2026-11-19T12:00:00Z', () => processVenueOUGame('home', 'ncaa-football', ouGame(true, PLACEHOLDER), budget, new Map([[husky.id, huskyForecast]])));
    assert.equal(r.action, 'skipped');
    assert.equal(r.reason, 'kickoff time TBD, no game-start market until a time is posted');
    assert.deepEqual(s.calls, {});
    assert.equal(budget.remaining, before, 'budget untouched');
  } finally { s.restore(); }
});

test('venue O/U: a timed game is unchanged (still created through the normal path)', async () => {
  const s = stubOU();
  try {
    const r = await withNow('2026-11-19T12:00:00Z', () => processVenueOUGame('home', 'ncaa-football', ouGame(false, '2026-11-21T20:00:00Z'), newCreationBudget(), new Map([[husky.id, huskyForecast]])));
    assert.equal(r.action, 'created', JSON.stringify(r));
    assert.equal(s.calls.createWager, 1);
    assert.equal(s.calls.updateWager ?? 0, 0);
    // Hand-derived (WOW-010 1(A)): kickoff 2026-11-21T20:00:00Z.
    // lockTime = kickoff - 3 h (LOCK_HOURS_BEFORE_KICKOFF) = 2026-11-21T17:00:00.000Z.
    // targetTime is the US-EASTERN wall clock of kickoff (etWallClockHHMM; the
    // wager's location.timeZone is ET), so 20:00Z = 15:00 EST, not the venue's
    // 12:00 PST.
    assert.equal(s.args.created[0].lockTime, '2026-11-21T17:00:00.000Z');
    assert.equal(s.args.created[0].targetTime, '15:00');
    assert.equal(s.args.created[0].targetDate, '2026-11-21');
  } finally { s.restore(); }
});

test('venue O/U: once a time is posted, an existing placeholder market is re-timed in place (update once, create never)', async () => {
  const s = stubOU();
  const existing = {
    id: 'w-placeholder', kind: 'over-under', autoManaged: true, status: 'open',
    targetDate: '2026-11-21', targetTime: '00:00', lockTime: '2026-11-21T02:00:00.000Z', line: 40.5,
  };
  Object.assign(venueOUDeps, {
    getMappedWagerId: async () => { s.calls.getMappedWagerId = (s.calls.getMappedWagerId ?? 0) + 1; return existing.id; },
    getWager: async () => { s.calls.getWager = (s.calls.getWager ?? 0) + 1; return existing as any; },
  });
  try {
    const r = await withNow('2026-11-19T12:00:00Z', () => processVenueOUGame('home', 'ncaa-football', ouGame(false, '2026-11-21T20:00:00Z'), newCreationBudget(), new Map([[husky.id, huskyForecast]])));
    assert.notEqual(r.action, 'skipped', JSON.stringify(r));
    assert.equal(s.calls.createWager ?? 0, 0);
    assert.equal(s.calls.updateWager, 1);
    assert.equal(s.args.updated[0].id, 'w-placeholder');
    // Hand-derived: same instants as the creation test above.
    assert.equal(s.args.updated[0].patch.lockTime, '2026-11-21T17:00:00.000Z');
    assert.equal(s.args.updated[0].patch.targetTime, '15:00');
  } finally { s.restore(); }
});
