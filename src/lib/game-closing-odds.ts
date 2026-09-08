// ── The line a game started with, kept for good ───────────────────────────
//
// Per Derek (2026-09-08): "keep the odds betting information up the entire
// time, locked in to what the lines were when the games started."
//
// The Odds API's /odds endpoint only lists games a book is still taking
// action on. The moment a game kicks off it drops out, `getGameLines`
// returns null, and every price on the board goes with it — which is why a
// finished game currently shows nothing but em dashes where its spread and
// total used to be. rotation-numbers.ts already rescued the two integers in
// that object that were never prices; this rescues the prices themselves.
//
// The distinction that makes this honest is WHEN we stop writing. A closing
// line means the last price offered before the game began. So:
//
//   - while the game is still 'pre', every render overwrites the stored copy,
//     so what we hold converges on the last line the market showed;
//   - the instant the game is 'in' or 'post' we stop writing entirely.
//
// That second rule is the whole point. If we kept writing after kickoff we
// would be storing whatever a book happened to leave up mid-game (or a live
// in-play price, which is a different market), label it "closing line", and
// be wrong in a way nobody could see. A frozen record is only worth having
// if the freezing instant is defined.
//
// Reads are equally strict: a started game shows the frozen line and never
// the live feed, so the number cannot change under a reader after the game
// it describes has begun.
//
// ⚠️ NOT to be confused with `closingLineSnapshot` on a Wager
// (wager-types.ts), which is OUR market's own price at the moment it locked.
// This file is about the SPORTSBOOK's line on the underlying game. Both are
// honestly called a "closing line" in their own domain, which is exactly why
// everything here is named `...ClosingOdds` instead.

import { getRedis } from './redis';
import type { GameLines } from './sportsbook-odds';

/**
 * Long enough that a finished game keeps its prices for the rest of the
 * season on the boards themselves. The permanent copy lives in the archive
 * record (game-archive.ts), which is written from this one.
 */
const TTL_SECONDS = 45 * 86400;

/** A stored line, plus when we froze it. */
export interface ClosingOddsRecord {
  lines: GameLines;
  /** ISO instant of the last pre-kickoff write. */
  capturedAt: string;
}

/**
 * Identity for a game, independent of which feed it came from.
 *
 * Deliberately the same shape rotation-numbers.ts uses: venue plus kickoff
 * hour. The ESPN id and the Odds API id differ for the same game, and a game
 * can switch between those two sources between one render and the next, so
 * neither id is stable enough to key a record that has to outlive the feed
 * that produced it.
 */
export function closingOddsKey(venueId: string, kickoffUTC: string): string | null {
  const ms = Date.parse(kickoffUTC);
  if (!venueId || !Number.isFinite(ms)) return null;
  return `closing-line:${venueId}:${Math.floor(ms / 3_600_000)}`;
}

/** Frozen lines for a set of games, keyed as `closingOddsKey` builds them. */
export async function getClosingOdds(
  keys: readonly (string | null)[],
): Promise<Map<string, ClosingOddsRecord>> {
  const wanted = [...new Set(keys.filter((k): k is string => !!k))];
  const out = new Map<string, ClosingOddsRecord>();
  if (wanted.length === 0) return out;
  try {
    const raw = await getRedis().mget<(string | ClosingOddsRecord | null)[]>(...wanted);
    wanted.forEach((key, i) => {
      const v = raw?.[i];
      if (v === null || v === undefined) return;
      try {
        const rec = (typeof v === 'string' ? JSON.parse(v) : v) as ClosingOddsRecord;
        if (rec?.lines) out.set(key, rec);
      } catch {
        /* a malformed entry is simply not remembered */
      }
    });
  } catch {
    /* redis unconfigured or down — the live feed is still authoritative */
  }
  return out;
}

/** True when this pair of prices differs from what we already hold. */
function pricesDiffer(a: GameLines, b: GameLines | undefined): boolean {
  if (!b) return true;
  return (
    a.moneylineHome !== b.moneylineHome ||
    a.moneylineAway !== b.moneylineAway ||
    a.spreadHome?.point !== b.spreadHome?.point ||
    a.spreadHome?.price !== b.spreadHome?.price ||
    a.spreadAway?.point !== b.spreadAway?.point ||
    a.spreadAway?.price !== b.spreadAway?.price ||
    a.total?.point !== b.total?.point ||
    a.total?.overPrice !== b.total?.overPrice ||
    a.total?.underPrice !== b.total?.underPrice
  );
}

/**
 * Store the current line for games that have NOT started yet.
 *
 * Callers pass every game on the board; this filters to the pre-kickoff ones
 * itself, so no caller can accidentally freeze a mid-game price by forgetting
 * the check. Only writes when the price actually moved — a board render sees
 * the same unchanged lines dozens of times an hour, and writing each one
 * would spend a Redis write per game per page load for no new information.
 *
 * Best-effort throughout: failing to remember a line must never cost a page
 * its render.
 */
export async function rememberClosingOdds(
  entries: readonly { key: string | null; state: 'pre' | 'in' | 'post'; lines: GameLines | null }[],
  known: Map<string, ClosingOddsRecord>,
): Promise<void> {
  const fresh: { key: string; lines: GameLines }[] = [];
  for (const e of entries) {
    if (!e.key || e.state !== 'pre' || !e.lines) continue;
    if (!pricesDiffer(e.lines, known.get(e.key)?.lines)) continue;
    fresh.push({ key: e.key, lines: e.lines });
  }
  if (fresh.length === 0) return;
  const capturedAt = new Date().toISOString();
  try {
    const redis = getRedis();
    await Promise.all(
      fresh.map((e) =>
        redis.set(e.key, JSON.stringify({ lines: e.lines, capturedAt } satisfies ClosingOddsRecord), {
          ex: TTL_SECONDS,
        }),
      ),
    );
  } catch {
    /* ignore */
  }
}

/**
 * The lines to display for one game.
 *
 * Before kickoff the live feed wins, because the market is still moving and a
 * reader wants the current number. From kickoff onward the frozen line wins
 * outright — not "wins when live is missing" — so that a started game shows
 * the price it started at and nothing else. `isClosing` is what the board
 * labels, so a reader is never shown a stale price that looks live.
 */
export function withClosingOdds(
  live: GameLines | null,
  state: 'pre' | 'in' | 'post',
  frozen: ClosingOddsRecord | undefined,
): { lines: GameLines | null; isClosing: boolean } {
  if (state === 'pre') return { lines: live, isClosing: false };
  if (frozen) return { lines: frozen.lines, isClosing: true };
  return { lines: live, isClosing: false };
}
