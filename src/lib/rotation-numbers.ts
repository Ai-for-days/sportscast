// ── Rotation numbers outlive the odds that carried them ───────────────────
//
// Per Derek (2026-08-31): "don't erase the rotation numbers when the games
// end."
//
// The `#` column on the Weatherboards comes off `lines.homeRotation` /
// `awayRotation`, which arrive attached to a game in The Odds API's /odds
// response. That endpoint lists games a bookmaker is still taking action on,
// so the moment a game starts or finishes it drops out, `getGameLines` returns
// null, and the whole `lines` object goes with it — including the rotation
// numbers, which are the one part of it that was never a price.
//
// A rotation number is an identifier, not a market. It is assigned before the
// game and it does not change, so there is no reason for it to disappear when
// the market closes: a final score keeps its rotation number in every printed
// sheet in the business. Once we have seen a game's pair we keep it.
//
// Small on purpose. Two integers per game, written only when they are new, and
// every failure path just returns what the live feed gave us.

import { getRedis } from './redis';

/** A week covers the whole time a finished game stays on any board. */
const TTL_SECONDS = 7 * 86400;

export interface RotationPair {
  home: number | null;
  away: number | null;
}

/**
 * Identity for a game, independent of which feed it came from.
 *
 * Venue plus kickoff hour, deliberately matching how `mergeOddsScheduleFallback`
 * decides two feeds are describing the same game: the ESPN id and the Odds API
 * id differ for one game, and a game can switch between those sources between
 * one render and the next.
 */
export function rotationKey(venueId: string, kickoffUTC: string): string | null {
  const ms = Date.parse(kickoffUTC);
  if (!venueId || !Number.isFinite(ms)) return null;
  return `rotation:${venueId}:${Math.floor(ms / 3_600_000)}`;
}

/** Remembered pairs for a set of games, keyed as `rotationKey` builds them. */
export async function getRememberedRotations(keys: readonly (string | null)[]): Promise<Map<string, RotationPair>> {
  const wanted = [...new Set(keys.filter((k): k is string => !!k))];
  const out = new Map<string, RotationPair>();
  if (wanted.length === 0) return out;
  try {
    const raw = await getRedis().mget<(string | RotationPair | null)[]>(...wanted);
    wanted.forEach((key, i) => {
      const v = raw?.[i];
      if (v === null || v === undefined) return;
      try {
        const pair = (typeof v === 'string' ? JSON.parse(v) : v) as RotationPair;
        if (pair && (pair.home !== null || pair.away !== null)) out.set(key, pair);
      } catch {
        /* a malformed entry is simply not remembered */
      }
    });
  } catch {
    /* redis unconfigured or down — the live feed is still authoritative */
  }
  return out;
}

/**
 * Store any pair we have not stored already. Best-effort and fire-and-forget
 * from the caller's point of view: failing to remember a rotation number must
 * never cost a page its render.
 */
export async function rememberRotations(entries: readonly { key: string | null; pair: RotationPair }[]): Promise<void> {
  const fresh = entries.filter((e) => e.key && (e.pair.home !== null || e.pair.away !== null));
  if (fresh.length === 0) return;
  try {
    const redis = getRedis();
    await Promise.all(
      fresh.map((e) => redis.set(e.key as string, JSON.stringify(e.pair), { ex: TTL_SECONDS })),
    );
  } catch {
    /* ignore */
  }
}

/**
 * The rotation numbers to display: whatever the live feed carries, falling
 * back to what we remember for that game.
 *
 * Live always wins when it has a value, so a corrected rotation number
 * propagates rather than being pinned by the first one we ever saw.
 */
export function withRememberedRotations<T extends { homeRotation: number | null; awayRotation: number | null }>(
  lines: T | null,
  remembered: RotationPair | undefined,
): T | null {
  if (!remembered) return lines;
  if (!lines) {
    // The market has closed and taken the whole lines object with it. Rebuild
    // the minimum a board needs to still print the `#` column.
    return { homeRotation: remembered.home, awayRotation: remembered.away } as T;
  }
  return {
    ...lines,
    homeRotation: lines.homeRotation ?? remembered.home,
    awayRotation: lines.awayRotation ?? remembered.away,
  };
}
