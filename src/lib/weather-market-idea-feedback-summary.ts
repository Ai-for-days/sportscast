// ── Step 155: Pure aggregator for idea-feedback tuning notes ────────────
//
// Takes a flat array of `WeatherMarketIdeaFeedback` records and rolls
// them up into operator-friendly summaries by preset / weather tag /
// metric pair / target-difference bucket / reason. Emits short
// **advisory** tuning notes ("keep current range" / "consider wider
// target" / etc.) based on simple sample-size + useful-rate
// heuristics. **Never mutates a preset definition. Never publishes,
// creates, or modifies a wager.**
//
// Pure function. No I/O. No imports beyond types.

import type {
  WeatherMarketIdeaFeedback,
  FeedbackRating,
  FeedbackReason,
} from './weather-market-idea-feedback-store';

// ── Heuristic thresholds (advisory only) ────────────────────────────────────

/** Sample size below which we won't editorialize beyond "keep collecting". */
const MIN_SAMPLES_FOR_TUNING = 5;
/** Useful-rate (fraction) above which we suggest "keep current". */
const KEEP_CURRENT_USEFUL_RATE = 0.6;
/** Useful-rate (fraction) below which we suggest "consider tuning". */
const NEEDS_TUNING_USEFUL_RATE = 0.35;
/** How many top negative reasons to include per group. */
const TOP_REASONS_PER_GROUP = 3;
/** Buckets for `targetDifferenceF` — none, 0–10, 10–20, 20–30, 30+. */
function bucketTargetDifference(f: number | undefined): string {
  if (f === undefined || f === null) return 'none';
  if (f < 10) return '<10°F';
  if (f < 20) return '10–20°F';
  if (f < 30) return '20–30°F';
  return '30+°F';
}

// ── Public types ────────────────────────────────────────────────────────────

export interface FeedbackGroupSummary {
  /** Group key — preset id, tag, metric pair, etc. depending on group type. */
  key: string;
  totalCount: number;
  usefulCount: number;
  notUsefulCount: number;
  neutralCount: number;
  /** `useful / total`, rounded to 2 decimals. `null` when total === 0. */
  usefulRate: number | null;
  /** Top negative reasons sorted by count desc, with their counts. */
  topNegativeReasons: Array<{ reason: FeedbackReason; count: number }>;
  /** Short advisory tuning note. Always present, even when sample is small. */
  tuningNote: string;
}

export interface FeedbackSummary {
  /** Total feedback records the summary considered. */
  totalFeedback: number;
  /** Counts by overall rating across the whole sample. */
  byRating: Record<FeedbackRating, number>;
  /** Counts by reason across the whole sample. */
  byReason: Record<FeedbackReason, number>;
  /** Per-preset rollups, sorted by total descending. */
  byPreset: FeedbackGroupSummary[];
  /** Per-weather-tag rollups (a record can contribute to multiple tags). */
  byTag: FeedbackGroupSummary[];
  /** Per-metric-pair rollups. */
  byMetricPair: FeedbackGroupSummary[];
  /** Per-target-difference-bucket rollups. */
  byTargetDifferenceBucket: FeedbackGroupSummary[];
  /** Sentence-form notes the UI can drop straight into a tuning panel. */
  topLevelNotes: string[];
}

// ── Internal helpers ───────────────────────────────────────────────────────

interface GroupAccumulator {
  total: number;
  useful: number;
  notUseful: number;
  neutral: number;
  reasonCounts: Map<FeedbackReason, number>;
}

function emptyAccumulator(): GroupAccumulator {
  return {
    total: 0,
    useful: 0,
    notUseful: 0,
    neutral: 0,
    reasonCounts: new Map(),
  };
}

function addToAccumulator(acc: GroupAccumulator, record: WeatherMarketIdeaFeedback): void {
  acc.total += 1;
  if (record.rating === 'useful') acc.useful += 1;
  else if (record.rating === 'not_useful') acc.notUseful += 1;
  else acc.neutral += 1;
  if (record.reason) {
    acc.reasonCounts.set(record.reason, (acc.reasonCounts.get(record.reason) ?? 0) + 1);
  }
}

function topNegativeReasons(
  acc: GroupAccumulator,
  limit = TOP_REASONS_PER_GROUP,
): Array<{ reason: FeedbackReason; count: number }> {
  // 'good_candidate' is positive; everything else is treated as a
  // negative or neutral signal worth surfacing.
  const negative: Array<{ reason: FeedbackReason; count: number }> = [];
  for (const [reason, count] of acc.reasonCounts) {
    if (reason === 'good_candidate') continue;
    negative.push({ reason, count });
  }
  negative.sort((a, b) => b.count - a.count);
  return negative.slice(0, limit);
}

function describeRate(useful: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((useful / total) * 100) / 100;
}

/**
 * Generate a single advisory sentence per group based on sample size,
 * useful rate, and dominant negative reason. **Never declarative — the
 * note is operator guidance, not an auto-action.**
 */
