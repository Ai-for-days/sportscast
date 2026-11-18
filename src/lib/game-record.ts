// ── The permanent per-game record (WOW-031 question 4, WOW-032 B) ─────────
//
// One small JSON record per finished game, kept with no TTL under
// `gamerec:<league>:<YYYY-MM-DD>:<slug>`, behind the /games/... page. This file
// is the pure half: the record's shape, how it is built from what we already
// hold, how the sportsbook's main lines are graded, the labels a reader sees,
// and the "What stood out" sentences. No Redis, no network (see
// game-record-store.ts and game-record-writer.ts for those).
//
// Rules that must not be loosened (Professor rulings WOW-031 and WOW-032):
//   - The close is a pre-start, non-live, full-scrape line. A line flagged
//     live, or captured at or after the feed's start time or the scheduled
//     kickoff, is never stored as the close.
//   - Sportsbook lines are graded only once ESPN says the game is final.
//     Postponed and cancelled games are never graded.
//   - Each weather market is shown graded only once its own wager is graded
//     or void. Until then it reads "Result pending".
//   - `frozenAt` is set once, when everything is settled, and is the only
//     date the sitemap's lastmod may use.
//   - No user positions or user data: a market here is the market's own
//     terms, its lock price, the observed value and the outcome. Nothing else.
//   - The sportsbook is never named on a public surface. The internal
//     `source` field says which feed a line came from and is never shown.
//   - "What stood out" is fixed templates over stored numbers, with fixed
//     thresholds. No prose generation, no causes, no claims about bettors.
//
// The schema is generic over leagues so MLB and MLS can follow. S2 writes NFL
// and college football only, and indoor sports never get a record.

import type { GameLines } from './sportsbook-odds';
import type { Venue } from './types';
import type { Wager, WagerMetric } from './wager-types';
import { getVenueSlug } from './venue-slug';
import { matchFeedGame } from './odds-feed-match';

export const GAME_RECORD_SCHEMA_VERSION = 1;
/** WOW-032 B: aim for this or less. */
export const GAME_RECORD_TARGET_BYTES = 4096;
/** WOW-032 B: a record over this is never written. */
export const GAME_RECORD_MAX_BYTES = 8192;

export type GameRecordLeague = 'nfl' | 'ncaa-football' | 'mlb' | 'mls';
/** Leagues that get records in S2. MLB and MLS reuse the schema later. */
export const GAME_RECORD_LEAGUES: readonly GameRecordLeague[] = ['nfl', 'ncaa-football'];
/** Leagues whose game pages go in sitemap-games.xml (WOW-031 4: NFL and CFB only at first). */
export const GAME_SITEMAP_LEAGUES: readonly GameRecordLeague[] = ['nfl', 'ncaa-football'];

export const GAME_LEAGUE_SEGMENT: Record<GameRecordLeague, string> = {
  nfl: 'nfl',
  'ncaa-football': 'college-football',
  mlb: 'mlb',
  mls: 'mls',
};

/** Rows dated before this came from a different odds source (WOW-031 4, WOW-032 B). */
export const FEED_SOURCE_START_DATE = '2026-10-13';
/** A capture more than this long before kickoff is "last line seen", not "closing line". */
export const CLOSING_LINE_MAX_MINUTES = 180;

const ET = 'America/New_York';

// ── Types ───────────────────────────────────────────────────────────────────

export type GameStatus = 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'cancelled';

/** Main lines in one orientation. `moneylineDraw` only for three-way (soccer) markets. */
export interface MainLines {
  moneylineHome: number | null;
  moneylineAway: number | null;
  moneylineDraw?: number | null;
  spreadHome: { point: number; price: number } | null;
  spreadAway: { point: number; price: number } | null;
  total: { point: number; overPrice: number; underPrice: number } | null;
}

/** One stored sportsbook snapshot (open or close). */
export interface LineSnapshotRecord {
  /** As the book listed them: when `bookSidesReversed`, `home` here is the record's away team. */
  lines: MainLines;
  /** Internal only, never shown: 'feed' (from 2026-10-13) or 'oddsapi' (before). */
  source: 'feed' | 'oddsapi';
  /** Internal only, never shown. Set for Odds API rows (e.g. "DraftKings"). */
  bookmaker?: string;
  /** ISO instant the line was captured, or null when it was never recorded. */
  capturedAt: string | null;
  /** The feed's own start time, ISO, when known. */
  feedStartTime: string | null;
  /** Whole minutes from capture to kickoff (floor), or null without a capture time. */
  minutesBeforeKickoff: number | null;
  /** True when the book listed the two teams the other way round (neutral sites). */
  bookSidesReversed: boolean;
  /** How it reached the record: the ingest-time key, the board's freeze, or the one-time backfill. */
  origin: 'ingest' | 'board-freeze' | 'backfill';
}

export type SpreadResult = 'home_cover' | 'away_cover' | 'push';
export type TotalResult = 'over' | 'under' | 'push';

export interface SportsbookGrades {
  /** The game's winner, which is the winning moneyline side. 'draw' on a tie. */
  moneyline: { winner: 'home' | 'away' | 'draw'; winnerPrice: number | null } | null;
  /** Graded on the home team's closing point. `margin` = home score - away score + home point. */
  spread: { result: SpreadResult; homePoint: number; margin: number } | null;
  /** `difference` = combined score - closing total. */
  total: { result: TotalResult; line: number; combined: number; difference: number } | null;
}

