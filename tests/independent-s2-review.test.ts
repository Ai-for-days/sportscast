// Independent S2 review tests (fresh-context reviewer, 2026-11-18).
//
// Written from the frozen spec (WOW-031 section 4, WOW-032 B) and the exported
// signatures/types only. Every expected value below is hand-derived in the
// comment next to it; none was obtained by running the code first.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  americanToDecimal,
  noVigProbabilities,
  classifyGameStatus,
  gradeSportsbookLines,
  sportsbookLineLabel,
  snapshotFromFeedLine,
  whatStoodOut,
  crossesKeyNumber,
  serializeGameRecord,
  UPSET_MIN_AMERICAN,
  MARGIN_THRESHOLD,
  SPREAD_MOVE_MIN,
  TOTAL_MOVE_MIN,
  NFL_KEY_NUMBERS,
  CLOSING_LINE_MAX_MINUTES,
  GAME_RECORD_MAX_BYTES,
  type MainLines,
  type GameRecord,
  type GameStatus,
  type LineSnapshotRecord,
  type StoredFeedLine,
  type WowMarketRecord,
  type GameRecordLeague,
} from '../src/lib/game-record';
import { closeOpenWrites } from '../src/lib/odds-feed-store';
import type { FeedGame, FeedLines } from '../src/lib/odds-feed';

const near = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);

// ── Builders ────────────────────────────────────────────────────────────────

/** Two-way main lines; spreadAway is the mirror of spreadHome; all juice -110. */
function lines(mlHome: number | null, mlAway: number | null, homePoint: number | null, total: number | null, mlDraw?: number | null): MainLines {
  const l: MainLines = {
    moneylineHome: mlHome,
    moneylineAway: mlAway,
    spreadHome: homePoint === null ? null : { point: homePoint, price: -110 },
    spreadAway: homePoint === null ? null : { point: -homePoint, price: -110 },
    total: total === null ? null : { point: total, overPrice: -110, underPrice: -110 },
  };
  if (mlDraw !== undefined) l.moneylineDraw = mlDraw;
  return l;
}

function snap(l: MainLines, over: Partial<LineSnapshotRecord> = {}): LineSnapshotRecord {
  return {
    lines: l,
    source: 'feed',
    capturedAt: '2026-11-16T00:42:00.000Z',
    feedStartTime: '2026-11-16T01:00:00.000Z',
    minutesBeforeKickoff: 18,
    bookSidesReversed: false,
    origin: 'ingest',
    ...over,
  };
}

function record(o: {
  league?: GameRecordLeague;
  status?: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  close: MainLines | null;
  open?: MainLines | null; // defaults to the close (no line move)
  markets?: WowMarketRecord[];
}): GameRecord {
  const status = o.status ?? 'final';
  const open = o.open === undefined ? o.close : o.open;
  const grades = gradeSportsbookLines({ close: o.close, homeScore: o.homeScore, awayScore: o.awayScore, status });
  return {
    schemaVersion: 1,
    frozenAt: null,
    league: o.league ?? 'nfl',
    date: '2026-11-15',
    slug: 'away-team-at-home-team',
    espnId: '401999999',
    feedId: 'F123',
    kickoff: '2026-11-16T01:00:00.000Z',
    kickoffTimeTBD: false,
    home: { name: 'Home Team', venueId: 'home-venue' },
    away: { name: 'Away Team', venueId: 'away-venue' },
    neutralSite: false,
    venue: null,
    siteName: 'Home Stadium',
    roof: { status: 'open', closed: false },
    result: { status, detail: status === 'final' ? 'Final' : status, homeScore: o.homeScore, awayScore: o.awayScore },
    sportsbook: { open: open ? snap(open) : null, close: o.close ? snap(o.close) : null, grades },
    weather: { wow: null, forecast: null, observed: null },
    markets: o.markets ?? [],
  };
}

// Every sentence produced in this file is collected and checked for banned
// wording at the end.
const allSentences: string[] = [];
function stood(rec: GameRecord): string[] {
  const s = whatStoodOut(rec);
  allSentences.push(...s);
  return s;
}

// A "quiet" baseline: favorite wins, nothing near any threshold, open == close.
//   close: home -200 / away +170, home -3.5, total 44.5. Score 24-17.
//   Upset? winner home at -200 -> no.
//   Spread margin = 24 - 17 + (-3.5) = 3.5 -> |3.5| < 10, not 0 -> no.
//   Total diff = 41 - 44.5 = -3.5 -> |3.5| < 10, not 0 -> no.
//   Line move: none (open == close). No markets.
const QUIET = lines(-200, 170, -3.5, 44.5);

// ── Constants vs spec ───────────────────────────────────────────────────────

