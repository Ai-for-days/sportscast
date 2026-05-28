// ── Step 163: Opportunity quality score for generated weather ideas ────
//
// Pure deterministic scorer that combines existing idea signals into a
// single 0–100 opportunity-quality score plus a five-step tier. The
// score is the basis for Step-163 suppression and inspector ranking.
//
// **Operator-facing quality signal — NOT betting advice.** No external
// API / no AI / no LLM / no mailer / no persistence. The same inputs
// always produce the same score.
//
// Component weights (must sum to 1.0):
//   forecastConfidence       0.30
//   crossModelAgreement      0.20
//   regionalUniqueness       0.10
//   spreadUniqueness         0.10
//   metricClarity            0.10
//   noveltyScore             0.10
//   rarityProxy              0.05
//   diversityContribution    0.05

import type { WeatherMarketIdea } from './weather-market-idea-generator';

// ── Public types ────────────────────────────────────────────────────────────

export type QualityTier = 'exceptional' | 'strong' | 'moderate' | 'weak' | 'suppress';

export const QUALITY_TIERS: readonly QualityTier[] = [
  'exceptional',
  'strong',
  'moderate',
  'weak',
  'suppress',
] as const;

export interface QualityComponents {
  forecastConfidence: number;
  crossModelAgreement: number;
  regionalUniqueness: number;
  spreadUniqueness: number;
  metricClarity: number;
  noveltyScore: number;
  rarityProxy: number;
  diversityContribution: number;
}

export interface QualityResult {
  score: number;
  tier: QualityTier;
  components: QualityComponents;
}

export interface QualityScoringContext {
  /** Normalized confidence from the Step-163 normalizer (0-100). */
  normalizedConfidence: number;
  /** Days from now to the idea's targetDate (≥ 0). */
  daysAhead: number;
  /** How many candidates share this region pair (1 = unique). */
  regionPairCount: number;
  /** How many candidates share this spread bucket. */
  spreadBucketCount: number;
  /** How many candidates share this city pair (direction-agnostic). */
  cityPairCount: number;
  /** Total candidate count — used to scale uniqueness scores. */
  totalCandidates: number;
  /** 0-100 — set by the diversity re-ranker. Higher = more diversity contribution. */
  diversityContribution?: number;
  /** Step 160 novelty bonus already attached to interestingnessScore — passed in. */
  noveltyBonus?: number;
}

// ── Weights ────────────────────────────────────────────────────────────────

export const QUALITY_WEIGHTS = {
  forecastConfidence: 0.3,
  crossModelAgreement: 0.2,
  regionalUniqueness: 0.1,
  spreadUniqueness: 0.1,
  metricClarity: 0.1,
  noveltyScore: 0.1,
  rarityProxy: 0.05,
  diversityContribution: 0.05,
} as const;

// ── Tier thresholds (mirrors Step 163 spec) ────────────────────────────────

export function classifyTier(score: number): QualityTier {
  if (score >= 85) return 'exceptional';
  if (score >= 70) return 'strong';
  if (score >= 55) return 'moderate';
  if (score >= 40) return 'weak';
  return 'suppress';
}

// ── Component computers (pure) ─────────────────────────────────────────────

/**
 * Cross-model agreement is a proxy until WeatherNext + Open-Meteo are
 * compared directly. Close-in forecasts collapse on the same answer
 * faster, so use horizon as a coarse proxy.
 *
 *   daysAhead 0-1 → 92
 *             2   → 80
 *             3   → 68
 *             4   → 56
 *             5   → 44
 *             6+  → 32
 */
function crossModelAgreementProxy(daysAhead: number): number {
  if (!Number.isFinite(daysAhead) || daysAhead < 0) return 50;
  if (daysAhead <= 1) return 92;
  if (daysAhead === 2) return 80;
  if (daysAhead === 3) return 68;
  if (daysAhead === 4) return 56;
  if (daysAhead === 5) return 44;
  return 32;
}

