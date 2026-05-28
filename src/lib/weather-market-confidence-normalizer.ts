// ── Step 163: Confidence normalization for generated weather ideas ──────
//
// Pure helpers that synthesize a 0–100 "raw confidence" from the existing
// signals on a `WeatherMarketIdea` and then push it through a
// deterministic squashing curve so over-confident scores compress and
// under-confident scores lift. Output stays in [0, 100].
//
// **No I/O. No mutation. No imports beyond types.**
//
// Trust posture:
//   - Pure functions — safe to call anywhere.
//   - Deterministic — same inputs always produce the same output.
//   - No external API / no AI / no LLM / no mailer / no persistence.

import type { WeatherMarketIdea } from './weather-market-idea-generator';

// ── Tunable thresholds (kept conservative) ─────────────────────────────────

/** Base confidence by `confidenceLabel`. */
const LABEL_BASE: Record<WeatherMarketIdea['confidenceLabel'], number> = {
  higher: 75,
  medium: 55,
  lower: 35,
};

/** Bonus when `closenessToTarget` is small (target-difference mode). */
const TARGET_BONUS_MAX = 10;

/** Bonus when `absDifference` is robustly large (legacy / interestingness mode). */
const ABS_DELTA_BONUS_MAX = 8;

// ── Public API ─────────────────────────────────────────────────────────────

export interface ConfidenceBreakdown {
  /** Raw 0-100 confidence synthesized from existing idea fields. */
  raw: number;
  /** Normalized 0-100 confidence (extremes compressed, low end lifted). */
  normalized: number;
  /** Coarse three-way band derived from normalized. */
  band: 'low' | 'medium' | 'high';
}

/**
 * Synthesize a 0-100 "raw confidence" from the signals already on the
 * idea. Pure. Deterministic. The breakdown:
 *
 *   - Start from `confidenceLabel`:
 *       higher  → 75
 *       medium  → 55
 *       lower   → 35
 *   - In target-difference mode: bonus up to +10 for closeness ≤ tolerance.
 *   - In legacy mode: bonus up to +8 when `absDifference` ≥ 20°F.
 *   - Penalty −10 when any `idea.warnings` entry mentions "horizon" /
 *     "beyond" — the spread sits past the reliable forecast window.
 *   - Clamp [0, 100].
 *
 * The normalizer below then squashes this raw value.
 */
export function synthesizeRawConfidence(idea: WeatherMarketIdea): number {
  let c = LABEL_BASE[idea.confidenceLabel];

  // Target-difference closeness bonus (Step 145 mode).
  if (typeof idea.closenessToTarget === 'number' && Number.isFinite(idea.closenessToTarget)) {
    // closeness 0 → +10, closeness 3 → +5, closeness 6+ → +0.
    const closeness = Math.max(0, idea.closenessToTarget);
    c += Math.max(0, TARGET_BONUS_MAX - closeness * (TARGET_BONUS_MAX / 6));
  } else if (idea.absDifference >= 20) {
    // Legacy "interestingness" mode — strong spreads earn a small lift.
    const overage = Math.min(20, idea.absDifference - 20);
    c += ABS_DELTA_BONUS_MAX * (overage / 20);
  }

  // Horizon penalty.
  if (Array.isArray(idea.warnings)) {
    for (const w of idea.warnings) {
      if (/horizon|beyond/i.test(w)) {
        c -= 10;
        break;
      }
    }
  }

  return clamp(c, 0, 100);
}

/**
 * Deterministic piecewise squash. **Documented examples:**
 *
 *   raw 0   → 30   (low end lifted)
 *   raw 25  → 42.5
 *   raw 40  → 50   (mid lift)
 *   raw 50  → 57.5
 *   raw 70  → 72.5
 *   raw 80  → 80   (pass-through point)
 *   raw 90  → 86
 *   raw 99  → 91.4 (compress overconfidence — matches Step 163 spec example)
 *   raw 100 → 92
 *
 * Three linear segments — keeps the function trivially inspectable in
 * the inspector page + audit trail.
 */
export function normalizeConfidence(raw: number): number {
  const c = clamp(raw, 0, 100);
  // [0, 40]   → [30, 50] (lift the low end)
  if (c <= 40) return round2(30 + (c / 40) * 20);
  // (40, 80]  → (50, 80] (gentle slope through the middle)
  if (c <= 80) return round2(50 + ((c - 40) / 40) * 30);
  // (80, 100] → (80, 92] (compress the top)
  return round2(80 + ((c - 80) / 20) * 12);
}

/**
 * Convenience composite — returns raw + normalized + a coarse band.
 */
export function describeConfidence(idea: WeatherMarketIdea): ConfidenceBreakdown {
  const raw = synthesizeRawConfidence(idea);
  const normalized = normalizeConfidence(raw);
  const band: ConfidenceBreakdown['band'] =
    normalized >= 75 ? 'high' : normalized >= 55 ? 'medium' : 'low';
  return { raw: round2(raw), normalized, band };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
