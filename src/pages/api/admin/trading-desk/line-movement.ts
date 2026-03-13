import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { listAllWagers } from '../../../../lib/wager-store';
import type { Wager, LineHistoryEntry, OverUnderWager, PointspreadWager, OddsWager } from '../../../../lib/wager-types';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const allWagers = await listAllWagers(200);

    // Collect all line changes
    const recentChanges: any[] = [];
    const marketDetails: Record<string, any[]> = {};

    for (const w of allWagers) {
      if (w.lineHistory && w.lineHistory.length > 0) {
        for (const entry of w.lineHistory) {
          recentChanges.push({
            changedAt: entry.changedAt,
            ticketNumber: w.ticketNumber,
            wagerTitle: w.title,
            marketType: entry.marketType,
            status: w.status,
            summary: entry.summary,
            changedBy: entry.changedBy,
            wagerId: w.id,
          });
        }
        marketDetails[w.id] = w.lineHistory.map(e => ({
          changedAt: e.changedAt,
          summary: e.summary,
          changedBy: e.changedBy,
        }));
      }
    }
    recentChanges.sort((a, b) => b.changedAt.localeCompare(a.changedAt));

    // Biggest movers
    const biggestMovers = allWagers
      .filter(w => w.lineHistory && w.lineHistory.length > 0)
      .map(w => {
        const history = w.lineHistory!;
        let cumulativeLineMove = 0;
        let cumulativeOddsMove = 0;

        for (const entry of history) {
          if (entry.overUnder) {
            cumulativeLineMove += Math.abs(entry.overUnder.newLine - entry.overUnder.previousLine);
            cumulativeOddsMove += Math.abs(entry.overUnder.newOverOdds - entry.overUnder.previousOverOdds);
            cumulativeOddsMove += Math.abs(entry.overUnder.newUnderOdds - entry.overUnder.previousUnderOdds);
          }
          if (entry.pointspread) {
            cumulativeLineMove += Math.abs(entry.pointspread.newSpread - entry.pointspread.previousSpread);
            cumulativeOddsMove += Math.abs(entry.pointspread.newLocationAOdds - entry.pointspread.previousLocationAOdds);
            cumulativeOddsMove += Math.abs(entry.pointspread.newLocationBOdds - entry.pointspread.previousLocationBOdds);
          }
          if (entry.rangeOdds) {
            const prevOdds = entry.rangeOdds.previousBands.map(b => b.odds);
            const newOdds = entry.rangeOdds.newBands.map(b => b.odds);
            for (let i = 0; i < Math.min(prevOdds.length, newOdds.length); i++) {
              cumulativeOddsMove += Math.abs(newOdds[i] - prevOdds[i]);
            }
          }
        }

        return {
          id: w.id,
          ticketNumber: w.ticketNumber,
          title: w.title,
          kind: w.kind,
          moveCount: history.length,
          cumulativeLineMove: Math.round(cumulativeLineMove * 10) / 10,
          cumulativeOddsMove: Math.round(cumulativeOddsMove),
        };
      })
      .sort((a, b) => b.moveCount - a.moveCount || b.cumulativeLineMove - a.cumulativeLineMove);

    return new Response(JSON.stringify({
      recentChanges: recentChanges.slice(0, 50),
      biggestMovers,
      marketDetails,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed' }), { status: 500 });
  }
};
