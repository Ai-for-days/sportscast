// ── Step 156: Historical outcome memory + interestingness scoring ───────
//
// Builds compact admin-only historical features from resolved /
// voided weather wagers, then scores a generated idea against the
// memory to produce an "interestingness" hint. **This is operator
// idea-ranking metadata, not betting advice, not pricing automation,
// and never customer-facing.** Banned vocabulary is enforced by
// convention — see docs/weather-market-idea-generator.md Step 156.
//
// Trust posture:
//   - Pure functions for normalization + scoring (data-in / data-out).
//   - Async loaders read **only** from the admin-only `wager-store`
//     read shim (`listAllWagers`, `getWager`). No mutators imported.
//   - Imports nothing from settlement / grading / wallet / pricing /
//     publish / Kalshi / Polymarket modules.
//   - PublicWagerView is unmodified — `outcomeInterestingness`
//     never enters the public allow-list.
//   - Memory fetch + score is best-effort; the generator catches and
//     degrades gracefully when this layer is unavailable.

import { listAllWagers } from './weather-market-store-admin';
import { listFeedback } from './weather-market-idea-feedback-store';
import { summarizeFeedback } from './weather-market-idea-feedback-summary';
import type { WeatherMarketIdea } from './weather-market-idea-generator';

if (typeof window !== 'undefined') {
  throw new Error(
    'weather-market-outcome-memory async loaders are server-only and must not be imported in client code',
  );
}

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Compact historical record derived from one resolved / voided wager.
 * Big raw payloads are deliberately not retained — we only need enough
 * to compare against a candidate idea later.
 */
export interface WeatherMarketOutcomeMemory {
  wagerId: string;
  kind: 'pointspread' | 'over-under' | 'odds';
  /** YYYY-MM-DD. */
  targetDate: string;
  /** UTC month string `'YYYY-MM'` for season-ish heuristics. */
  targetMonth: string;
  metric: string;
  metricA?: string;
  metricB?: string;
  /** Lowercased / trimmed for matching, mirrors the Step 150 risk analyzer. */
  locationANorm?: string;
  locationBNorm?: string;
  locationADisplay?: string;
  locationBDisplay?: string;
  /** Pointspread spread (signed). Undefined for non-pointspread. */
  spread?: number;
  /** Coarse spread bucket — `'<5°F' | '5-10' | '10-20' | '20-30' | '30+' | 'unknown'`. */
  spreadBucket: string;
  /** Final observed values (when graded). */
  observedA?: number;
  observedB?: number;
  /** `observedA - observedB` for pointspread (when graded). */
  finalDiff?: number;
  /** `(observedA - observedB) - spread` for pointspread (when graded). */
  marginVsLine?: number;
  /** Lifecycle status. */
  status: string;
  /** Set when the market was voided pre-grading. */
  voided: boolean;
  /** Heuristic outcome flags. */
  closeFinish: boolean;
  nearPush: boolean;
  blowout: boolean;
}

/**
 * Roll-up of historical markets that look "similar" to a candidate
 * idea. Used to drive the interestingness score.
 */
export interface SimilarMarketOutcomeSummary {
  /** Memory records matched by the similarity heuristic. */
  sampleCount: number;
  closeFinishCount: number;
  nearPushCount: number;
  blowoutCount: number;
  voidCount: number;
  closeFinishRate: number;
  nearPushRate: number;
  blowoutRate: number;
  voidRate: number;
  /** Step 155 useful-feedback rate scoped to the same preset/tags/metricPair when available. */
  usefulFeedbackRate?: number;
  usefulFeedbackSampleCount?: number;
  /** Up to 5 example wager titles for UI hover/expand. */
  exampleWagerIds: string[];
}

export type InterestingnessLabel =
  | 'high_interest'
  | 'promising'
  | 'neutral'
  | 'low_signal'
  | 'insufficient_history';

export const INTERESTINGNESS_LABELS: readonly InterestingnessLabel[] = [
  'high_interest',
  'promising',
  'neutral',
  'low_signal',
  'insufficient_history',
] as const;