export interface LockSummary {
  line?: number;
  overOdds?: number;
  underOdds?: number;
  spread?: number;
  aOdds?: number;
  bOdds?: number;
  bands?: { label: string; odds: number }[];
  capturedAt?: string;
}

/** One WOW weather market on this game. The market's terms and result only, never anyone's position. */
export interface WowMarketRecord {
  id: string;
  title: string;
  kind: Wager['kind'];
  metric: WagerMetric;
  metricB?: WagerMetric;
  unit: '°F' | 'mph';
  status: 'pending' | 'graded' | 'void';
  lock: LockSummary | null;
  /** Side names for a pointspread (A, B). */
  aName?: string;
  bName?: string;
  observed: number | null;
  observedB?: number | null;
  /** 'over' | 'under' | 'push' | 'locationA' | 'locationB' | a band label | 'no_match'; null until graded. */
  winner: string | null;
  station: string | null;
  stationB?: string | null;
}

export interface GameRecord {
  schemaVersion: number;
  /** ISO instant everything was settled; null until then. The only lastmod. */
  frozenAt: string | null;
  league: GameRecordLeague;
  /** ET calendar date of kickoff, YYYY-MM-DD. */
  date: string;
  slug: string;
  espnId: string;
  feedId: string | null;
  /** ISO kickoff (ESPN). */
  kickoff: string;
  kickoffTimeTBD: boolean;
  home: { name: string; venueId: string };
  away: { name: string; venueId: string };
  neutralSite: boolean;
  /** Where the game is played. Null when that venue is not one we track (an untracked neutral site). */
  venue: { id: string; name: string; city: string; state: string; zip?: string; lat: number; lon: number; type: Venue['type'] } | null;
  siteName: string;
  roof: { status: 'open' | 'closed' | 'unknown'; closed: boolean };
  result: { status: GameStatus; detail: string; homeScore: number | null; awayScore: number | null };
  sportsbook: { open: LineSnapshotRecord | null; close: LineSnapshotRecord | null; grades: SportsbookGrades | null };
  weather: {
    wow: { score: number; version: string } | null;
    forecast: { tempF: number; windSpeedMph: number; precipProbability: number; description: string | null } | null;
    observed: { tempF: number; windSpeedMph: number | null; precipMmLastHour: number | null; description: string | null; stationId: string } | null;
  };
  markets: WowMarketRecord[];
}

// ── Odds math ───────────────────────────────────────────────────────────────

/** Decimal odds for an American price, or null for a non-price (0, NaN, between -100 and +100). */
export function americanToDecimal(american: number): number | null {
  if (!Number.isFinite(american)) return null;
  if (american >= 100) return 1 + american / 100;
  if (american <= -100) return 1 + 100 / -american;
  return null;
}

/**
 * No-vig implied probabilities (WOW-032 B rule 1): p_i = (1/d_i) / Σ(1/d_j),
 * with decimal odds d. Returns null unless there are at least two prices and
 * every one is a real decimal price (> 1).
 */
export function noVigProbabilities(decimalOdds: readonly number[]): number[] | null {
  if (decimalOdds.length < 2) return null;
  if (decimalOdds.some((d) => !Number.isFinite(d) || d <= 1)) return null;
  const inv = decimalOdds.map((d) => 1 / d);
  const sum = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / sum);
}

// ── Status ──────────────────────────────────────────────────────────────────

/** ESPN state plus its status text, as the record's status. Pure. */
export function classifyGameStatus(state: 'pre' | 'in' | 'post', statusDetail: string | null | undefined): GameStatus {
  const d = String(statusDetail ?? '');
  if (/postpon/i.test(d)) return 'postponed';
  if (/cancel/i.test(d)) return 'cancelled';
  if (state === 'post') {
    // ESPN parks a suspended or delayed game under 'post' on some feeds; neither is a result.
    if (/suspend|delay/i.test(d)) return 'in_progress';
    return 'final';
  }
  return state === 'in' ? 'in_progress' : 'scheduled';
}

// ── Orientation ─────────────────────────────────────────────────────────────

/** Lines in the record's orientation. `reversed` = the book listed the teams the other way round. */
export function orientLines(lines: MainLines, reversed: boolean): MainLines {
  if (!reversed) return lines;
  return {
    ...lines,
    moneylineHome: lines.moneylineAway,
    moneylineAway: lines.moneylineHome,
    spreadHome: lines.spreadAway,
    spreadAway: lines.spreadHome,
  };
}

/** The home team's point on a spread, from whichever side carries it. */
function homePointOf(l: MainLines): number | null {
  if (l.spreadHome) return l.spreadHome.point;
  if (l.spreadAway) return l.spreadAway.point === 0 ? 0 : -l.spreadAway.point;
  return null;
}

// ── Grading ─────────────────────────────────────────────────────────────────

export interface GradeSportsbookInput {
  /** The stored close, as the book listed it. */
  close: MainLines | null;
  /** Final scores in the record's (ESPN's) orientation. */
  homeScore: number | null;
  awayScore: number | null;
  status: GameStatus;
  /** True when the book's home team is ESPN's away team (neutral-site swap). */
  bookSidesReversed?: boolean;
}