test('threshold constants match the frozen spec', () => {
  // Rule 1: "+150 or longer".
  assert.equal(UPSET_MIN_AMERICAN, 150);
  // Rules 2/3: 10 points (MLB 4 runs, MLS 2 goals). CFB is not named; football = 10.
  assert.deepEqual({ ...MARGIN_THRESHOLD }, { nfl: 10, 'ncaa-football': 10, mlb: 4, mls: 2 });
  // Rule 4: spread 2.5+, total 3+, key numbers 3 and 7.
  assert.equal(SPREAD_MOVE_MIN, 2.5);
  assert.equal(TOTAL_MOVE_MIN, 3);
  assert.deepEqual([...NFL_KEY_NUMBERS], [3, 7]);
  // "more than 3 hours" -> 180 minutes.
  assert.equal(CLOSING_LINE_MAX_MINUTES, 180);
  // "A record over 8 KB is not written."
  assert.equal(GAME_RECORD_MAX_BYTES, 8192);
});

// ── americanToDecimal ───────────────────────────────────────────────────────

test('americanToDecimal: hand-computed values', () => {
  // -110 -> 1 + 100/110 = 1.909090...
  near(americanToDecimal(-110)!, 1 + 100 / 110);
  // +150 -> 1 + 150/100 = 2.5
  near(americanToDecimal(150)!, 2.5);
  // -200 -> 1 + 100/200 = 1.5
  near(americanToDecimal(-200)!, 1.5);
  // +170 -> 2.7
  near(americanToDecimal(170)!, 2.7);
  // +100 and -100 are both even money -> 2.0
  near(americanToDecimal(100)!, 2);
  near(americanToDecimal(-100)!, 2);
  // Inside (-100, +100) is not a valid American price -> null.
  assert.equal(americanToDecimal(99), null);
  assert.equal(americanToDecimal(-99), null);
  assert.equal(americanToDecimal(0), null);
});

// ── noVigProbabilities ──────────────────────────────────────────────────────

test('no-vig: -110/-110 -> 0.5/0.5', () => {
  // d = 1.90909 each; equal reciprocals -> 0.5 each.
  const d = 1 + 100 / 110;
  const p = noVigProbabilities([d, d])!;
  assert.equal(p.length, 2);
  near(p[0], 0.5);
  near(p[1], 0.5);
});

test('no-vig: -200/+170 -> 0.642857/0.357143', () => {
  // d = 1.5 and 2.7; 1/d = 2/3 and 10/27; sum = 18/27 + 10/27 = 28/27.
  // p1 = (2/3)/(28/27) = 54/84 = 9/14 = 0.642857...
  // p2 = (10/27)/(28/27) = 10/28 = 5/14 = 0.357142...
  const p = noVigProbabilities([1.5, 2.7])!;
  near(p[0], 9 / 14);
  near(p[1], 5 / 14);
  near(p[0] + p[1], 1);
});

test('no-vig: three-way [2, 3, 4] -> 6/13, 4/13, 3/13', () => {
  // 1/2 + 1/3 + 1/4 = 13/12. p = (1/2)(12/13)=6/13, (1/3)(12/13)=4/13, (1/4)(12/13)=3/13.
  const p = noVigProbabilities([2, 3, 4])!;
  near(p[0], 6 / 13);
  near(p[1], 4 / 13);
  near(p[2], 3 / 13);
});

test('no-vig: null for fewer than 2 prices or any d <= 1', () => {
  assert.equal(noVigProbabilities([]), null);
  assert.equal(noVigProbabilities([2]), null);
  assert.equal(noVigProbabilities([1, 2]), null);
  assert.equal(noVigProbabilities([0.5, 2]), null);
});

// ── classifyGameStatus ──────────────────────────────────────────────────────

test('classifyGameStatus: final, in progress, postponed, cancelled', () => {
  assert.equal(classifyGameStatus('post', 'Final'), 'final');
  assert.equal(classifyGameStatus('post', 'Final/OT'), 'final');
  assert.equal(classifyGameStatus('in', '2nd Quarter'), 'in_progress');
  assert.equal(classifyGameStatus('pre', 'Postponed'), 'postponed');
  assert.equal(classifyGameStatus('post', 'Postponed'), 'postponed');
  assert.equal(classifyGameStatus('post', 'Canceled'), 'cancelled');
  assert.equal(classifyGameStatus('pre', 'Cancelled'), 'cancelled');
  assert.equal(classifyGameStatus('pre', 'Sun, November 15th at 8:20 PM EST'), 'scheduled');
});

// ── gradeSportsbookLines ────────────────────────────────────────────────────

test('grade: half-point spread, home covers; total over; moneyline home', () => {
  // home -3.5, score 24-17: margin = 7 - 3.5 = 3.5 -> home_cover.
  // total 40.5, combined 41: diff = +0.5 -> over.
  // ML winner home, price -200.
  const g = gradeSportsbookLines({ close: lines(-200, 170, -3.5, 40.5), homeScore: 24, awayScore: 17, status: 'final' })!;
  assert.deepEqual(g.moneyline, { winner: 'home', winnerPrice: -200 });
  assert.equal(g.spread!.result, 'home_cover');
  assert.equal(g.spread!.homePoint, -3.5);
  near(g.spread!.margin, 3.5);
  assert.equal(g.total!.result, 'over');
  assert.equal(g.total!.line, 40.5);
  assert.equal(g.total!.combined, 41);
  near(g.total!.difference, 0.5);
});

