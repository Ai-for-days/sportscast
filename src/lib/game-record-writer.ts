// ── The hourly writer for the permanent game records (WOW-032 B) ──────────
//
// Called from /api/cron/archive-games, which already walks every league's
// current slate each hour. Two passes:
//
//  1. Slate pass. Every NFL and college-football game ESPN reports as final,
//     postponed or cancelled gets its record built (or advanced) from what we
//     hold: the ingest-time close and open (odds-feed-store.ts), the board's
//     frozen line as a fallback, the frozen WOW Score, our kickoff forecast
//     snapshot, the NWS observation nearest kickoff, and the game's weather
//     markets. Games still in progress are left alone.
//  2. Pending pass. Records not yet frozen whose games have left the schedule
//     window (the wagers grade the next morning) get their markets re-read.
//
// A frozen record is never rewritten. A record whose JSON did not change is
// not rewritten either, so the repeated hourly runs cost reads, not writes.
// Every dependency is injected so the whole thing runs against a fake in tests.

import type { EnrichedScheduleGame, SiteLeague } from './league-schedule';
import type { Venue } from './types';
import type { Wager } from './wager-types';
import {
  GAME_RECORD_LEAGUES, buildGameRecord, classifyGameStatus, etDateOf, gameRecordKey, gameRecordSlug,
  isRecordableWagerStatus, parseGameRecordKey, serializeGameRecord, settleGameRecordMarkets,
  type BoardLineInput, type BuildGameRecordInput, type GameRecord, type GameRecordLeague, type StoredFeedLine,
} from './game-record';
import { getGameRecords, writeGameRecord, pendingGameRecordKeys, dropPending, type GameRecordRedis } from './game-record-store';
import { feedCloseKey, feedOpenKey } from './odds-feed-store';
import { closingOddsKey, type ClosingOddsRecord } from './game-closing-odds';
import { kickoffSnapshotKey, type KickoffSnapshot } from './game-forecast-accuracy';
import { isTempMetric, locationMatchesVenue } from './weatherboard-markets';
import { getVenueById } from './venue-data';

/** Give up re-reading a record's markets after this long; it stays unfrozen. */
export const PENDING_GIVE_UP_MS = 21 * 86400_000;

export interface ObservedAtKickoff {
  tempF: number;
  windSpeedMph: number | null;
  precipMmLastHour: number | null;
  textDescription: string | null;
  stationId: string;
}

export interface GameRecordWriterDeps {
  redis: GameRecordRedis;
  getWagersByDate: (date: string) => Promise<Wager[]>;
  observe: (venue: Venue, kickoffMs: number) => Promise<ObservedAtKickoff | null>;
  now: () => number;
  log: (msg: string) => void;
}

export interface WriterSummary {
  considered: number;
  written: number;
  unchanged: number;
  frozen: number;
  alreadyFrozen: number;
  tooLarge: string[];
  skipped: { id: string; reason: string }[];
  keys: string[];
}

/**
 * A game's weather markets: pointspreads touching either venue and
 * over/unders at either venue on the board's temperature metrics (the same
 * selection /wagers/game uses), but including graded and void markets, since
 * the record exists to show how they settled.
 */