/**
 * Grade the sportsbook's closing main lines against the final score. Pure.
 *
 * Returns null unless the game is final with both scores and a close exists:
 * postponed, cancelled, in-progress and scheduled games are never graded.
 *   - moneyline: the winner (home, away, or 'draw' on a tie), plus the
 *     winner's closing price when the close carries one;
 *   - against the spread, on the home point p: margin = home - away + p;
 *     > 0 home cover, < 0 away cover, 0 push;
 *   - total, on line t: combined = home + away; > t over, < t under, = t push.
 * Each part is null when the close does not carry that market.
 */
export function gradeSportsbookLines(input: GradeSportsbookInput): SportsbookGrades | null {
  const { close, homeScore, awayScore, status } = input;
  if (status !== 'final' || !close) return null;
  if (homeScore === null || awayScore === null || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  const l = orientLines(close, input.bookSidesReversed === true);

  const winner: 'home' | 'away' | 'draw' = homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';
  const hasMl = l.moneylineHome !== null || l.moneylineAway !== null || (l.moneylineDraw ?? null) !== null;
  const winnerPrice = winner === 'home' ? l.moneylineHome : winner === 'away' ? l.moneylineAway : (l.moneylineDraw ?? null);
  const moneyline = hasMl ? { winner, winnerPrice: winnerPrice ?? null } : null;

  const homePoint = homePointOf(l);
  let spread: SportsbookGrades['spread'] = null;
  if (homePoint !== null) {
    const margin = round2(homeScore - awayScore + homePoint);
    spread = { result: margin > 0 ? 'home_cover' : margin < 0 ? 'away_cover' : 'push', homePoint, margin };
  }

  let total: SportsbookGrades['total'] = null;
  if (l.total) {
    const combined = homeScore + awayScore;
    const difference = round2(combined - l.total.point);
    total = { result: difference > 0 ? 'over' : difference < 0 ? 'under' : 'push', line: l.total.point, combined, difference };
  }

  if (!moneyline && !spread && !total) return null;
  return { moneyline, spread, total };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatAmerican(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** A spread point as a reader writes it: -3.5, +7, PK. */
export function formatPoint(p: number): string {
  if (p === 0) return 'PK';
  return p > 0 ? `+${p}` : String(p);
}

/** "7:42 PM" in ET. */
export function formatEtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
}

/** "Sunday, November 16, 2026" for a YYYY-MM-DD date. */
export function formatLongDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** ET calendar date (YYYY-MM-DD) of an instant. */
export function etDateOf(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: ET });
}

/** ISO 8601 with the ET offset, e.g. 2026-11-16T13:00:00-05:00. */
export function etIsoWithOffset(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const off = get('timeZoneName').replace('GMT', '') || '+00:00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${off}`;
}

// ── Labels (WOW-032 B) ──────────────────────────────────────────────────────

/**
 * The label a reader sees for a stored line. Never names the book, and never
 * says "the market", "consensus" or "Vegas". In order:
 *   - a row dated before 2026-10-13: "Sportsbook line (different data source before Oct 13, 2026)";
 *   - no capture time: "Stored sportsbook line (capture time not recorded)";
 *   - open: "Sportsbook opening line";
 *   - close captured more than 3 hours before kickoff: "Last line seen (captured N h before kickoff)", N = whole hours (floor);
 *   - close: "Sportsbook closing line, captured h:mm PM ET, N min before kickoff".
 */
export function sportsbookLineLabel(snapshot: LineSnapshotRecord, kind: 'open' | 'close', gameDate: string): string {
  if (gameDate < FEED_SOURCE_START_DATE) return 'Sportsbook line (different data source before Oct 13, 2026)';
  if (!snapshot.capturedAt || !Number.isFinite(Date.parse(snapshot.capturedAt))) return 'Stored sportsbook line (capture time not recorded)';
  if (kind === 'open') return 'Sportsbook opening line';
  const min = snapshot.minutesBeforeKickoff;
  if (min !== null && min > CLOSING_LINE_MAX_MINUTES) return `Last line seen (captured ${Math.floor(min / 60)} h before kickoff)`;
  const at = formatEtTime(Date.parse(snapshot.capturedAt));
  return `Sportsbook closing line, captured ${at} ET, ${min ?? 0} min before kickoff`;
}

/** True when the stored close may be called a closing line (captured within 3 hours of kickoff). */
export function isTrueClosingLine(snapshot: LineSnapshotRecord | null, gameDate: string): boolean {
  if (!snapshot || gameDate < FEED_SOURCE_START_DATE || !snapshot.capturedAt) return false;
  return snapshot.minutesBeforeKickoff !== null && snapshot.minutesBeforeKickoff <= CLOSING_LINE_MAX_MINUTES;
}

// ── Identity, keys and URLs ─────────────────────────────────────────────────

/** `<away>-at-<home>` from our own venue slugs (never feed ids); `-g2` for a second game. Null when either side has no slug. */
export function gameRecordSlug(away: Venue | null | undefined, home: Venue | null | undefined, gameNumber = 1): string | null {
  const a = away ? getVenueSlug(away) : null;
  const h = home ? getVenueSlug(home) : null;
  if (!a || !h) return null;
  return gameNumber > 1 ? `${a}-at-${h}-g${gameNumber}` : `${a}-at-${h}`;
}

export function gameRecordKey(league: GameRecordLeague, date: string, slug: string): string {
  return `gamerec:${league}:${date}:${slug}`;
}