/**
 * Uniqueness given how many of the `total` candidates share the same
 * key. Single-occurrence facets score high; ubiquitous facets score
 * low. Smooth decay so a small batch doesn't over-penalize.
 */
function uniquenessScore(shareCount: number, total: number): number {
  if (total <= 0) return 50;
  const safeShare = Math.max(1, shareCount);
  const ratio = safeShare / total;
  // 1/total → 95, 0.5 → 50, 1.0 → 20
  if (ratio <= 1 / Math.max(total, 4)) return 95;
  if (ratio <= 0.2) return 85;
  if (ratio <= 0.35) return 70;
  if (ratio <= 0.5) return 55;
  if (ratio <= 0.75) return 35;
  return 20;
}

function metricClarityScore(idea: WeatherMarketIdea): number {
  // Same-metric pointspread reads cleanly to a human ("high vs high").
  // Cross-metric ("high vs low") works but adds operator-confusion risk.
  return idea.metricA === idea.metricB ? 90 : 60;
}

/**
 * Re-scale the Step-160 novelty bonus (typically 0-5.5) into a 0-100
 * component. When no bonus was supplied, fall back to a deterministic
 * estimate from the idea fields.
 */
function noveltyComponent(idea: WeatherMarketIdea, bonus?: number): number {
  let n = 0;
  if (typeof bonus === 'number' && Number.isFinite(bonus)) {
    n = bonus;
  } else {
    if (idea.locationA.region !== idea.locationB.region) n += 2;
    if (idea.metricA !== idea.metricB) n += 1.5;
    const latSpread = Math.abs(idea.locationA.lat - idea.locationB.lat);
    if (latSpread >= 10) n += Math.min(2, latSpread / 10);
  }
  // 0 → 30, 5 → 95
  const scaled = 30 + Math.min(1, n / 5) * 65;
  return clamp(scaled, 0, 100);
}

/**
 * Rarity proxy uses Step-156 historical outcome interestingness when
 * available. Falls back to 50 (neutral) when the loader failed.
 */
function rarityProxyScore(idea: WeatherMarketIdea): number {
  const oi = idea.outcomeInterestingness;
  if (!oi) return 50;
  if (oi.label === 'insufficient_history') return 45;
  return clamp(oi.score, 0, 100);
}

// ── Public scorer ───────────────────────────────────────────────────────────

/**
 * Pure scorer. Returns a complete `QualityResult` for every idea — even
 * one that ends up tier='suppress'. The caller decides whether to drop
 * the idea or surface it in the inspector.
 */
export function computeQualityScore(
  idea: WeatherMarketIdea,
  ctx: QualityScoringContext,
): QualityResult {
  const components: QualityComponents = {
    forecastConfidence: clamp(ctx.normalizedConfidence, 0, 100),
    crossModelAgreement: crossModelAgreementProxy(ctx.daysAhead),
    regionalUniqueness: uniquenessScore(ctx.regionPairCount, ctx.totalCandidates),
    spreadUniqueness: uniquenessScore(ctx.spreadBucketCount, ctx.totalCandidates),
    metricClarity: metricClarityScore(idea),
    noveltyScore: noveltyComponent(idea, ctx.noveltyBonus),
    rarityProxy: rarityProxyScore(idea),
    diversityContribution: clamp(ctx.diversityContribution ?? 50, 0, 100),
  };

  const w = QUALITY_WEIGHTS;
  const raw =
    components.forecastConfidence * w.forecastConfidence +
    components.crossModelAgreement * w.crossModelAgreement +
    components.regionalUniqueness * w.regionalUniqueness +
    components.spreadUniqueness * w.spreadUniqueness +
    components.metricClarity * w.metricClarity +
    components.noveltyScore * w.noveltyScore +
    components.rarityProxy * w.rarityProxy +
    components.diversityContribution * w.diversityContribution;

  const score = round2(clamp(raw, 0, 100));
  return { score, tier: classifyTier(score), components };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
