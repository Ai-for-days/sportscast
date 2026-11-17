// ── Tests: kickoff time TBD (WOW-006 C) ─────────────────────────────────────
//
// ESPN lists a game whose kickoff time is not set with a placeholder date
// (00:00 ET, e.g. 2026-11-21T05:00Z) and competitions[0].timeValid === false.
// Before this change the boards and the feed treated that placeholder as a
// real kickoff: a midnight WES, write-up and kickoff sample, and, for venues
// west of Eastern, the PREVIOUS day's forecast. The fix reads ESPN's own flag
// (never the clock time: a real Hawaii night game is also 05:00Z).
//
// Expected values are hand-derived from tests/fixtures/tbd-kickoff-fixtures.ts:
//   Husky Stadium (UTC-8): Fri 11-20 high 50, Sat 11-21 high 62.
//   Hawaii (UTC-10): Fri 11-20 high 82, Sat 11-21 high 85.
//   05:00Z = Fri 21:00 in Seattle, Fri 19:00 in Honolulu, Sat 00:00 ET.
// t3/t4 compare against tests/fixtures/tbd-kickoff-golden.json, captured from
// the code BEFORE this change with the same fixtures.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getScheduleGames, espnKickoffTimeTBD } from '../src/lib/league-schedule';
import { buildGameWeatherFeed } from '../src/lib/game-weather-feed';
import { wesSnapshotKey } from '../src/lib/game-wes-snapshot';
import { autzen, husky, hawaii, rawGame, stubSchedule, KICKOFF_0500Z, KICKOFF_SAT_2000Z, NOW } from './fixtures/tbd-kickoff-fixtures';

const golden = JSON.parse(readFileSync(new URL('./fixtures/tbd-kickoff-golden.json', import.meta.url), 'utf8'));

async function run(raw: any[]) {
  const s = stubSchedule(raw);
  try {
    const r = await getScheduleGames('ncaa-football', 7);
    return { ...r, wesSnapshotInputs: s.wesSnapshotInputs, kickoffSnapshots: s.kickoffSnapshots };
  } finally { s.restore(); }
}

test('ESPN flag: only timeValid === false means TBD', () => {
  assert.equal(espnKickoffTimeTBD({ timeValid: false }), true);
  assert.equal(espnKickoffTimeTBD({ timeValid: true }), false);
  assert.equal(espnKickoffTimeTBD({}), false);
  assert.equal(espnKickoffTimeTBD(undefined), false);
  assert.equal(espnKickoffTimeTBD({ timeValid: 'false' }), false); // only the boolean counts
});

test('t1: Pacific venue, TBD flag, 05:00Z → no kickoff-hour outputs; day is the ET date (Saturday)', async () => {
  const { games } = await run([rawGame('tbd-1', husky, KICKOFF_0500Z, true)]);
  const g = games[0];
  assert.equal(g.kickoffTimeTBD, true);
  assert.equal(g.kickoffUTC, KICKOFF_0500Z); // unchanged
  assert.equal(g.wes, null);
  assert.equal(g.weatherNarrative, null);
  assert.equal(g.kickoffWeather, null);
  assert.equal(g.firstPitchWeather, null);
  assert.equal(g.day?.date, '2026-11-21');
  assert.equal(g.day?.highF, 62);
  const feed = buildGameWeatherFeed('ncaa-football', { games, windowDays: 7, truncated: false }, NOW);
  assert.equal(feed.unavailable.length, 0, 'a TBD game is not unavailable just because kickoff is null');
  const f = feed.games[0];
  assert.equal(f.kickoffTimeTBD, true);
  assert.equal(f.kickoff, null);
  assert.equal(f.wes, null);
  assert.deepEqual(f.day, { highF: 62, lowF: 47, sky: 'day-2026-11-21', rainChancePct: 60, windMph: 18, gustMph: 23 });
  // Saturday row: precip 60 (>= 50 → high), wind 18 (>= 13 → moderate) → high.
  assert.equal(f.impact?.label, 'high');
});

test('t2 (negative control): Hawaii, real 05:00Z kickoff, flag false → computed as today, local-date day', async () => {
  const { games } = await run([rawGame('hi-1', hawaii, KICKOFF_0500Z, false)]);
  const g = games[0];
  assert.equal(g.kickoffTimeTBD, false);
  assert.ok(g.wes, 'WES computed');
  assert.ok(g.weatherNarrative, 'narrative computed');
  assert.ok(g.kickoffWeather, 'kickoff sample computed');
  assert.equal(g.day?.date, '2026-11-20'); // 19:00 Friday in Honolulu
  assert.equal(g.day?.highF, 82);
});

