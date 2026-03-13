// ── Portfolio Sizing Engine ──────────────────────────────────────────────────
//
// Recommends position sizes and enforces concentration/exposure constraints.
// Recommendation-only — no live execution.

import type { RankedSignal, SizingTier } from './signal-ranking';

// ── Configurable Portfolio Constraints ──────────────────────────────────────

export const PORTFOLIO_LIMITS = {
  // Stake per sizing tier (in cents)
  STAKE_LARGE: 5000,     // $50
  STAKE_MEDIUM: 2000,    // $20
  STAKE_SMALL: 500,      // $5

  // Max allowed stake per trade (in cents)
  MAX_STAKE_PER_TRADE: 10000, // $100

  // Concentration caps (in cents of recommended exposure)
  MAX_EXPOSURE_PER_CITY: 20000,     // $200
  MAX_EXPOSURE_PER_DATE: 30000,     // $300
  MAX_EXPOSURE_PER_METRIC: 25000,   // $250
  MAX_EXPOSURE_PER_SOURCE: 50000,   // $500

  // Total portfolio limits (in cents)
  MAX_TOTAL_PAPER_EXPOSURE: 100000,     // $1,000
  MAX_TOTAL_SPORTSBOOK_RISK: 200000,    // $2,000
} as const;

// ── Types ───────────────────────────────────────────────────────────────────

export interface PortfolioRecommendation {
  signalId: string;
  signalScore: number;
  sizingTier: SizingTier;
  recommendedStakeCents?: number;
  maxAllowedStakeCents?: number;
  portfolioReason: string;
  constrained: boolean;
}

export interface ConcentrationEntry {
  key: string;
  totalExposureCents: number;
  signalCount: number;
  capCents: number;
  utilizationPct: number;
}

export interface PortfolioOverview {
  totalRankedSignals: number;
  tradableSignals: number;
  smallCount: number;
  mediumCount: number;
  largeCount: number;
  noTradeCount: number;
  totalRecommendedExposureCents: number;
  constrainedCount: number;
  concentrationByCity: ConcentrationEntry[];
  concentrationByDate: ConcentrationEntry[];
  concentrationByMetric: ConcentrationEntry[];
  concentrationBySource: ConcentrationEntry[];
  recommendations: PortfolioRecommendation[];
}

// ── Sizing Logic ────────────────────────────────────────────────────────────

function baseStakeForTier(tier: SizingTier): number {
  if (tier === 'large') return PORTFOLIO_LIMITS.STAKE_LARGE;
  if (tier === 'medium') return PORTFOLIO_LIMITS.STAKE_MEDIUM;
  if (tier === 'small') return PORTFOLIO_LIMITS.STAKE_SMALL;
  return 0;
}

// ── Concentration Tracking ──────────────────────────────────────────────────

interface ConcentrationTracker {
  byCity: Map<string, number>;
  byDate: Map<string, number>;
  byMetric: Map<string, number>;
  bySource: Map<string, number>;
  totalPaper: number;
  totalSportsbook: number;
}

function newTracker(): ConcentrationTracker {
  return {
    byCity: new Map(),
    byDate: new Map(),
    byMetric: new Map(),
    bySource: new Map(),
    totalPaper: 0,
    totalSportsbook: 0,
  };
}

