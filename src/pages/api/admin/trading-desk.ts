import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { listAllWagers } from '../../../lib/wager-store';
import { getWagerExposure } from '../../../lib/exposure';
import type { Wager, OverUnderWager, PointspreadWager, OddsWager, LineHistoryEntry } from '../../../lib/wager-types';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const allWagers = await listAllWagers(200);

    // Compute exposure for each wager
    const exposureMap: Record<string, { handle: number; liability: number; betCount: number }> = {};
    for (const w of allWagers) {
      try {
        const exp = await getWagerExposure(w.id);
        exposureMap[w.id] = {
          handle: exp.totalStakedCents,
          liability: exp.maxLiabilityCents,
          betCount: exp.totalBets,
        };
      } catch {
        exposureMap[w.id] = { handle: 0, liability: 0, betCount: 0 };
      }
    }

    // Overview stats
    const open = allWagers.filter(w => w.status === 'open');
    const locked = allWagers.filter(w => w.status === 'locked');
    const graded = allWagers.filter(w => w.status === 'graded');
    const withSnapshot = allWagers.filter(w => w.pricingSnapshot);

    let totalHandle = 0;
    let largestLiability = 0;
    const holds: number[] = [];

    for (const w of allWagers) {
      const exp = exposureMap[w.id];
      totalHandle += exp?.handle || 0;
      if ((exp?.liability || 0) > largestLiability) largestLiability = exp?.liability || 0;

      const snap = w.pricingSnapshot;
      if (snap?.overUnder) holds.push(snap.overUnder.hold);
      if (snap?.pointspread) holds.push(snap.pointspread.hold);
    }

    const avgHold = holds.length > 0 ? holds.reduce((a, b) => a + b, 0) / holds.length : null;

    const overview = {
      openMarkets: open.length,
      lockedMarkets: locked.length,
      gradedMarkets: graded.length,
      totalHandle,
      largestLiability,
      avgHold,
      snapshotCount: withSnapshot.length,
    };

    // Open markets table data
    const openMarkets = open.map(w => {
      const exp = exposureMap[w.id];
      return {
        id: w.id,
        ticketNumber: w.ticketNumber,
        title: w.title,
        kind: w.kind,
        status: w.status,
        lockTime: w.lockTime,
        targetDate: w.targetDate,
        handle: exp?.handle || 0,
        liability: exp?.liability || 0,
        betCount: exp?.betCount || 0,
        modelVsPosted: getModelVsPostedSummary(w),
        hasSnapshot: !!w.pricingSnapshot,
      };
    });

    // Attention needed
    const attentionNeeded = allWagers
      .filter(w => w.status === 'open' || w.status === 'locked')
      .filter(w => {
        const exp = exposureMap[w.id];
        const highLiability = (exp?.liability || 0) > 50000; // > $500
        const noSnapshot = !w.pricingSnapshot;
        const bigDrift = hasSignificantDrift(w);
        const lopsided = isLopsidedAction(w, exp);
        return highLiability || noSnapshot || bigDrift || lopsided;
      })
      .map(w => {
        const exp = exposureMap[w.id];
        const reasons: string[] = [];
        if ((exp?.liability || 0) > 50000) reasons.push('High liability');
        if (!w.pricingSnapshot) reasons.push('No pricing snapshot');
        if (hasSignificantDrift(w)) reasons.push('Line drift from model');
        if (isLopsidedAction(w, exp)) reasons.push('Lopsided action');
        return {
          id: w.id,
          ticketNumber: w.ticketNumber,
          title: w.title,
          kind: w.kind,
          handle: exp?.handle || 0,
          liability: exp?.liability || 0,
          reasons,
        };
      });

    // Recent line changes — collect all lineHistory entries across all wagers
    const recentChanges: (LineHistoryEntry & { wagerId: string; wagerTitle: string; ticketNumber: string })[] = [];
    for (const w of allWagers) {
      if (w.lineHistory) {
        for (const entry of w.lineHistory) {
          recentChanges.push({ ...entry, wagerId: w.id, wagerTitle: w.title, ticketNumber: w.ticketNumber });
        }
      }
    }
    recentChanges.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
    const recentLineChanges = recentChanges.slice(0, 20);

    return new Response(JSON.stringify({
      overview,
      openMarkets,
      attentionNeeded,
      recentLineChanges,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to load trading desk data' }), { status: 500 });
  }
};

function getModelVsPostedSummary(w: Wager): string {
  const snap = w.pricingSnapshot;
  if (!snap) return '—';

  if (snap.overUnder) {
    const diff = snap.overUnder.postedLine - snap.overUnder.suggestedLine;
    return `Line ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`;
  }
  if (snap.pointspread) {
    const diff = snap.pointspread.postedSpread - snap.pointspread.suggestedSpread;
    return `Spread ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`;
  }
  if (snap.rangeOdds) {
    const diffs = snap.rangeOdds.bands.map(b => b.postedOdds - b.suggestedOdds);
    const avgDiff = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
    return `Odds ${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(0)}`;
  }
  return '—';
}

function hasSignificantDrift(w: Wager): boolean {
  const snap = w.pricingSnapshot;
  if (!snap) return false;

  if (snap.overUnder) {
    return Math.abs(snap.overUnder.postedLine - snap.overUnder.suggestedLine) > 2;
  }
  if (snap.pointspread) {
    return Math.abs(snap.pointspread.postedSpread - snap.pointspread.suggestedSpread) > 2;
  }
  return false;
}

function isLopsidedAction(w: Wager, exp: { handle: number; liability: number; betCount: number } | undefined): boolean {
  if (!exp || exp.betCount < 3) return false;
  return exp.liability > exp.handle * 0.5;
}
