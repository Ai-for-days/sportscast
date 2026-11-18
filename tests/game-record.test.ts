// WOW-032 S2: the pure game-record functions (game-record.ts). These are the
// implementer's tests; the independent grading review writes its own.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  americanToDecimal, noVigProbabilities, classifyGameStatus, gradeSportsbookLines, orientLines,
  sportsbookLineLabel, buildGameRecord, serializeGameRecord, whatStoodOut, gameRecordSlug, gameRecordKey,
  gameRecordPath, gameRecordKeyFromPath, parseGameRecordKey, gameRecordIndexable, crossesKeyNumber,
  etIsoWithOffset, marketRecordFromWager, snapshotFromFeedLine, snapshotFromBoardLine,
  GAME_RECORD_MAX_BYTES, type MainLines, type LineSnapshotRecord, type GameRecord,
} from '../src/lib/game-record';
import { KICK, MIN, venue, lines, game, feedLine, ouWager, psWager, input } from './helpers/game-record-fixtures';

const L = (o: Partial<MainLines> = {}): MainLines => ({
  moneylineHome: -175, moneylineAway: 150,
  spreadHome: { point: -3.5, price: -110 }, spreadAway: { point: 3.5, price: -110 },
  total: { point: 47.5, overPrice: -110, underPrice: -110 },
  ...o,
});
const final = (homeScore: number, awayScore: number, close: MainLines | null = L(), reversed = false) =>
  gradeSportsbookLines({ close, homeScore, awayScore, status: 'final', bookSidesReversed: reversed });

describe('no-vig implied probability', () => {
  it('p_i = (1/d_i) / sum(1/d_j)', () => {
    const p = noVigProbabilities([2.5, 1 + 100 / 175])!;
    const a = 1 / 2.5, b = 1 / (1 + 100 / 175);
    assert.ok(Math.abs(p[0] - a / (a + b)) < 1e-12);
    assert.ok(Math.abs(p[0] + p[1] - 1) < 1e-12);
    assert.deepEqual(noVigProbabilities([1.909090909, 1.909090909])!.map((x) => Math.round(x * 1e6) / 1e6), [0.5, 0.5]);
  });
  it('three-way prices sum to one; bad input is null', () => {
    const p = noVigProbabilities([2.1, 3.4, 3.6])!;
    assert.ok(Math.abs(p.reduce((s, x) => s + x, 0) - 1) < 1e-12);
    assert.equal(noVigProbabilities([2]), null);
    assert.equal(noVigProbabilities([2, 1]), null);
    assert.equal(noVigProbabilities([2, NaN]), null);
  });
  it('American to decimal', () => {
    assert.equal(americanToDecimal(150), 2.5);
    assert.equal(americanToDecimal(-200), 1.5);
    assert.equal(americanToDecimal(100), 2);
    assert.equal(americanToDecimal(50), null);
  });
});

