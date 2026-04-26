// ── Step 70: Calibrated Edge & Signal Quality Adjustment ────────────────────
//
// Reads outputs from calibration-lab.ts (Step 69) and produces a per-signal
// reliability factor + calibrated edge. **Read-only metadata.**
//
// IMPORTANT CONSTRAINTS:
// - No execution behavior changes
// - No automatic filtering or suppression of signals
// - signalScore / sizingTier are NOT recomputed from calibratedEdge —
//   calibration is purely advisory
// - reliabilityFactor lives in [0, 1] (never amplifies edge above raw)
//
// Reliability factor combines three components, each in [0, 1]:
//
//   probFactor    Calibration error in the probability bucket the signal
//                 falls in. 0% miss → 1.0; ≥25% miss → 0.0.
//   edgeFactor    Hit rate of the historical edge bucket. <30% → 0;
//                 ≥70% → 1.0; smooth between.
//   horizonFactor Same hitRate-based shape as edgeFactor for the lead-time bucket.
//
// Components are equal-weighted and averaged; missing components are skipped.
// If no component has ≥30 samples in the freshest available window, the
// signal gets reliabilityFactor = 1.0 with a clarifying note.
//
// Window preference per component (Step 70 spec — prefer recent data):
//   1. Rolling 7-day window  — used if that bucket has ≥30 samples
//   2. Rolling 30-day window — used if that bucket has ≥30 samples
//   3. All-time              — used as a final fallback
//
// All three reports are loaded once per signal-ranking pass, so per-signal
// calibration is synchronous and cheap.

import {
  buildCalibrationReport,
  PROB_BUCKETS,
  EDGE_BUCKETS,
  HORIZON_BUCKETS,
  type CalibrationReport,
  evidenceLevel,
} from './calibration-lab';

const MIN_SAMPLES_FOR_FACTOR = 30; // matches Step 69's "early evidence" threshold

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CalibrationContext {
  sevenDay: CalibrationReport;
  thirtyDay: CalibrationReport;
  allTime: CalibrationReport;
}

export interface SignalCalibration {
  rawEdge: number;
  calibratedEdge: number;
  reliabilityFactor: number;
  calibrationNotes: string[];
}

// Cache so multiple ranking passes within a short window don't re-pull Redis.
let cachedContext: { ctx: CalibrationContext; loadedAt: number } | null = null;
const CONTEXT_CACHE_MS = 30_000;

export async function loadCalibrationContext(): Promise<CalibrationContext> {
  const now = Date.now();
  if (cachedContext && now - cachedContext.loadedAt < CONTEXT_CACHE_MS) {
    return cachedContext.ctx;
  }
  const [sevenDay, thirtyDay, allTime] = await Promise.all([
    buildCalibrationReport(now - 7  * DAY_MS),
    buildCalibrationReport(now - 30 * DAY_MS),
    buildCalibrationReport(),
  ]);
  const ctx = { sevenDay, thirtyDay, allTime };
  cachedContext = { ctx, loadedAt: now };
  return ctx;
}

// ── Bucket lookup helpers ───────────────────────────────────────────────────

function probBucketIndex(probYesEffective: number | undefined): number | null {
  if (probYesEffective == null) return null;
  for (let i = 0; i < PROB_BUCKETS.length; i++) {
    const b = PROB_BUCKETS[i];
    if (probYesEffective >= b.min && probYesEffective < b.max) return i;
  }
  return null;
}

function edgeBucketIndex(rawEdge: number | undefined): number | null {
  if (rawEdge == null) return null;
  const e = Math.abs(rawEdge);
  for (let i = 0; i < EDGE_BUCKETS.length; i++) {
    const b = EDGE_BUCKETS[i];
    if (e >= b.min && e < b.max) return i;
  }
  return null;
}

function horizonBucketIndex(leadHours: number | undefined): number | null {
  if (leadHours == null) return null;
  for (let i = 0; i < HORIZON_BUCKETS.length; i++) {
    const b = HORIZON_BUCKETS[i];
    if (leadHours >= b.minHours && leadHours < b.maxHours) return i;
  }
  return null;
}

// ── Window selection ────────────────────────────────────────────────────────
// Picks the freshest window with ≥ MIN_SAMPLES_FOR_FACTOR samples for the
// given bucket, falling back through 7d → 30d → all-time.

interface WindowedRow<T> {
  row: T;
  windowLabel: '7-day' | '30-day' | 'all-time';
}

function pickWindowedRow<T extends { count: number; withPnl?: number }>(
  rowKey: 'count' | 'withPnl',
  ctx: CalibrationContext,
  getter: (r: CalibrationReport) => T,
): WindowedRow<T> | null {
  const candidates: { rep: CalibrationReport; label: WindowedRow<T>['windowLabel'] }[] = [
    { rep: ctx.sevenDay,  label: '7-day' },
    { rep: ctx.thirtyDay, label: '30-day' },
    { rep: ctx.allTime,   label: 'all-time' },
  ];
  for (const c of candidates) {
    const r = getter(c.rep);
    const n = (r as any)[rowKey] ?? 0;
    if (n >= MIN_SAMPLES_FOR_FACTOR) return { row: r, windowLabel: c.label };
  }
  return null;
}