export function gameRecordPath(league: GameRecordLeague, date: string, slug: string): string {
  return `/games/${GAME_LEAGUE_SEGMENT[league]}/${date}/${slug}`;
}

/** The record key for a page path's parts, or null for anything malformed or outside S2's leagues. */
export function gameRecordKeyFromPath(segment: string, date: string, slug: string): string | null {
  const league = (Object.entries(GAME_LEAGUE_SEGMENT).find(([, s]) => s === segment)?.[0] ?? null) as GameRecordLeague | null;
  if (!league || !GAME_RECORD_LEAGUES.includes(league)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-at-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return null;
  return gameRecordKey(league, date, slug);
}

/** League, date and slug back out of a record key. */
export function parseGameRecordKey(key: string): { league: GameRecordLeague; date: string; slug: string } | null {
  const m = /^gamerec:([a-z-]+):(\d{4}-\d{2}-\d{2}):([a-z0-9-]+)$/.exec(key);
  if (!m || !(m[1] in GAME_LEAGUE_SEGMENT)) return null;
  return { league: m[1] as GameRecordLeague, date: m[2], slug: m[3] };
}

// ── Stored-line inputs ──────────────────────────────────────────────────────

/** The ingest-time `oddsfeed:close:<id>` / `oddsfeed:open:<id>` value (odds-feed-store.ts). */
export interface StoredFeedLine {
  v: 1;
  feedId: string;
  league: string;
  lines: GameLines;
  /** Epoch ms the line arrived. */
  capturedAt: number;
  /** The feed's start time, epoch ms. */
  startTime: number;
  minutesBeforeStart: number;
  home: string;
  away: string;
  homeShort: string | null;
  awayShort: string | null;
}

/** A board-frozen `closing-line:*` record, or an archive row's lines (capture time unknown). */
export interface BoardLineInput {
  lines: GameLines;
  capturedAt: string | null;
  origin: 'board-freeze' | 'backfill';
}

function mainOf(l: GameLines): MainLines {
  return {
    moneylineHome: l.moneylineHome ?? null,
    moneylineAway: l.moneylineAway ?? null,
    spreadHome: l.spreadHome ? { point: l.spreadHome.point, price: l.spreadHome.price } : null,
    spreadAway: l.spreadAway ? { point: l.spreadAway.point, price: l.spreadAway.price } : null,
    total: l.total ? { point: l.total.point, overPrice: l.total.overPrice, underPrice: l.total.underPrice } : null,
  };
}

function hasAnyMain(l: MainLines): boolean {
  return l.moneylineHome !== null || l.moneylineAway !== null || !!l.spreadHome || !!l.spreadAway || !!l.total;
}

/** 'feed' for the pushed feed (any spelling of its name), else the Odds API. The name itself is dropped. */
function sourceOf(bookmaker: string | undefined): { source: 'feed' | 'oddsapi'; bookmaker?: string } {
  const b = String(bookmaker ?? '');
  if (!b || /^feed$/i.test(b) || /bovada|bodog/i.test(b)) return { source: 'feed' };
  return { source: 'oddsapi', bookmaker: b.slice(0, 40) };
}

function minutesBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / 60_000);
}

/**
 * The ingest-time key as a snapshot, or null when it may not stand as a
 * pre-game line: flagged live, captured at or after the feed's start, or at
 * or after the scheduled kickoff (whichever says "started" first wins).
 */
export function snapshotFromFeedLine(
  stored: StoredFeedLine | null,
  game: { kickoffMs: number; kickoffTimeTBD: boolean; homeTeam: string; awayTeam: string; neutralSite: boolean; league: string },
): LineSnapshotRecord | null {
  if (!stored || !stored.lines || !Number.isFinite(stored.capturedAt)) return null;
  if (stored.lines.live === true) return null;
  if (Number.isFinite(stored.startTime) && stored.capturedAt >= stored.startTime) return null;
  if (!game.kickoffTimeTBD && Number.isFinite(game.kickoffMs) && stored.capturedAt >= game.kickoffMs) return null;
  const lines = mainOf(stored.lines);
  if (!hasAnyMain(lines)) return null;
  const match = matchFeedGame(
    game.league,
    { homeTeam: game.homeTeam, awayTeam: game.awayTeam, kickoffUTC: new Date(Number.isFinite(game.kickoffMs) ? game.kickoffMs : stored.startTime).toISOString(), neutralSite: game.neutralSite },
    [{ id: stored.feedId, startTime: stored.startTime, home: stored.home, away: stored.away, homeShort: stored.homeShort, awayShort: stored.awayShort }],
  );
  const kickoff = !game.kickoffTimeTBD && Number.isFinite(game.kickoffMs) ? game.kickoffMs : stored.startTime;
  return {
    lines,
    source: 'feed',
    capturedAt: new Date(stored.capturedAt).toISOString(),
    feedStartTime: Number.isFinite(stored.startTime) ? new Date(stored.startTime).toISOString() : null,
    minutesBeforeKickoff: minutesBetween(stored.capturedAt, kickoff),
    bookSidesReversed: match?.swapped === true,
    origin: 'ingest',
  };
}

/**
 * A board-frozen or archived line as a snapshot. These are already in our
 * orientation (odds-source.ts swaps them before the board sees them). The same
 * pre-start test applies wherever a capture time exists; without one the label
 * says so.
 */