function checkConstraints(
  signal: RankedSignal,
  proposedStake: number,
  tracker: ConcentrationTracker,
): { allowedStake: number; reasons: string[] } {
  let allowed = proposedStake;
  const reasons: string[] = [];
  const L = PORTFOLIO_LIMITS;

  // City concentration
  if (signal.locationName) {
    const cityKey = signal.locationName.toLowerCase();
    const current = tracker.byCity.get(cityKey) || 0;
    const remaining = L.MAX_EXPOSURE_PER_CITY - current;
    if (remaining <= 0) {
      reasons.push(`City cap reached (${signal.locationName})`);
      allowed = 0;
    } else if (allowed > remaining) {
      reasons.push(`City cap reduced (${signal.locationName})`);
      allowed = remaining;
    }
  }

  // Date concentration
  if (signal.targetDate) {
    const current = tracker.byDate.get(signal.targetDate) || 0;
    const remaining = L.MAX_EXPOSURE_PER_DATE - current;
    if (remaining <= 0) {
      reasons.push(`Date cap reached (${signal.targetDate})`);
      allowed = 0;
    } else if (allowed > remaining) {
      reasons.push(`Date cap reduced (${signal.targetDate})`);
      allowed = remaining;
    }
  }

  // Metric concentration
  if (signal.metric) {
    const current = tracker.byMetric.get(signal.metric) || 0;
    const remaining = L.MAX_EXPOSURE_PER_METRIC - current;
    if (remaining <= 0) {
      reasons.push(`Metric cap reached (${signal.metric})`);
      allowed = 0;
    } else if (allowed > remaining) {
      reasons.push(`Metric cap reduced (${signal.metric})`);
      allowed = remaining;
    }
  }

  // Source concentration
  const sourceKey = signal.source;
  const currentSource = tracker.bySource.get(sourceKey) || 0;
  const remainingSource = L.MAX_EXPOSURE_PER_SOURCE - currentSource;
  if (remainingSource <= 0) {
    reasons.push(`Source cap reached (${sourceKey})`);
    allowed = 0;
  } else if (allowed > remainingSource) {
    reasons.push(`Source cap reduced (${sourceKey})`);
    allowed = remainingSource;
  }

  // Total portfolio limits
  if (signal.source === 'kalshi') {
    const remaining = L.MAX_TOTAL_PAPER_EXPOSURE - tracker.totalPaper;
    if (remaining <= 0) {
      reasons.push('Total paper exposure cap reached');
      allowed = 0;
    } else if (allowed > remaining) {
      reasons.push('Total paper exposure cap reduced');
      allowed = remaining;
    }
  } else {
    const remaining = L.MAX_TOTAL_SPORTSBOOK_RISK - tracker.totalSportsbook;
    if (remaining <= 0) {
      reasons.push('Total sportsbook risk cap reached');
      allowed = 0;
    } else if (allowed > remaining) {
      reasons.push('Total sportsbook risk cap reduced');
      allowed = remaining;
    }
  }

  // Per-trade cap
  if (allowed > L.MAX_STAKE_PER_TRADE) {
    allowed = L.MAX_STAKE_PER_TRADE;
  }

  return { allowedStake: Math.max(0, Math.round(allowed)), reasons };
}

function updateTracker(signal: RankedSignal, stake: number, tracker: ConcentrationTracker): void {
  if (signal.locationName) {
    const key = signal.locationName.toLowerCase();
    tracker.byCity.set(key, (tracker.byCity.get(key) || 0) + stake);
  }
  if (signal.targetDate) {
    tracker.byDate.set(signal.targetDate, (tracker.byDate.get(signal.targetDate) || 0) + stake);
  }
  if (signal.metric) {
    tracker.byMetric.set(signal.metric, (tracker.byMetric.get(signal.metric) || 0) + stake);
  }
  tracker.bySource.set(signal.source, (tracker.bySource.get(signal.source) || 0) + stake);
  if (signal.source === 'kalshi') tracker.totalPaper += stake;
  else tracker.totalSportsbook += stake;
}

// ── Build Concentration Tables ──────────────────────────────────────────────

function buildConcentrationTable(map: Map<string, number>, cap: number): ConcentrationEntry[] {
  return Array.from(map.entries())
    .map(([key, total]) => ({
      key,
      totalExposureCents: total,
      signalCount: 0, // filled below
      capCents: cap,
      utilizationPct: Math.round((total / cap) * 10000) / 100,
    }))
    .sort((a, b) => b.totalExposureCents - a.totalExposureCents);
}

// ── Main Portfolio Builder ──────────────────────────────────────────────────