/**
 * The golden predates WES 1.1 (WOW-023 interim rain cap). 1.1 changes only the
 * version string and adds two fields that are null on these dry games; every
 * score must still match the golden exactly. Apply exactly those additions to
 * the golden's wes object, never to the computed one.
 */
function goldenAt11(e: any): any {
  if (!e || !e.wes) return e;
  return { ...e, wes: { ...e.wes, wesVersion: '1.2', conditionsCap: null, conditionsCapReason: null } };
}

test('t3: flag missing on the raw game → output identical to the pre-change golden', async () => {
  const { games } = await run([rawGame('missing-1', husky, KICKOFF_0500Z, undefined)]);
  const g: any = { ...games[0] };
  assert.equal(g.kickoffTimeTBD, false);
  delete g.kickoffTimeTBD;
  // DBD 2026-11-17: liveConditions is added and is null before the game.
  assert.equal(g.liveConditions, null);
  delete g.liveConditions;
  const want = goldenAt11(golden.enriched.find((e: any) => e.id === 'missing-1'));
  assert.deepEqual(JSON.parse(JSON.stringify(g)), want);
});

test('t4: a timed game\'s enriched and feed records equal the pre-change golden apart from the added field', async () => {
  const r = await run([rawGame('timed-1', autzen, KICKOFF_SAT_2000Z, false), rawGame('missing-1', husky, KICKOFF_0500Z, undefined)]);
  const g: any = { ...r.games.find((x) => x.id === 'timed-1')! };
  assert.equal(g.kickoffTimeTBD, false);
  delete g.kickoffTimeTBD;
  // DBD 2026-11-17: liveConditions is added and is null before the game.
  assert.equal(g.liveConditions, null);
  delete g.liveConditions;
  assert.deepEqual(JSON.parse(JSON.stringify(g)), goldenAt11(golden.enriched.find((e: any) => e.id === 'timed-1')));
  const feed = buildGameWeatherFeed('ncaa-football', r, NOW);
  const fg: any = { ...feed.games.find((x) => x.id === 'timed-1')! };
  assert.equal(fg.kickoffTimeTBD, false);
  delete fg.kickoffTimeTBD;
  // WOW-025 R0: the added `wow` mirrors `wes` exactly; compare the rest to the golden.
  assert.deepEqual(fg.wow, fg.wes);
  delete fg.wow;
  // DBD 2026-11-17: writeupFull is added; writeup is its first sentence.
  assert.ok(fg.writeupFull.startsWith(fg.writeup));
  delete fg.writeupFull;
  // DBD 2026-11-17: venue.zipUrl and the day's rain/wind/gust are added.
  delete fg.venue.zipUrl;
  if (fg.day) { delete fg.day.rainChancePct; delete fg.day.windMph; delete fg.day.gustMph; }
  assert.deepEqual(JSON.parse(JSON.stringify(fg)), golden.feedGames.find((e: any) => e.id === 'timed-1'));
});

test('t5: no WES snapshot entry and no kickoff snapshot for a TBD game; a timed game still gets both', async () => {
  const r = await run([rawGame('tbd-1', husky, KICKOFF_0500Z, true), rawGame('timed-1', autzen, KICKOFF_SAT_2000Z, false)]);
  const keys = r.wesSnapshotInputs.map((e: any) => e.key);
  assert.ok(!keys.includes(wesSnapshotKey(husky.id, KICKOFF_0500Z)), `TBD game in snapshot input: ${JSON.stringify(keys)}`);
  assert.ok(keys.includes(wesSnapshotKey(autzen.id, KICKOFF_SAT_2000Z)), 'timed game snapshot entry present');
  assert.ok(!r.kickoffSnapshots.includes('tbd-1'));
  assert.ok(r.kickoffSnapshots.includes('timed-1'));
});

test('weekly football pages: TBD game uses the ET date for its forecast and says "time TBD"', async () => {
  const { gameDayForecast, kickoffLabel } = await import('../src/lib/football-weather-report');
  const { FORECASTS } = await import('./fixtures/tbd-kickoff-fixtures');
  const base: any = { id: 'x', venue: husky, kickoffUTC: KICKOFF_0500Z, state: 'pre', statusDetail: 'TBD', livePeriodClock: null };
  assert.equal(gameDayForecast({ ...base, kickoffTimeTBD: true }, FORECASTS['ncaa-wash'])?.date, '2026-11-21');
  assert.equal(gameDayForecast({ ...base }, FORECASTS['ncaa-wash'])?.date, '2026-11-20'); // unchanged without the flag
  assert.match(kickoffLabel({ ...base, kickoffTimeTBD: true }, 'America/New_York'), /· time TBD$/);
  assert.doesNotMatch(kickoffLabel({ ...base }, 'America/New_York'), /TBD/);
});