export function snapshotFromBoardLine(
  input: BoardLineInput | null,
  game: { kickoffMs: number; kickoffTimeTBD: boolean },
): LineSnapshotRecord | null {
  if (!input || !input.lines) return null;
  if (input.lines.live === true) return null;
  const lines = mainOf(input.lines);
  if (!hasAnyMain(lines)) return null;
  const capMs = input.capturedAt ? Date.parse(input.capturedAt) : NaN;
  const feedStart = typeof input.lines.feedStartTime === 'number' ? input.lines.feedStartTime : null;
  if (Number.isFinite(capMs)) {
    if (feedStart !== null && capMs >= feedStart) return null;
    if (!game.kickoffTimeTBD && Number.isFinite(game.kickoffMs) && capMs >= game.kickoffMs) return null;
  }
  const kickoff = !game.kickoffTimeTBD && Number.isFinite(game.kickoffMs) ? game.kickoffMs : feedStart;
  return {
    lines,
    ...sourceOf(input.lines.bookmaker),
    capturedAt: Number.isFinite(capMs) ? new Date(capMs).toISOString() : null,
    feedStartTime: feedStart !== null ? new Date(feedStart).toISOString() : null,
    minutesBeforeKickoff: Number.isFinite(capMs) && kickoff !== null ? minutesBetween(capMs, kickoff) : null,
    bookSidesReversed: false,
    origin: input.origin,
  };
}

// ── Weather markets ─────────────────────────────────────────────────────────

export function metricUnit(m: WagerMetric): '°F' | 'mph' {
  return m === 'actual_wind' || m === 'actual_gust' ? 'mph' : '°F';
}

/** One wager as the record's market entry. Pending markets carry no observed value or winner. Pure. */
export function marketRecordFromWager(w: Wager): WowMarketRecord {
  const status: WowMarketRecord['status'] = w.status === 'graded' ? 'graded' : w.status === 'void' ? 'void' : 'pending';
  const snap = w.closingLineSnapshot;
  let lock: LockSummary | null = null;
  if (snap) {
    if (snap.overUnder) lock = { line: snap.overUnder.line, overOdds: snap.overUnder.overOdds, underOdds: snap.overUnder.underOdds };
    else if (snap.pointspread) lock = { spread: snap.pointspread.spread, aOdds: snap.pointspread.locationAOdds, bOdds: snap.pointspread.locationBOdds };
    else if (snap.rangeOdds) lock = { bands: snap.rangeOdds.bands.slice(0, 8).map((b) => ({ label: String(b.label).slice(0, 24), odds: b.odds })) };
    if (lock && snap.capturedAt) lock.capturedAt = snap.capturedAt;
  }
  const graded = status === 'graded';
  const base: WowMarketRecord = {
    id: w.id,
    title: String(w.title ?? '').slice(0, 90),
    kind: w.kind,
    metric: w.metric,
    unit: metricUnit(w.kind === 'pointspread' ? (w.metricA ?? w.metric) : w.metric),
    status,
    lock,
    observed: graded && typeof w.observedValue === 'number' ? w.observedValue : null,
    winner: graded ? (w.winningOutcome ?? null) : null,
    station: null,
  };
  if (w.kind === 'pointspread') {
    base.metric = w.metricA ?? w.metric;
    if (w.metricB && w.metricB !== base.metric) base.metricB = w.metricB;
    base.aName = String(w.locationA.name ?? '').slice(0, 60);
    base.bName = String(w.locationB.name ?? '').slice(0, 60);
    base.observed = graded && typeof w.observedValueA === 'number' ? w.observedValueA : base.observed;
    base.observedB = graded && typeof w.observedValueB === 'number' ? w.observedValueB : null;
    base.station = w.locationA.stationId ?? null;
    base.stationB = w.locationB.stationId ?? null;
  } else {
    base.station = w.location.stationId ?? null;
  }
  return base;
}

// ── Building the record ─────────────────────────────────────────────────────

/** The board row fields the record reads (EnrichedScheduleGame satisfies this). */
export interface RecordGameInput {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUTC: string;
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: Venue;
  homeTeamVenue: Venue | null;
  awayVenue: Venue | null;
  neutralSite: boolean;
  venueIsGameSite: boolean;
  gameSiteName: string;
  roofStatus: 'open' | 'closed' | 'unknown';
  roofClosed: boolean;
  wes: { wesFinal: number; wesVersion: string } | null;
  wesIsFrozen: boolean;
  kickoffTimeTBD?: boolean;
}

export interface BuildGameRecordInput {
  league: GameRecordLeague;
  game: RecordGameInput;
  slug: string;
  feedId: string | null;
  /** `oddsfeed:close:<feedId>`, when held. */
  feedClose: StoredFeedLine | null;
  /** `oddsfeed:open:<feedId>`, when held. */
  feedOpen: StoredFeedLine | null;
  /** The board's frozen close (`closing-line:*`) or an archive row's lines: used only when the feed close is missing. */
  boardClose?: BoardLineInput | null;
  /** Our kickoff forecast snapshot, when one was saved before the game. */
  forecast?: { tempF: number; windSpeedMph: number; precipProbability: number; description?: string | null } | null;
  /** The NWS observation nearest kickoff, with its station. */
  observed?: { tempF: number; windSpeedMph: number | null; precipMmLastHour: number | null; textDescription?: string | null; stationId: string } | null;
  /** This game's weather markets, or null when they could not be read (then the previous list is kept and nothing freezes). */
  wagers: Wager[] | null;
  previous?: GameRecord | null;
  now: number;
}

