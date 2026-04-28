// ── Step 95: Wager Market Design Lab ─────────────────────────────────────────
//
// Pure advisory pre-publication analysis of a proposed CreateWagerInput.
// Computes fairness / fun / risk scores, an estimated house edge, narrative
// pricing notes, warnings, and recommended adjustments.
//
// SAFETY: never writes to wager:*, never calls createWager, never publishes /
// locks / grades / voids wagers. Only writes to wager-design-review:* and the
// audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import type {
  CreateWagerInput, WagerKind, WagerMetric, OddsOutcome, OverUnderSide,
} from './wager-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type Verdict = 'publishable' | 'needs_review' | 'not_recommended';

export interface MarketDesignReview {
  id: string;
  generatedAt: string;
  generatedBy: string;
  wagerKind: WagerKind | 'unknown';
  metric: WagerMetric | 'unknown';
  targetDate: string | null;
  targetTime?: string | null;
  /** Short human-readable description of the location(s). */
  locationSummary: string;

  fairnessScore: number;       // 0..100
  funScore: number;            // 0..100
  riskScore: number;           // 0..100 (higher = riskier book)
  houseEdgeEstimate: number;   // percent, e.g. 4.55 → 4.55%

  pricingNotes: string[];
  warnings: string[];
  recommendedAdjustments: string[];
  verdict: Verdict;

  /** Echo of the proposed input (for the history view / re-analysis). */
  proposedInput: CreateWagerInput;
}

export class MarketDesignError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys (advisory namespace only — never wager:*) ───────────────────

const REVIEW_PREFIX = 'wager-design-review:';
const REVIEWS_SET = 'wager-design-reviews:all';
const MAX_REVIEWS = 500;

// ── Utilities ────────────────────────────────────────────────────────────────