describe('gradeSportsbookLines', () => {
  it('half-point spread: home -3.5 wins by 7 covers; wins by 3 does not', () => {
    assert.equal(final(27, 20)!.spread!.result, 'home_cover');
    assert.equal(final(27, 20)!.spread!.margin, 3.5);
    assert.equal(final(23, 20)!.spread!.result, 'away_cover');
    assert.equal(final(23, 20)!.spread!.margin, -0.5);
  });
  it('whole-point spread push', () => {
    const g = final(24, 21, L({ spreadHome: { point: -3, price: -110 }, spreadAway: { point: 3, price: -110 } }))!;
    assert.equal(g.spread!.result, 'push');
    assert.equal(g.spread!.margin, 0);
  });
  it('total over, under and push', () => {
    assert.equal(final(27, 21)!.total!.result, 'over');
    assert.equal(final(27, 20)!.total!.result, 'under');
    const p = final(27, 20, L({ total: { point: 47, overPrice: -110, underPrice: -110 } }))!;
    assert.equal(p.total!.result, 'push');
    assert.equal(p.total!.combined, 47);
  });
  it('moneyline winner and price; a pick em spread', () => {
    const g = final(17, 20, L({ spreadHome: { point: 0, price: -110 }, spreadAway: { point: 0, price: -110 } }))!;
    assert.deepEqual(g.moneyline, { winner: 'away', winnerPrice: 150 });
    assert.equal(g.spread!.result, 'away_cover');
    assert.equal(g.spread!.homePoint, 0);
  });
  it('a tie is a draw; a three-way draw price is used when present', () => {
    assert.deepEqual(final(20, 20)!.moneyline, { winner: 'draw', winnerPrice: null });
    assert.deepEqual(final(1, 1, L({ moneylineDraw: 230 }))!.moneyline, { winner: 'draw', winnerPrice: 230 });
  });
  it('neutral-site swap: book home is our away', () => {
    // Book lists Georgia home -6.5; ESPN lists Florida home. Georgia (our away) wins 34-20.
    const book = L({ moneylineHome: -250, moneylineAway: 200, spreadHome: { point: -6.5, price: -110 }, spreadAway: { point: 6.5, price: -110 } });
    const g = final(20, 34, book, true)!;
    assert.deepEqual(g.moneyline, { winner: 'away', winnerPrice: -250 });
    assert.equal(g.spread!.homePoint, 6.5);
    assert.equal(g.spread!.result, 'away_cover');
    assert.equal(g.spread!.margin, -7.5);
    assert.deepEqual(orientLines(book, true).spreadHome, { point: 6.5, price: -110 });
  });
  it('never grades postponed, cancelled, unfinished or scoreless games', () => {
    for (const status of ['postponed', 'cancelled', 'in_progress', 'scheduled'] as const) {
      assert.equal(gradeSportsbookLines({ close: L(), homeScore: 0, awayScore: 0, status }), null);
    }
    assert.equal(gradeSportsbookLines({ close: L(), homeScore: null, awayScore: 3, status: 'final' }), null);
    assert.equal(gradeSportsbookLines({ close: null, homeScore: 3, awayScore: 0, status: 'final' }), null);
  });
  it('spread from the away side alone', () => {
    const g = final(27, 20, L({ spreadHome: null, spreadAway: { point: 3.5, price: -110 } }))!;
    assert.equal(g.spread!.homePoint, -3.5);
    assert.equal(g.spread!.result, 'home_cover');
  });
});

describe('status', () => {
  it('ESPN state and text', () => {
    assert.equal(classifyGameStatus('post', 'Final'), 'final');
    assert.equal(classifyGameStatus('post', 'Final/OT'), 'final');
    assert.equal(classifyGameStatus('post', 'Postponed'), 'postponed');
    assert.equal(classifyGameStatus('pre', 'Postponed'), 'postponed');
    assert.equal(classifyGameStatus('post', 'Canceled'), 'cancelled');
    assert.equal(classifyGameStatus('post', 'Suspended'), 'in_progress');
    assert.equal(classifyGameStatus('in', 'Q3 6:49'), 'in_progress');
    assert.equal(classifyGameStatus('pre', '1:00 PM ET'), 'scheduled');
  });
});

describe('labels (WOW-032 B)', () => {
  const snap = (o: Partial<LineSnapshotRecord> = {}): LineSnapshotRecord => ({
    lines: L(), source: 'feed', capturedAt: new Date(Date.parse('2026-11-20T00:42:00Z')).toISOString(), feedStartTime: null,
    minutesBeforeKickoff: 18, bookSidesReversed: false, origin: 'ingest', ...o,
  });
  it('closing line with ET time and minutes', () => {
    assert.equal(sportsbookLineLabel(snap(), 'close', '2026-11-19'), 'Sportsbook closing line, captured 7:42 PM ET, 18 min before kickoff');
  });
  it('more than 3 hours before kickoff is "last line seen"; exactly 3 hours is still a closing line', () => {
    assert.equal(sportsbookLineLabel(snap({ minutesBeforeKickoff: 250 }), 'close', '2026-11-19'), 'Last line seen (captured 4 h before kickoff)');
    assert.equal(sportsbookLineLabel(snap({ minutesBeforeKickoff: 181 }), 'close', '2026-11-19'), 'Last line seen (captured 3 h before kickoff)');
    assert.match(sportsbookLineLabel(snap({ minutesBeforeKickoff: 180 }), 'close', '2026-11-19'), /^Sportsbook closing line, captured .* 180 min before kickoff$/);
  });
  it('opening line, older source and missing capture time', () => {
    assert.equal(sportsbookLineLabel(snap(), 'open', '2026-11-19'), 'Sportsbook opening line');
    assert.equal(sportsbookLineLabel(snap(), 'close', '2026-10-12'), 'Sportsbook line (different data source before Oct 13, 2026)');
    assert.equal(sportsbookLineLabel(snap(), 'open', '2026-09-30'), 'Sportsbook line (different data source before Oct 13, 2026)');
    assert.equal(sportsbookLineLabel(snap({ capturedAt: null, minutesBeforeKickoff: null }), 'close', '2026-10-20'), 'Stored sportsbook line (capture time not recorded)');
  });
});