/**
 * Build (or advance) one game's record. Pure.
 *
 * A frozen previous record is returned unchanged: once settled it is never
 * rewritten. Otherwise lines and weather already on the previous record are
 * kept when this pass cannot see them (the source keys expire), grading is
 * redone from the stored close once the game is final, and `frozenAt` is set
 * the first time the result is final (or postponed / cancelled) and every
 * market is graded or void.
 */
export function buildGameRecord(input: BuildGameRecordInput): GameRecord {
  const prev = input.previous ?? null;
  if (prev?.frozenAt) return prev;
  const g = input.game;
  const kickoffMs = Date.parse(g.kickoffUTC);
  const tbd = g.kickoffTimeTBD === true;
  const date = Number.isFinite(kickoffMs) ? etDateOf(kickoffMs) : prev?.date ?? '';
  const status = classifyGameStatus(g.state, g.statusDetail);
  const homeOwn = g.neutralSite ? g.homeTeamVenue : g.homeTeamVenue ?? g.venue;

  const ctx = { kickoffMs, kickoffTimeTBD: tbd, homeTeam: g.homeTeam, awayTeam: g.awayTeam, neutralSite: g.neutralSite, league: input.league };
  const close = snapshotFromFeedLine(input.feedClose, ctx)
    ?? snapshotFromBoardLine(input.boardClose ?? null, ctx)
    ?? prev?.sportsbook.close
    ?? null;
  const open = snapshotFromFeedLine(input.feedOpen, ctx) ?? prev?.sportsbook.open ?? null;

  const homeScore = status === 'final' ? g.homeScore : null;
  const awayScore = status === 'final' ? g.awayScore : null;
  const grades = gradeSportsbookLines({
    close: close?.lines ?? null,
    homeScore,
    awayScore,
    status,
    bookSidesReversed: close?.bookSidesReversed ?? false,
  });

  const wow = g.wesIsFrozen && g.wes && Number.isFinite(g.wes.wesFinal)
    ? { score: Math.round(g.wes.wesFinal), version: String(g.wes.wesVersion ?? '') }
    : prev?.weather.wow ?? null;
  const forecast = input.forecast && Number.isFinite(input.forecast.tempF)
    ? {
        tempF: input.forecast.tempF,
        windSpeedMph: input.forecast.windSpeedMph,
        precipProbability: input.forecast.precipProbability,
        description: input.forecast.description ? String(input.forecast.description).slice(0, 60) : null,
      }
    : prev?.weather.forecast ?? null;
  // Observed weather belongs to a game that was played: none for postponed or cancelled.
  const observed = status === 'final' && input.observed && Number.isFinite(input.observed.tempF) && input.observed.stationId
    ? {
        tempF: input.observed.tempF,
        windSpeedMph: input.observed.windSpeedMph ?? null,
        precipMmLastHour: input.observed.precipMmLastHour ?? null,
        description: input.observed.textDescription ? String(input.observed.textDescription).slice(0, 60) : null,
        stationId: String(input.observed.stationId).slice(0, 12),
      }
    : prev?.weather.observed ?? null;

  const markets = input.wagers ? input.wagers.map(marketRecordFromWager) : prev?.markets ?? [];
  const v = g.venueIsGameSite ? g.venue : null;

  const rec: GameRecord = {
    schemaVersion: GAME_RECORD_SCHEMA_VERSION,
    frozenAt: null,
    league: input.league,
    date,
    slug: input.slug,
    espnId: String(g.id),
    feedId: input.feedId ?? prev?.feedId ?? null,
    kickoff: Number.isFinite(kickoffMs) ? new Date(kickoffMs).toISOString() : prev?.kickoff ?? '',
    kickoffTimeTBD: tbd,
    home: { name: g.homeTeam, venueId: homeOwn?.id ?? '' },
    away: { name: g.awayTeam, venueId: g.awayVenue?.id ?? '' },
    neutralSite: g.neutralSite,
    venue: v ? { id: v.id, name: v.name, city: v.city, state: v.state, ...(v.zip ? { zip: v.zip } : {}), lat: v.lat, lon: v.lon, type: v.type } : null,
    siteName: g.gameSiteName || v?.name || '',
    roof: { status: g.roofStatus, closed: g.roofClosed },
    result: { status, detail: String(g.statusDetail ?? '').slice(0, 40), homeScore, awayScore },
    sportsbook: { open, close, grades },
    weather: { wow, forecast, observed },
    markets,
  };

  if (isReadyToFreeze(rec, input.wagers !== null)) rec.frozenAt = new Date(input.now).toISOString();
  return rec;
}

/**
 * The freeze rule: the result is settled (final with both scores, or
 * postponed, or cancelled), this pass could read the game's wagers, and every
 * market is graded or void.
 */
export function isReadyToFreeze(rec: GameRecord, wagersKnown: boolean): boolean {
  const r = rec.result;
  const settled = (r.status === 'final' && r.homeScore !== null && r.awayScore !== null) || r.status === 'postponed' || r.status === 'cancelled';
  return settled && wagersKnown && rec.markets.every((m) => m.status !== 'pending');
}

/**
 * A stored, not-yet-frozen record with its markets re-read: used for games
 * that have left the schedule window but whose wagers settle later (grading
 * runs the next morning). Frozen records come back unchanged. Pure.
 */