export function buildPortfolio(rankedSignals: RankedSignal[]): PortfolioOverview {
  const tracker = newTracker();
  const recommendations: PortfolioRecommendation[] = [];

  let tradableSignals = 0;
  let smallCount = 0;
  let mediumCount = 0;
  let largeCount = 0;
  let noTradeCount = 0;
  let totalRecommended = 0;
  let constrainedCount = 0;

  // Process signals in rank order (already sorted by signalScore desc)
  for (const signal of rankedSignals) {
    if (signal.sizingTier === 'no-trade') {
      noTradeCount++;
      recommendations.push({
        signalId: signal.id,
        signalScore: signal.signalScore,
        sizingTier: 'no-trade',
        portfolioReason: 'Below signal score threshold',
        constrained: false,
      });
      continue;
    }

    const baseStake = baseStakeForTier(signal.sizingTier);
    const { allowedStake, reasons } = checkConstraints(signal, baseStake, tracker);

    let finalTier = signal.sizingTier;
    let constrained = false;

    if (allowedStake === 0) {
      finalTier = 'no-trade';
      constrained = true;
      constrainedCount++;
      noTradeCount++;
    } else if (allowedStake < PORTFOLIO_LIMITS.STAKE_SMALL) {
      finalTier = 'no-trade';
      constrained = true;
      constrainedCount++;
      noTradeCount++;
    } else {
      // Possibly downgrade tier if stake was reduced
      if (allowedStake < PORTFOLIO_LIMITS.STAKE_MEDIUM && signal.sizingTier !== 'small') {
        finalTier = 'small';
        constrained = true;
        constrainedCount++;
      } else if (allowedStake < PORTFOLIO_LIMITS.STAKE_LARGE && signal.sizingTier === 'large') {
        finalTier = 'medium';
        constrained = true;
        constrainedCount++;
      }

      tradableSignals++;
      if (finalTier === 'large') largeCount++;
      else if (finalTier === 'medium') mediumCount++;
      else if (finalTier === 'small') smallCount++;

      updateTracker(signal, allowedStake, tracker);
      totalRecommended += allowedStake;
    }

    const portfolioReason = reasons.length > 0 ? reasons.join('; ') : `${finalTier} position — ${signal.rankingReason}`;

    recommendations.push({
      signalId: signal.id,
      signalScore: signal.signalScore,
      sizingTier: finalTier,
      recommendedStakeCents: allowedStake > 0 ? allowedStake : undefined,
      maxAllowedStakeCents: allowedStake > 0 ? PORTFOLIO_LIMITS.MAX_STAKE_PER_TRADE : undefined,
      portfolioReason,
      constrained,
    });
  }

  // Build concentration tables with signal counts
  const citySignalCounts = new Map<string, number>();
  const dateSignalCounts = new Map<string, number>();
  const metricSignalCounts = new Map<string, number>();
  const sourceSignalCounts = new Map<string, number>();
  for (const s of rankedSignals) {
    if (s.locationName) citySignalCounts.set(s.locationName.toLowerCase(), (citySignalCounts.get(s.locationName.toLowerCase()) || 0) + 1);
    if (s.targetDate) dateSignalCounts.set(s.targetDate, (dateSignalCounts.get(s.targetDate) || 0) + 1);
    if (s.metric) metricSignalCounts.set(s.metric, (metricSignalCounts.get(s.metric) || 0) + 1);
    sourceSignalCounts.set(s.source, (sourceSignalCounts.get(s.source) || 0) + 1);
  }

  const concentrationByCity = buildConcentrationTable(tracker.byCity, PORTFOLIO_LIMITS.MAX_EXPOSURE_PER_CITY);
  concentrationByCity.forEach(c => { c.signalCount = citySignalCounts.get(c.key) || 0; });

  const concentrationByDate = buildConcentrationTable(tracker.byDate, PORTFOLIO_LIMITS.MAX_EXPOSURE_PER_DATE);
  concentrationByDate.forEach(c => { c.signalCount = dateSignalCounts.get(c.key) || 0; });

  const concentrationByMetric = buildConcentrationTable(tracker.byMetric, PORTFOLIO_LIMITS.MAX_EXPOSURE_PER_METRIC);
  metricSignalCounts.forEach((count, key) => {
    const entry = concentrationByMetric.find(c => c.key === key);
    if (entry) entry.signalCount = count;
  });

  const concentrationBySource = buildConcentrationTable(tracker.bySource, PORTFOLIO_LIMITS.MAX_EXPOSURE_PER_SOURCE);
  sourceSignalCounts.forEach((count, key) => {
    const entry = concentrationBySource.find(c => c.key === key);
    if (entry) entry.signalCount = count;
  });

  return {
    totalRankedSignals: rankedSignals.length,
    tradableSignals,
    smallCount,
    mediumCount,
    largeCount,
    noTradeCount,
    totalRecommendedExposureCents: totalRecommended,
    constrainedCount,
    concentrationByCity,
    concentrationByDate,
    concentrationByMetric,
    concentrationBySource,
    recommendations,
  };
}