describe('stored lines into snapshots', () => {
  const ctx = { kickoffMs: KICK, kickoffTimeTBD: false, homeTeam: 'Kansas City Chiefs', awayTeam: 'Buffalo Bills', neutralSite: false, league: 'nfl' };
  it('a pre-start feed close becomes the snapshot, minutes counted to the ESPN kickoff', () => {
    const s = snapshotFromFeedLine(feedLine(), ctx)!;
    assert.equal(s.minutesBeforeKickoff, 18);
    assert.equal(s.bookSidesReversed, false);
    assert.equal(s.source, 'feed');
  });
  it('refuses a close captured at or after the feed start or the ESPN kickoff, or flagged live', () => {
    assert.equal(snapshotFromFeedLine(feedLine({ capturedAt: KICK }), ctx), null);
    assert.equal(snapshotFromFeedLine(feedLine({ capturedAt: KICK - MIN, startTime: KICK - 2 * MIN }), ctx), null);
    assert.equal(snapshotFromFeedLine(feedLine({ capturedAt: KICK - MIN }), { ...ctx, kickoffMs: KICK - 5 * MIN }), null);
    assert.equal(snapshotFromFeedLine(feedLine({}, { live: true }), ctx), null);
  });
  it('detects the neutral-site swap from the stored team names', () => {
    const s = snapshotFromFeedLine(
      feedLine({ home: 'Georgia', away: 'Florida', league: 'ncaa-football' }),
      { ...ctx, homeTeam: 'Florida Gators', awayTeam: 'Georgia Bulldogs', neutralSite: true, league: 'ncaa-football' },
    )!;
    assert.equal(s.bookSidesReversed, true);
  });
  it('a board freeze keeps its capture time; an archive row without one is labelled', () => {
    const b = snapshotFromBoardLine({ lines: lines({ bookmaker: 'Bovada' }), capturedAt: new Date(KICK - 40 * MIN).toISOString(), origin: 'board-freeze' }, ctx)!;
    assert.equal(b.minutesBeforeKickoff, 40);
    assert.equal(b.source, 'feed');
    assert.equal('bookmaker' in b, false);
    assert.equal(snapshotFromBoardLine({ lines: lines(), capturedAt: new Date(KICK + MIN).toISOString(), origin: 'board-freeze' }, ctx), null);
    const old = snapshotFromBoardLine({ lines: lines({ bookmaker: 'DraftKings' }), capturedAt: null, origin: 'backfill' }, ctx)!;
    assert.equal(old.capturedAt, null);
    assert.equal(old.source, 'oddsapi');
    assert.equal(sportsbookLineLabel(old, 'close', '2026-10-20'), 'Stored sportsbook line (capture time not recorded)');
  });
});