export function settleGameRecordMarkets(rec: GameRecord, wagers: Wager[] | null, now: number): GameRecord {
  if (rec.frozenAt) return rec;
  const next: GameRecord = { ...rec, markets: wagers ? wagers.map(marketRecordFromWager) : rec.markets };
  if (isReadyToFreeze(next, wagers !== null)) next.frozenAt = new Date(now).toISOString();
  return next;
}

/** True once the page may be indexed: a close and a final result are both held (WOW-031 4). */
export function gameRecordIndexable(rec: GameRecord): boolean {
  return !!rec.sportsbook.close && rec.result.status === 'final' && rec.result.homeScore !== null && rec.result.awayScore !== null;
}

/** The record as stored, with its size, and whether it is under the 8 KB cap. */
export function serializeGameRecord(rec: GameRecord): { json: string; bytes: number; ok: boolean } {
  const json = JSON.stringify(rec);
  const bytes = new TextEncoder().encode(json).length;
  return { json, bytes, ok: bytes <= GAME_RECORD_MAX_BYTES };
}

// ── "What stood out" (WOW-032 B) ────────────────────────────────────────────

/** Rule 2 and 3 thresholds, in the league's own scoring unit. */
export const MARGIN_THRESHOLD: Record<GameRecordLeague, number> = { nfl: 10, 'ncaa-football': 10, mlb: 4, mls: 2 };
const SCORE_UNIT: Record<GameRecordLeague, [string, string]> = {
  nfl: ['point', 'points'],
  'ncaa-football': ['point', 'points'],
  mlb: ['run', 'runs'],
  mls: ['goal', 'goals'],
};
/** Rule 1: the winner's closing moneyline at or beyond this price. */
export const UPSET_MIN_AMERICAN = 150;
/** Rule 4 thresholds. */
export const SPREAD_MOVE_MIN = 2.5;
export const TOTAL_MOVE_MIN = 3;
export const NFL_KEY_NUMBERS = [3, 7] as const;
/**
 * Rule 5 "observed value beat the line by a stated margin". The ruling gives
 * the example (gusts 31 mph against 18.5) but no number, so these are fixed
 * here and flagged for review: 10 °F for temperature, 10 mph for wind.
 */
export const WEATHER_MARGIN_MIN: Record<'°F' | 'mph', number> = { '°F': 10, mph: 10 };

function unitWord(league: GameRecordLeague, n: number): string {
  const [one, many] = SCORE_UNIT[league];
  return Math.abs(n) === 1 ? one : many;
}

function num(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** True when the move from a to b strictly passes +k or -k for any key number k. */
export function crossesKeyNumber(a: number, b: number, keys: readonly number[] = NFL_KEY_NUMBERS): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return keys.some((k) => (lo < k && k < hi) || (lo < -k && -k < hi));
}

/** Which side the line made the favourite: by the spread's sign, else by the shorter moneyline. */
function favoriteOf(l: MainLines): 'home' | 'away' | null {
  const p = homePointOf(l);
  if (p !== null && p !== 0) return p < 0 ? 'home' : 'away';
  if (l.moneylineHome !== null && l.moneylineAway !== null && l.moneylineHome !== l.moneylineAway) {
    const dh = americanToDecimal(l.moneylineHome);
    const da = americanToDecimal(l.moneylineAway);
    if (dh !== null && da !== null) return dh < da ? 'home' : 'away';
  }
  return null;
}

function stoodOutUpset(rec: GameRecord, close: MainLines): string | null {
  const ml = rec.sportsbook.grades?.moneyline;
  if (!ml || ml.winner === 'draw' || ml.winnerPrice === null || ml.winnerPrice < UPSET_MIN_AMERICAN) return null;
  const prices = [close.moneylineHome, close.moneylineAway, ...(close.moneylineDraw != null ? [close.moneylineDraw] : [])];
  if (prices.some((p) => p === null)) return null;
  const dec = (prices as number[]).map(americanToDecimal);
  if (dec.some((d) => d === null)) return null;
  const probs = noVigProbabilities(dec as number[]);
  if (!probs) return null;
  const p = probs[ml.winner === 'home' ? 0 : 1];
  const team = ml.winner === 'home' ? rec.home.name : rec.away.name;
  return `${team} won at ${formatAmerican(ml.winnerPrice)} on the closing moneyline, a no-vig implied probability of ${(p * 100).toFixed(1)}%.`;
}

function stoodOutSpread(rec: GameRecord): string | null {
  const s = rec.sportsbook.grades?.spread;
  if (!s) return null;
  const line = `${rec.home.name} ${formatPoint(s.homePoint)}`;
  if (s.margin === 0) return `The final margin landed exactly on the closing spread (${line}), a push.`;
  if (Math.abs(s.margin) < MARGIN_THRESHOLD[rec.league]) return null;
  const team = s.margin > 0 ? rec.home.name : rec.away.name;
  return `Against the closing spread (${line}), ${team} covered by ${num(Math.abs(s.margin))} ${unitWord(rec.league, s.margin)}.`;
}