// ── Component factors ───────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Map a hit rate (0-100 percent) to a [0, 1] factor:
 *   ≤30% → 0.0   (significantly worse than coin flip)
 *   60% → 0.75
 *   ≥70% → 1.0
 */
function hitRateToFactor(hitRatePct: number): number {
  return clamp01((hitRatePct - 30) / 40);
}

/** Map calibration miss (|observed - predicted|, 0-1 scale) to a [0, 1] factor:
 *  perfect calibration → 1.0; ≥25% miss → 0.0.
 */
function calibrationMissToFactor(absMiss: number): number {
  return clamp01(1 - absMiss * 4);
}

// ── Per-signal calibration ──────────────────────────────────────────────────

export interface CalibrateSignalInput {
  rawEdge: number;
  modelProbForSide?: number;        // probability the model assigned to the side traded
  side?: 'yes' | 'no' | string;     // direction of trade (yes or no)
  leadTimeHours?: number;
}

export function calibrateSignal(
  input: CalibrateSignalInput,
  ctx: CalibrationContext,
): SignalCalibration {
  const { rawEdge, modelProbForSide, side, leadTimeHours } = input;
  const notes: string[] = [];

  // Effective YES-side probability (always express in YES terms for the bucket lookup)
  const probYesEffective =
    modelProbForSide != null
      ? side === 'yes' ? modelProbForSide : 1 - modelProbForSide
      : undefined;

  const factors: number[] = [];

  // ── Probability calibration component ────────────────────────────────────
  const probIdx = probBucketIndex(probYesEffective);
  if (probIdx != null) {
    const picked = pickWindowedRow('count', ctx, r => r.probabilityCalibration[probIdx]);
    if (picked && picked.row.observedYesRate != null && picked.row.predictedAvg != null) {
      const miss = Math.abs(picked.row.observedYesRate - picked.row.predictedAvg);
      const f = calibrationMissToFactor(miss);
      factors.push(f);
      notes.push(
        `Probability bucket ${PROB_BUCKETS[probIdx].label}: observed ${(picked.row.observedYesRate * 100).toFixed(1)}% vs predicted ${(picked.row.predictedAvg * 100).toFixed(1)}% (${picked.windowLabel}, n=${picked.row.count}) → factor ${f.toFixed(2)}`,
      );
    } else {
      notes.push(`Probability bucket ${PROB_BUCKETS[probIdx].label}: insufficient calibration data`);
    }
  }

  // ── Edge bucket component ───────────────────────────────────────────────
  const edgeIdx = edgeBucketIndex(rawEdge);
  if (edgeIdx != null) {
    const picked = pickWindowedRow('withPnl', ctx, r => r.edgeBuckets[edgeIdx]);
    if (picked && picked.row.hitRate != null) {
      const f = hitRateToFactor(picked.row.hitRate);
      factors.push(f);
      notes.push(
        `Edge bucket ${EDGE_BUCKETS[edgeIdx].label}: hit rate ${picked.row.hitRate.toFixed(1)}% (${picked.windowLabel}, n=${picked.row.withPnl}) → factor ${f.toFixed(2)}`,
      );
    } else {
      notes.push(`Edge bucket ${EDGE_BUCKETS[edgeIdx].label}: insufficient calibration data`);
    }
  }

  // ── Horizon component ───────────────────────────────────────────────────
  const horizonIdx = horizonBucketIndex(leadTimeHours);
  if (horizonIdx != null) {
    const picked = pickWindowedRow('withPnl', ctx, r => r.horizonBuckets[horizonIdx]);
    if (picked && picked.row.hitRate != null) {
      const f = hitRateToFactor(picked.row.hitRate);
      factors.push(f);
      notes.push(
        `Horizon ${HORIZON_BUCKETS[horizonIdx].label}: hit rate ${picked.row.hitRate.toFixed(1)}% (${picked.windowLabel}, n=${picked.row.withPnl}) → factor ${f.toFixed(2)}`,
      );
    } else {
      notes.push(`Horizon ${HORIZON_BUCKETS[horizonIdx].label}: insufficient calibration data`);
    }
  }

  // ── Combine ─────────────────────────────────────────────────────────────
  let reliabilityFactor: number;
  if (factors.length === 0) {
    reliabilityFactor = 1.0;
    notes.unshift('Insufficient calibration data — defaulting to reliabilityFactor = 1.0');
  } else {
    const avg = factors.reduce((s, f) => s + f, 0) / factors.length;
    reliabilityFactor = Math.round(clamp01(avg) * 100) / 100;
  }

  const calibratedEdge = Math.round(rawEdge * reliabilityFactor * 10000) / 10000;

  return {
    rawEdge,
    calibratedEdge,
    reliabilityFactor,
    calibrationNotes: notes,
  };
}