describe('buildGameRecord', () => {
  it('a final game with settled markets is graded and frozen', () => {
    const rec = buildGameRecord(input());
    assert.equal(rec.result.status, 'final');
    assert.equal(rec.sportsbook.grades!.spread!.result, 'home_cover');
    assert.equal(rec.sportsbook.grades!.total!.result, 'under');
    assert.equal(rec.frozenAt, new Date(KICK + 20 * 3600_000).toISOString());
    assert.equal(rec.date, '2026-11-16');
    assert.equal(rec.weather.wow!.score, 72);
    assert.equal(gameRecordIndexable(rec), true);
  });
  it('an open or locked market keeps the record unfrozen and shows no result for it', () => {
    const rec = buildGameRecord(input({ wagers: [ouWager('w1'), psWager('w2', { status: 'locked', winningOutcome: undefined })] }));
    assert.equal(rec.frozenAt, null);
    const m = rec.markets.find((x) => x.id === 'w2')!;
    assert.equal(m.status, 'pending');
    assert.equal(m.winner, null);
    assert.equal(m.observed, null);
  });
  it('unknown wagers (read failed) never freeze and keep the previous markets', () => {
    const first = buildGameRecord(input({ wagers: [psWager('w2', { status: 'locked' })] }));
    const rec = buildGameRecord(input({ wagers: null, previous: first }));
    assert.equal(rec.frozenAt, null);
    assert.equal(rec.markets.length, 1);
  });
  it('a void market counts as settled', () => {
    assert.ok(buildGameRecord(input({ wagers: [ouWager('w1', { status: 'void' })] })).frozenAt);
  });
  it('a frozen record is returned unchanged', () => {
    const frozen = buildGameRecord(input());
    const again = buildGameRecord(input({ previous: frozen, game: game({ homeScore: 99 }), now: KICK + 99 * 3600_000 }));
    assert.equal(again, frozen);
  });
  it('a game still in progress is not graded and not frozen', () => {
    const rec = buildGameRecord(input({ game: game({ state: 'in', statusDetail: 'Q4 2:00' }) }));
    assert.equal(rec.sportsbook.grades, null);
    assert.equal(rec.result.homeScore, null);
    assert.equal(rec.frozenAt, null);
  });
  it('a postponed game is never graded, freezes once its markets settle, and is not indexable', () => {
    const rec = buildGameRecord(input({ game: game({ statusDetail: 'Postponed', homeScore: 0, awayScore: 0 }), wagers: [ouWager('w1', { status: 'void' })] }));
    assert.equal(rec.result.status, 'postponed');
    assert.equal(rec.sportsbook.grades, null);
    assert.ok(rec.frozenAt);
    assert.equal(gameRecordIndexable(rec), false);
  });
  it('a post-start close from the feed is ignored, falling back to the board freeze', () => {
    const rec = buildGameRecord(input({
      feedClose: feedLine({ capturedAt: KICK + 25 * MIN }, { spreadHome: { point: 6.5, price: -110 }, spreadAway: { point: -6.5, price: -110 } }),
      boardClose: { lines: lines(), capturedAt: new Date(KICK - 90 * MIN).toISOString(), origin: 'board-freeze' },
    }));
    assert.equal(rec.sportsbook.close!.origin, 'board-freeze');
    assert.equal(rec.sportsbook.close!.lines.spreadHome!.point, -3.5);
  });
  it('no close at all: still a record, not indexable', () => {
    const rec = buildGameRecord(input({ feedClose: null, boardClose: null }));
    assert.equal(rec.sportsbook.close, null);
    assert.equal(rec.sportsbook.grades, null);
    assert.equal(gameRecordIndexable(rec), false);
  });
  it('neutral site: our home team keeps its own venue id, the venue is the game site, and the swap is graded', () => {
    const jax = venue('nfl-jax');
    const rec = buildGameRecord(input({
      league: 'ncaa-football',
      slug: 'georgia-at-florida',
      game: game({
        homeTeam: 'Florida Gators', awayTeam: 'Georgia Bulldogs', homeScore: 20, awayScore: 34,
        venue: jax, homeTeamVenue: venue('ncaa-florida'), awayVenue: venue('ncaa-uga'), neutralSite: true, gameSiteName: jax.name,
      }),
      feedClose: feedLine({ home: 'Georgia', away: 'Florida', league: 'ncaa-football' }, { moneylineHome: -250, moneylineAway: 200, spreadHome: { point: -6.5, price: -110 }, spreadAway: { point: 6.5, price: -110 } }),
      feedOpen: null,
      wagers: [],
    }));
    assert.equal(rec.home.venueId, 'ncaa-florida');
    assert.equal(rec.venue!.id, 'nfl-jax');
    assert.equal(rec.sportsbook.close!.bookSidesReversed, true);
    assert.equal(rec.sportsbook.grades!.spread!.result, 'away_cover');
    assert.equal(rec.sportsbook.grades!.moneyline!.winnerPrice, -250);
  });
  it('holds no user data: no bets, stakes, users or wallet fields', () => {
    const { json } = serializeGameRecord(buildGameRecord(input()));
    for (const bad of ['userId', 'stake', 'bets', 'wallet', 'email', 'payout', 'ticketNumber', 'voidReason']) assert.equal(json.includes(bad), false, bad);
  });
});