export interface MarketInterestingnessScore {
  /** 0–100, integer. */
  score: number;
  label: InterestingnessLabel;
  /** Operator-friendly bullets explaining what drove the score. */
  reasons: string[];
  /** Mirror of the matched-history sample count for convenience. */
  sampleCount: number;
}

// ── Heuristic thresholds ────────────────────────────────────────────────────

/** Pointspread "close finish" — final margin within ±2°F of the line. */
const CLOSE_FINISH_F = 2;
/** "Near push" — final margin within ±0.5°F of the line. */
const NEAR_PUSH_F = 0.5;
/** "Blowout" — final margin off the line by more than this. */
const BLOWOUT_F = 10;
/** Maximum number of resolved wagers to scan when building memory. */
const MAX_HISTORY_SCAN = 200;
/** Minimum sample size to give a real label (rather than insufficient_history). */
const MIN_HISTORY_SAMPLE = 3;
/** Score thresholds. */
const SCORE_HIGH = 75;
const SCORE_PROMISING = 60;
const SCORE_NEUTRAL = 40;
const SCORE_LOW = 20;

// ── Normalization ──────────────────────────────────────────────────────────

function normalizeName(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase();
}

function spreadBucketFor(spread: number | undefined): string {
  if (spread === undefined || spread === null || !Number.isFinite(spread)) return 'unknown';
  const abs = Math.abs(spread);
  if (abs < 5) return '<5°F';
  if (abs < 10) return '5-10°F';
  if (abs < 20) return '10-20°F';
  if (abs < 30) return '20-30°F';
  return '30+°F';
}

function targetMonthOf(targetDate: string): string {
  if (typeof targetDate !== 'string' || targetDate.length < 7) return '';
  return targetDate.slice(0, 7);
}

/**
 * Normalize a single live `Wager` (admin shape) into the compact
 * outcome-memory record. Returns null when the wager isn't usable
 * (open / locked status, missing critical fields). Pure function.
 */
export function normalizeWagerToMemory(w: any): WeatherMarketOutcomeMemory | null {
  if (!w || typeof w !== 'object') return null;
  if (w.kind !== 'pointspread' && w.kind !== 'over-under' && w.kind !== 'odds') return null;
  // Only keep terminal-status wagers — open/locked tell us nothing about outcome yet.
  if (w.status !== 'graded' && w.status !== 'void') return null;

  const targetDate = typeof w.targetDate === 'string' ? w.targetDate : '';
  if (!targetDate) return null;

  const isPointspread = w.kind === 'pointspread';
  const spread = isPointspread && typeof w.spread === 'number' ? w.spread : undefined;
  const observedA = typeof w.observedValueA === 'number' ? w.observedValueA : undefined;
  const observedB = typeof w.observedValueB === 'number' ? w.observedValueB : undefined;
  const finalDiff =
    isPointspread && observedA !== undefined && observedB !== undefined
      ? observedA - observedB
      : undefined;
  const marginVsLine =
    finalDiff !== undefined && spread !== undefined ? finalDiff - spread : undefined;

  const voided = w.status === 'void';
  const closeFinish =
    !voided && marginVsLine !== undefined && Math.abs(marginVsLine) <= CLOSE_FINISH_F;
  const nearPush =
    !voided && marginVsLine !== undefined && Math.abs(marginVsLine) <= NEAR_PUSH_F;
  const blowout =
    !voided && marginVsLine !== undefined && Math.abs(marginVsLine) > BLOWOUT_F;

  return {
    wagerId: typeof w.id === 'string' ? w.id : '',
    kind: w.kind,
    targetDate,
    targetMonth: targetMonthOf(targetDate),
    metric: typeof w.metric === 'string' ? w.metric : '',
    metricA: typeof w.metricA === 'string' ? w.metricA : undefined,
    metricB: typeof w.metricB === 'string' ? w.metricB : undefined,
    locationANorm: normalizeName(w.locationA?.name),
    locationBNorm: normalizeName(w.locationB?.name),
    locationADisplay: w.locationA?.name,
    locationBDisplay: w.locationB?.name,
    spread,
    spreadBucket: spreadBucketFor(spread),
    observedA,
    observedB,
    finalDiff,
    marginVsLine,
    status: w.status,
    voided,
    closeFinish,
    nearPush,
    blowout,
  };
}