test('grade: half-point spread, away covers; total under', () => {
  // home -3.5, score 20-17: margin = 3 - 3.5 = -0.5 -> away_cover.
  // total 37.5, combined 37: diff = -0.5 -> under.
  const g = gradeSportsbookLines({ close: lines(-200, 170, -3.5, 37.5), homeScore: 20, awayScore: 17, status: 'final' })!;
  assert.equal(g.spread!.result, 'away_cover');
  near(g.spread!.margin, -0.5);
  assert.equal(g.total!.result, 'under');
  near(g.total!.difference, -0.5);
});

test('grade: whole-point spread push and total push', () => {
  // home -3, score 20-17: margin = 3 - 3 = 0 -> push.
  // total 37, combined 37: diff 0 -> push.
  const g = gradeSportsbookLines({ close: lines(-160, 140, -3, 37), homeScore: 20, awayScore: 17, status: 'final' })!;
  assert.equal(g.spread!.result, 'push');
  assert.equal(g.spread!.margin, 0);
  assert.equal(g.total!.result, 'push');
  assert.equal(g.total!.difference, 0);
});

test('grade: whole-point underdog spread, away covers by the hook-less number', () => {
  // home +7, score 10-24: margin = -14 + 7 = -7 -> away_cover.
  const g = gradeSportsbookLines({ close: lines(260, -320, 7, 44), homeScore: 10, awayScore: 24, status: 'final' })!;
  assert.equal(g.spread!.result, 'away_cover');
  assert.equal(g.spread!.margin, -7);
  assert.deepEqual(g.moneyline, { winner: 'away', winnerPrice: -320 });
  // combined 34 vs 44 -> under, diff -10.
  assert.equal(g.total!.result, 'under');
  assert.equal(g.total!.difference, -10);
});

test("grade: pick'em (spread 0) — win covers, tie pushes", () => {
  // home 0 (PK), 21-20: margin = 1 -> home_cover.
  const win = gradeSportsbookLines({ close: lines(-110, -110, 0, 41.5), homeScore: 21, awayScore: 20, status: 'final' })!;
  assert.equal(win.spread!.result, 'home_cover');
  assert.equal(win.spread!.homePoint, 0);
  near(win.spread!.margin, 1);
  // 20-20 (NFL tie): margin = 0 -> push; moneyline winner 'draw' (type comment: "'draw' on a tie").
  const tie = gradeSportsbookLines({ close: lines(-110, -110, 0, 41.5), homeScore: 20, awayScore: 20, status: 'final' })!;
  assert.equal(tie.spread!.result, 'push');
  assert.equal(tie.moneyline!.winner, 'draw');
});

test('grade: MLS draw uses the draw price', () => {
  // MLS 1-1 with draw +250: winner 'draw', winnerPrice 250.
  // goal line home -0.5: margin = 0 - 0.5 = -0.5 -> away_cover.
  // total 2.5, combined 2 -> under, diff -0.5.
  const g = gradeSportsbookLines({ close: lines(120, 210, -0.5, 2.5, 250), homeScore: 1, awayScore: 1, status: 'final' })!;
  assert.deepEqual(g.moneyline, { winner: 'draw', winnerPrice: 250 });
  assert.equal(g.spread!.result, 'away_cover');
  near(g.spread!.margin, -0.5);
  assert.equal(g.total!.result, 'under');
});

test('grade: neutral site with book sides reversed grades in record orientation', () => {
  // Record: home A scored 10, away B scored 24.
  // The book listed B as its home: moneylineHome(B) -150, moneylineAway(A) +130,
  // spreadHome(B) -3.5, spreadAway(A) +3.5.
  // Record home (A) point = +3.5; margin = 10 - 24 + 3.5 = -10.5 -> away_cover.
  // Winner = record away (B), whose price is the book's "home" price -150.
  const g = gradeSportsbookLines({
    close: lines(-150, 130, -3.5, 47.5),
    homeScore: 10,
    awayScore: 24,
    status: 'final',
    bookSidesReversed: true,
  })!;
  assert.deepEqual(g.moneyline, { winner: 'away', winnerPrice: -150 });
  assert.equal(g.spread!.homePoint, 3.5);
  near(g.spread!.margin, -10.5);
  assert.equal(g.spread!.result, 'away_cover');
  // Total is orientation-free: 34 vs 47.5 -> under, diff -13.5.
  assert.equal(g.total!.result, 'under');
  near(g.total!.difference, -13.5);
});

test('grade: same reversed lines without the flag would give the opposite spread result', () => {
  // Sanity of the swap: unflagged, home point = -3.5; margin = -14 - 3.5 = -17.5 -> away_cover,
  // but moneyline winner away at the book's away price +130.
  const g = gradeSportsbookLines({ close: lines(-150, 130, -3.5, 47.5), homeScore: 10, awayScore: 24, status: 'final' })!;
  assert.equal(g.spread!.homePoint, -3.5);
  near(g.spread!.margin, -17.5);
  assert.deepEqual(g.moneyline, { winner: 'away', winnerPrice: 130 });
});

