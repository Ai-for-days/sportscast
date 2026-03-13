import { listAllWagers } from './wager-store';
import { getWagerExposure } from './exposure';
import type { Wager, WagerKind, WagerStatus } from './wager-types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MarketOverview {
  totalWithSnapshot: number;
  openCount: number;
  lockedCount: number;
  gradedCount: number;
  voidCount: number;
  avgHold: number | null;
  avgAbsLineDiff: number | null;
}

export interface MarketTypeStats {
  kind: WagerKind;
  count: number;
  avgHold: number | null;
  avgAbsLineDiff: number | null;
}

export interface OverUnderAnalytics {
  count: number;
  avgLineDiff: number;       // postedLine - suggestedLine
  avgOverOddsDiff: number;   // postedOverOdds - suggestedOverOdds
  avgUnderOddsDiff: number;  // postedUnderOdds - suggestedUnderOdds
}

export interface PointspreadAnalytics {
  count: number;
  avgSpreadDiff: number;
  avgLocAOddsDiff: number;
  avgLocBOddsDiff: number;
}

export interface RangeOddsAnalytics {
  count: number;
  avgBandOddsDiff: number;
}

export interface StatusGroup {
  status: string;
  count: number;
  avgHold: number | null;
  avgAbsLineDiff: number | null;
}

export interface ShadedMarket {
  id: string;
  title: string;
  ticketNumber: string;
  kind: string;
  status: string;
  driftValue: number;
  driftLabel: string;
}

export interface MarketPerformanceReport {
  overview: MarketOverview;
  byType: MarketTypeStats[];
  byStatus: StatusGroup[];
  overUnder: OverUnderAnalytics | null;
  pointspread: PointspreadAnalytics | null;
  rangeOdds: RangeOddsAnalytics | null;
  topShaded: ShadedMarket[];
  marketTable: MarketTableRow[];
}