// ── Async loader ───────────────────────────────────────────────────────────

export interface FetchMemoryOptions {
  /** Cap on resolved/voided wagers to scan. Defaults to MAX_HISTORY_SCAN. */
  maxScan?: number;
}

/**
 * Pull up to `maxScan` admin-side wagers via the read-only shim and
 * normalize the terminal-status ones into outcome-memory records.
 * **Best-effort and never throws**: returns an empty array if the read
 * fails so the generator can still surface ideas without history.
 */
export async function fetchOutcomeMemory(
  options: FetchMemoryOptions = {},
): Promise<WeatherMarketOutcomeMemory[]> {
  const cap = Math.max(10, Math.min(500, options.maxScan ?? MAX_HISTORY_SCAN));
  try {
    const wagers = await listAllWagers(cap);
    const out: WeatherMarketOutcomeMemory[] = [];
    for (const w of wagers ?? []) {
      const m = normalizeWagerToMemory(w);
      if (m) out.push(m);
    }
    return out;
  } catch {
    return [];
  }
}

// ── Similarity + roll-up ───────────────────────────────────────────────────

const IDEA_METRIC_TO_WAGER: Record<'daily_high' | 'daily_low', 'high_temp' | 'low_temp'> = {
  daily_high: 'high_temp',
  daily_low: 'low_temp',
};

function effectiveMetricsForIdea(idea: WeatherMarketIdea): { metricA: string; metricB: string } {
  return {
    metricA: IDEA_METRIC_TO_WAGER[idea.metricA] ?? idea.metricA,
    metricB: IDEA_METRIC_TO_WAGER[idea.metricB] ?? idea.metricB,
  };
}

function effectiveMetricsForMemory(m: WeatherMarketOutcomeMemory): { metricA: string; metricB: string } {
  return {
    metricA: m.metricA ?? m.metric,
    metricB: m.metricB ?? m.metric,
  };
}

function isSamePairAnyDirection(
  a: { aN: string; bN: string },
  b: { aN: string; bN: string },
): boolean {
  return (
    (a.aN === b.aN && a.bN === b.bN) ||
    (a.aN === b.bN && a.bN === b.aN)
  );
}

function isSameMetricPairAnyDirection(
  a: { mA: string; mB: string },
  b: { mA: string; mB: string },
): boolean {
  return (
    (a.mA === b.mA && a.mB === b.mB) ||
    (a.mA === b.mB && a.mB === b.mA)
  );
}

export interface SummarizeOptions {
  /** Optional Step 155 feedback summary scoped to this run's preset/tags/metricPair. */
  usefulFeedbackRate?: number;
  usefulFeedbackSampleCount?: number;
}

/**
 * Find historical memory that "looks like" the candidate idea and roll
 * up close-finish / near-push / blowout / void rates. Conservative:
 * only pointspread vs pointspread, same metric pair (any direction),
 * and either same city pair OR same spread bucket.
 */
