// ── Redis storage for the permanent game records (WOW-031 4, WOW-032 B) ───
//
// Keys:
//   gamerec:<league>:<YYYY-MM-DD>:<slug>   one record, JSON, NO TTL (target <= 4 KB, never over 8 KB)
//   gamerec:index:<league>                 sorted set: record key, scored by kickoff (epoch ms)
//   gamerec:pending                        sorted set: records not yet frozen, scored by kickoff
//   gamerec:sitemap:<league>               sorted set: page path of each frozen, indexable record,
//                                          scored by frozenAt (epoch ms), the sitemap's only lastmod
//
// Cost: one pipelined write (SET + 2-3 ZADD/ZREM) per changed record, one GET
// per page view (frozen pages are edge-cached for a day), one ZRANGE per
// league for the sitemap and for a date page's links. Nothing here scans keys.
//
// A record over GAME_RECORD_MAX_BYTES is never written. The writer logs it
// instead, so an oversized record shows in the cron's logs and response
// rather than silently growing the database.

import { getRedis } from './redis';
import {
  GAME_RECORD_MAX_BYTES, GAME_SITEMAP_LEAGUES, gameRecordIndexable, gameRecordKey, gameRecordPath, serializeGameRecord,
  type GameRecord, type GameRecordLeague,
} from './game-record';

/** The Redis calls this module makes: the real client in production, a fake in tests. */
export type GameRecordRedis = Pick<ReturnType<typeof getRedis>, 'get' | 'mget' | 'set' | 'zadd' | 'zrem' | 'zrange' | 'pipeline'>;

export const recordIndexKey = (league: GameRecordLeague) => `gamerec:index:${league}`;
export const RECORD_PENDING_KEY = 'gamerec:pending';
export const recordSitemapKey = (league: GameRecordLeague) => `gamerec:sitemap:${league}`;

export function keyOfRecord(rec: Pick<GameRecord, 'league' | 'date' | 'slug'>): string {
  return gameRecordKey(rec.league, rec.date, rec.slug);
}

function parseRecord(raw: unknown): GameRecord | null {
  if (raw === null || raw === undefined) return null;
  try {
    const r = (typeof raw === 'string' ? JSON.parse(raw) : raw) as GameRecord;
    return r && typeof r === 'object' && typeof r.schemaVersion === 'number' ? r : null;
  } catch {
    return null;
  }
}

export async function getGameRecord(key: string, redis: GameRecordRedis = getRedis()): Promise<GameRecord | null> {
  try {
    return parseRecord(await redis.get(key));
  } catch {
    return null;
  }
}

/** Records for many keys in one MGET, in key order (null where absent). */
export async function getGameRecords(keys: readonly string[], redis: GameRecordRedis = getRedis()): Promise<(GameRecord | null)[]> {
  if (keys.length === 0) return [];
  const raw = (await redis.mget(...keys)) as unknown[];
  return keys.map((_, i) => parseRecord(raw?.[i]));
}

export type WriteOutcome = 'written' | 'too-large';

/**
 * Store one record, its index entry and its pending / sitemap membership, in
 * one pipeline. Refuses (and logs) a record over the 8 KB cap. The record
 * itself gets no TTL; this is the permanent copy.
 */
export async function writeGameRecord(
  rec: GameRecord,
  redis: GameRecordRedis = getRedis(),
  log: (msg: string) => void = (m) => console.warn(m),
): Promise<{ outcome: WriteOutcome; bytes: number }> {
  const { json, bytes, ok } = serializeGameRecord(rec);
  const key = keyOfRecord(rec);
  if (!ok) {
    log(`[game-record] not written: ${key} is ${bytes} bytes, over the ${GAME_RECORD_MAX_BYTES}-byte cap`);
    return { outcome: 'too-large', bytes };
  }
  const kickoff = Date.parse(rec.kickoff);
  const score = Number.isFinite(kickoff) ? kickoff : 0;
  const p = redis.pipeline();
  p.set(key, json);
  p.zadd(recordIndexKey(rec.league), { score, member: key });
  if (rec.frozenAt) {
    p.zrem(RECORD_PENDING_KEY, key);
    if (GAME_SITEMAP_LEAGUES.includes(rec.league) && gameRecordIndexable(rec)) {
      p.zadd(recordSitemapKey(rec.league), { score: Date.parse(rec.frozenAt), member: gameRecordPath(rec.league, rec.date, rec.slug) });
    }
  } else {
    p.zadd(RECORD_PENDING_KEY, { score, member: key });
  }
  await p.exec();
  return { outcome: 'written', bytes };
}

/** Record keys for one league with kickoff in [fromMs, toMs]. Empty on any failure. */
export async function gameRecordKeysInRange(
  league: GameRecordLeague,
  fromMs: number,
  toMs: number,
  redis: GameRecordRedis = getRedis(),
): Promise<string[]> {
  try {
    const raw = (await redis.zrange(recordIndexKey(league), fromMs, toMs, { byScore: true })) as unknown[];
    return (raw ?? []).map(String);
  } catch {
    return [];
  }
}

/** The oldest not-yet-frozen record keys. */
export async function pendingGameRecordKeys(limit = 200, redis: GameRecordRedis = getRedis()): Promise<{ key: string; kickoffMs: number }[]> {
  const raw = (await redis.zrange(RECORD_PENDING_KEY, 0, limit - 1, { withScores: true })) as unknown[];
  const out: { key: string; kickoffMs: number }[] = [];
  for (let i = 0; i + 1 < (raw ?? []).length; i += 2) out.push({ key: String(raw[i]), kickoffMs: Number(raw[i + 1]) });
  return out;
}

export async function dropPending(keys: readonly string[], redis: GameRecordRedis = getRedis()): Promise<void> {
  if (keys.length) await redis.zrem(RECORD_PENDING_KEY, ...keys);
}

/** Sitemap entries: frozen, indexable game pages with their frozenAt. Empty on any failure. */
export async function getSitemapGameEntries(
  leagues: readonly GameRecordLeague[] = GAME_SITEMAP_LEAGUES,
  redis: GameRecordRedis = getRedis(),
): Promise<{ path: string; lastmod: string }[]> {
  const out: { path: string; lastmod: string }[] = [];
  for (const league of leagues) {
    try {
      const raw = (await redis.zrange(recordSitemapKey(league), 0, -1, { withScores: true })) as unknown[];
      for (let i = 0; i + 1 < (raw ?? []).length; i += 2) {
        const ms = Number(raw[i + 1]);
        if (!Number.isFinite(ms) || ms <= 0) continue;
        out.push({ path: String(raw[i]), lastmod: new Date(ms).toISOString() });
      }
    } catch {
      /* a league whose set cannot be read is simply left out */
    }
  }
  return out;
}