function stoodOutTotal(rec: GameRecord): string | null {
  const t = rec.sportsbook.grades?.total;
  if (!t) return null;
  const u = unitWord(rec.league, t.combined);
  if (t.difference === 0) return `The teams combined for ${t.combined} ${u}, exactly the closing total of ${num(t.line)}.`;
  if (Math.abs(t.difference) < MARGIN_THRESHOLD[rec.league]) return null;
  return `The teams combined for ${t.combined} ${u}, ${num(Math.abs(t.difference))} ${t.difference > 0 ? 'over' : 'under'} the closing total of ${num(t.line)}.`;
}

function stoodOutMove(rec: GameRecord, open: MainLines, close: MainLines): string | null {
  const p0 = homePointOf(open);
  const p1 = homePointOf(close);
  const f0 = favoriteOf(open);
  const f1 = favoriteOf(close);
  const flipped = f0 !== null && f1 !== null && f0 !== f1;
  const spreadMoved = p0 !== null && p1 !== null && (
    Math.abs(p1 - p0) >= SPREAD_MOVE_MIN ||
    (rec.league === 'nfl' && crossesKeyNumber(p0, p1))
  );
  const t0 = open.total?.point ?? null;
  const t1 = close.total?.point ?? null;
  const totalMoved = t0 !== null && t1 !== null && Math.abs(t1 - t0) >= TOTAL_MOVE_MIN;
  const parts: string[] = [];
  if ((spreadMoved || flipped) && p0 !== null && p1 !== null) {
    parts.push(`the spread moved from ${rec.home.name} ${formatPoint(p0)} to ${rec.home.name} ${formatPoint(p1)}`);
  } else if (flipped) {
    const name = (s: 'home' | 'away') => (s === 'home' ? rec.home.name : rec.away.name);
    parts.push(`the moneyline favorite changed from ${name(f0!)} to ${name(f1!)}`);
  }
  if (totalMoved) parts.push(`the total moved from ${num(t0!)} to ${num(t1!)}`);
  if (!parts.length) return null;
  return `From open to close, ${parts.join(', and ')}.`;
}

function stoodOutWeather(rec: GameRecord): string | null {
  for (const m of rec.markets) {
    if (m.status !== 'graded' || !m.winner || m.winner === 'push') continue;
    const lock = m.lock;
    // Underdog at lock: the winning side's lock price was strictly the longer one.
    if (lock) {
      let won: number | undefined;
      let other: number | undefined;
      let side = '';
      if (m.kind === 'over-under' && lock.overOdds !== undefined && lock.underOdds !== undefined) {
        if (m.winner === 'over') { won = lock.overOdds; other = lock.underOdds; side = 'Over'; }
        if (m.winner === 'under') { won = lock.underOdds; other = lock.overOdds; side = 'Under'; }
      } else if (m.kind === 'pointspread' && lock.aOdds !== undefined && lock.bOdds !== undefined) {
        if (m.winner === 'locationA') { won = lock.aOdds; other = lock.bOdds; side = m.aName ?? 'Side A'; }
        if (m.winner === 'locationB') { won = lock.bOdds; other = lock.aOdds; side = m.bName ?? 'Side B'; }
      }
      const dw = won !== undefined ? americanToDecimal(won) : null;
      const doth = other !== undefined ? americanToDecimal(other) : null;
      if (dw !== null && doth !== null && dw > doth) {
        return `Weather market "${m.title}" settled on ${side}, the longer price at lock (${formatAmerican(won!)}).`;
      }
    }
    // Or the observed value beat the line by the fixed margin.
    if (m.kind === 'over-under' && lock?.line !== undefined && m.observed !== null) {
      const diff = m.observed - lock.line;
      if (Math.abs(diff) >= WEATHER_MARGIN_MIN[m.unit]) {
        return `Weather market "${m.title}": the observed value was ${num(m.observed)} ${m.unit} against a line of ${num(lock.line)} ${m.unit}.`;
      }
    }
    if (m.kind === 'pointspread' && lock?.spread !== undefined && m.observed !== null && m.observedB != null) {
      const adj = m.observed - m.observedB + lock.spread;
      if (Math.abs(adj) >= WEATHER_MARGIN_MIN[m.unit]) {
        return `Weather market "${m.title}": observed ${num(m.observed)} ${m.unit} against ${num(m.observedB)} ${m.unit}, with a spread of ${formatPoint(lock.spread)}.`;
      }
    }
  }
  return null;
}

/**
 * Up to three sentences from the fixed templates, in rule order (upset,
 * spread margin, total, line move, weather market). Empty when nothing meets
 * its threshold, and always empty for a game that is not final. Pure.
 */
export function whatStoodOut(rec: GameRecord): string[] {
  if (rec.result.status !== 'final') return [];
  const close = rec.sportsbook.close ? orientLines(rec.sportsbook.close.lines, rec.sportsbook.close.bookSidesReversed) : null;
  const open = rec.sportsbook.open ? orientLines(rec.sportsbook.open.lines, rec.sportsbook.open.bookSidesReversed) : null;
  const out = [
    close ? stoodOutUpset(rec, close) : null,
    stoodOutSpread(rec),
    stoodOutTotal(rec),
    open && close ? stoodOutMove(rec, open, close) : null,
    stoodOutWeather(rec),
  ].filter((s): s is string => !!s);
  return out.slice(0, 3);
}

// ── Choosing a game's markets ───────────────────────────────────────────────

/** Statuses a record shows: open and locked read "Result pending"; graded and void are results. */
export function isRecordableWagerStatus(s: Wager['status']): boolean {
  return s === 'open' || s === 'locked' || s === 'graded' || s === 'void';
}