test('grade: never graded unless final with both scores and a close', () => {
  const close = lines(-200, 170, -3.5, 44.5);
  assert.equal(gradeSportsbookLines({ close, homeScore: 24, awayScore: 17, status: 'postponed' }), null);
  assert.equal(gradeSportsbookLines({ close, homeScore: 0, awayScore: 0, status: 'cancelled' }), null);
  assert.equal(gradeSportsbookLines({ close, homeScore: 24, awayScore: 17, status: 'in_progress' }), null);
  assert.equal(gradeSportsbookLines({ close, homeScore: 24, awayScore: 17, status: 'scheduled' }), null);
  assert.equal(gradeSportsbookLines({ close, homeScore: null, awayScore: 17, status: 'final' }), null);
  assert.equal(gradeSportsbookLines({ close, homeScore: 24, awayScore: null, status: 'final' }), null);
  assert.equal(gradeSportsbookLines({ close: null, homeScore: 24, awayScore: 17, status: 'final' }), null);
});

// ── sportsbookLineLabel ─────────────────────────────────────────────────────

const BANNED = /bovada|bodog|vegas|consensus|the market|draftkings/i;

test('label: closing line 18 min before kickoff (spec example text)', () => {
  // 2026-11-16T00:42Z = 2026-11-15 19:42 EST (UTC-5; DST ended 2026-11-01) = 7:42 PM ET.
  const s = snap(QUIET, { capturedAt: '2026-11-16T00:42:00.000Z', minutesBeforeKickoff: 18 });
  const label = sportsbookLineLabel(s, 'close', '2026-11-15');
  assert.equal(label, 'Sportsbook closing line, captured 7:42 PM ET, 18 min before kickoff');
});

test('label: 180 minutes is still "closing line"; 181 is "last line seen"', () => {
  // "more than 3 hours" -> 180 is not more than 180.
  // 180 min before 01:00Z = 22:00Z = 5:00 PM EST.
  const at180 = sportsbookLineLabel(snap(QUIET, { capturedAt: '2026-11-15T22:00:00.000Z', minutesBeforeKickoff: 180 }), 'close', '2026-11-15');
  assert.match(at180, /^Sportsbook closing line/);
  assert.doesNotMatch(at180, /Last line seen/i);
  const at181 = sportsbookLineLabel(snap(QUIET, { capturedAt: '2026-11-15T21:59:00.000Z', minutesBeforeKickoff: 181 }), 'close', '2026-11-15');
  assert.match(at181, /^Last line seen/);
  assert.doesNotMatch(at181, /closing line/i);
});

test('label: close captured 4 h before kickoff (spec example text)', () => {
  // 240 min before 01:00Z = 21:00Z.
  const label = sportsbookLineLabel(snap(QUIET, { capturedAt: '2026-11-15T21:00:00.000Z', minutesBeforeKickoff: 240 }), 'close', '2026-11-15');
  assert.equal(label, 'Last line seen (captured 4 h before kickoff)');
});

test('label: opening line', () => {
  const label = sportsbookLineLabel(snap(QUIET, { capturedAt: '2026-11-12T15:00:00.000Z', minutesBeforeKickoff: 5640 }), 'open', '2026-11-15');
  assert.match(label, /^Sportsbook opening line/);
});

test('label: pre-2026-10-13 rows and the 10-13 boundary', () => {
  const old = snap(QUIET, { source: 'oddsapi', bookmaker: 'DraftKings', origin: 'backfill' });
  assert.equal(
    sportsbookLineLabel(old, 'close', '2026-10-12'),
    'Sportsbook line (different data source before Oct 13, 2026)',
  );
  // On 2026-10-13 itself the feed is the source: not the pre-source label.
  const onDay = sportsbookLineLabel(snap(QUIET), 'close', '2026-10-13');
  assert.doesNotMatch(onDay, /different data source/);
});

test('label: backfilled row with no capture time', () => {
  const s = snap(QUIET, { capturedAt: null, minutesBeforeKickoff: null, origin: 'backfill' });
  assert.equal(sportsbookLineLabel(s, 'close', '2026-10-20'), 'Stored sportsbook line (capture time not recorded)');
});

test('label: never shows the internal source/bookmaker or banned words', () => {
  const cases: [LineSnapshotRecord, 'open' | 'close', string][] = [
    [snap(QUIET, { bookmaker: 'Bovada' }), 'close', '2026-11-15'],
    [snap(QUIET, { bookmaker: 'Bodog', minutesBeforeKickoff: 400 }), 'close', '2026-11-15'],
    [snap(QUIET, { source: 'oddsapi', bookmaker: 'DraftKings' }), 'close', '2026-10-01'],
    [snap(QUIET, { source: 'oddsapi', bookmaker: 'DraftKings' }), 'open', '2026-10-01'],
    [snap(QUIET, { capturedAt: null, minutesBeforeKickoff: null, origin: 'backfill', bookmaker: 'bovada' }), 'close', '2026-10-20'],
  ];
  for (const [s, k, d] of cases) assert.doesNotMatch(sportsbookLineLabel(s, k, d), BANNED);
});

