// ── Step 163: Near-duplicate suppression for generated weather ideas ───
//
// Pure deterministic deduper. Treats two ideas as near-duplicates when
// they share:
//   - normalized city pair (direction-agnostic)
//   - metric pair
//   - spread bucket
//   - directional framing (positive vs negative suggested spread)
//   - confidence band (low / medium / high from the Step-163 normalizer)
//
// Keeps the highest-`qualityScore` member of each cluster. The others
// are tagged with the cluster id + reason so the inspector can render
// the full picture.
//
// **No I/O. No mutation of inputs.** Returns shallow-cloned ideas.

import type { WeatherMarketIdea } from './weather-market-idea-generator';

// ── Public types ────────────────────────────────────────────────────────────

export interface DedupedIdea extends WeatherMarketIdea {
  /** Stable identifier shared by every member of the same near-duplicate cluster. */
  dedupeClusterId: string;
  /** True when the deduper picked this idea as the cluster winner. */
  dedupeRetained: boolean;
  /** Set when `dedupeRetained === false`. */
  dedupeReason?: 'near_duplicate' | 'lower_quality_duplicate';
  /** Number of ideas (including this one) in the cluster. */
  dedupeClusterSize: number;
}

export interface DedupeResult {
  /** All ideas annotated with cluster metadata. Order preserved from input. */
  annotated: DedupedIdea[];
  /** Just the kept ideas, in input order. */
  kept: DedupedIdea[];
  /** Just the suppressed ideas, in input order. */
  suppressed: DedupedIdea[];
  /** Number of distinct clusters discovered. */
  clusterCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function spreadBucket(spread: number): string {
  const a = Math.abs(spread);
  if (a < 5) return '<5';
  if (a < 10) return '5-10';
  if (a < 15) return '10-15';
  if (a < 20) return '15-20';
  if (a < 30) return '20-30';
  return '30+';
}

function cityPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function confidenceBand(normalized: number): 'low' | 'medium' | 'high' {
  if (normalized >= 75) return 'high';
  if (normalized >= 55) return 'medium';
  return 'low';
}

function direction(spread: number): 'a_favored' | 'b_favored' | 'even' {
  if (spread > 0.5) return 'a_favored';
  if (spread < -0.5) return 'b_favored';
  return 'even';
}

function clusterKeyFor(
  idea: WeatherMarketIdea,
  normalizedConfidence: number,
): string {
  return [
    cityPairKey(idea.locationA.id, idea.locationB.id),
    `${idea.metricA}-${idea.metricB}`,
    spreadBucket(idea.suggestedSpread),
    direction(idea.suggestedSpread),
    confidenceBand(normalizedConfidence),
  ].join('|');
}

function makeClusterId(seedKey: string, idx: number): string {
  // Deterministic id — keeps the audit trail trivially comparable.
  return `dc-${idx.toString(36)}-${hashKey(seedKey)}`;
}

function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface DedupeInputs {
  /** Pre-computed normalized confidence per idea id (Step 163 normalizer). */
  normalizedConfidenceById: Record<string, number>;
  /** Pre-computed quality score per idea id (Step 163 scorer). */
  qualityScoreById: Record<string, number>;
}

/**
 * Pure deduper. Groups by the composite cluster key + keeps the
 * highest-quality idea per cluster.
 */
export function dedupeIdeas(
  ideas: readonly WeatherMarketIdea[],
  inputs: DedupeInputs,
): DedupeResult {
  const annotated: DedupedIdea[] = [];
  const buckets = new Map<string, { ids: string[]; clusterId: string }>();
  let clusterIdx = 0;

  for (const idea of ideas) {
    const norm = inputs.normalizedConfidenceById[idea.id] ?? 50;
    const key = clusterKeyFor(idea, norm);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { ids: [], clusterId: makeClusterId(key, clusterIdx++) };
      buckets.set(key, bucket);
    }
    bucket.ids.push(idea.id);
  }

  // For each bucket, decide the winner deterministically:
  //   highest qualityScore → lowest interestingnessScore tie-break → lowest id
  const winners = new Set<string>();
  for (const bucket of buckets.values()) {
    if (bucket.ids.length === 0) continue;
    let winnerId = bucket.ids[0];
    let winnerScore = inputs.qualityScoreById[winnerId] ?? -1;
    for (const id of bucket.ids.slice(1)) {
      const s = inputs.qualityScoreById[id] ?? -1;
      if (s > winnerScore) {
        winnerScore = s;
        winnerId = id;
      } else if (s === winnerScore && id < winnerId) {
        winnerId = id;
      }
    }
    winners.add(winnerId);
  }

  for (const idea of ideas) {
    const norm = inputs.normalizedConfidenceById[idea.id] ?? 50;
    const key = clusterKeyFor(idea, norm);
    const bucket = buckets.get(key)!;
    const retained = winners.has(idea.id);
    const annotatedIdea: DedupedIdea = {
      ...idea,
      dedupeClusterId: bucket.clusterId,
      dedupeRetained: retained,
      dedupeReason: retained
        ? undefined
        : bucket.ids.length > 1
          ? 'lower_quality_duplicate'
          : 'near_duplicate',
      dedupeClusterSize: bucket.ids.length,
    };
    annotated.push(annotatedIdea);
  }

  return {
    annotated,
    kept: annotated.filter((i) => i.dedupeRetained),
    suppressed: annotated.filter((i) => !i.dedupeRetained),
    clusterCount: buckets.size,
  };
}