export function selectGameWagers(dayWagers: readonly Wager[], site: Venue | null, away: Venue | null): Wager[] {
  return dayWagers.filter((w) => {
    if (!isRecordableWagerStatus(w.status)) return false;
    if (w.kind === 'pointspread') {
      if (!isTempMetric(w.metricA ?? w.metric) || !isTempMetric(w.metricB ?? w.metric)) return false;
      return [w.locationA, w.locationB].some((l) => locationMatchesVenue(l, site) || locationMatchesVenue(l, away));
    }
    if (w.kind === 'over-under') {
      if (!isTempMetric(w.metric)) return false;
      return locationMatchesVenue(w.location, site) || locationMatchesVenue(w.location, away);
    }
    return false;
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function parseJson<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  try {
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
  } catch {
    return null;
  }
}

async function mgetJson<T>(redis: GameRecordRedis, keys: string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const uniq = [...new Set(keys)];
  if (!uniq.length) return out;
  try {
    const raw = (await redis.mget(...uniq)) as unknown[];
    uniq.forEach((k, i) => {
      const v = parseJson<T>(raw?.[i]);
      if (v) out.set(k, v);
    });
  } catch {
    /* treated as absent; a later run retries */
  }
  return out;
}

function wagersFor(deps: GameRecordWriterDeps) {
  const cache = new Map<string, Promise<Wager[] | null>>();
  return (date: string) => {
    if (!cache.has(date)) cache.set(date, deps.getWagersByDate(date).catch(() => null));
    return cache.get(date)!;
  };
}

/** The home team's own park: its slug side. At a neutral site that is not the game venue. */
function homeOwnVenue(g: EnrichedScheduleGame): Venue | null {
  return g.neutralSite ? g.homeTeamVenue : g.homeTeamVenue ?? g.venue;
}

async function persist(
  rec: GameRecord,
  prev: GameRecord | null,
  deps: GameRecordWriterDeps,
  sum: WriterSummary,
): Promise<void> {
  const before = prev ? serializeGameRecord(prev).json : null;
  if (before !== null && before === serializeGameRecord(rec).json) {
    sum.unchanged += 1;
    return;
  }
  const { outcome } = await writeGameRecord(rec, deps.redis, deps.log);
  if (outcome === 'too-large') {
    sum.tooLarge.push(`${rec.league}:${rec.date}:${rec.slug}`);
    return;
  }
  sum.written += 1;
  if (rec.frozenAt) sum.frozen += 1;
}

/** Slate pass: build or advance the record of every finished NFL / CFB game in the window. */
export async function writeGameRecordsForSlate(
  entries: readonly { league: SiteLeague; game: EnrichedScheduleGame }[],
  deps: GameRecordWriterDeps,
): Promise<WriterSummary> {
  const sum: WriterSummary = { considered: 0, written: 0, unchanged: 0, frozen: 0, alreadyFrozen: 0, tooLarge: [], skipped: [], keys: [] };
  type Cand = { league: GameRecordLeague; g: EnrichedScheduleGame; date: string; base: string; slug: string; key: string };
  const cands: Cand[] = [];
  for (const { league, game: g } of entries) {
    if (!GAME_RECORD_LEAGUES.includes(league as GameRecordLeague)) continue;
    const status = classifyGameStatus(g.state, g.statusDetail);
    if (status !== 'final' && status !== 'postponed' && status !== 'cancelled') continue;
    sum.considered += 1;
    const kickoffMs = Date.parse(g.kickoffUTC);
    if (!Number.isFinite(kickoffMs)) { sum.skipped.push({ id: g.id, reason: 'no kickoff time' }); continue; }
    const base = gameRecordSlug(g.awayVenue, homeOwnVenue(g));
    if (!base) { sum.skipped.push({ id: g.id, reason: 'a team without a tracked venue' }); continue; }
    const date = etDateOf(kickoffMs);
    cands.push({ league: league as GameRecordLeague, g, date, base, slug: base, key: gameRecordKey(league as GameRecordLeague, date, base) });
  }
  if (!cands.length) return sum;

  // Second game on the same date and matchup: -g2 (a doubleheader, or a key already held by another game).
  const existing = new Map<string, GameRecord | null>();
  const load = async (keys: string[]) => {
    const want = keys.filter((k) => !existing.has(k));
    if (!want.length) return;
    const recs = await getGameRecords(want, deps.redis);
    want.forEach((k, i) => existing.set(k, recs[i]));
  };
  await load(cands.map((c) => c.key));
  const claimed = new Map<string, string>(); // key -> espn id
  for (const c of cands) {
    const held = existing.get(c.key);
    const takenBy = claimed.get(c.key) ?? held?.espnId;
    if (takenBy && takenBy !== String(c.g.id)) {
      c.slug = gameRecordSlug(c.g.awayVenue, homeOwnVenue(c.g), 2)!;
      c.key = gameRecordKey(c.league, c.date, c.slug);
    }
    claimed.set(c.key, String(c.g.id));
  }
  await load(cands.map((c) => c.key));

  const live = cands.filter((c) => {
    const prev = existing.get(c.key) ?? null;
    if (prev?.frozenAt) { sum.alreadyFrozen += 1; sum.keys.push(c.key); return false; }
    return true;
  });
  if (!live.length) return sum;

  const feedIds = live.map((c) => c.g.lines?.feedGameId ?? null);
  const feedLines = await mgetJson<StoredFeedLine>(deps.redis, feedIds.flatMap((id) => (id ? [feedCloseKey(id), feedOpenKey(id)] : [])));
  const boardKeys = live.map((c) => closingOddsKey(c.g.venue?.id ?? '', c.g.kickoffUTC));
  const boards = await mgetJson<ClosingOddsRecord>(deps.redis, boardKeys.filter((k): k is string => !!k));
  const snaps = await mgetJson<KickoffSnapshot>(deps.redis, live.map((c) => kickoffSnapshotKey(c.g.id)));
  const dayWagers = wagersFor(deps);

  for (let i = 0; i < live.length; i++) {
    const c = live[i];
    const g = c.g;
    const prev = existing.get(c.key) ?? null;
    const feedId = feedIds[i];
    const board = boardKeys[i] ? boards.get(boardKeys[i]!) : undefined;
    const site = g.venueIsGameSite ? g.venue : null;
    const day = await dayWagers(c.date);
    let observed: ObservedAtKickoff | null = null;
    if (!prev?.weather.observed && site && site.type !== 'indoor' && !g.roofClosed && classifyGameStatus(g.state, g.statusDetail) === 'final') {
      observed = await deps.observe(site, Date.parse(g.kickoffUTC)).catch(() => null);
    }
    const snap = snaps.get(kickoffSnapshotKey(g.id));
    const input: BuildGameRecordInput = {
      league: c.league,
      game: g,
      slug: c.slug,
      feedId,
      feedClose: feedId ? feedLines.get(feedCloseKey(feedId)) ?? null : null,
      feedOpen: feedId ? feedLines.get(feedOpenKey(feedId)) ?? null : null,
      boardClose: board ? ({ lines: board.lines, capturedAt: board.capturedAt ?? null, origin: 'board-freeze' } satisfies BoardLineInput) : null,
      forecast: snap ? { tempF: snap.tempF, windSpeedMph: snap.windSpeedMph, precipProbability: snap.precipProbability, description: snap.description } : null,
      observed,
      wagers: day ? selectGameWagers(day, site, g.awayVenue) : null,
      previous: prev,
      now: deps.now(),
    };
    const rec = buildGameRecord(input);
    sum.keys.push(c.key);
    await persist(rec, prev, deps, sum);
  }
  return sum;
}

/** Pending pass: re-read the markets of unfrozen records the slate pass did not see. */
export async function refreshPendingGameRecords(
  skipKeys: ReadonlySet<string>,
  deps: GameRecordWriterDeps,
): Promise<{ checked: number; written: number; frozen: number; gaveUp: number; tooLarge: string[] }> {
  const out = { checked: 0, written: 0, frozen: 0, gaveUp: 0, tooLarge: [] as string[] };
  const pending = await pendingGameRecordKeys(200, deps.redis);
  const now = deps.now();
  const stale = pending.filter((p) => now - p.kickoffMs > PENDING_GIVE_UP_MS).map((p) => p.key);
  if (stale.length) {
    await dropPending(stale, deps.redis);
    out.gaveUp = stale.length;
  }
  const keys = pending.map((p) => p.key).filter((k) => !skipKeys.has(k) && !stale.includes(k) && parseGameRecordKey(k));
  if (!keys.length) return out;
  const recs = await getGameRecords(keys, deps.redis);
  const dayWagers = wagersFor(deps);
  const sum: WriterSummary = { considered: 0, written: 0, unchanged: 0, frozen: 0, alreadyFrozen: 0, tooLarge: [], skipped: [], keys: [] };
  for (const rec of recs) {
    if (!rec) continue;
    out.checked += 1;
    if (rec.frozenAt) {
      await dropPending([`gamerec:${rec.league}:${rec.date}:${rec.slug}`], deps.redis);
      continue;
    }
    const day = await dayWagers(rec.date);
    const site = rec.venue ? getVenueById(rec.venue.id) ?? null : null;
    const away = rec.away.venueId ? getVenueById(rec.away.venueId) ?? null : null;
    const next = settleGameRecordMarkets(rec, day ? selectGameWagers(day, site, away) : null, now);
    await persist(next, rec, deps, sum);
  }
  out.written = sum.written;
  out.frozen = sum.frozen;
  out.tooLarge = sum.tooLarge;
  return out;
}

/** Production dependencies. Imported lazily so tests never touch the real client or the network. */
export async function liveWriterDeps(): Promise<GameRecordWriterDeps> {
  const [{ getRedis }, { getWagersByDate }, { resolveStation, fetchObservationNear }] = await Promise.all([
    import('./redis'),
    import('./wager-store'),
    import('./forecast-observed-floor'),
  ]);
  return {
    redis: getRedis(),
    getWagersByDate,
    observe: async (venue, kickoffMs) => {
      const stationId = await resolveStation(venue.lat, venue.lon);
      if (!stationId) return null;
      const obs = await fetchObservationNear(stationId, kickoffMs);
      return obs ? { tempF: obs.tempF, windSpeedMph: obs.windSpeedMph, precipMmLastHour: obs.precipMmLastHour, textDescription: obs.textDescription, stationId } : null;
    },
    now: () => Date.now(),
    log: (m) => console.warn(m),
  };
}
