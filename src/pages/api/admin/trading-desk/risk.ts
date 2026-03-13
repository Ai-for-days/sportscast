import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { listAllWagers } from '../../../../lib/wager-store';
import { getWagerExposure } from '../../../../lib/exposure';
import type { Wager, OverUnderWager, PointspreadWager, OddsWager } from '../../../../lib/wager-types';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const allWagers = await listAllWagers(200);

    const exposureMap: Record<string, { handle: number; liability: number; betCount: number; byOutcome: Record<string, { betCount: number; stakedCents: number; maxPayoutCents: number }> }> = {};
    for (const w of allWagers) {
      try {
        const exp = await getWagerExposure(w.id);
        exposureMap[w.id] = {
          handle: exp.totalStakedCents,
          liability: exp.maxLiabilityCents,
          betCount: exp.totalBets,
          byOutcome: exp.byOutcome,
        };
      } catch {
        exposureMap[w.id] = { handle: 0, liability: 0, betCount: 0, byOutcome: {} };
      }
    }

    const open = allWagers.filter(w => w.status === 'open');
    const locked = allWagers.filter(w => w.status === 'locked');
    const graded = allWagers.filter(w => w.status === 'graded');
    const withSnapshot = allWagers.filter(w => w.pricingSnapshot);

    let totalHandle = 0;
    let totalLiability = 0;
    let largestLiability = 0;
    const holds: number[] = [];

    for (const w of allWagers) {
      const exp = exposureMap[w.id];
      totalHandle += exp?.handle || 0;
      totalLiability += exp?.liability || 0;
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
      totalLiability,
      largestLiability,
      avgHold,
      snapshotCount: withSnapshot.length,
    };

    // Risk level calculation
    function getRiskLevel(liability: number, handle: number, betCount: number): 'low' | 'medium' | 'high' | 'critical' {
      if (liability > 100000) return 'critical'; // > $1000
      if (liability > 50000) return 'high'; // > $500
      if (liability > 20000 || (handle > 0 && liability > handle * 0.5)) return 'medium';
      return 'low';
    }

    // Model vs posted summary
    function getModelVsPosted(w: Wager): string {
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
      return '—';
    }

    // Worst outcome
    function getWorstOutcome(w: Wager, exp: typeof exposureMap[string]): string {
      if (!exp?.byOutcome) return '—';
      let worst = '';
      let worstLoss = 0;
      for (const [label, data] of Object.entries(exp.byOutcome)) {
        const netLoss = data.maxPayoutCents - exp.handle;
        if (netLoss > worstLoss) {
          worstLoss = netLoss;
          worst = label;
        }
      }
      return worst || '—';
    }

    // Highest risk markets (open + locked, sorted by liability)
    const activeWagers = allWagers.filter(w => w.status === 'open' || w.status === 'locked');
    const highestRisk = activeWagers
      .map(w => {
        const exp = exposureMap[w.id];
        return {
          id: w.id,
          ticketNumber: w.ticketNumber,
          title: w.title,
          kind: w.kind,
          lockTime: w.lockTime,
          betCount: exp?.betCount || 0,
          handle: exp?.handle || 0,
          liability: exp?.liability || 0,
          worstOutcome: getWorstOutcome(w, exp),
          modelVsPosted: getModelVsPosted(w),
          riskLevel: getRiskLevel(exp?.liability || 0, exp?.handle || 0, exp?.betCount || 0),
        };
      })
      .sort((a, b) => b.liability - a.liability)
      .slice(0, 20);

    // Lopsided action
    const lopsided = activeWagers
      .filter(w => {
        const exp = exposureMap[w.id];
        if (!exp || exp.betCount < 2) return false;
        const outcomes = Object.values(exp.byOutcome);
        if (outcomes.length < 2) return false;
        const totalBets = outcomes.reduce((s, o) => s + o.betCount, 0);
        const maxBets = Math.max(...outcomes.map(o => o.betCount));
        return maxBets / totalBets > 0.65;
      })
      .map(w => {
        const exp = exposureMap[w.id];
        const outcomes = Object.entries(exp.byOutcome);
        const totalBets = outcomes.reduce((s, [, o]) => s + o.betCount, 0);
        let dominantSide = '';
        let dominantPct = 0;
        for (const [label, data] of outcomes) {
          const pct = data.betCount / totalBets;
          if (pct > dominantPct) {
            dominantPct = pct;
            dominantSide = label;
          }
        }
        return {
          id: w.id,
          ticketNumber: w.ticketNumber,
          title: w.title,
          kind: w.kind,
          handle: exp.handle,
          liability: exp.liability,
          dominantSide,
          dominantPct: Math.round(dominantPct * 100),
        };
      });

    // Missing model
    const missingModel = activeWagers
      .filter(w => !w.pricingSnapshot)
      .map(w => ({
        id: w.id,
        ticketNumber: w.ticketNumber,
        title: w.title,
        kind: w.kind,
        status: w.status,
      }));

    // Stale markets (open with 0 bets or no activity in 24h)
    const staleThreshold = Date.now() - 24 * 60 * 60 * 1000;
    const staleMarkets = open
      .filter(w => {
        const exp = exposureMap[w.id];
        return (exp?.betCount || 0) === 0 || new Date(w.updatedAt).getTime() < staleThreshold;
      })
      .map(w => ({
        id: w.id,
        ticketNumber: w.ticketNumber,
        title: w.title,
        kind: w.kind,
        betCount: exposureMap[w.id]?.betCount || 0,
        lastActivity: w.updatedAt,
      }));

    // Attention needed
    function hasSignificantDrift(w: Wager): boolean {
      const snap = w.pricingSnapshot;
      if (!snap) return false;
      if (snap.overUnder) return Math.abs(snap.overUnder.postedLine - snap.overUnder.suggestedLine) > 2;
      if (snap.pointspread) return Math.abs(snap.pointspread.postedSpread - snap.pointspread.suggestedSpread) > 2;
      return false;
    }

    const attentionNeeded = activeWagers
      .filter(w => {
        const exp = exposureMap[w.id];
        return (exp?.liability || 0) > 50000 || !w.pricingSnapshot || hasSignificantDrift(w) || lopsided.some(l => l.id === w.id);
      })
      .map(w => {
        const exp = exposureMap[w.id];
        const reasons: string[] = [];
        if ((exp?.liability || 0) > 50000) reasons.push('High liability');
        if (!w.pricingSnapshot) reasons.push('No pricing snapshot');
        if (hasSignificantDrift(w)) reasons.push('Line drift from model');
        if (lopsided.some(l => l.id === w.id)) reasons.push('Lopsided action');
        return {
          id: w.id,
          ticketNumber: w.ticketNumber,
          title: w.title,
          kind: w.kind,
          handle: exp?.handle || 0,
          liability: exp?.liability || 0,
          reasons,
          riskLevel: getRiskLevel(exp?.liability || 0, exp?.handle || 0, exp?.betCount || 0),
        };
      });

    return new Response(JSON.stringify({
      overview,
      highestRisk,
      lopsided,
      missingModel,
      staleMarkets,
      attentionNeeded,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed' }), { status: 500 });
  }
};