function tuningNoteFor(
  groupLabel: string,
  acc: GroupAccumulator,
): string {
  const total = acc.total;
  if (total === 0) {
    return `${groupLabel}: no feedback yet — keep collecting before tuning.`;
  }
  if (total < MIN_SAMPLES_FOR_TUNING) {
    return `${groupLabel}: only ${total} feedback record(s) — keep collecting before tuning (need ≥ ${MIN_SAMPLES_FOR_TUNING}).`;
  }
  const rate = acc.useful / total;
  const top = topNegativeReasons(acc, 1)[0];
  const ratePct = Math.round(rate * 100);

  if (rate >= KEEP_CURRENT_USEFUL_RATE) {
    return `${groupLabel}: ${ratePct}% useful rate over ${total} feedback record(s) — keep current settings.`;
  }
  if (rate <= NEEDS_TUNING_USEFUL_RATE) {
    let suggestion = ' — consider revising the preset / tag mix.';
    if (top) {
      switch (top.reason) {
        case 'too_boring':
          suggestion = ' — many marked too boring; consider widening target difference or relaxing the tag filter.';
          break;
        case 'too_extreme':
          suggestion = ' — many marked too extreme; consider lowering target difference or tightening the tolerance.';
          break;
        case 'bad_city_pair':
          suggestion = ' — many marked bad city pair; review the cities the preset / tag set is matching.';
          break;
        case 'unclear_market':
          suggestion = ' — many marked unclear; review the title template / metric pair on the preset.';
          break;
        case 'duplicate':
          suggestion = ' — many marked duplicate of existing markets; tighten the city set or adjust spread granularity.';
          break;
        case 'wrong_metric_pair':
          suggestion = ' — many marked wrong metric pair; consider changing the preset\'s suggested metric pair.';
          break;
        case 'poor_forecast_confidence':
          suggestion = ' — many marked poor forecast confidence; shorten the day-offset window.';
          break;
        default:
          suggestion = ' — consider revising the preset / tag mix.';
      }
    }
    return `${groupLabel}: ${ratePct}% useful rate over ${total} feedback record(s)${suggestion}`;
  }
  return `${groupLabel}: ${ratePct}% useful rate over ${total} feedback record(s) — borderline, watch the trend.`;
}

function finalizeGroup(
  key: string,
  acc: GroupAccumulator,
  labelForNote: string,
): FeedbackGroupSummary {
  return {
    key,
    totalCount: acc.total,
    usefulCount: acc.useful,
    notUsefulCount: acc.notUseful,
    neutralCount: acc.neutral,
    usefulRate: describeRate(acc.useful, acc.total),
    topNegativeReasons: topNegativeReasons(acc),
    tuningNote: tuningNoteFor(labelForNote, acc),
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export function summarizeFeedback(
  records: readonly WeatherMarketIdeaFeedback[],
): FeedbackSummary {
  const byPreset = new Map<string, GroupAccumulator>();
  const byTag = new Map<string, GroupAccumulator>();
  const byMetricPair = new Map<string, GroupAccumulator>();
  const byBucket = new Map<string, GroupAccumulator>();
  const byRating: Record<FeedbackRating, number> = { useful: 0, not_useful: 0, neutral: 0 };
  const byReason: Record<string, number> = {};

  for (const r of records) {
    byRating[r.rating] = (byRating[r.rating] ?? 0) + 1;
    if (r.reason) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;

    if (r.presetId) {
      const acc = byPreset.get(r.presetId) ?? emptyAccumulator();
      addToAccumulator(acc, r);
      byPreset.set(r.presetId, acc);
    }
    if (Array.isArray(r.weatherTags)) {
      // A record contributes to every tag it ran with — that's the
      // semantically right rollup since the operator mostly cares
      // "did 'hot' work across multiple presets / runs".
      for (const t of r.weatherTags) {
        const acc = byTag.get(t) ?? emptyAccumulator();
        addToAccumulator(acc, r);
        byTag.set(t, acc);
      }
    }
    if (r.metricPair) {
      const acc = byMetricPair.get(r.metricPair) ?? emptyAccumulator();
      addToAccumulator(acc, r);
      byMetricPair.set(r.metricPair, acc);
    }
    const bucket = bucketTargetDifference(r.targetDifferenceF);
    {
      const acc = byBucket.get(bucket) ?? emptyAccumulator();
      addToAccumulator(acc, r);
      byBucket.set(bucket, acc);
    }
  }

  const presetSummaries = Array.from(byPreset.entries())
    .map(([key, acc]) => finalizeGroup(key, acc, `preset "${key}"`))
    .sort((a, b) => b.totalCount - a.totalCount);
  const tagSummaries = Array.from(byTag.entries())
    .map(([key, acc]) => finalizeGroup(key, acc, `tag "${key}"`))
    .sort((a, b) => b.totalCount - a.totalCount);
  const metricPairSummaries = Array.from(byMetricPair.entries())
    .map(([key, acc]) => finalizeGroup(key, acc, `metric pair "${key}"`))
    .sort((a, b) => b.totalCount - a.totalCount);
  const bucketSummaries = Array.from(byBucket.entries())
    .map(([key, acc]) => finalizeGroup(key, acc, `target-difference bucket ${key}`))
    .sort((a, b) => b.totalCount - a.totalCount);

  const topLevelNotes: string[] = [];
  if (records.length === 0) {
    topLevelNotes.push('No feedback recorded yet. Mark generated ideas Useful / Not useful to start the tuning trail.');
  } else {
    topLevelNotes.push(
      `${records.length} feedback record(s) collected — ${byRating.useful} useful / ${byRating.not_useful} not useful / ${byRating.neutral} neutral.`,
    );
    // Surface the single most-rated preset with a verbatim note.
    if (presetSummaries.length > 0 && presetSummaries[0].totalCount >= MIN_SAMPLES_FOR_TUNING) {
      topLevelNotes.push(presetSummaries[0].tuningNote);
    }
  }

  return {
    totalFeedback: records.length,
    byRating,
    byReason: byReason as Record<FeedbackReason, number>,
    byPreset: presetSummaries,
    byTag: tagSummaries,
    byMetricPair: metricPairSummaries,
    byTargetDifferenceBucket: bucketSummaries,
    topLevelNotes,
  };
}
