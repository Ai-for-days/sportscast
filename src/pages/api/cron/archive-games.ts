// ── Archive the games as they finish (2026-09-08, per Derek) ──────────────
//
// "We want a history of all of the games played."
//
// This is the writer behind that history. It walks each league's current
// slate, keeps the games that are FINAL, and adds them to that ET game day's
// record (game-archive.ts). `/weatherboard/history` and a past date on
// `/weatherboard/<date>` read those records back.
//
// Why a cron and not a page render: the boards only build a record for games
// somebody actually loaded, and the quiet leagues are exactly the ones nobody
// loads. A history with holes wherever traffic was thin is not a history.
// This runs whether or not anyone visited.
//
// **Why it archives the CURRENT game day and not yesterday.** The schedule
// window every feed here is built on starts at the current game day
// (startOfGameDayET, see venue-schedule.ts) — deliberately, and for good
// reasons documented there. The consequence is that yesterday's games are
// already out of range: a tidy "archive yesterday at 4am" job would find
// nothing at all. So the record is filled in as the day goes, and is complete
// by the time the 6am ET roll drops it out of range. game-archive.ts merges
// rather than overwrites for exactly this reason.
//
// Hourly. A late West Coast finish is still 'in' at 3am ET, and the ET game
// day runs to 6am, so the last runs of a day are the ones that catch its last
// games. Adding a game already on record is a no-op, so the repeated runs
// cost one Redis read each.

import type { APIRoute } from 'astro';
import { getScheduleGames, type SiteLeague } from '../../../lib/league-schedule';
import { archiveDay, gameDayFor, type ArchivedGame } from '../../../lib/game-archive';
import { gameDayDateStr } from '../../../lib/mlb-schedule';

const LEAGUES: SiteLeague[] = ['mlb', 'nfl', 'ncaa-football', 'mls'];

export const GET: APIRoute = async ({ request, url }) => {
  // Same cron-secret check as the other cron routes.
  const authHeader = request.headers.get('authorization');
  const cronSecret = import.meta.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const today = gameDayDateStr(new Date());

  try {
    // A 2-day window: the current game day plus whatever has already started
    // for tomorrow. Finished games from BOTH are archived — a game that
    // finishes after midnight ET still belongs to today's game day, and
    // gameDayFor is what decides that, not the window.
    const perLeague = await Promise.all(
      LEAGUES.map(async (league) => {
        try {
          const { games } = await getScheduleGames(league, 2);
          return games.map((g) => ({ league, game: g }));
        } catch {
          return []; // one league's feed being down must not cost the others their record
        }
      }),
    );

    const archivedAt = new Date().toISOString();
    const byDay = new Map<string, ArchivedGame[]>();
    for (const { league, game } of perLeague.flat()) {
      if (game.state !== 'post') continue; // a game still in progress has a score about to be wrong
      const day = gameDayFor(game.kickoffUTC);
      if (!day) continue;
      const list = byDay.get(day) ?? [];
      list.push({ ...game, league, archivedAt });
      byDay.set(day, list);
    }

    const results: { day: string; finished: number; added: number }[] = [];
    for (const [day, games] of byDay) {
      const added = await archiveDay(day, games);
      results.push({ day, finished: games.length, added });
    }

    return new Response(JSON.stringify({
      ok: true,
      today,
      days: results,
      totalAdded: results.reduce((n, r) => n + r.added, 0),
      timestamp: archivedAt,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, today, error: err?.message ?? 'Archive failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
