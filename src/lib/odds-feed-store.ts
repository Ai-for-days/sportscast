// Storage for the pushed sportsbook feed (2026-10-13). See odds-feed.ts for the format.
//
// Redis keys (all ids are the feed's game / market ids):
//   oddsfeed:game:<id>       the full game, every market (one scraper push, ~15 min)
//   oddsfeed:live:<id>       in-game main lines only (live pusher, every ~20s while they move)
//   oddsfeed:sig:<id>        hash marketId -> price signature, so history only grows on a change
//   oddsfeed:hist:<id>       hash marketId -> line-movement points, capped per market
//   oddsfeed:summary:<lg>    hash gameId -> what the Weatherboard needs: teams, start, main lines
//   oddsfeed:last-ingest     when anything last arrived, for staleness + health
//   oddsfeed:rejected        the last 100 refused games, for the admin page
//
// Cost is deliberately per CHANGED game: the scraper only sends games whose
// prices moved, live updates touch only the small live key, and history reads
// and writes only the markets that changed.
//
// A full push with zero markets is refused and the stored game kept (Derek,
// 2026-10-13: "make sure an empty result never overwrites a good snapshot").
// A live push merges markets in and never removes one.

import { getRedis } from './redis';
import {
  appendHistory, historyPointFor, mainLinesFromGame, marketCount, marketSignature,
  type FeedGame, type FeedLines, type FeedPayload, type FeedSeen, type HistoryPoint,
} from './odds-feed';

const GAME_TTL = 10 * 86400;
const LIVE_TTL = 86400;
const SUMMARY_KEEP_AFTER_START_MS = 36 * 3600_000;
const REJECTED_KEEP = 100;

const k = {
  game: (id: string) => `oddsfeed:game:${id}`,
  live: (id: string) => `oddsfeed:live:${id}`,
  sig: (id: string) => `oddsfeed:sig:${id}`,
  hist: (id: string) => `oddsfeed:hist:${id}`,
  summary: (league: string) => `oddsfeed:summary:${league}`,
  lastIngest: 'oddsfeed:last-ingest',
  rejected: 'oddsfeed:rejected',
};

/** One feed game as the Weatherboard sees it. */
export interface FeedSummary {
  id: string;
  league: string;
  startTime: number;
  description: string;
  home: string;
  away: string;
  homeShort: string | null;
  awayShort: string | null;
  /** Main lines from the latest full push. */
  lines: FeedLines | null;
  /** Main lines from the latest live push (game in progress). */
  liveLines: FeedLines | null;
  marketCount: number;
  groups: string[];
  /** Last full push that carried this game, and last time either source confirmed it unchanged. */
  fullAt: number | null;
  seenAt: number;
  liveAt: number | null;
  liveSeenAt: number | null;
}

export interface LastIngest {
  at: number;
  source: 'scraper' | 'live';
  games: number;
  stored: number;
  rejected: number;
}

function parse<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return raw as T;
}

function teamsOf(game: FeedGame) {
  const home = game.competitors.find((c) => c.home);
  const away = game.competitors.find((c) => !c.home);
  return { home: home?.name ?? '', away: away?.name ?? '', homeShort: home?.shortName ?? null, awayShort: away?.shortName ?? null };
}

/** Diff a game's markets against their stored signatures and extend the history of those that moved. */
async function recordMovement(game: FeedGame, at: number): Promise<number> {
  const redis = getRedis();
  const markets = game.groups.flatMap((g) => g.markets);
  if (!markets.length) return 0;
  const stored = ((await redis.hgetall(k.sig(game.id))) ?? {}) as Record<string, unknown>;
  const changed = markets.filter((m) => String(stored[m.id] ?? '') !== marketSignature(m));
  if (!changed.length) return 0;
  const ids = changed.map((m) => m.id);
  const existing = (await redis.hmget(k.hist(game.id), ...ids)) as Record<string, unknown> | null;
  const hist: Record<string, string> = {};
  const sigs: Record<string, string> = {};
  for (const m of changed) {
    hist[m.id] = JSON.stringify(appendHistory(parse<HistoryPoint[]>(existing?.[m.id]), historyPointFor(m, at)));
    sigs[m.id] = marketSignature(m);
  }
  const p = redis.pipeline();
  p.hset(k.hist(game.id), hist);
  p.hset(k.sig(game.id), sigs);
  p.expire(k.hist(game.id), GAME_TTL);
  p.expire(k.sig(game.id), GAME_TTL);
  await p.exec();
  return changed.length;
}

export interface IngestResult {
  stored: number;
  moved: number;
  rejected: { id: string; reason: string }[];
}

