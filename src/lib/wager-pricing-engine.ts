// ── Step 96: Wager Pricing & Margin Engine ──────────────────────────────────
//
// Converts true probabilities (or vig-stripped current odds) into suggested
// American odds with a configurable house margin. Pure advisory: never
// imports createWager, never writes to wager:*, never publishes/locks/grades
// or otherwise mutates an existing wager. Records persist to
// wager-pricing-rec:* and the audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import type {
  CreateWagerInput, WagerKind, WagerMetric, OddsOutcome, OverUnderSide,
} from './wager-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type PricingMode = 'fair' | 'standard_margin' | 'aggressive_margin' | 'custom_margin';
export type Verdict = 'usable' | 'needs_review' | 'not_recommended';

export interface SuggestedOddsOdds {
  /** Per-outcome suggestion (matches order of input.outcomes). */
  outcomes: { label: string; suggestedOdds: number; impliedProbability: number; fairOdds: number; fairProbability: number }[];
}
export interface SuggestedOddsOverUnder {
  line: number;
  over: { suggestedOdds: number; impliedProbability: number; fairOdds: number; fairProbability: number };
  under: { suggestedOdds: number; impliedProbability: number; fairOdds: number; fairProbability: number };
}
export interface SuggestedOddsPointspread {
  spread: number;
  locationA: { suggestedOdds: number; impliedProbability: number; fairOdds: number; fairProbability: number };
  locationB: { suggestedOdds: number; impliedProbability: number; fairOdds: number; fairProbability: number };
}

/** Optional probability overrides — values must be in [0, 1]. */
export interface FairProbabilityOverrides {
  /** Odds wager: per-outcome probabilities, length must match outcomes; will be normalized. */
  outcomes?: number[];
  /** Over-under: probability of over (under is 1 - over). */
  over?: number;
  /** Pointspread: probability of locationA winning vs spread (locationB is 1 - locationA). */
  locationA?: number;
}

export interface PricingRecommendation {
  id: string;
  generatedAt: string;
  generatedBy: string;
  wagerKind: WagerKind | 'unknown';
  metric: WagerMetric | 'unknown';
  targetDate: string | null;
  targetTime?: string | null;
  pricingMode: PricingMode;
  /** Effective margin in percent (e.g. 6.0). */
  marginPct: number;

  /** Vig-stripped probabilities used as the "true" baseline (sum to 1). */
  fairProbabilities: number[];
  /** American odds corresponding to fairProbabilities (rounded to nearest 5). */
  fairOdds: number[];
  /** American odds with margin applied (rounded to nearest 5). */
  suggestedOdds: number[];
  /** Implied probabilities of suggestedOdds (sum to ~1 + margin/100). */
  impliedProbabilities: number[];
  /** Estimated hold = sum(impliedProbabilities) - 1, in percent. */
  estimatedHoldPct: number;

  /** Kind-specific structured suggestion suitable for UI/auto-apply. */
  suggestion: { kind: 'odds'; odds: SuggestedOddsOdds }
            | { kind: 'over-under'; overUnder: SuggestedOddsOverUnder }
            | { kind: 'pointspread'; pointspread: SuggestedOddsPointspread }
            | { kind: 'unknown' };

  notes: string[];
  warnings: string[];
  recommendedLineAdjustment?: string;
  verdict: Verdict;

  /** Echo of the proposal for the history view / re-application. */
  proposedInput: CreateWagerInput;
}

export class PricingEngineError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MARGIN: Record<PricingMode, number> = {
  fair: 0,
  standard_margin: 6,
  aggressive_margin: 10,
  custom_margin: 6, // unused — caller provides customMarginPct
};

const MAX_CUSTOM_MARGIN = 20;
const MIN_CUSTOM_MARGIN = 0;

const REC_PREFIX = 'wager-pricing-rec:';
const RECS_SET = 'wager-pricing-recs:all';
const MAX_RECS = 500;

// ── Utility math ─────────────────────────────────────────────────────────────

/** American odds → implied probability in [0, 1]. */
export function impliedProbability(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  if (odds >= 100) return 100 / (odds + 100);
  if (odds <= -100) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 0;
}

/**
 * Probability → American odds. Returns 0 for invalid (p ≤ 0 or p ≥ 1).
 * For p === 0.5 returns -100 (mathematically -100 = +100 in implied prob).
 */
export function americanOddsForProbability(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return 0;
  if (p >= 0.5) return -1 * (100 * p) / (1 - p); // negative
  return 100 * (1 - p) / p; // positive
}