export interface MarketTableRow {
  id: string;
  title: string;
  ticketNumber: string;
  kind: string;
  status: string;
  modelSummary: string;
  postedSummary: string;
  handle: number;
  liability: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

// ── Build report ───────────────────────────────────────────────────────────────

export async function buildMarketPerformanceReport(): Promise<MarketPerformanceReport> {
  const allWagers = await listAllWagers(200);
  const withSnapshot = allWagers.filter(w => w.pricingSnapshot);

  // Overview
  const holds: number[] = [];
  const absLineDiffs: number[] = [];

  for (const w of withSnapshot) {
    const snap = w.pricingSnapshot!;
    if (snap.overUnder) {
      holds.push(snap.overUnder.hold);
      absLineDiffs.push(Math.abs(snap.overUnder.postedLine - snap.overUnder.suggestedLine));
    }
    if (snap.pointspread) {
      holds.push(snap.pointspread.hold);
      absLineDiffs.push(Math.abs(snap.pointspread.postedSpread - snap.pointspread.suggestedSpread));
    }
  }

  const overview: MarketOverview = {
    totalWithSnapshot: withSnapshot.length,
    openCount: withSnapshot.filter(w => w.status === 'open').length,
    lockedCount: withSnapshot.filter(w => w.status === 'locked').length,
    gradedCount: withSnapshot.filter(w => w.status === 'graded').length,
    voidCount: withSnapshot.filter(w => w.status === 'void').length,
    avgHold: avg(holds),
    avgAbsLineDiff: avg(absLineDiffs),
  };

  // By type
  const kindGroups: Record<WagerKind, Wager[]> = {
    'over-under': [],
    'odds': [],
    'pointspread': [],
  };
  for (const w of withSnapshot) {
    kindGroups[w.kind].push(w);
  }

  const byType: MarketTypeStats[] = (['over-under', 'odds', 'pointspread'] as WagerKind[]).map(kind => {
    const group = kindGroups[kind];
    const groupHolds: number[] = [];
    const groupDiffs: number[] = [];
    for (const w of group) {
      const snap = w.pricingSnapshot!;
      if (snap.overUnder) {
        groupHolds.push(snap.overUnder.hold);
        groupDiffs.push(Math.abs(snap.overUnder.postedLine - snap.overUnder.suggestedLine));
      }
      if (snap.pointspread) {
        groupHolds.push(snap.pointspread.hold);
        groupDiffs.push(Math.abs(snap.pointspread.postedSpread - snap.pointspread.suggestedSpread));
      }
    }
    return {
      kind,
      count: group.length,
      avgHold: avg(groupHolds),
      avgAbsLineDiff: avg(groupDiffs),
    };
  });

  // Over/Under analytics
  let overUnder: OverUnderAnalytics | null = null;
  const ouWagers = withSnapshot.filter(w => w.pricingSnapshot?.overUnder);
  if (ouWagers.length > 0) {
    const lineDiffs: number[] = [];
    const overOddsDiffs: number[] = [];
    const underOddsDiffs: number[] = [];
    for (const w of ouWagers) {
      const ou = w.pricingSnapshot!.overUnder!;
      lineDiffs.push(ou.postedLine - ou.suggestedLine);
      overOddsDiffs.push(ou.postedOverOdds - ou.suggestedOverOdds);
      underOddsDiffs.push(ou.postedUnderOdds - ou.suggestedUnderOdds);
    }
    overUnder = {
      count: ouWagers.length,
      avgLineDiff: avg(lineDiffs)!,
      avgOverOddsDiff: avg(overOddsDiffs)!,
      avgUnderOddsDiff: avg(underOddsDiffs)!,
    };
  }

  // Pointspread analytics
  let pointspread: PointspreadAnalytics | null = null;
  const psWagers = withSnapshot.filter(w => w.pricingSnapshot?.pointspread);
  if (psWagers.length > 0) {
    const spreadDiffs: number[] = [];
    const locADiffs: number[] = [];
    const locBDiffs: number[] = [];
    for (const w of psWagers) {
      const ps = w.pricingSnapshot!.pointspread!;
      spreadDiffs.push(ps.postedSpread - ps.suggestedSpread);
      locADiffs.push(ps.postedLocationAOdds - ps.suggestedLocationAOdds);
      locBDiffs.push(ps.postedLocationBOdds - ps.suggestedLocationBOdds);
    }
    pointspread = {
      count: psWagers.length,
      avgSpreadDiff: avg(spreadDiffs)!,
      avgLocAOddsDiff: avg(locADiffs)!,
      avgLocBOddsDiff: avg(locBDiffs)!,
    };
  }

  // Range odds analytics
  let rangeOdds: RangeOddsAnalytics | null = null;
  const roWagers = withSnapshot.filter(w => w.pricingSnapshot?.rangeOdds);
  if (roWagers.length > 0) {
    const allBandDiffs: number[] = [];
    for (const w of roWagers) {
      for (const band of w.pricingSnapshot!.rangeOdds!.bands) {
        allBandDiffs.push(band.postedOdds - band.suggestedOdds);
      }
    }
    rangeOdds = {
      count: roWagers.length,
      avgBandOddsDiff: avg(allBandDiffs)!,
    };
  }

  // By status grouping
  const statuses: WagerStatus[] = ['open', 'locked', 'graded', 'void'];
  const byStatus: StatusGroup[] = statuses.map(status => {
    const group = withSnapshot.filter(w => w.status === status);
    const statusHolds: number[] = [];
    const statusDiffs: number[] = [];
    for (const w of group) {
      const snap = w.pricingSnapshot!;
      if (snap.overUnder) {
        statusHolds.push(snap.overUnder.hold);
        statusDiffs.push(Math.abs(snap.overUnder.postedLine - snap.overUnder.suggestedLine));
      }
      if (snap.pointspread) {
        statusHolds.push(snap.pointspread.hold);
        statusDiffs.push(Math.abs(snap.pointspread.postedSpread - snap.pointspread.suggestedSpread));
      }
    }
    return {
      status,
      count: group.length,
      avgHold: avg(statusHolds),
      avgAbsLineDiff: avg(statusDiffs),
    };
  }).filter(g => g.count > 0);

  // Top shaded markets (biggest drift between model and posted)
  const shadedCandidates: { wager: Wager; drift: number; label: string }[] = [];
  for (const w of withSnapshot) {
    const snap = w.pricingSnapshot!;
    if (snap.overUnder) {
      const d = Math.abs(snap.overUnder.postedLine - snap.overUnder.suggestedLine);
      if (d > 0) shadedCandidates.push({ wager: w, drift: d, label: `Line ${(snap.overUnder.postedLine - snap.overUnder.suggestedLine) >= 0 ? '+' : ''}${(snap.overUnder.postedLine - snap.overUnder.suggestedLine).toFixed(1)}` });
    }
    if (snap.pointspread) {
      const d = Math.abs(snap.pointspread.postedSpread - snap.pointspread.suggestedSpread);
      if (d > 0) shadedCandidates.push({ wager: w, drift: d, label: `Spread ${(snap.pointspread.postedSpread - snap.pointspread.suggestedSpread) >= 0 ? '+' : ''}${(snap.pointspread.postedSpread - snap.pointspread.suggestedSpread).toFixed(1)}` });
    }
    if (snap.rangeOdds) {
      const diffs = snap.rangeOdds.bands.map(b => b.postedOdds - b.suggestedOdds);
      const avgDiff = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
      const absDiff = Math.abs(avgDiff);
      if (absDiff > 0) shadedCandidates.push({ wager: w, drift: absDiff, label: `Odds ${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(0)}` });
    }
  }
  shadedCandidates.sort((a, b) => b.drift - a.drift);
  const topShaded: ShadedMarket[] = shadedCandidates.slice(0, 10).map(c => ({
    id: c.wager.id,
    title: c.wager.title,
    ticketNumber: c.wager.ticketNumber,
    kind: c.wager.kind,
    status: c.wager.status,
    driftValue: c.drift,
    driftLabel: c.label,
  }));

  // Market table with handle/liability
  const marketTable: MarketTableRow[] = [];
  for (const w of withSnapshot) {
    let modelSummary = '—';
    let postedSummary = '—';
    const snap = w.pricingSnapshot!;
    if (snap.overUnder) {
      modelSummary = `Line ${snap.overUnder.suggestedLine}`;
      postedSummary = `Line ${snap.overUnder.postedLine}`;
    } else if (snap.pointspread) {
      modelSummary = `Spread ${snap.pointspread.suggestedSpread}`;
      postedSummary = `Spread ${snap.pointspread.postedSpread}`;
    } else if (snap.rangeOdds) {
      modelSummary = `${snap.rangeOdds.bands.length} bands`;
      postedSummary = `${snap.rangeOdds.bands.length} bands`;
    }

    let handle = 0;
    let liability = 0;
    try {
      const exp = await getWagerExposure(w.id);
      handle = exp.totalStakedCents;
      liability = exp.maxLiabilityCents;
    } catch { /* ignore */ }

    marketTable.push({
      id: w.id,
      title: w.title,
      ticketNumber: w.ticketNumber,
      kind: w.kind,
      status: w.status,
      modelSummary,
      postedSummary,
      handle,
      liability,
    });
  }

  return { overview, byType, byStatus, overUnder, pointspread, rangeOdds, topShaded, marketTable };
}
