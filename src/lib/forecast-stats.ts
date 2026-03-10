// ── Forecast Stats — Server-Side Aggregation ────────────────────────────────

import type { ForecastEntry } from './forecast-tracker-types';
import { listForecastEntries } from './forecast-tracker-store';

// ── Helpers ─────────────────────────────────────────────────────────────────

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

async function loadEntries(): Promise<ForecastEntry[]> {
  return listForecastEntries(500);
}

// ── Overview ────────────────────────────────────────────────────────────────

export async function getOverviewStats() {
  const entries = await loadEntries();
  const verified = entries.filter(e => e.actualValue != null);
  const pending = entries.filter(e => e.actualValue == null);

  return {
    total: entries.length,
    verified: verified.length,
    pending: pending.length,
    avgAbsError: avg(verified.filter(e => e.absError != null).map(e => e.absError!)),
    avgAdjustedError: avg(verified.filter(e => e.adjustedError != null).map(e => e.adjustedError!)),
    avgAccuracyScoreV2: avg(verified.filter(e => e.accuracyScoreV2 != null).map(e => e.accuracyScoreV2!)),
  };
}

// ── By source ───────────────────────────────────────────────────────────────

export async function getStatsBySource() {
  const entries = await loadEntries();
  const groups = new Map<string, ForecastEntry[]>();

  for (const e of entries) {
    const src = e.sourceNormalized || 'wageronweather';
    if (!groups.has(src)) groups.set(src, []);
    groups.get(src)!.push(e);
  }

  return Array.from(groups.entries()).map(([source, items]) => {
    const verified = items.filter(e => e.actualValue != null);
    return {
      source,
      count: items.length,
      verifiedCount: verified.length,
      avgAbsError: avg(verified.filter(e => e.absError != null).map(e => e.absError!)),
      avgAdjustedError: avg(verified.filter(e => e.adjustedError != null).map(e => e.adjustedError!)),
      avgAccuracyScoreV2: avg(verified.filter(e => e.accuracyScoreV2 != null).map(e => e.accuracyScoreV2!)),
      avgSignedError: avg(verified.filter(e => e.signedError != null).map(e => e.signedError!)),
    };
  });
}

// ── By metric ───────────────────────────────────────────────────────────────

export async function getStatsByMetric() {
  const entries = await loadEntries();
  const groups = new Map<string, ForecastEntry[]>();

  for (const e of entries) {
    if (!groups.has(e.metric)) groups.set(e.metric, []);
    groups.get(e.metric)!.push(e);
  }

  return Array.from(groups.entries()).map(([metric, items]) => {
    const verified = items.filter(e => e.actualValue != null);
    return {
      metric,
      metricGroup: items[0]?.metricGroup || 'unknown',
      count: items.length,
      verifiedCount: verified.length,
      avgAbsError: avg(verified.filter(e => e.absError != null).map(e => e.absError!)),
      avgAdjustedError: avg(verified.filter(e => e.adjustedError != null).map(e => e.adjustedError!)),
      avgAccuracyScoreV2: avg(verified.filter(e => e.accuracyScoreV2 != null).map(e => e.accuracyScoreV2!)),
      avgSignedError: avg(verified.filter(e => e.signedError != null).map(e => e.signedError!)),
    };
  });
}

// ── By lead bucket ──────────────────────────────────────────────────────────

export async function getStatsByLeadBucket() {
  const entries = await loadEntries();
  const groups = new Map<string, ForecastEntry[]>();

  for (const e of entries) {
    const bucket = e.leadBucket || 'unknown';
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(e);
  }

  // Sort buckets in chronological order
  const bucketOrder = ['0-1h', '1-6h', '6-24h', '1-3d', '3-5d', '5-7d', '7-10d', '10-14d', '14d+', 'unknown'];

  return Array.from(groups.entries())
    .sort((a, b) => bucketOrder.indexOf(a[0]) - bucketOrder.indexOf(b[0]))
    .map(([leadBucket, items]) => {
      const verified = items.filter(e => e.actualValue != null);
      return {
        leadBucket,
        count: items.length,
        verifiedCount: verified.length,
        avgAbsError: avg(verified.filter(e => e.absError != null).map(e => e.absError!)),
        avgAdjustedError: avg(verified.filter(e => e.adjustedError != null).map(e => e.adjustedError!)),
        avgAccuracyScoreV2: avg(verified.filter(e => e.accuracyScoreV2 != null).map(e => e.accuracyScoreV2!)),
      };
    });
}

// ── Leaderboard ─────────────────────────────────────────────────────────────

export async function getLeaderboard() {
  const bySource = await getStatsBySource();

  const ranked = bySource
    .filter(s => s.verifiedCount > 0)
    .sort((a, b) => {
      // Highest avgAccuracyScoreV2 first
      const scoreA = a.avgAccuracyScoreV2 ?? -1;
      const scoreB = b.avgAccuracyScoreV2 ?? -1;
      if (scoreB !== scoreA) return scoreB - scoreA;
      // Ties: lower avgAdjustedError
      const adjA = a.avgAdjustedError ?? Infinity;
      const adjB = b.avgAdjustedError ?? Infinity;
      if (adjA !== adjB) return adjA - adjB;
      // Then higher verifiedCount
      return b.verifiedCount - a.verifiedCount;
    });

  return ranked.map((s, i) => ({
    rank: i + 1,
    source: s.source,
    verifiedCount: s.verifiedCount,
    avgAccuracyScoreV2: s.avgAccuracyScoreV2,
    avgAbsError: s.avgAbsError,
    avgAdjustedError: s.avgAdjustedError,
    avgSignedError: s.avgSignedError,
  }));
}