describe('size cap', () => {
  it('the typical record is under 4 KB; the cap is 8 KB', () => {
    const { bytes, ok } = serializeGameRecord(buildGameRecord(input()));
    assert.ok(bytes <= 4096, `${bytes} bytes`);
    assert.equal(ok, true);
    assert.equal(GAME_RECORD_MAX_BYTES, 8192);
  });
  it('a record over 8 KB is flagged not ok', () => {
    // The 12-market cap (WOW-033 c) keeps built records far below 8 KB, so pad one by hand.
    const rec = buildGameRecord(input());
    rec.markets = Array.from({ length: 40 }, (_, i) => marketRecordFromWager(psWager(`w${i}`)));
    const s = serializeGameRecord(rec);
    assert.ok(s.bytes > 8192);
    assert.equal(s.ok, false);
  });
});

describe('what stood out (WOW-032 B)', () => {
  const rec = (o: Parameters<typeof input>[0] = {}) => buildGameRecord(input({ wagers: [], ...o }));
  const closeWith = (l: Parameters<typeof lines>[0]) => feedLine({}, l);
  it('nothing qualifies: empty', () => {
    // 27-20, -3.5 margin 3.5, total 47 vs 47.5, open -3.5 / 47.5 (no move).
    assert.deepEqual(whatStoodOut(rec({ feedOpen: feedLine() })), []);
  });
  it('upset at exactly +150 states the no-vig probability', () => {
    const s = whatStoodOut(rec({ game: game({ homeScore: 17, awayScore: 20 }), feedOpen: feedLine() }));
    const p = noVigProbabilities([1 + 100 / 175, 2.5])![1]; // [home -175, away +150]
    assert.equal(s[0], `Buffalo Bills won at +150 on the closing moneyline, a no-vig implied probability of ${(p * 100).toFixed(1)}%.`);
  });
  it('+149 is not an upset', () => {
    const s = whatStoodOut(rec({ game: game({ homeScore: 17, awayScore: 20 }), feedClose: closeWith({ moneylineAway: 149 }), feedOpen: closeWith({ moneylineAway: 149 }) }));
    assert.equal(s.some((x) => /closing moneyline/.test(x)), false);
  });
  it('spread margin of exactly 10 qualifies; 9.5 does not; landing on the spread is a push sentence', () => {
    const ten = whatStoodOut(rec({ game: game({ homeScore: 33, awayScore: 20 }), feedClose: closeWith({ spreadHome: { point: -3, price: -110 }, spreadAway: { point: 3, price: -110 } }), feedOpen: closeWith({ spreadHome: { point: -3, price: -110 }, spreadAway: { point: 3, price: -110 } }) }));
    assert.ok(ten.includes('Against the closing spread (Kansas City Chiefs -3), Kansas City Chiefs covered by 10 points.'), ten.join('|'));
    const nine = whatStoodOut(rec({ game: game({ homeScore: 33, awayScore: 20 }), feedOpen: feedLine() }));
    assert.equal(nine.some((x) => x.startsWith('Against the closing spread')), false);
    const push = whatStoodOut(rec({ game: game({ homeScore: 23, awayScore: 20 }), feedClose: closeWith({ spreadHome: { point: -3, price: -110 }, spreadAway: { point: 3, price: -110 } }), feedOpen: closeWith({ spreadHome: { point: -3, price: -110 }, spreadAway: { point: 3, price: -110 } }) }));
    assert.ok(push.includes('The final margin landed exactly on the closing spread (Kansas City Chiefs -3), a push.'), push.join('|'));
  });
  it('total off by exactly 10 qualifies, and an exact landing', () => {
    const over = whatStoodOut(rec({ game: game({ homeScore: 34, awayScore: 23 }), feedClose: closeWith({ total: { point: 47, overPrice: -110, underPrice: -110 } }), feedOpen: closeWith({ total: { point: 47, overPrice: -110, underPrice: -110 } }) }));
    assert.ok(over.includes('The teams combined for 57 points, 10 over the closing total of 47.'), over.join('|'));
    const exact = whatStoodOut(rec({ feedClose: closeWith({ total: { point: 47, overPrice: -110, underPrice: -110 } }), feedOpen: closeWith({ total: { point: 47, overPrice: -110, underPrice: -110 } }) }));
    assert.ok(exact.includes('The teams combined for 47 points, exactly the closing total of 47.'), exact.join('|'));
  });
  it('line move: exactly 2.5 qualifies, 2 does not unless it crosses 3 or 7 in the NFL', () => {
    const sp = (p: number) => ({ spreadHome: { point: p, price: -110 }, spreadAway: { point: -p, price: -110 } });
    const move = (o: number, c: number, league: 'nfl' | 'ncaa-football' = 'nfl') => whatStoodOut(rec({ league, feedOpen: closeWith(sp(o)), feedClose: closeWith(sp(c)) })).filter((x) => x.startsWith('From open to close'));
    assert.deepEqual(move(-1, -3.5), ['From open to close, the spread moved from Kansas City Chiefs -1 to Kansas City Chiefs -3.5.']);
    assert.deepEqual(move(-1.5, -3.5), ['From open to close, the spread moved from Kansas City Chiefs -1.5 to Kansas City Chiefs -3.5.']);
    assert.deepEqual(move(-1.5, -3.5, 'ncaa-football'), []);
    assert.deepEqual(move(-3, -2), []);
    assert.deepEqual(move(-6.5, -7.5).length, 1);
    assert.deepEqual(move(-1, 1), ['From open to close, the spread moved from Kansas City Chiefs -1 to Kansas City Chiefs +1.']);
  });
  it('total move of exactly 3 qualifies', () => {
    const t = (p: number) => ({ total: { point: p, overPrice: -110, underPrice: -110 } });
    const s = whatStoodOut(rec({ feedOpen: closeWith(t(44.5)), feedClose: closeWith(t(47.5)) }));
    assert.ok(s.includes('From open to close, the total moved from 44.5 to 47.5.'), s.join('|'));
    assert.equal(whatStoodOut(rec({ feedOpen: closeWith(t(45)), feedClose: closeWith(t(47.5)) })).length, 0);
  });
  it('key numbers cross only when the line passes through them', () => {
    assert.equal(crossesKeyNumber(-2.5, -3.5), true);
    assert.equal(crossesKeyNumber(-3, -3.5), false);
    assert.equal(crossesKeyNumber(-2.5, -3), false);
    assert.equal(crossesKeyNumber(6.5, 7.5), true);
  });
  it('weather market: underdog at lock, or observed beating the line by 10', () => {
    const dog = whatStoodOut(rec({ wagers: [ouWager('w1', { closingLineSnapshot: { capturedAt: '', marketType: 'over-under', overUnder: { line: 47.5, overOdds: -130, underOdds: 110 } } })] }));
    assert.ok(dog.includes('Weather market "GEHA Field at Arrowhead Stadium Temp at Kickoff Over/Under" settled on Under, the longer price at lock (+110).'), dog.join('|'));
    const gust = ouWager('w1', { metric: 'actual_gust', title: 'Arrowhead Gust at Kickoff', observedValue: 31, winningOutcome: 'over', line: 18.5, closingLineSnapshot: { capturedAt: '', marketType: 'over-under', overUnder: { line: 18.5, overOdds: -110, underOdds: -110 } } } as any);
    const g = whatStoodOut(rec({ wagers: [gust] }));
    assert.ok(g.includes('Weather market "Arrowhead Gust at Kickoff": the observed value was 31 mph against a line of 18.5 mph.'), g.join('|'));
    const nine = ouWager('w1', { observedValue: 38, winningOutcome: 'under', closingLineSnapshot: { capturedAt: '', marketType: 'over-under', overUnder: { line: 47.5, overOdds: -110, underOdds: -110 } } });
    assert.equal(whatStoodOut(rec({ wagers: [nine] })).filter((x) => x.startsWith('Weather')).length, 0);
    const pending = ouWager('w1', { status: 'locked', closingLineSnapshot: { capturedAt: '', marketType: 'over-under', overUnder: { line: 47.5, overOdds: -130, underOdds: 110 } } });
    assert.equal(whatStoodOut(rec({ wagers: [pending] })).filter((x) => x.startsWith('Weather')).length, 0);
  });
  it('at most three sentences, never on a game that is not final, never a cause or a bettor claim', () => {
    const t = (p: number) => ({ total: { point: p, overPrice: -110, underPrice: -110 }, spreadHome: { point: -10, price: -110 }, spreadAway: { point: 10, price: -110 }, moneylineAway: 400 });
    const r = rec({ game: game({ homeScore: 3, awayScore: 40 }), feedOpen: closeWith({ total: { point: 40, overPrice: -110, underPrice: -110 } }), feedClose: closeWith(t(47)) });
    const s = whatStoodOut(r);
    assert.equal(s.length, 3);
    for (const x of s) assert.doesNotMatch(x, /because|sharp|public|bettor|money|handle|cashed|the market|consensus|vegas|bovada|bodog/i);
    assert.deepEqual(whatStoodOut(rec({ game: game({ statusDetail: 'Postponed' }) })), []);
  });
});