export function summarizeSimilarMarkets(
  idea: WeatherMarketIdea,
  memory: readonly WeatherMarketOutcomeMemory[],
  options: SummarizeOptions = {},
): SimilarMarketOutcomeSummary {
  const ideaMetrics = effectiveMetricsForIdea(idea);
  const ideaPair = {
    aN: normalizeName(idea.locationA?.label),
    bN: normalizeName(idea.locationB?.label),
  };
  const ideaSpreadBucket = spreadBucketFor(idea.suggestedSpread);

  const matches: WeatherMarketOutcomeMemory[] = [];
  for (const m of memory) {
    if (m.kind !== 'pointspread') continue;
    const memMetrics = effectiveMetricsForMemory(m);
    if (
      !isSameMetricPairAnyDirection(
        { mA: ideaMetrics.metricA, mB: ideaMetrics.metricB },
        { mA: memMetrics.metricA, mB: memMetrics.metricB },
      )
    ) {
      continue;
    }
    const samePair = isSamePairAnyDirection(ideaPair, {
      aN: m.locationANorm ?? '',
      bN: m.locationBNorm ?? '',
    });
    const sameBucket = m.spreadBucket === ideaSpreadBucket;
    if (!samePair && !sameBucket) continue;
    matches.push(m);
  }

  const sampleCount = matches.length;
  const closeFinishCount = matches.filter((m) => m.closeFinish).length;
  const nearPushCount = matches.filter((m) => m.nearPush).length;
  const blowoutCount = matches.filter((m) => m.blowout).length;
  const voidCount = matches.filter((m) => m.voided).length;
  const safeRate = (n: number) => (sampleCount > 0 ? Math.round((n / sampleCount) * 100) / 100 : 0);

  return {
    sampleCount,
    closeFinishCount,
    nearPushCount,
    blowoutCount,
    voidCount,
    closeFinishRate: safeRate(closeFinishCount),
    nearPushRate: safeRate(nearPushCount),
    blowoutRate: safeRate(blowoutCount),
    voidRate: safeRate(voidCount),
    usefulFeedbackRate: options.usefulFeedbackRate,
    usefulFeedbackSampleCount: options.usefulFeedbackSampleCount,
    exampleWagerIds: matches.slice(0, 5).map((m) => m.wagerId),
  };
}

// ── Scoring ────────────────────────────────────────────────────────────────

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 50;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

function labelForScore(score: number, sampleCount: number): InterestingnessLabel {
  if (sampleCount < MIN_HISTORY_SAMPLE) return 'insufficient_history';
  if (score >= SCORE_HIGH) return 'high_interest';
  if (score >= SCORE_PROMISING) return 'promising';
  if (score >= SCORE_NEUTRAL) return 'neutral';
  if (score >= SCORE_LOW) return 'low_signal';
  return 'low_signal';
}

/**
 * Compute an admin-only "operator interestingness" score. This is NOT
 * a win probability and NOT betting advice. The score helps an operator
 * decide which generated ideas to spend time evaluating first.
 *
 * Scoring components (rough, advisory):
 *   - close-finish history (+)
 *   - near-push history (+)
 *   - useful-feedback rate (+)
 *   - blowout history (-)
 *   - void/cancel history (-)
 *   - small/empty sample (-)
 */