// ── snapshotFromFeedLine ────────────────────────────────────────────────────

const KICK = Date.parse('2026-11-16T01:00:00.000Z');

function stored(o: Partial<StoredFeedLine> & { live?: boolean } = {}): StoredFeedLine {
  const { live, ...rest } = o;
  const capturedAt = rest.capturedAt ?? KICK - 18 * 60_000;
  return {
    v: 1,
    feedId: 'F123',
    league: 'nfl',
    lines: {
      moneylineHome: -200,
      moneylineAway: 170,
      spreadHome: { point: -3.5, price: -110 },
      spreadAway: { point: 3.5, price: -110 },
      total: { point: 44.5, overPrice: -110, underPrice: -110 },
      live: live ?? false,
    } as unknown as StoredFeedLine['lines'],
    capturedAt,
    startTime: KICK,
    minutesBeforeStart: Math.floor((KICK - capturedAt) / 60_000),
    home: 'Home Team',
    away: 'Away Team',
    homeShort: null,
    awayShort: null,
    ...rest,
  };
}

const GAME = { kickoffMs: KICK, kickoffTimeTBD: false, homeTeam: 'Home Team', awayTeam: 'Away Team', neutralSite: false, league: 'nfl' };

test('snapshotFromFeedLine: normal pre-start line', () => {
  // Captured 18 min before -> minutesBeforeKickoff 18, ISO 00:42Z, not reversed, ingest origin.
  const s = snapshotFromFeedLine(stored(), GAME)!;
  assert.ok(s);
  assert.equal(s.capturedAt, '2026-11-16T00:42:00.000Z');
  assert.equal(s.minutesBeforeKickoff, 18);
  assert.equal(s.bookSidesReversed, false);
  assert.equal(s.origin, 'ingest');
  assert.equal(s.source, 'feed');
  assert.equal(s.lines.moneylineHome, -200);
  assert.equal(s.lines.spreadHome!.point, -3.5);
});

test('snapshotFromFeedLine: minutes are floored (18.5 min -> 18)', () => {
  const s = snapshotFromFeedLine(stored({ capturedAt: KICK - 18.5 * 60_000 }), GAME)!;
  assert.equal(s.minutesBeforeKickoff, 18);
});

test('snapshotFromFeedLine: 181 minutes stored as 181 (later labelled last line seen)', () => {
  const s = snapshotFromFeedLine(stored({ capturedAt: KICK - 181 * 60_000 }), GAME)!;
  assert.equal(s.minutesBeforeKickoff, 181);
  assert.match(sportsbookLineLabel(s, 'close', '2026-11-15'), /^Last line seen/);
});

test('snapshotFromFeedLine: neutral site, feed home is ESPN away -> bookSidesReversed', () => {
  const s = snapshotFromFeedLine(
    stored({ home: 'Away Team', away: 'Home Team' }),
    { ...GAME, neutralSite: true },
  )!;
  assert.ok(s);
  assert.equal(s.bookSidesReversed, true);
});

test('snapshotFromFeedLine: rejects live, at/after feed start, at/after kickoff', () => {
  assert.equal(snapshotFromFeedLine(null, GAME), null);
  assert.equal(snapshotFromFeedLine(stored({ live: true }), GAME), null);
  // captured exactly at startTime -> not pre-start.
  assert.equal(snapshotFromFeedLine(stored({ capturedAt: KICK }), GAME), null);
  assert.equal(snapshotFromFeedLine(stored({ capturedAt: KICK + 60_000 }), GAME), null);
  // feed start 30 min after ESPN kickoff; capture 10 min after ESPN kickoff -> started per ESPN.
  assert.equal(
    snapshotFromFeedLine(stored({ capturedAt: KICK + 10 * 60_000, startTime: KICK + 30 * 60_000 }), GAME),
    null,
  );
});

// ── closeOpenWrites ─────────────────────────────────────────────────────────

const START = Date.parse('2026-11-16T01:00:00.000Z');

function feedGame(o: Partial<FeedGame> = {}): FeedGame {
  return {
    id: 'F123',
    league: 'nfl',
    description: 'Away Team @ Home Team',
    startTime: START,
    live: false,
    competitors: [
      { name: 'Home Team', home: true },
      { name: 'Away Team', home: false },
    ],
    scope: 'full',
    groups: [],
    ...o,
  };
}

function feedLines(o: { ml?: number; live?: boolean } = {}): FeedLines {
  return {
    moneylineHome: o.ml ?? -200,
    moneylineAway: 170,
    spreadHome: { point: -3.5, price: -110 },
    spreadAway: { point: 3.5, price: -110 },
    total: { point: 44.5, overPrice: -110, underPrice: -110 },
    live: o.live ?? false,
    feedGameId: 'F123',
  } as unknown as FeedLines;
}