describe('identity, keys, paths', () => {
  it('slugs come from our venue slugs, -g2 for a second game', () => {
    assert.equal(gameRecordSlug(venue('nfl-buf'), venue('nfl-kc')), 'buffalo-at-kansas-city');
    assert.equal(gameRecordSlug(venue('nfl-nyj'), venue('nfl-buf'), 2), 'new-york-jets-at-buffalo-g2');
    assert.equal(gameRecordSlug(null, venue('nfl-kc')), null);
  });
  it('key, path and reverse lookup', () => {
    assert.equal(gameRecordKey('ncaa-football', '2026-11-15', 'georgia-at-florida'), 'gamerec:ncaa-football:2026-11-15:georgia-at-florida');
    assert.equal(gameRecordPath('ncaa-football', '2026-11-15', 'georgia-at-florida'), '/games/college-football/2026-11-15/georgia-at-florida');
    assert.equal(gameRecordKeyFromPath('college-football', '2026-11-15', 'georgia-at-florida'), 'gamerec:ncaa-football:2026-11-15:georgia-at-florida');
    assert.equal(gameRecordKeyFromPath('mlb', '2026-09-01', 'boston-at-new-york-yankees'), null);
    assert.equal(gameRecordKeyFromPath('nfl', '2026-13-45', 'a-at-b'), null);
    assert.equal(gameRecordKeyFromPath('nfl', '2026-11-16', 'Buffalo-at-KC'), null);
    assert.deepEqual(parseGameRecordKey('gamerec:nfl:2026-11-16:buffalo-at-kansas-city'), { league: 'nfl', date: '2026-11-16', slug: 'buffalo-at-kansas-city' });
  });
  it('startDate carries the ET offset', () => {
    assert.equal(etIsoWithOffset(KICK), '2026-11-16T13:00:00-05:00');
    assert.equal(etIsoWithOffset(Date.parse('2026-09-13T17:00:00Z')), '2026-09-13T13:00:00-04:00');
  });
  it('a market entry summarises the lock price from closingLineSnapshot', () => {
    const m = marketRecordFromWager(psWager('w2'));
    assert.deepEqual(m.lock, { spread: -6.5, aOdds: -110, bOdds: -110, capturedAt: new Date(KICK - 60 * MIN).toISOString() });
    assert.equal(m.observed, 52);
    assert.equal(m.observedB, 39);
    assert.equal(m.winner, 'locationA');
  });
});

export type { GameRecord };
