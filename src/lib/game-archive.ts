// ── A permanent record of every game that has been played ─────────────────
//
// Per Derek (2026-09-08): "we want a history of all of the games played."
//
// Nothing upstream can answer that question for us. ESPN's scoreboard window
// this site builds starts at the CURRENT game day (deliberately — see
// venue-schedule.ts), The Odds API drops a game the moment it starts, and
// `/weatherboard/<a past date>` has until now answered "That date has already
// passed" because there was genuinely nothing left to render. A history has
// to be written down while the games are current or it does not exist.
//
// So this is a write-behind archive: one record per game, plus one index per
// game day so a date can be listed without scanning keys. The record is the
// board row itself (`EnrichedScheduleGame`), which means the history page
// renders through the exact same WeatherboardTable as the live board rather
// than growing a parallel renderer that drifts.
//
// Three rules worth keeping:
//
//  1. **A day is filled in as it goes, never rewritten.** The schedule window
//     this site builds starts at the CURRENT game day, so yesterday's games
//     are simply gone from every feed by the time a nightly job could look for
//     them. The archive therefore accumulates the current day, hour by hour,
//     as its games go final — and by the 6am ET roll that day is complete.
//     `archiveDay` MERGES for that reason; it does not overwrite.
//  2. **The first record of a game wins.** Its score, its closing odds and its
//     forecast-accuracy write-up are settled facts the moment it ends, and the
//     feeds only thin out from there, so a later pass can only replace a good
//     record with a worse one.
//  3. **Only finished games are archived.** A game still in progress has a
//     score that is about to be wrong.
//
// Written by /api/cron/archive-games, not by page renders, so a game nobody
// happened to load still ends up in the history.

import { getRedis } from './redis';
import { gameDayDateStr } from './mlb-schedule';
import type { EnrichedScheduleGame, SiteLeague } from './league-schedule';

/** ~13 months: a full season stays browsable, and a year-ago comparison works. */
const RECORD_TTL_SECONDS = 400 * 86400;

/** One archived game: the board row, plus what league it belongs to. */
export interface ArchivedGame extends EnrichedScheduleGame {
  league: SiteLeague;
  /** ISO instant this record was written. */
  archivedAt: string;
}

/** The ET game day (`YYYY-MM-DD`) a kickoff belongs to, or null if unparseable. */
export function gameDayFor(kickoffUTC: string): string | null {
  const ms = Date.parse(kickoffUTC);
  if (!Number.isFinite(ms)) return null;
  return gameDayDateStr(new Date(ms));
}

function dayKey(day: string): string {
  return `game-archive:day:${day}`;
}
function indexKey(): string {
  return 'game-archive:days';
}

/**
 * Read one game day's archive, newest leagues first in the order the boards
 * use. Returns an empty array for a day never archived, which the caller
 * renders as "no record" rather than "no games".
 */
export async function getArchivedDay(day: string): Promise<ArchivedGame[]> {
  try {
    const raw = await getRedis().get(dayKey(day));
    if (!raw) return [];
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ArchivedGame[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** How many games we already hold for a day. */
export async function archivedCount(day: string): Promise<number> {
  return (await getArchivedDay(day)).length;
}

/**
 * The game days we hold a record for, newest first.
 *
 * Kept as its own sorted list rather than derived by scanning keys: Upstash
 * charges per command and a KEYS scan over a season of days on every history
 * page load is exactly the kind of cost that only shows up in the bill.
 */
export async function getArchivedDays(limit = 60): Promise<string[]> {
  try {
    const raw = await getRedis().get(indexKey());
    if (!raw) return [];
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as string[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Add finished games to one game day's record, keeping everything already
 * there.
 *
 * Merge, not overwrite (see rule 1 up top): this is called repeatedly through
 * a game day as its slate finishes, and each call only sees the games still in
 * the feed's window. Overwriting would delete the early games every time a
 * late one finished.
 *
 * A game already on record is left exactly as it was (rule 2), so a thinner
 * later view of the same game cannot degrade it.
 *
 * No-ops on an empty slate: writing an empty day would put it in the index and
 * make "no games" look like a fact for a day whose feed merely happened to be
 * down. A day with genuinely no tracked games stays absent from the index,
 * which the history page already renders correctly.
 *
 * @returns how many games were newly added.
 */
export async function archiveDay(day: string, games: readonly ArchivedGame[]): Promise<number> {
  if (games.length === 0) return 0;
  try {
    const redis = getRedis();
    const existing = await getArchivedDay(day);
    const seen = new Set(existing.map((g) => g.id));
    const added = games.filter((g) => !seen.has(g.id));
    if (added.length === 0) return 0;

    const merged = [...existing, ...added].sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC));
    await redis.set(dayKey(day), JSON.stringify(merged), { ex: RECORD_TTL_SECONDS });

    const days = await getArchivedDays(9999);
    if (!days.includes(day)) {
      const next = [...days, day].sort().reverse();
      await redis.set(indexKey(), JSON.stringify(next), { ex: RECORD_TTL_SECONDS });
    }
    return added.length;
  } catch {
    return 0;
  }
}