/** Store one validated push. */
export async function ingestFeed(payload: FeedPayload, now = Date.now()): Promise<IngestResult> {
  const redis = getRedis();
  const result: IngestResult = { stored: 0, moved: 0, rejected: [] };

  // Current summaries for every league touched, so each game merges with what we hold.
  const leagues = [...new Set([...payload.games.map((g) => g.league), ...payload.seen.map((s) => s.league)])];
  const summaries = new Map<string, Record<string, FeedSummary>>();
  for (const league of leagues) {
    const raw = ((await redis.hgetall(k.summary(league))) ?? {}) as Record<string, unknown>;
    const m: Record<string, FeedSummary> = {};
    for (const [id, v] of Object.entries(raw)) {
      const s = parse<FeedSummary>(v);
      if (s) m[id] = s;
    }
    summaries.set(league, m);
  }
  const dirty = new Map<string, Record<string, string>>();
  const markDirty = (league: string, s: FeedSummary) => {
    const d = dirty.get(league) ?? {};
    d[s.id] = JSON.stringify(s);
    dirty.set(league, d);
  };

  for (const game of payload.games) {
    const prev = summaries.get(game.league)?.[game.id];
    const count = marketCount(game);
    if (game.scope === 'full' && count === 0) {
      result.rejected.push({ id: game.id, reason: prev ? 'no markets in this push; kept the stored copy' : 'no markets in this push' });
      continue;
    }
    const t = teamsOf(game);
    const base: FeedSummary = prev ?? {
      id: game.id, league: game.league, startTime: game.startTime, description: game.description,
      home: t.home, away: t.away, homeShort: t.homeShort, awayShort: t.awayShort,
      lines: null, liveLines: null, marketCount: 0, groups: [], fullAt: null, seenAt: now, liveAt: null, liveSeenAt: null,
    };
    const next: FeedSummary = { ...base, startTime: game.startTime, description: game.description, ...t };
    if (game.scope === 'full') {
      await redis.set(k.game(game.id), JSON.stringify({ ...game, receivedAt: now }), { ex: GAME_TTL });
      Object.assign(next, {
        lines: mainLinesFromGame(game, now),
        marketCount: count,
        groups: game.groups.filter((g) => g.markets.length).map((g) => g.description),
        fullAt: now,
        seenAt: now,
      });
    } else {
      await redis.set(k.live(game.id), JSON.stringify({ ...game, receivedAt: now }), { ex: LIVE_TTL });
      Object.assign(next, { liveLines: mainLinesFromGame(game, now), liveAt: now, liveSeenAt: now });
      if (!prev) next.seenAt = now;
    }
    result.moved += await recordMovement(game, now);
    summaries.get(game.league)![game.id] = next;
    markDirty(game.league, next);
    result.stored += 1;
  }

  // Unchanged games are still on offer: keep them fresh without resending them.
  for (const s of payload.seen) {
    const cur = summaries.get(s.league)?.[s.id];
    if (!cur) continue;
    if (payload.source === 'live') cur.liveSeenAt = now;
    else cur.seenAt = now;
    markDirty(s.league, cur);
  }

  const p = redis.pipeline();
  for (const [league, fields] of dirty) p.hset(k.summary(league), fields);
  // Finished games drop off the summary once the full scrape runs.
  if (payload.source === 'scraper') {
    for (const [league, m] of summaries) {
      const old = Object.values(m).filter((s) => s.startTime < now - SUMMARY_KEEP_AFTER_START_MS).map((s) => s.id);
      if (old.length) p.hdel(k.summary(league), ...old);
    }
  }
  const last: LastIngest = { at: now, source: payload.source, games: payload.games.length, stored: result.stored, rejected: result.rejected.length };
  p.set(k.lastIngest, JSON.stringify(last));
  for (const r of result.rejected) p.lpush(k.rejected, JSON.stringify({ ...r, at: now }));
  if (result.rejected.length) p.ltrim(k.rejected, 0, REJECTED_KEEP - 1);
  await p.exec();
  return result;
}

export async function getLastIngest(): Promise<LastIngest | null> {
  try {
    return parse<LastIngest>(await getRedis().get(k.lastIngest));
  } catch {
    return null;
  }
}

export async function getRecentRejections(limit = 50): Promise<{ id: string; reason: string; at: number }[]> {
  try {
    const raw = await getRedis().lrange(k.rejected, 0, limit - 1);
    return raw.map((r) => parse<{ id: string; reason: string; at: number }>(r)).filter((r): r is { id: string; reason: string; at: number } => !!r);
  } catch {
    return [];
  }
}

// Board renders call this once per league; a short in-process cache and
// in-flight sharing keep a page that renders four leagues to four reads.
const SUMMARY_CACHE_MS = 10_000;
const summaryCache = new Map<string, { at: number; value: FeedSummary[] }>();
const summaryInFlight = new Map<string, Promise<FeedSummary[]>>();

export async function getFeedSummaries(league: string): Promise<FeedSummary[]> {
  const hit = summaryCache.get(league);
  if (hit && Date.now() - hit.at < SUMMARY_CACHE_MS) return hit.value;
  const pending = summaryInFlight.get(league);
  if (pending) return pending;
  const p = (async () => {
    try {
      const raw = ((await getRedis().hgetall(k.summary(league))) ?? {}) as Record<string, unknown>;
      const value = Object.values(raw).map((v) => parse<FeedSummary>(v)).filter((s): s is FeedSummary => !!s);
      summaryCache.set(league, { at: Date.now(), value });
      return value;
    } catch {
      return [];
    } finally {
      summaryInFlight.delete(league);
    }
  })();
  summaryInFlight.set(league, p);
  return p;
}

export async function getFeedSummary(league: string, id: string): Promise<FeedSummary | null> {
  try {
    return parse<FeedSummary>(await getRedis().hget(k.summary(league), id));
  } catch {
    return null;
  }
}

/** The full game for the game page, with the newest in-game lines merged in. */
export async function getFeedGame(id: string): Promise<{ game: FeedGame & { receivedAt?: number }; live: (FeedGame & { receivedAt?: number }) | null } | null> {
  try {
    const [game, live] = (await getRedis().mget(k.game(id), k.live(id))) as unknown[];
    const g = parse<FeedGame & { receivedAt?: number }>(game);
    if (!g) return null;
    return { game: g, live: parse<FeedGame & { receivedAt?: number }>(live) };
  } catch {
    return null;
  }
}

export async function getMarketHistory(id: string, marketIds: string[]): Promise<Record<string, HistoryPoint[]>> {
  if (!marketIds.length) return {};
  try {
    const raw = (await getRedis().hmget(k.hist(id), ...marketIds)) as Record<string, unknown> | null;
    const out: Record<string, HistoryPoint[]> = {};
    for (const m of marketIds) out[m] = parse<HistoryPoint[]>(raw?.[m]) ?? [];
    return out;
  } catch {
    return {};
  }
}