export function scoreInterestingness(
  idea: WeatherMarketIdea,
  similar: SimilarMarketOutcomeSummary,
): MarketInterestingnessScore {
  const reasons: string[] = [];
  let score = 50; // start neutral

  // History-based components.
  if (similar.sampleCount >= MIN_HISTORY_SAMPLE) {
    if (similar.closeFinishRate > 0) {
      const bump = Math.round(similar.closeFinishRate * 30);
      score += bump;
      reasons.push(
        `${Math.round(similar.closeFinishRate * 100)}% of ${similar.sampleCount} comparable historical market(s) finished close to the line.`,
      );
    }
    if (similar.nearPushRate > 0) {
      const bump = Math.round(similar.nearPushRate * 10);
      score += bump;
      reasons.push(
        `${Math.round(similar.nearPushRate * 100)}% of ${similar.sampleCount} comparable historical market(s) finished near a push (within ±${NEAR_PUSH_F}°F of the line).`,
      );
    }
    if (similar.blowoutRate > 0) {
      const penalty = Math.round(similar.blowoutRate * 20);
      score -= penalty;
      reasons.push(
        `${Math.round(similar.blowoutRate * 100)}% of comparable historical market(s) finished as a blowout (margin > ${BLOWOUT_F}°F off the line).`,
      );
    }
    if (similar.voidRate > 0) {
      const penalty = Math.round(similar.voidRate * 30);
      score -= penalty;
      reasons.push(
        `${Math.round(similar.voidRate * 100)}% of comparable historical market(s) were voided / cancelled.`,
      );
    }
  } else {
    score -= 25;
    reasons.push(
      `Only ${similar.sampleCount} comparable historical market(s) — sample is below the ${MIN_HISTORY_SAMPLE}-record threshold; treat as insufficient history.`,
    );
  }

  // Operator feedback alignment (Step 155).
  if (
    similar.usefulFeedbackRate !== undefined &&
    similar.usefulFeedbackSampleCount !== undefined &&
    similar.usefulFeedbackSampleCount > 0
  ) {
    if (similar.usefulFeedbackRate >= 0.6) {
      score += 10;
      reasons.push(
        `Operators rated ${Math.round(similar.usefulFeedbackRate * 100)}% of similar generator runs as useful (n=${similar.usefulFeedbackSampleCount}).`,
      );
    } else if (similar.usefulFeedbackRate <= 0.3) {
      score -= 10;
      reasons.push(
        `Operators rated only ${Math.round(similar.usefulFeedbackRate * 100)}% of similar generator runs as useful (n=${similar.usefulFeedbackSampleCount}).`,
      );
    }
  }

  // Cross-metric / beyond-horizon signals already on the idea.
  if (idea.warnings && idea.warnings.length > 0) {
    if (idea.warnings.some((w) => /horizon|beyond/i.test(w))) {
      score -= 10;
      reasons.push('Target date is beyond the reliable forecast horizon — operator confidence will be lower.');
    }
  }

  const finalScore = clampScore(score);
  if (reasons.length === 0) {
    reasons.push('No notable historical or feedback signal — neutral starting score.');
  }
  return {
    score: finalScore,
    label: labelForScore(finalScore, similar.sampleCount),
    reasons,
    sampleCount: similar.sampleCount,
  };
}

// ── Convenience: assemble feedback-aware similar summary ───────────────────

/**
 * Roll up the universe of historical memory + Step 155 feedback into a
 * per-idea score. Pure function of its inputs (the universe + feedback
 * are fetched separately and cached per generator run).
 */
export function scoreIdeaAgainstMemory(
  idea: WeatherMarketIdea,
  memory: readonly WeatherMarketOutcomeMemory[],
  feedbackUsefulRate?: number,
  feedbackUsefulSampleCount?: number,
): MarketInterestingnessScore {
  const similar = summarizeSimilarMarkets(idea, memory, {
    usefulFeedbackRate: feedbackUsefulRate,
    usefulFeedbackSampleCount: feedbackUsefulSampleCount,
  });
  return scoreInterestingness(idea, similar);
}

/**
 * Best-effort feedback-rate lookup keyed by (presetId | metricPair) so
 * the score gets a feedback signal scoped to the run's settings rather
 * than the global average. Returns `{ undefined, undefined }` when no
 * feedback exists yet.
 */
export interface FeedbackRateInputs {
  presetId?: string;
  metricPair?: string;
}

export interface FeedbackRateLookup {
  rate?: number;
  sampleCount?: number;
}

export async function fetchFeedbackUsefulRate(
  inputs: FeedbackRateInputs,
): Promise<FeedbackRateLookup> {
  try {
    const records = await listFeedback({ limit: 500 });
    const summary = summarizeFeedback(records);
    if (inputs.presetId) {
      const g = summary.byPreset.find((x) => x.key === inputs.presetId);
      if (g && g.usefulRate !== null) {
        return { rate: g.usefulRate, sampleCount: g.totalCount };
      }
    }
    if (inputs.metricPair) {
      const g = summary.byMetricPair.find((x) => x.key === inputs.metricPair);
      if (g && g.usefulRate !== null) {
        return { rate: g.usefulRate, sampleCount: g.totalCount };
      }
    }
    return {};
  } catch {
    return {};
  }
}