test('closeOpenWrites: normal pre-start full push with no previous lines writes close and open', () => {
  const now = START - 18 * 60_000;
  const w = closeOpenWrites(feedGame(), feedLines(), null, now);
  assert.ok(w.close);
  assert.ok(w.open);
  assert.equal(w.close!.capturedAt, now);
  assert.equal(w.close!.startTime, START);
  // floor((START - now)/60000) = 18
  assert.equal(w.close!.minutesBeforeStart, 18);
  assert.equal(w.close!.home, 'Home Team');
  assert.equal(w.close!.away, 'Away Team');
});

test('closeOpenWrites: changed pre-start push writes close but never re-writes open', () => {
  const now = START - 60 * 60_000;
  const w = closeOpenWrites(feedGame(), feedLines({ ml: -220 }), feedLines({ ml: -200 }), now);
  assert.ok(w.close);
  assert.equal(w.open, null);
});

test('closeOpenWrites: unchanged lines write nothing', () => {
  const now = START - 60 * 60_000;
  const w = closeOpenWrites(feedGame(), feedLines(), feedLines(), now);
  assert.equal(w.close, null);
  assert.equal(w.open, null);
});

test('closeOpenWrites: post-start full push never becomes the close', () => {
  // nowMs == startTime (not strictly before) and after it.
  for (const now of [START, START + 1, START + 30 * 60_000]) {
    const w = closeOpenWrites(feedGame(), feedLines({ ml: -250 }), feedLines(), now);
    assert.equal(w.close, null, `close at now=${now}`);
    assert.equal(w.open, null, `open at now=${now}`);
    const w2 = closeOpenWrites(feedGame(), feedLines({ ml: -250 }), null, now);
    assert.equal(w2.close, null);
    assert.equal(w2.open, null);
  }
});

test('closeOpenWrites: game.live === true or live lines never write', () => {
  const now = START - 10 * 60_000;
  const a = closeOpenWrites(feedGame({ live: true }), feedLines({ ml: -250 }), feedLines(), now);
  assert.equal(a.close, null);
  assert.equal(a.open, null);
  const b = closeOpenWrites(feedGame(), feedLines({ ml: -250, live: true }), feedLines(), now);
  assert.equal(b.close, null);
  assert.equal(b.open, null);
});

test('closeOpenWrites: a main-scope (non-full) push never writes', () => {
  const now = START - 10 * 60_000;
  const w = closeOpenWrites(feedGame({ scope: 'main' }), feedLines({ ml: -250 }), null, now);
  assert.equal(w.close, null);
  assert.equal(w.open, null);
});

// ── crossesKeyNumber ────────────────────────────────────────────────────────

test('crossesKeyNumber: clear crossings and non-crossings', () => {
  assert.equal(crossesKeyNumber(-2.5, -3.5), true); // 2.5 -> 3.5 passes 3
  assert.equal(crossesKeyNumber(-3.5, -2.5), true); // either direction
  assert.equal(crossesKeyNumber(-6.5, -7.5), true); // passes 7
  assert.equal(crossesKeyNumber(2.5, 3.5), true); // underdog side, same magnitudes
  assert.equal(crossesKeyNumber(-3.5, -6.5), false); // 3.5..6.5 holds neither 3 nor 7
  assert.equal(crossesKeyNumber(-7.5, -10), false);
  assert.equal(crossesKeyNumber(-1, -2.5), false);
  assert.equal(crossesKeyNumber(-3.5, -3.5), false);
});

// ── whatStoodOut ────────────────────────────────────────────────────────────

test('stood out: quiet game -> []', () => {
  assert.deepEqual(stood(record({ homeScore: 24, awayScore: 17, close: QUIET })), []);
});

test('stood out: nothing unless final (postponed, cancelled, in progress)', () => {
  // Same lines as an upset that would qualify, but the game is not final.
  const close = lines(-170, 150, -3.5, 44.5);
  for (const status of ['postponed', 'cancelled', 'in_progress', 'scheduled'] as GameStatus[]) {
    assert.deepEqual(stood(record({ status, homeScore: 17, awayScore: 24, close })), [], status);
  }
});

test('stood out rule 1: winner at exactly +150 is an upset, with the no-vig probability', () => {
  // close home -170 / away +150; away wins 24-17.
  // Margin = -7 - 3.5 = -10.5 would trip rule 2, so use 17-20 (away by 3):
  //   margin = -3 - 3.5 = -6.5 (no), total 37 vs 44.5 -> -7.5 (no).
  // d_home = 1 + 100/170 = 1.588235 -> 1/d = 170/270 = 0.629630
  // d_away = 2.5 -> 1/d = 0.4
  // p_away = 0.4 / 1.029630 = 0.388489 -> about 39% (38.8%).
  const s = stood(record({ homeScore: 17, awayScore: 20, close: lines(-170, 150, -3.5, 44.5) }));
  assert.equal(s.length, 1, JSON.stringify(s));
  assert.match(s[0], /\+150/);
  assert.match(s[0], /39%|38\.8%|38\.9%/);
});

test('stood out rule 1: winner at +149 is not an upset', () => {
  const s = stood(record({ homeScore: 17, awayScore: 20, close: lines(-170, 149, -3.5, 44.5) }));
  assert.deepEqual(s, []);
});