/** Round American odds to the nearest 5; clamp at +/-100 boundary by sign preservation. */
function roundOddsTo5(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  const sign = odds < 0 ? -1 : 1;
  const abs = Math.abs(odds);
  const rounded = Math.round(abs / 5) * 5;
  // Don't allow odds in (-100, +100) which is invalid American format
  const safe = Math.max(100, rounded);
  return sign * safe;
}

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

function newRecId(): string {
  return `wpr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Per-kind pricing ─────────────────────────────────────────────────────────

interface BuildResult {
  fairProbabilities: number[];
  fairOdds: number[];
  suggestedOdds: number[];
  impliedProbabilities: number[];
  notes: string[];
  warnings: string[];
  recommendedLineAdjustment?: string;
  blocking: boolean;
}

function buildFromOdds(currentOddsArray: number[]): { probs: number[]; warning?: string } {
  // Strip vig: normalize implied probabilities so they sum to 1.
  const implieds = currentOddsArray.map(impliedProbability);
  const total = implieds.reduce((s, x) => s + x, 0);
  if (total <= 0) return { probs: [], warning: 'Could not derive fair probabilities from current odds.' };
  return { probs: implieds.map(p => p / total) };
}

function applyMarginProportional(fair: number[], marginPct: number): number[] {
  const factor = 1 + (marginPct / 100);
  return fair.map(p => p * factor);
}

function priceOdds(
  proposal: CreateWagerInput,
  marginPct: number,
  overrides: FairProbabilityOverrides | undefined,
): BuildResult {
  const out: BuildResult = {
    fairProbabilities: [], fairOdds: [], suggestedOdds: [], impliedProbabilities: [],
    notes: [], warnings: [], blocking: false,
  };

  const outcomes = (proposal.outcomes ?? []) as OddsOutcome[];
  if (outcomes.length === 0) {
    out.blocking = true;
    out.warnings.push('No outcomes defined — odds wager needs at least one outcome.');
    return out;
  }

  // 1. Determine fair probabilities
  let fair: number[];
  if (overrides?.outcomes && overrides.outcomes.length === outcomes.length) {
    const sum = overrides.outcomes.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
    if (sum <= 0) {
      out.blocking = true;
      out.warnings.push('Override fair probabilities sum to zero.');
      return out;
    }
    fair = overrides.outcomes.map(p => p / sum);
    out.notes.push('Fair probabilities sourced from operator override (normalized to 1.00).');
  } else {
    const built = buildFromOdds(outcomes.map(o => Number(o.odds)));
    if (built.warning) {
      out.blocking = true;
      out.warnings.push(built.warning);
      return out;
    }
    fair = built.probs;
    out.notes.push('Fair probabilities derived by stripping vig from current outcome odds.');
  }

  // 2. Apply margin
  const target = applyMarginProportional(fair, marginPct);

  // 3. Convert
  const fairOdds = fair.map(p => roundOddsTo5(americanOddsForProbability(p)));
  const suggested = target.map(p => roundOddsTo5(americanOddsForProbability(p)));
  const implieds = suggested.map(impliedProbability);

  out.fairProbabilities = fair;
  out.fairOdds = fairOdds;
  out.suggestedOdds = suggested;
  out.impliedProbabilities = implieds;

  // Per-outcome guardrails
  outcomes.forEach((o, i) => {
    if (!Number.isFinite(suggested[i]) || suggested[i] === 0) {
      out.warnings.push(`Outcome "${o.label}" — could not produce valid odds (probability ~ ${(target[i] * 100).toFixed(1)}%).`);
    }
    if (suggested[i] >= 1000 || suggested[i] <= -1000) {
      out.warnings.push(`Outcome "${o.label}" suggested odds ${suggested[i] > 0 ? '+' + suggested[i] : suggested[i]} are extreme.`);
    }
  });

  return out;
}

function priceOverUnder(
  proposal: CreateWagerInput,
  marginPct: number,
  overrides: FairProbabilityOverrides | undefined,
): BuildResult {
  const out: BuildResult = {
    fairProbabilities: [], fairOdds: [], suggestedOdds: [], impliedProbabilities: [],
    notes: [], warnings: [], blocking: false,
  };

  const over = proposal.over as OverUnderSide | undefined;
  const under = proposal.under as OverUnderSide | undefined;

  let fairOver: number;
  if (typeof overrides?.over === 'number' && overrides.over > 0 && overrides.over < 1) {
    fairOver = overrides.over;
    out.notes.push(`Fair probability of over sourced from operator override: ${(fairOver * 100).toFixed(1)}%.`);
  } else if (over && Number.isFinite(over.odds) && under && Number.isFinite(under.odds)) {
    const built = buildFromOdds([Number(over.odds), Number(under.odds)]);
    if (built.warning) {
      out.blocking = true;
      out.warnings.push(built.warning);
      return out;
    }
    fairOver = built.probs[0];
    out.notes.push(`Fair probability of over derived by stripping vig from current odds: ${(fairOver * 100).toFixed(1)}%.`);
  } else {
    out.blocking = true;
    out.warnings.push('Need either current over/under odds or an override probability for over.');
    return out;
  }
  const fairUnder = 1 - fairOver;

  const target = applyMarginProportional([fairOver, fairUnder], marginPct);
  const fairOdds = [
    roundOddsTo5(americanOddsForProbability(fairOver)),
    roundOddsTo5(americanOddsForProbability(fairUnder)),
  ];
  const suggested = target.map(p => roundOddsTo5(americanOddsForProbability(p)));
  const implieds = suggested.map(impliedProbability);

  out.fairProbabilities = [fairOver, fairUnder];
  out.fairOdds = fairOdds;
  out.suggestedOdds = suggested;
  out.impliedProbabilities = implieds;

  // Coherence check
  if (suggested[0] === 0 || suggested[1] === 0) {
    out.warnings.push('One side could not be priced — fair probability is too extreme.');
    out.recommendedLineAdjustment = 'Consider moving the line so each side has at least ~10% fair probability.';
  } else {
    suggested.forEach((s, i) => {
      const sideName = i === 0 ? 'over' : 'under';
      if (s >= 1000 || s <= -1000) {
        out.warnings.push(`${sideName} suggested odds ${s > 0 ? '+' + s : s} are extreme.`);
      }
    });
  }

  // Suggest line adjustment if fair prob is far from 50/50 (heavy skew)
  const skew = Math.abs(fairOver - 0.5);
  if (skew > 0.18) {
    out.recommendedLineAdjustment = `Fair probability is ${(fairOver * 100).toFixed(1)}/${(fairUnder * 100).toFixed(1)} — consider moving the line ${fairOver > 0.5 ? 'up' : 'down'} so the implied true probability is closer to 50/50.`;
  }

  return out;
}

function pricePointspread(
  proposal: CreateWagerInput,
  marginPct: number,
  overrides: FairProbabilityOverrides | undefined,
): BuildResult {
  const out: BuildResult = {
    fairProbabilities: [], fairOdds: [], suggestedOdds: [], impliedProbabilities: [],
    notes: [], warnings: [], blocking: false,
  };

  let fairA: number;
  if (typeof overrides?.locationA === 'number' && overrides.locationA > 0 && overrides.locationA < 1) {
    fairA = overrides.locationA;
    out.notes.push(`Fair probability of locationA sourced from operator override: ${(fairA * 100).toFixed(1)}%.`);
  } else if (Number.isFinite(proposal.locationAOdds) && Number.isFinite(proposal.locationBOdds)) {
    const built = buildFromOdds([Number(proposal.locationAOdds), Number(proposal.locationBOdds)]);
    if (built.warning) {
      out.blocking = true;
      out.warnings.push(built.warning);
      return out;
    }
    fairA = built.probs[0];
    out.notes.push(`Fair probability of locationA derived by stripping vig: ${(fairA * 100).toFixed(1)}%.`);
  } else {
    out.blocking = true;
    out.warnings.push('Need either current location odds or an override probability for locationA.');
    return out;
  }
  const fairB = 1 - fairA;

  const target = applyMarginProportional([fairA, fairB], marginPct);
  const fairOdds = [
    roundOddsTo5(americanOddsForProbability(fairA)),
    roundOddsTo5(americanOddsForProbability(fairB)),
  ];
  const suggested = target.map(p => roundOddsTo5(americanOddsForProbability(p)));
  const implieds = suggested.map(impliedProbability);

  out.fairProbabilities = [fairA, fairB];
  out.fairOdds = fairOdds;
  out.suggestedOdds = suggested;
  out.impliedProbabilities = implieds;

  if (suggested[0] === 0 || suggested[1] === 0) {
    out.warnings.push('One side could not be priced — fair probability is too extreme.');
    out.recommendedLineAdjustment = 'Consider adjusting the spread so each side has at least ~10% fair probability.';
  } else {
    suggested.forEach((s, i) => {
      if (s >= 1000 || s <= -1000) {
        out.warnings.push(`location${i === 0 ? 'A' : 'B'} suggested odds ${s > 0 ? '+' + s : s} are extreme.`);
      }
    });
  }

  const skew = Math.abs(fairA - 0.5);
  if (skew > 0.18) {
    out.recommendedLineAdjustment = `Fair probability of locationA is ${(fairA * 100).toFixed(1)}% — consider adjusting the spread to bring both sides closer to 50/50.`;
  }

  return out;
}

// ── Verdict ──────────────────────────────────────────────────────────────────

function deriveVerdict(opts: { blocking: boolean; estimatedHoldPct: number; warningCount: number }): Verdict {
  if (opts.blocking) return 'not_recommended';
  if (opts.estimatedHoldPct > 25) return 'not_recommended';
  if (opts.estimatedHoldPct < 0) return 'needs_review';      // negative hold → still surfaces but not auto-not_recommended
  if (opts.warningCount >= 2) return 'needs_review';
  return 'usable';
}

// ── Main ─────────────────────────────────────────────────────────────────────

export interface PricingOptions {
  pricingMode: PricingMode;
  /** Required only when pricingMode === 'custom_margin'. */
  customMarginPct?: number;
  /** Optional fair probability overrides per kind. */
  fairProbabilities?: FairProbabilityOverrides;
  /** Default true — persist + audit-log. */
  persist?: boolean;
}

export async function generatePricingRecommendation(
  input: CreateWagerInput,
  actor: string,
  options: PricingOptions,
): Promise<PricingRecommendation> {
  if (!actor) throw new PricingEngineError('actor is required', 'actor_required');
  if (!input || typeof input !== 'object') throw new PricingEngineError('CreateWagerInput is required', 'input_required');
  if (!options || !options.pricingMode) throw new PricingEngineError('pricingMode is required', 'mode_required');

  // Determine effective margin
  let marginPct: number;
  if (options.pricingMode === 'custom_margin') {
    const c = Number(options.customMarginPct);
    if (!Number.isFinite(c)) throw new PricingEngineError('customMarginPct is required for custom_margin', 'custom_margin_required');
    if (c < MIN_CUSTOM_MARGIN || c > MAX_CUSTOM_MARGIN) {
      throw new PricingEngineError(`customMarginPct must be between ${MIN_CUSTOM_MARGIN} and ${MAX_CUSTOM_MARGIN}`, 'custom_margin_out_of_range');
    }
    marginPct = c;
  } else {
    marginPct = DEFAULT_MARGIN[options.pricingMode];
  }
  marginPct = clamp(marginPct, MIN_CUSTOM_MARGIN, MAX_CUSTOM_MARGIN);

  // Per-kind pricing
  let result: BuildResult;
  if (input.kind === 'odds') result = priceOdds(input, marginPct, options.fairProbabilities);
  else if (input.kind === 'over-under') result = priceOverUnder(input, marginPct, options.fairProbabilities);
  else if (input.kind === 'pointspread') result = pricePointspread(input, marginPct, options.fairProbabilities);
  else {
    result = {
      fairProbabilities: [], fairOdds: [], suggestedOdds: [], impliedProbabilities: [],
      notes: [], warnings: [`Unknown wager kind "${input.kind}".`], blocking: true,
    };
  }

  // Estimated hold
  const totalImplied = result.impliedProbabilities.reduce((s, x) => s + x, 0);
  const estimatedHoldPct = result.impliedProbabilities.length === 0 ? 0 : Math.round(((totalImplied - 1) * 100) * 10) / 10;

  // Universal warnings
  if (result.impliedProbabilities.length > 0 && estimatedHoldPct < 0) {
    result.warnings.unshift(`Negative hold (${estimatedHoldPct}%) — book pays out more than it takes in.`);
  }
  if (estimatedHoldPct > 25) {
    result.warnings.unshift(`Estimated hold ${estimatedHoldPct}% exceeds 25% — markets will not attract players.`);
  }

  const verdict = deriveVerdict({
    blocking: result.blocking,
    estimatedHoldPct,
    warningCount: result.warnings.length,
  });

  // Build kind-specific suggestion payload
  let suggestion: PricingRecommendation['suggestion'];
  if (input.kind === 'odds') {
    const outcomes = (input.outcomes ?? []) as OddsOutcome[];
    suggestion = {
      kind: 'odds',
      odds: {
        outcomes: outcomes.map((o, i) => ({
          label: o.label,
          suggestedOdds: result.suggestedOdds[i] ?? 0,
          impliedProbability: result.impliedProbabilities[i] ?? 0,
          fairOdds: result.fairOdds[i] ?? 0,
          fairProbability: result.fairProbabilities[i] ?? 0,
        })),
      },
    };
  } else if (input.kind === 'over-under') {
    suggestion = {
      kind: 'over-under',
      overUnder: {
        line: Number(input.line),
        over:  { suggestedOdds: result.suggestedOdds[0] ?? 0, impliedProbability: result.impliedProbabilities[0] ?? 0, fairOdds: result.fairOdds[0] ?? 0, fairProbability: result.fairProbabilities[0] ?? 0 },
        under: { suggestedOdds: result.suggestedOdds[1] ?? 0, impliedProbability: result.impliedProbabilities[1] ?? 0, fairOdds: result.fairOdds[1] ?? 0, fairProbability: result.fairProbabilities[1] ?? 0 },
      },
    };
  } else if (input.kind === 'pointspread') {
    suggestion = {
      kind: 'pointspread',
      pointspread: {
        spread: Number(input.spread),
        locationA: { suggestedOdds: result.suggestedOdds[0] ?? 0, impliedProbability: result.impliedProbabilities[0] ?? 0, fairOdds: result.fairOdds[0] ?? 0, fairProbability: result.fairProbabilities[0] ?? 0 },
        locationB: { suggestedOdds: result.suggestedOdds[1] ?? 0, impliedProbability: result.impliedProbabilities[1] ?? 0, fairOdds: result.fairOdds[1] ?? 0, fairProbability: result.fairProbabilities[1] ?? 0 },
      },
    };
  } else {
    suggestion = { kind: 'unknown' };
  }

  const id = newRecId();
  const now = new Date().toISOString();
  const rec: PricingRecommendation = {
    id,
    generatedAt: now,
    generatedBy: actor,
    wagerKind: (input.kind as WagerKind) ?? 'unknown',
    metric: (input.metric as WagerMetric) ?? 'unknown',
    targetDate: typeof input.targetDate === 'string' ? input.targetDate : null,
    targetTime: input.targetTime ?? null,
    pricingMode: options.pricingMode,
    marginPct,
    fairProbabilities: result.fairProbabilities,
    fairOdds: result.fairOdds,
    suggestedOdds: result.suggestedOdds,
    impliedProbabilities: result.impliedProbabilities,
    estimatedHoldPct,
    suggestion,
    notes: result.notes,
    warnings: result.warnings,
    recommendedLineAdjustment: result.recommendedLineAdjustment,
    verdict,
    proposedInput: input,
  };

  if (options.persist !== false) {
    const redis = getRedis();
    await redis.set(`${REC_PREFIX}${id}`, JSON.stringify(rec));
    await redis.zadd(RECS_SET, { score: Date.now(), member: id });
    await trimToCap(redis);

    await logAuditEvent({
      actor,
      eventType: 'wager_pricing_recommendation_generated',
      targetType: 'wager_proposal',
      targetId: id,
      summary: `Pricing recommendation ${id} (${rec.wagerKind}, mode=${rec.pricingMode}, margin=${marginPct}%, hold=${estimatedHoldPct}%, verdict=${verdict})`,
      details: {
        recId: id, verdict, wagerKind: rec.wagerKind, metric: rec.metric,
        pricingMode: rec.pricingMode, marginPct, estimatedHoldPct,
        warningCount: rec.warnings.length,
      },
    });
  }

  return rec;
}

// ── Listing / retrieval ──────────────────────────────────────────────────────

export async function listPricingRecommendations(limit = 100): Promise<PricingRecommendation[]> {
  const redis = getRedis();
  const total = await redis.zcard(RECS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(RECS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: PricingRecommendation[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${REC_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function getPricingRecommendation(id: string): Promise<PricingRecommendation | null> {
  const redis = getRedis();
  const raw = await redis.get(`${REC_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as PricingRecommendation);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(RECS_SET);
  if (total <= MAX_RECS) return;
  const overflow = total - MAX_RECS;
  const oldest = await redis.zrange(RECS_SET, 0, overflow - 1);
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(RECS_SET, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${REC_PREFIX}${oldId}`);
  }
}