function newReviewId(): string {
  return `wmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** American odds → implied probability in [0, 1]. */
export function impliedProbability(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  if (odds >= 100) return 100 / (odds + 100);
  if (odds <= -100) return Math.abs(odds) / (Math.abs(odds) + 100);
  // anything between -100 and +100 is invalid American odds; treat as 0 prob
  return 0;
}

/** "Fair" pair odds for a 50% probability is -110/-110 (about 4.55% vig). */
function describeOdds(odds: number): string {
  if (!Number.isFinite(odds)) return 'invalid';
  if (odds >= 100) return `+${odds}`;
  return `${odds}`;
}

function locationSummaryOf(input: CreateWagerInput): string {
  if (input.kind === 'pointspread') {
    return `${input.locationA?.name ?? '?'} vs ${input.locationB?.name ?? '?'}`;
  }
  return input.location?.name ?? '?';
}

function isValidDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

// ── Per-kind analysis ────────────────────────────────────────────────────────

interface PartialAnalysis {
  fairnessPenalty: number;     // 0..100 deduction from 100
  funPenalty: number;          // 0..100 deduction from 100
  riskRaw: number;             // 0..100 absolute risk score
  houseEdgeEstimate: number;   // percent
  pricingNotes: string[];
  warnings: string[];
  recommendedAdjustments: string[];
  /** True if the analysis was unable to complete (e.g. missing fields). */
  blocking: boolean;
}

function analyzeOdds(input: CreateWagerInput): PartialAnalysis {
  const out: PartialAnalysis = {
    fairnessPenalty: 0, funPenalty: 0, riskRaw: 0, houseEdgeEstimate: 0,
    pricingNotes: [], warnings: [], recommendedAdjustments: [], blocking: false,
  };

  const outcomes = (input.outcomes ?? []) as OddsOutcome[];
  if (outcomes.length === 0) {
    out.blocking = true;
    out.warnings.push('No outcomes defined — odds wager needs at least one outcome.');
    return out;
  }

  // ── Outcome count & shape ──────────────────────────────────────────────────
  if (outcomes.length === 1) {
    out.warnings.push('Only one outcome — players have no real decision to make.');
    out.funPenalty += 35;
  } else if (outcomes.length === 2) {
    out.pricingNotes.push('Binary odds wager — equivalent to over/under in feel.');
    out.funPenalty += 5;
  } else if (outcomes.length >= 3 && outcomes.length <= 5) {
    out.pricingNotes.push(`${outcomes.length} outcomes — well-sized for engagement.`);
  } else if (outcomes.length === 6 || outcomes.length === 7) {
    out.pricingNotes.push(`${outcomes.length} outcomes — getting busy; consider trimming for clarity.`);
    out.funPenalty += 5;
  } else if (outcomes.length >= 8) {
    out.warnings.push(`${outcomes.length} outcomes is overwhelming — consider grouping or reducing.`);
    out.funPenalty += 15;
    out.recommendedAdjustments.push('Reduce to 5 or fewer outcomes for a clearer player decision.');
  }

  // ── Implied probability + house edge ───────────────────────────────────────
  let totalImpliedProb = 0;
  let validOddsCount = 0;
  const longshotLabels: string[] = [];
  for (const o of outcomes) {
    const p = impliedProbability(o.odds);
    if (p > 0) { totalImpliedProb += p; validOddsCount++; }
    else out.warnings.push(`Outcome "${o.label}" has invalid American odds (${o.odds}).`);
    if (o.odds >= 500) longshotLabels.push(`"${o.label}" (${describeOdds(o.odds)})`);
  }

  if (validOddsCount === 0) {
    out.blocking = true;
    out.warnings.push('No valid American odds found across outcomes.');
    return out;
  }

  const edgePct = (totalImpliedProb - 1) * 100;
  out.houseEdgeEstimate = round1(edgePct);
  out.pricingNotes.push(`Sum of implied probabilities: ${(totalImpliedProb * 100).toFixed(1)}% → estimated house edge ${out.houseEdgeEstimate >= 0 ? '+' : ''}${out.houseEdgeEstimate}%.`);

  if (edgePct < -1) {
    out.warnings.push(`Negative edge (${out.houseEdgeEstimate}%) — book pays out more than it takes in. Tighten odds.`);
    out.fairnessPenalty += 25;
    out.recommendedAdjustments.push('Tighten favorite odds (or add a small vig) so total implied probability sums to 102–108%.');
    out.riskRaw += 25;
  } else if (edgePct < 2) {
    out.pricingNotes.push('Very tight book (edge < 2%) — generous to players but thin margin.');
    out.fairnessPenalty += 0;
  } else if (edgePct <= 8) {
    out.pricingNotes.push('Edge is in the typical retail-friendly band (2–8%).');
  } else if (edgePct <= 15) {
    out.warnings.push(`Edge ${out.houseEdgeEstimate}% is high — players will notice.`);
    out.fairnessPenalty += 15;
    out.recommendedAdjustments.push('Reduce vig — ideal odds book sums to 102–108% implied probability.');
  } else if (edgePct <= 25) {
    out.warnings.push(`Edge ${out.houseEdgeEstimate}% is excessive — likely to deter players.`);
    out.fairnessPenalty += 30;
    out.recommendedAdjustments.push('Tighten odds significantly to bring edge under 10%.');
  } else {
    out.warnings.push(`Edge ${out.houseEdgeEstimate}% is uncompetitive — players will avoid this market.`);
    out.fairnessPenalty += 50;
    out.recommendedAdjustments.push('Edge above 25% is not publishable as-is; rebuild the price ladder.');
  }

  // ── Range coverage (gaps / overlaps) ───────────────────────────────────────
  const hasNumeric = outcomes.every(o => typeof o.minValue === 'number' && typeof o.maxValue === 'number');
  if (hasNumeric) {
    const sorted = [...outcomes].sort((a, b) => a.minValue - b.minValue);
    let gapCount = 0;
    let overlapCount = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const nxt = sorted[i + 1];
      if (cur.maxValue < nxt.minValue - 0.0001) {
        gapCount++;
        out.recommendedAdjustments.push(`Gap between "${cur.label}" (max ${cur.maxValue}) and "${nxt.label}" (min ${nxt.minValue}) — players cannot bet that range.`);
      } else if (cur.maxValue > nxt.minValue + 0.0001) {
        overlapCount++;
        out.warnings.push(`Outcomes "${cur.label}" and "${nxt.label}" overlap — grading will be ambiguous.`);
      }
    }
    if (gapCount > 0) {
      out.warnings.push(`${gapCount} coverage gap(s) between outcome ranges.`);
      out.fairnessPenalty += Math.min(20, gapCount * 8);
    }
    if (overlapCount > 0) {
      out.fairnessPenalty += Math.min(25, overlapCount * 10);
    }
  }

  // ── Longshot risk ──────────────────────────────────────────────────────────
  if (longshotLabels.length > 0) {
    out.pricingNotes.push(`Long-shot outcome${longshotLabels.length === 1 ? '' : 's'}: ${longshotLabels.join(', ')} — large potential payout(s).`);
    out.riskRaw += Math.min(35, longshotLabels.length * 15);
    if (longshotLabels.length >= 3) {
      out.warnings.push('Three or more long-shot outcomes — book is heavily skewed by tail outcomes.');
      out.recommendedAdjustments.push('Consolidate long-shot outcomes into a single tail bucket to bound liability.');
    }
  }

  // ── Implied-probability balance (no single outcome > 80%) ──────────────────
  const maxImplied = Math.max(...outcomes.map(o => impliedProbability(o.odds)));
  if (maxImplied > 0.8) {
    out.warnings.push(`A single outcome has ${(maxImplied * 100).toFixed(0)}% implied probability — players will see no value.`);
    out.funPenalty += 20;
    out.recommendedAdjustments.push('Re-balance outcomes — no single outcome should imply > 70% probability.');
  } else if (maxImplied > 0.7) {
    out.pricingNotes.push(`Top outcome implies ${(maxImplied * 100).toFixed(0)}% — borderline lopsided.`);
    out.funPenalty += 8;
  }

  return out;
}

function analyzeOverUnder(input: CreateWagerInput): PartialAnalysis {
  const out: PartialAnalysis = {
    fairnessPenalty: 0, funPenalty: 0, riskRaw: 0, houseEdgeEstimate: 0,
    pricingNotes: [], warnings: [], recommendedAdjustments: [], blocking: false,
  };

  const over = input.over as OverUnderSide | undefined;
  const under = input.under as OverUnderSide | undefined;
  const line = input.line;

  if (typeof line !== 'number') {
    out.blocking = true;
    out.warnings.push('Line is not set — over/under requires a numeric line.');
    return out;
  }
  if (!over || !Number.isFinite(over.odds) || !under || !Number.isFinite(under.odds)) {
    out.blocking = true;
    out.warnings.push('Over and under odds must both be valid American odds.');
    return out;
  }

  const pOver = impliedProbability(over.odds);
  const pUnder = impliedProbability(under.odds);
  const total = pOver + pUnder;
  const edgePct = (total - 1) * 100;
  out.houseEdgeEstimate = round1(edgePct);

  out.pricingNotes.push(`Line ${line} on ${input.metric}; over ${describeOdds(over.odds)} (${(pOver * 100).toFixed(1)}%) / under ${describeOdds(under.odds)} (${(pUnder * 100).toFixed(1)}%).`);
  out.pricingNotes.push(`Sum implied probability ${(total * 100).toFixed(1)}% → edge ${out.houseEdgeEstimate >= 0 ? '+' : ''}${out.houseEdgeEstimate}%.`);

  // Edge band
  if (edgePct < -1) {
    out.warnings.push('Negative edge — over/under priced too generously.');
    out.fairnessPenalty += 25;
    out.recommendedAdjustments.push('Move both sides toward -110 to restore typical 4.5% vig.');
  } else if (edgePct < 2) {
    out.pricingNotes.push('Very tight book; thin margin.');
  } else if (edgePct <= 8) {
    out.pricingNotes.push('Edge in the standard retail band (2–8%).');
  } else if (edgePct <= 15) {
    out.warnings.push(`Edge ${out.houseEdgeEstimate}% is high.`);
    out.fairnessPenalty += 15;
    out.recommendedAdjustments.push('Reduce vig to ~5% (-110/-110 reference).');
  } else {
    out.warnings.push(`Edge ${out.houseEdgeEstimate}% is excessive.`);
    out.fairnessPenalty += 30;
    out.recommendedAdjustments.push('Edge >15% will deter players — rebuild over/under odds toward -110/-110.');
  }

  // Symmetry check
  const skew = Math.abs(pOver - pUnder);
  if (skew > 0.15) {
    out.warnings.push(`Significant side skew (${(skew * 100).toFixed(0)}%) — implied probabilities lopsided.`);
    out.fairnessPenalty += 10;
    out.riskRaw += 15;
    out.recommendedAdjustments.push(`Either move the line ${pOver > pUnder ? 'up' : 'down'} or rebalance the odds so each side implies ~50%.`);
  } else if (skew > 0.07) {
    out.pricingNotes.push(`Mild side skew (${(skew * 100).toFixed(0)}%) — acceptable.`);
  }

  // Fun: clean over/under is a fun-by-default market
  out.funPenalty += 0;

  return out;
}

function analyzePointspread(input: CreateWagerInput): PartialAnalysis {
  const out: PartialAnalysis = {
    fairnessPenalty: 0, funPenalty: 0, riskRaw: 0, houseEdgeEstimate: 0,
    pricingNotes: [], warnings: [], recommendedAdjustments: [], blocking: false,
  };

  if (typeof input.spread !== 'number'
      || typeof input.locationAOdds !== 'number'
      || typeof input.locationBOdds !== 'number') {
    out.blocking = true;
    out.warnings.push('Pointspread requires a numeric spread plus both location odds.');
    return out;
  }

  const pA = impliedProbability(input.locationAOdds);
  const pB = impliedProbability(input.locationBOdds);
  const total = pA + pB;
  const edgePct = (total - 1) * 100;
  out.houseEdgeEstimate = round1(edgePct);

  out.pricingNotes.push(
    `Spread ${input.spread > 0 ? '+' : ''}${input.spread} (${input.locationA?.name ?? 'A'} − ${input.locationB?.name ?? 'B'}); ` +
    `${input.locationA?.name ?? 'A'} ${describeOdds(input.locationAOdds)} (${(pA * 100).toFixed(1)}%) / ` +
    `${input.locationB?.name ?? 'B'} ${describeOdds(input.locationBOdds)} (${(pB * 100).toFixed(1)}%).`,
  );
  out.pricingNotes.push(`Sum implied probability ${(total * 100).toFixed(1)}% → edge ${out.houseEdgeEstimate >= 0 ? '+' : ''}${out.houseEdgeEstimate}%.`);

  // Edge band
  if (edgePct < -1) {
    out.warnings.push('Negative edge — pointspread priced too generously.');
    out.fairnessPenalty += 25;
    out.recommendedAdjustments.push('Move both sides toward -110 to restore typical 4.5% vig.');
  } else if (edgePct < 2) {
    out.pricingNotes.push('Very tight book; thin margin.');
  } else if (edgePct <= 8) {
    out.pricingNotes.push('Edge in the standard retail band (2–8%).');
  } else if (edgePct <= 15) {
    out.warnings.push(`Edge ${out.houseEdgeEstimate}% is high.`);
    out.fairnessPenalty += 15;
    out.recommendedAdjustments.push('Reduce vig to ~5% (-110/-110 reference).');
  } else {
    out.warnings.push(`Edge ${out.houseEdgeEstimate}% is excessive.`);
    out.fairnessPenalty += 30;
  }

  // Skew
  const skew = Math.abs(pA - pB);
  if (skew > 0.20) {
    out.warnings.push(`Heavy side skew (${(skew * 100).toFixed(0)}%) — one location is a strong favorite at this spread.`);
    out.fairnessPenalty += 15;
    out.riskRaw += 15;
    out.recommendedAdjustments.push('Adjust the spread or rebalance odds so each side sits within ~10pp of the other.');
  } else if (skew > 0.10) {
    out.pricingNotes.push(`Moderate side skew (${(skew * 100).toFixed(0)}%) — acceptable.`);
  }

  // Spread magnitude — large spreads (>20°F or >30 mph) → likely lopsided market
  const absSpread = Math.abs(input.spread);
  if (absSpread > 30) {
    out.warnings.push(`Spread magnitude ${absSpread} is unusually large — outcome is nearly determined.`);
    out.funPenalty += 25;
    out.recommendedAdjustments.push('Consider a different location pair — current spread implies a near-certain outcome.');
  } else if (absSpread > 20) {
    out.pricingNotes.push(`Large spread (${absSpread}) — fewer players will perceive value on the underdog.`);
    out.funPenalty += 10;
  }

  return out;
}

// ── Universal checks (timing / metadata / location) ─────────────────────────

function universalChecks(input: CreateWagerInput): { warnings: string[]; recommendations: string[]; riskAdjust: number; funAdjust: number; blocking: boolean } {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  let riskAdjust = 0;
  let funAdjust = 0;
  let blocking = false;

  // Title
  if (!input.title || !input.title.trim()) {
    warnings.push('Title is missing.');
    blocking = true;
  } else if (input.title.length > 200) {
    warnings.push('Title exceeds 200 characters — will be rejected by validation.');
    blocking = true;
  }

  // Date
  if (!isValidDate(input.targetDate)) {
    warnings.push('targetDate must be a valid YYYY-MM-DD value.');
    blocking = true;
  } else {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (input.targetDate < todayStr) {
      warnings.push(`Target date ${input.targetDate} is in the past — wager would lock immediately.`);
      blocking = true;
    } else if (input.targetDate === todayStr) {
      // same-day wagers are fun + high engagement
      funAdjust += 5;
    } else {
      const days = Math.floor((new Date(input.targetDate).getTime() - new Date(todayStr).getTime()) / 86_400_000);
      if (days > 14) {
        funAdjust -= 10;
        warnings.push(`Target date is ${days} days out — engagement drops sharply for far-out markets.`);
        recommendations.push('Consider opening this wager closer to the target date (≤7 days).');
      } else if (days > 7) {
        funAdjust -= 4;
      }
    }
  }

  // targetTime (for by-time metrics) is HH:MM
  if (input.targetTime != null && input.targetTime !== '' && !/^\d{2}:\d{2}$/.test(input.targetTime)) {
    warnings.push(`targetTime "${input.targetTime}" is not in HH:MM format.`);
    blocking = true;
  }

  // Location presence
  if (input.kind === 'odds' || input.kind === 'over-under') {
    if (!input.location?.name || typeof input.location.lat !== 'number' || typeof input.location.lon !== 'number') {
      warnings.push('Location is missing or incomplete — wager needs name, lat, and lon.');
      blocking = true;
    }
  } else if (input.kind === 'pointspread') {
    if (!input.locationA?.name || typeof input.locationA.lat !== 'number' || typeof input.locationA.lon !== 'number') {
      warnings.push('Location A is missing or incomplete.');
      blocking = true;
    }
    if (!input.locationB?.name || typeof input.locationB.lat !== 'number' || typeof input.locationB.lon !== 'number') {
      warnings.push('Location B is missing or incomplete.');
      blocking = true;
    }
    if (input.locationA?.name && input.locationB?.name && input.locationA.name === input.locationB.name) {
      warnings.push('Location A and Location B are the same — pointspread requires two distinct locations.');
      blocking = true;
    }
  }

  // Metric vs targetTime: by-time metrics implied by targetTime presence
  // We don't enforce this strictly here; just nudge.
  const isByTime = input.targetTime != null && input.targetTime !== '';
  if (isByTime && (input.metric === 'high_temp' || input.metric === 'low_temp')) {
    warnings.push(`Metric "${input.metric}" is a daily aggregate — pairing with a specific time may confuse players.`);
    recommendations.push('Use actual_temp / actual_wind / actual_gust for by-time wagers; high_temp / low_temp for by-day.');
  }
  if (!isByTime && (input.metric === 'actual_temp' || input.metric === 'actual_wind' || input.metric === 'actual_gust')) {
    recommendations.push('Without a target time, the "actual_*" metric will resolve at end-of-day — confirm that matches your intent.');
  }

  // Description length
  if (input.description && input.description.length > 500) {
    warnings.push('Description is very long — consider trimming for player clarity.');
    funAdjust -= 3;
  }

  // Pricing snapshot presence is a soft positive
  if (input.pricingSnapshot) {
    funAdjust += 2;
  } else {
    recommendations.push('Attach a pricing snapshot ("Generate Suggested Lines") so opening odds are documented.');
  }

  return { warnings, recommendations, riskAdjust, funAdjust, blocking };
}

// ── Main analyzer ────────────────────────────────────────────────────────────

function deriveVerdict(opts: { blocking: boolean; warningCount: number; fairnessScore: number; edgePct: number }): Verdict {
  if (opts.blocking) return 'not_recommended';
  if (opts.edgePct > 25 || opts.edgePct < -5) return 'not_recommended';
  if (opts.fairnessScore < 50) return 'not_recommended';
  if (opts.warningCount >= 2 || opts.fairnessScore < 75) return 'needs_review';
  return 'publishable';
}

export interface AnalyzeOptions {
  reviewerId: string;
  /** Default true — persists the review and audit-logs. */
  persist?: boolean;
}

export async function analyzeMarketDesign(input: CreateWagerInput, opts: AnalyzeOptions): Promise<MarketDesignReview> {
  if (!opts || !opts.reviewerId) throw new MarketDesignError('reviewerId is required', 'reviewer_required');
  if (!input || typeof input !== 'object') throw new MarketDesignError('CreateWagerInput is required', 'input_required');

  const universal = universalChecks(input);
  let kindAnalysis: PartialAnalysis;
  if (input.kind === 'odds') kindAnalysis = analyzeOdds(input);
  else if (input.kind === 'over-under') kindAnalysis = analyzeOverUnder(input);
  else if (input.kind === 'pointspread') kindAnalysis = analyzePointspread(input);
  else {
    kindAnalysis = {
      fairnessPenalty: 100, funPenalty: 100, riskRaw: 0, houseEdgeEstimate: 0,
      pricingNotes: [], warnings: [`Unknown wager kind "${input.kind}".`], recommendedAdjustments: [],
      blocking: true,
    };
  }

  const blocking = universal.blocking || kindAnalysis.blocking;
  const allWarnings = [...universal.warnings, ...kindAnalysis.warnings];
  const allRecommendations = [...kindAnalysis.recommendedAdjustments, ...universal.recommendations];

  const fairnessScore = clamp(100 - kindAnalysis.fairnessPenalty);
  const funScore = clamp(100 - kindAnalysis.funPenalty + universal.funAdjust);
  const riskScore = clamp(kindAnalysis.riskRaw + universal.riskAdjust);

  const verdict = deriveVerdict({
    blocking,
    warningCount: allWarnings.length,
    fairnessScore,
    edgePct: kindAnalysis.houseEdgeEstimate,
  });

  const id = newReviewId();
  const now = new Date().toISOString();
  const review: MarketDesignReview = {
    id,
    generatedAt: now,
    generatedBy: opts.reviewerId,
    wagerKind: (input.kind as WagerKind) ?? 'unknown',
    metric: (input.metric as WagerMetric) ?? 'unknown',
    targetDate: typeof input.targetDate === 'string' ? input.targetDate : null,
    targetTime: input.targetTime ?? null,
    locationSummary: locationSummaryOf(input),
    fairnessScore,
    funScore,
    riskScore,
    houseEdgeEstimate: kindAnalysis.houseEdgeEstimate,
    pricingNotes: kindAnalysis.pricingNotes,
    warnings: allWarnings,
    recommendedAdjustments: allRecommendations,
    verdict,
    proposedInput: input,
  };

  if (opts.persist !== false) {
    const redis = getRedis();
    await redis.set(`${REVIEW_PREFIX}${id}`, JSON.stringify(review));
    await redis.zadd(REVIEWS_SET, { score: Date.now(), member: id });
    await trimToCap(redis);

    await logAuditEvent({
      actor: opts.reviewerId,
      eventType: 'wager_market_design_review_generated',
      targetType: 'wager_proposal',
      targetId: id,
      summary: `Market design review ${id} (${review.wagerKind}, verdict=${verdict}, edge=${review.houseEdgeEstimate}%)`,
      details: {
        reviewId: id, verdict, wagerKind: review.wagerKind, metric: review.metric,
        targetDate: review.targetDate, targetTime: review.targetTime,
        locationSummary: review.locationSummary,
        fairnessScore: review.fairnessScore, funScore: review.funScore, riskScore: review.riskScore,
        houseEdgeEstimate: review.houseEdgeEstimate,
        warningCount: allWarnings.length,
      },
    });
  }

  return review;
}

// ── Listing / retrieval ──────────────────────────────────────────────────────

export async function listMarketDesignReviews(limit = 100): Promise<MarketDesignReview[]> {
  const redis = getRedis();
  const total = await redis.zcard(REVIEWS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(REVIEWS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: MarketDesignReview[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${REVIEW_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function getMarketDesignReview(id: string): Promise<MarketDesignReview | null> {
  const redis = getRedis();
  const raw = await redis.get(`${REVIEW_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as MarketDesignReview);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(REVIEWS_SET);
  if (total <= MAX_REVIEWS) return;
  const overflow = total - MAX_REVIEWS;
  const oldest = await redis.zrange(REVIEWS_SET, 0, overflow - 1);
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(REVIEWS_SET, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${REVIEW_PREFIX}${oldId}`);
  }
}