test('stood out rule 2: margin exactly 10 qualifies, 9.5 does not', () => {
  // home -3, 27-14: margin = 13 - 3 = 10 -> qualifies. total 44.5, combined 41 -> -3.5 (no).
  const ten = stood(record({ homeScore: 27, awayScore: 14, close: lines(-160, 140, -3, 44.5) }));
  assert.equal(ten.length, 1, JSON.stringify(ten));
  assert.match(ten[0], /\b10\b/);
  // home -3.5, 27-14: margin = 9.5 -> no.
  assert.deepEqual(stood(record({ homeScore: 27, awayScore: 14, close: lines(-160, 140, -3.5, 44.5) })), []);
  // away side: home +3, 14-27: margin = -13 + 3 = -10 -> |10| qualifies.
  const awayTen = stood(record({ homeScore: 14, awayScore: 27, close: lines(140, -160, 3, 44.5) }));
  assert.equal(awayTen.length, 1, JSON.stringify(awayTen));
});

test('stood out rule 2: landing exactly on the spread qualifies', () => {
  // home -7, 24-17: margin 0. total 44.5 vs 41 -> -3.5 (no).
  const s = stood(record({ homeScore: 24, awayScore: 17, close: lines(-300, 240, -7, 44.5) }));
  assert.equal(s.length, 1, JSON.stringify(s));
});

test('stood out rule 3: total miss exactly 10 qualifies, 9.5 does not, exact landing qualifies', () => {
  // total 44, 34-20 = 54: diff +10 -> qualifies. Spread -3.5: margin 14 - 3.5 = 10.5 would trip rule 2,
  // so use home -10: margin = 14 - 10 = 4 (no).
  const ten = stood(record({ homeScore: 34, awayScore: 20, close: lines(-500, 380, -10, 44) }));
  assert.equal(ten.length, 1, JSON.stringify(ten));
  // total 44.5, 54: diff 9.5 -> no.
  assert.deepEqual(stood(record({ homeScore: 34, awayScore: 20, close: lines(-500, 380, -10, 44.5) })), []);
  // total 41, 24-17 = 41: diff 0 -> qualifies. Spread -3.5: margin 3.5 (no).
  const on = stood(record({ homeScore: 24, awayScore: 17, close: lines(-200, 170, -3.5, 41) }));
  assert.equal(on.length, 1, JSON.stringify(on));
});

test('stood out rule 4: spread move exactly 2.5 qualifies, 2 does not (NFL, no key crossing)', () => {
  // open -7.5 -> close -10: move 2.5; 7.5..10 holds no 3/7 -> rule 4 by size alone.
  // 30-17: margin = 13 - 10 = 3 (no). total 44.5 vs 47 -> +2.5 (no). Winner home -500 (no).
  const moved = stood(record({ homeScore: 30, awayScore: 17, open: lines(-400, 310, -7.5, 44.5), close: lines(-500, 380, -10, 44.5) }));
  assert.equal(moved.length, 1, JSON.stringify(moved));
  assert.match(moved[0], /7\.5/);
  assert.match(moved[0], /\b10\b/);
  // open -8 -> close -10: move 2 -> no.
  assert.deepEqual(
    stood(record({ homeScore: 30, awayScore: 17, open: lines(-450, 340, -8, 44.5), close: lines(-500, 380, -10, 44.5) })),
    [],
  );
});

test('stood out rule 4: total move exactly 3 qualifies, 2.5 does not', () => {
  // open 41.5 -> close 44.5: move 3. Score 24-17 vs close -3.5/44.5 as QUIET (nothing else).
  const moved = stood(record({ homeScore: 24, awayScore: 17, open: lines(-200, 170, -3.5, 41.5), close: QUIET }));
  assert.equal(moved.length, 1, JSON.stringify(moved));
  assert.match(moved[0], /41\.5/);
  assert.match(moved[0], /44\.5/);
  // open 42 -> 44.5: move 2.5 -> no.
  assert.deepEqual(stood(record({ homeScore: 24, awayScore: 17, open: lines(-200, 170, -3.5, 42), close: QUIET })), []);
});

test('stood out rule 4: crossing 3 counts in the NFL only', () => {
  // open -2.5 -> close -3.5: move 1 (< 2.5) but crosses 3.
  const open = lines(-140, 120, -2.5, 44.5);
  const nfl = stood(record({ league: 'nfl', homeScore: 24, awayScore: 17, open, close: QUIET }));
  assert.equal(nfl.length, 1, JSON.stringify(nfl));
  // Same move in college football: no key-number rule -> nothing.
  assert.deepEqual(stood(record({ league: 'ncaa-football', homeScore: 24, awayScore: 17, open, close: QUIET })), []);
});

