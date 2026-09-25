// ── The WES a game was played in, kept for good ───────────────────────────
//
// Per Derek (2026-09-24): "WES numbers are not showing up for every game.
// WES needs to always be there, even after the game has started and
// finished."
//
// They were disappearing at kickoff, and the reason is not in wes.ts at all.
// `computeGameWes` scores the 3.5h window starting when the game does,
// sampling the hourly forecast every 30 minutes. But `getForecast()`'s hourly
// array is trimmed to "current hour onward" everywhere in the app (see
// open-meteo.ts), so a game's own window slides out of the data as the game is
// played: slot by slot while it is under way, and entirely once it ends.
// `getGameWindowForecast` then returns nothing, `computeGameWes` declines,
// and the chip vanishes, on a board where 15 of 17 rows were finals. The
// score was never wrong. There was simply nothing left to compute it from.
//
// Nothing can be recovered after the fact either. WES scores feels-like,
// gust, dew point, cloud, visibility, UV and precip rate together, and the
// post-game observation path (game-forecast-accuracy.ts) carries only
// temperature, wind and precipitation. A WES rebuilt from the fields that
// happen to survive would not be the same number.
//
// So it is frozen instead, on exactly the model game-closing-odds.ts already
// established for the sportsbook line in the next column:
//
//   - while the game is still 'pre', every full board render overwrites the
//     stored copy, so what we hold converges on the last forecast before the
//     game starts;
//   - from that moment on we stop writing, and the frozen copy is what the
//     board shows.
//
// The boards carry baseball, football and soccer, so the label the reader sees
// is the league's own word for that moment, not one term for all four leagues.
// Per Derek (2026-09-24): "'first pitch' is baseball, football and soccer are
// 'kick offs'." See `gameStartNoun` in league-schedule.ts.
//
// Freezing is not merely a way to keep the cell filled. It is the more honest
// number. WES scores an EVENT (what this weather does to the experience of
// attending and playing it), not an instant. Recomputing it mid-game over
// whatever is left of the window means the chip in the 9th inning describes
// the last half hour rather than the game, and drifts under a reader all
// evening. A game gets one WES: the one its full window was forecast to have.
//
// Coverage does not depend on anyone loading the page. /api/cron/archive-games
// runs the full enrichment path for all four leagues every hour at :25, so
// every game is enriched as 'pre' several times before it starts.

import { getRedis } from './redis';
import type { WesResult } from './wes';

/**
 * Long enough that a finished game keeps its score for the rest of the season
 * on the boards themselves. The permanent copy rides along in the archive
 * record (game-archive.ts), which stores the enriched game whole.
 */
const TTL_SECONDS = 45 * 86400;

/** A stored score, plus when we froze it. */
export interface WesSnapshotRecord {
  wes: WesResult;
  /** ISO instant of the last pre-kickoff write. */
  capturedAt: string;
}

/**
 * Identity for a game, independent of which feed it came from.
 *
 * Deliberately the same shape rotation-numbers.ts and game-closing-odds.ts
 * use: venue plus kickoff hour. The ESPN id and the MLB id differ for the
 * same game, and a game can switch between those sources between one render
 * and the next, so neither id is stable enough to key a record that has to
 * outlive the forecast that produced it.
 */
export function wesSnapshotKey(venueId: string, kickoffUTC: string): string | null {
  const ms = Date.parse(kickoffUTC);
  if (!venueId || !Number.isFinite(ms)) return null;
  return `wes-snapshot:${venueId}:${Math.floor(ms / 3_600_000)}`;
}

/** Frozen scores for a set of games, keyed as `wesSnapshotKey` builds them. */
export async function getWesSnapshots(
  keys: readonly (string | null)[],
): Promise<Map<string, WesSnapshotRecord>> {
  const wanted = [...new Set(keys.filter((k): k is string => !!k))];
  const out = new Map<string, WesSnapshotRecord>();
  if (wanted.length === 0) return out;
  try {
    const raw = await getRedis().mget<(string | WesSnapshotRecord | null)[]>(...wanted);
    wanted.forEach((key, i) => {
      const v = raw?.[i];
      if (v === null || v === undefined) return;
      try {
        const rec = (typeof v === 'string' ? JSON.parse(v) : v) as WesSnapshotRecord;
        if (rec?.wes && Number.isFinite(rec.wes.wesFinal)) out.set(key, rec);
      } catch {
        /* a malformed entry is simply not remembered */
      }
    });
  } catch {
    /* redis unconfigured or down, and the live computation is still authoritative */
  }
  return out;
}

/**
 * True when this score differs from what we already hold.
 *
 * The four published numbers plus the severe-weather cap, which is the whole
 * of what a reader ever sees. The sub-scores move with them.
 */
function scoresDiffer(a: WesResult, b: WesResult | undefined): boolean {
  if (!b) return true;
  return (
    a.wesFinal !== b.wesFinal ||
    a.environmental !== b.environmental ||
    a.fanFeel !== b.fanFeel ||
    a.playerFeel !== b.playerFeel ||
    a.severeWeatherCap !== b.severeWeatherCap ||
    a.wesVersion !== b.wesVersion
  );
}

/**
 * Store the current score for games that have NOT started yet.
 *
 * Callers pass every game on the board; this filters to the pre-kickoff ones
 * itself, so no caller can accidentally freeze a half-elapsed window by
 * forgetting the check. Only writes when the score actually moved, because a
 * board render sees the same forecast many times an hour and writing each one
 * would spend a Redis write per game per page load for no new information.
 *
 * Best-effort throughout: failing to remember a score must never cost a page
 * its render.
 */
export async function rememberWesSnapshots(
  entries: readonly { key: string | null; state: 'pre' | 'in' | 'post'; wes: WesResult | null }[],
  known: Map<string, WesSnapshotRecord>,
): Promise<void> {
  const fresh: { key: string; wes: WesResult }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.key || e.state !== 'pre' || !e.wes) continue;
    if (seen.has(e.key)) continue;
    if (!scoresDiffer(e.wes, known.get(e.key)?.wes)) continue;
    seen.add(e.key);
    fresh.push({ key: e.key, wes: e.wes });
  }
  if (fresh.length === 0) return;
  const capturedAt = new Date().toISOString();
  try {
    const redis = getRedis();
    await Promise.all(
      fresh.map((e) =>
        redis.set(e.key, JSON.stringify({ wes: e.wes, capturedAt } satisfies WesSnapshotRecord), {
          ex: TTL_SECONDS,
        }),
      ),
    );
  } catch {
    /* ignore */
  }
}

/**
 * The score to display for one game.
 *
 * Before the game starts the live computation wins, because the forecast is
 * still being revised and a reader wants the current number. From the start of
 * the game onward the frozen score wins outright, not "wins when live is
 * missing", so that a game's WES is the one its full window was forecast to
 * have rather than a number that drifts downward as the window empties out
 * beneath it.
 *
 * The fallback to the live value on a started game covers the one case the
 * freeze cannot: a game that never got a full 'pre' enrichment (a feed that
 * only published it after the game began, or a cold start with no Redis). Half
 * a window's score beats an empty cell, and `isFrozen` reports which of the two
 * a reader is looking at, so the board never labels it as something it isn't.
 */
export function withWesSnapshot(
  live: WesResult | null,
  state: 'pre' | 'in' | 'post',
  frozen: WesSnapshotRecord | undefined,
): { wes: WesResult | null; isFrozen: boolean } {
  if (state === 'pre') return { wes: live, isFrozen: false };
  if (frozen) return { wes: frozen.wes, isFrozen: true };
  return { wes: live, isFrozen: false };
}
