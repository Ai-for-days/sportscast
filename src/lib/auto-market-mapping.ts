// ── Game-to-wager pointers for the auto-market engines ────────────────────
//
// Each engine remembers which wager it created for a given game in a Redis key
// shaped `<namespace>:<league>:<gameId>` holding the wager id, with a 90-day
// TTL (MAP_TTL_SECONDS in auto-market-shared.ts). That pointer is what stops
// the engines creating a duplicate market on every 30-minute tick.
//
// The problem this file solves, found 2026-08-27: voiding or deleting an
// auto-created market does NOT clear its pointer. The engine keeps finding it
// and skipping, with "wager already void" or "mapped wager missing or not
// auto-managed", so that game gets no replacement market for the remaining 90
// days. That is how the Faurot Field game on 2026-09-11 silently lost its
// market for good, while its sibling at David Booth, left alone, repriced
// itself correctly the moment the forecast reached that date.
//
// Nothing here creates, prices, or cancels a market. Clearing a pointer only
// makes a game eligible for the engines again on their next tick.

import { getRedis } from './redis';

/**
 * Every namespace the engines key their pointers under. If a new auto-market
 * type is added, it MUST be listed here or its orphans become unreachable.
 *   autohvl     — auto-hvl-market.ts (cross-venue High vs Low)
 *   autohvh/lvl — auto-cross-venue-market.ts (High vs High, Low vs Low)
 *   autoou      — auto-venue-ou-market.ts (per-venue temp at game start)
 */
export const AUTO_MARKET_NAMESPACES = [
  'autohvl:game',
  'autohvh:game',
  'autolvl:game',
  'autoou:home:game',
  'autoou:away:game',
] as const;

export interface AutoMarketMapping {
  /** Full Redis key, e.g. "autoou:home:game:mlb:823666". */
  key: string;
  /** Which engine owns it. */
  namespace: string;
  league: string;
  gameId: string;
  /** The wager id it points at. */
  wagerId: string;
}

/** How many keys to read back per MGET. Keeps one round trip bounded. */
const READ_BATCH = 200;

function parseKey(key: string, namespace: string): { league: string; gameId: string } {
  const rest = key.slice(namespace.length + 1);
  const cut = rest.indexOf(':');
  return cut === -1
    ? { league: rest, gameId: '' }
    : { league: rest.slice(0, cut), gameId: rest.slice(cut + 1) };
}

/** Every pointer key currently living under one namespace. */
async function scanNamespace(namespace: string): Promise<string[]> {
  const redis = getRedis();
  const keys: string[] = [];
  let cursor = '0';
  // Bounded so a pathological keyspace cannot spin here forever.
  for (let pass = 0; pass < 100; pass++) {
    const [next, batch] = await redis.scan(cursor, { match: `${namespace}:*`, count: 500 }) as [string, string[]];
    keys.push(...batch);
    cursor = String(next);
    if (cursor === '0') break;
  }
  return keys;
}

/**
 * Find every pointer aimed at a given wager. Usually one, but a wager could in
 * principle be referenced by more than one engine, so this returns all of them
 * rather than stopping at the first.
 *
 * Wagers do not store their own gameId, which is why this scans rather than
 * looking anything up directly.
 */
export async function findMappingsForWager(wagerId: string): Promise<AutoMarketMapping[]> {
  if (!wagerId) return [];
  const redis = getRedis();
  const found: AutoMarketMapping[] = [];

  for (const namespace of AUTO_MARKET_NAMESPACES) {
    const keys = await scanNamespace(namespace);
    for (let i = 0; i < keys.length; i += READ_BATCH) {
      const slice = keys.slice(i, i + READ_BATCH);
      if (slice.length === 0) continue;
      const values = await redis.mget<(string | null)[]>(...slice);
      slice.forEach((key, idx) => {
        const value = values[idx];
        if (typeof value === 'string' && value === wagerId) {
          found.push({ key, namespace, ...parseKey(key, namespace), wagerId });
        }
      });
    }
  }
  return found;
}

/**
 * Delete pointers by key. Returns how many were actually removed.
 *
 * Only ever call this with keys that came back from findMappingsForWager, so
 * a typo cannot delete an unrelated key: every key is re-checked against the
 * known namespaces first.
 */
export async function clearMappings(keys: string[]): Promise<number> {
  const safe = keys.filter(k => AUTO_MARKET_NAMESPACES.some(ns => k.startsWith(`${ns}:`)));
  if (safe.length === 0) return 0;
  const redis = getRedis();
  let removed = 0;
  for (const key of safe) {
    removed += Number(await redis.del(key)) || 0;
  }
  return removed;
}