test('stood out rule 4: crossing 7 in the NFL', () => {
  // open -6.5 -> close -7.5: move 1, crosses 7. 28-17: margin 11 - 7.5 = 3.5 (no); total 45 vs 44.5 (+0.5, no).
  const s = stood(record({ homeScore: 28, awayScore: 17, open: lines(-280, 230, -6.5, 44.5), close: lines(-340, 270, -7.5, 44.5) }));
  assert.equal(s.length, 1, JSON.stringify(s));
});

test('stood out rule 4: favorite flip', () => {
  // open home -120 / away +100 (home favored), spread home -0.5.
  // close home +110 / away -130 (away favored), spread home +0.5.
  // Spread move 1, crosses no 3/7; total unchanged 44.5.
  // 20-17 home win: winner price +110 (< +150, no upset); margin = 3 + 0.5 = 3.5 (no); total 37 vs 44.5 (-7.5, no).
  const s = stood(record({ homeScore: 20, awayScore: 17, open: lines(-120, 100, -0.5, 44.5), close: lines(110, -130, 0.5, 44.5) }));
  assert.equal(s.length, 1, JSON.stringify(s));
});

test('stood out rule 5: spec example, gusts 31 mph against 18.5', () => {
  // The spec's own example sentence must qualify: 31 - 18.5 = 12.5 over the line.
  const market: WowMarketRecord = {
    id: 'w1',
    title: 'Peak gust at kickoff',
    kind: 'over-under',
    metric: 'actual_gust',
    unit: 'mph',
    status: 'graded',
    lock: { line: 18.5, overOdds: -110, underOdds: -110 },
    observed: 31,
    winner: 'over',
    station: 'KXYZ',
  };
  const s = stood(record({ homeScore: 24, awayScore: 17, close: QUIET, markets: [market] }));
  assert.equal(s.length, 1, JSON.stringify(s));
  assert.match(s[0], /31/);
  assert.match(s[0], /18\.5/);
  // An ungraded (pending) market never produces a sentence.
  const pending = stood(record({ homeScore: 24, awayScore: 17, close: QUIET, markets: [{ ...market, status: 'pending', winner: null }] }));
  assert.deepEqual(pending, []);
});

test('stood out: at most 3 sentences, in rule order', () => {
  // close home -170 / away +150, home -3, total 44, open -0.5/41.
  // Away wins 14-27: winner +150 -> rule 1.
  // margin = -13 - 3 = -16 -> rule 2.  combined 41 vs 44 -> -3 (no rule 3).
  // open -0.5 -> close -3: move 2.5 -> rule 4. total 41 -> 44: move 3 -> rule 4.
  // Make rule 3 fire too: total 31 (combined 41, diff +10). Open total 28 (move 3).
  const s = stood(record({ homeScore: 14, awayScore: 27, open: lines(-110, -110, -0.5, 28), close: lines(-170, 150, -3, 31) }));
  assert.equal(s.length, 3, JSON.stringify(s));
  // Rule 1 first (the upset carries the +150 price).
  assert.match(s[0], /\+150/);
});

test('stood out: no bettor/cause claims and no banned names in any sentence', () => {
  assert.ok(allSentences.length >= 10, `only ${allSentences.length} sentences collected`);
  const forbidden = /bovada|bodog|vegas|consensus|the market|sharp|handle|bettors?\b|public|cashed|money came|because|due to|steam|wiseguy|square/i;
  for (const s of allSentences) assert.doesNotMatch(s, forbidden, s);
});

// ── serializeGameRecord ─────────────────────────────────────────────────────

test('serializeGameRecord: ok flag at exactly 8192 bytes and at 8193', () => {
  // Calibration: measure the record with an empty siteName, then pad siteName with ASCII
  // so the UTF-8 JSON is exactly 8192 (ok) and then 8193 (not ok). Each ASCII 'x' adds one byte.
  const base = record({ homeScore: 24, awayScore: 17, close: QUIET });
  base.siteName = '';
  const b0 = serializeGameRecord(base);
  // bytes must be the UTF-8 length of json, and json must round-trip.
  assert.equal(b0.bytes, Buffer.byteLength(b0.json, 'utf8'));
  assert.deepEqual(JSON.parse(b0.json), JSON.parse(JSON.stringify(base)));
  assert.ok(b0.bytes < 8192);

  const atLimit = { ...base, siteName: 'x'.repeat(8192 - b0.bytes) };
  const r1 = serializeGameRecord(atLimit);
  assert.equal(r1.bytes, 8192);
  assert.equal(r1.ok, true);

  const over = { ...base, siteName: 'x'.repeat(8193 - b0.bytes) };
  const r2 = serializeGameRecord(over);
  assert.equal(r2.bytes, 8193);
  assert.equal(r2.ok, false);
});

test('serializeGameRecord: bytes count UTF-8, not characters', () => {
  // '°' is 2 bytes in UTF-8. Adding '°' x 10 to siteName adds 10 chars but 20 bytes.
  const base = record({ homeScore: 24, awayScore: 17, close: QUIET });
  base.siteName = '';
  const b0 = serializeGameRecord(base).bytes;
  const b1 = serializeGameRecord({ ...base, siteName: '°'.repeat(10) }).bytes;
  assert.equal(b1 - b0, 20);
});
