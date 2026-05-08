// ── Step 130: Forecast revision analysis ────────────────────────────────────
//
// Pure heuristic comparison between a prior forecast snapshot and the
// current one. Emits human-readable revision summaries — "Rain chances
// increased", "Forecast trending warmer", "Conditions have become less
// stable" — without overstating precision.
//
// No betting, pricing, settlement, or admin behavior touches this layer.
// See docs/forecast-intelligence-notes.md for thresholds and philosophy.

import type { ForecastSnapshot } from './forecast-revision-store';

export type ForecastRevisionKind =
  | 'severe_added'
  | 'severe_removed'
  | 'less_stable'
  | 'more_stable'
  | 'wetter'
  | 'drier'
  | 'windier'
  | 'calming'
  | 'warming'
  | 'cooling';

export interface ForecastRevisionChange {
  kind: ForecastRevisionKind;
  summary: string;
  /** Signed magnitude for the dominant axis; useful for ordering and tooltips. */
  delta: number;
}

export interface ForecastRevisionSummary {
  /** When the prior snapshot was captured (ISO). null when none. */
  priorCapturedAt: string | null;
  /** Customer-facing label like "since this morning" / "in the last hour". */
  comparedLabel: string | null;
  /** True when prior and current share the same upstream `generatedAt`. */
  generatedAtUnchanged: boolean;
  /** True when no prior snapshot existed (first observation). */
  isInitial: boolean;
  /** True when there is nothing meaningful to report. */
  isUnchanged: boolean;
  /** Up to three most-relevant changes, priority-sorted. */
  changes: ForecastRevisionChange[];
  /** Friendly headline for cards: "Rain chances increased since this morning." */
  headline: string | null;
}

// ── Thresholds ──────────────────────────────────────────────────────────────

const TEMP_DELTA_F = 4;      // avg of next-3-day highs
const PRECIP_DELTA_PP = 15;  // max of next-3-day precip probability
const WIND_DELTA_MPH = 4;    // avg of next-3-day wind speed

const KIND_PRIORITY: ForecastRevisionKind[] = [
  'severe_added',
  'severe_removed',
  'less_stable',
  'more_stable',
  'wetter',
  'drier',
  'windier',
  'calming',
  'warming',
  'cooling',
];

// ── Time-of-day labelling ───────────────────────────────────────────────────

export function buildComparedLabel(priorIso: string, nowMs = Date.now()): string {
  const t = Date.parse(priorIso);
  if (!Number.isFinite(t)) return 'recently';
  const diffMs = nowMs - t;
  if (diffMs < 0) return 'recently';

  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) {
    if (minutes <= 1) return 'in the last minute';
    return `${minutes} minutes ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    // Same calendar day? Prefer narrative phrasing.
    const prior = new Date(t);
    const now = new Date(nowMs);
    if (prior.toDateString() === now.toDateString()) {
      const priorH = prior.getHours();
      if (priorH < 12) return 'since this morning';
      if (priorH < 17) return 'since this afternoon';
      return 'since this evening';
    }
    if (hours === 1) return '1 hour ago';
    return `${hours} hours ago`;
  }

  const days = Math.round(hours / 24);
  if (days === 1) return 'since yesterday';
  if (days < 7) return `${days} days ago`;
  return `more than a week ago`;
}

// ── Aggregations ────────────────────────────────────────────────────────────

function avgOfHighs(snap: ForecastSnapshot, n: number): number | null {
  const slice = snap.daily.slice(0, n);
  if (slice.length === 0) return null;
  return slice.reduce((s, d) => s + d.highF, 0) / slice.length;
}

function maxPrecip(snap: ForecastSnapshot, n: number): number | null {
  const slice = snap.daily.slice(0, n);
  if (slice.length === 0) return null;
  let m = -Infinity;
  for (const d of slice) m = Math.max(m, d.precipProbability);
  return m === -Infinity ? null : m;
}

function avgWind(snap: ForecastSnapshot, n: number): number | null {
  const slice = snap.daily.slice(0, n);
  if (slice.length === 0) return null;
  return slice.reduce((s, d) => s + d.windSpeedMph, 0) / slice.length;
}

function confidenceRank(level: ForecastSnapshot['intelligence']['confidence']): number {
  return level === 'high' ? 2 : level === 'moderate' ? 1 : 0;
}

function volatilityRank(level: ForecastSnapshot['intelligence']['volatility']): number {
  return level === 'stable' ? 0 : level === 'shifting' ? 1 : 2;
}

// ── Core diff ───────────────────────────────────────────────────────────────

export function diffSnapshots(
  prior: ForecastSnapshot,
  current: ForecastSnapshot,
): ForecastRevisionChange[] {
  const changes: ForecastRevisionChange[] = [];

  // Severe alerts.
  if (current.hasActiveSevereAlert && !prior.hasActiveSevereAlert) {
    changes.push({
      kind: 'severe_added',
      summary: 'A severe weather alert has been issued.',
      delta: 1,
    });
  } else if (!current.hasActiveSevereAlert && prior.hasActiveSevereAlert) {
    changes.push({
      kind: 'severe_removed',
      summary: 'Severe weather alert has cleared.',
      delta: -1,
    });
  }

  // Stability (confidence + volatility combined into a single direction).
  const priorStability = confidenceRank(prior.intelligence.confidence) - volatilityRank(prior.intelligence.volatility);
  const currentStability = confidenceRank(current.intelligence.confidence) - volatilityRank(current.intelligence.volatility);
  if (currentStability < priorStability) {
    changes.push({
      kind: 'less_stable',
      summary: 'Conditions have become less stable.',
      delta: priorStability - currentStability,
    });
  } else if (currentStability > priorStability) {
    changes.push({
      kind: 'more_stable',
      summary: 'Conditions have become more stable.',
      delta: currentStability - priorStability,
    });
  }

  // Precip chances over the next ~3 days.
  const pPrior = maxPrecip(prior, 3);
  const pCur = maxPrecip(current, 3);
  if (pPrior !== null && pCur !== null) {
    const delta = pCur - pPrior;
    if (delta >= PRECIP_DELTA_PP) {
      changes.push({
        kind: 'wetter',
        summary: `Rain chances increased — peaks near ${Math.round(pCur)}% in the next few days.`,
        delta,
      });
    } else if (delta <= -PRECIP_DELTA_PP) {
      changes.push({
        kind: 'drier',
        summary: `Rain chances eased — now peaking near ${Math.round(pCur)}%.`,
        delta,
      });
    }
  }

  // Wind speed over the next ~3 days.
  const wPrior = avgWind(prior, 3);
  const wCur = avgWind(current, 3);
  if (wPrior !== null && wCur !== null) {
    const delta = wCur - wPrior;
    if (delta >= WIND_DELTA_MPH) {
      changes.push({
        kind: 'windier',
        summary: `Wind forecast strengthened — averaging ${Math.round(wCur)} mph.`,
        delta,
      });
    } else if (delta <= -WIND_DELTA_MPH) {
      changes.push({
        kind: 'calming',
        summary: `Winds easing — averaging ${Math.round(wCur)} mph.`,
        delta,
      });
    }
  }

  // High temps over the next ~3 days.
  const tPrior = avgOfHighs(prior, 3);
  const tCur = avgOfHighs(current, 3);
  if (tPrior !== null && tCur !== null) {
    const delta = tCur - tPrior;
    if (delta >= TEMP_DELTA_F) {
      changes.push({
        kind: 'warming',
        summary: `Forecast trending warmer — highs near ${Math.round(tCur)}°F.`,
        delta,
      });
    } else if (delta <= -TEMP_DELTA_F) {
      changes.push({
        kind: 'cooling',
        summary: `Forecast trending cooler — highs near ${Math.round(tCur)}°F.`,
        delta,
      });
    }
  }

  return changes;
}

// ── Public entry point ──────────────────────────────────────────────────────

export function buildRevisionSummary(
  prior: ForecastSnapshot | null,
  current: ForecastSnapshot,
): ForecastRevisionSummary {
  if (!prior) {
    return {
      priorCapturedAt: null,
      comparedLabel: null,
      generatedAtUnchanged: false,
      isInitial: true,
      isUnchanged: false,
      changes: [],
      headline: null,
    };
  }

  const generatedAtUnchanged =
    !!prior.generatedAt && !!current.generatedAt && prior.generatedAt === current.generatedAt;

  // No upstream revision: nothing meaningful to compare.
  if (generatedAtUnchanged) {
    return {
      priorCapturedAt: prior.capturedAt,
      comparedLabel: buildComparedLabel(prior.capturedAt),
      generatedAtUnchanged: true,
      isInitial: false,
      isUnchanged: true,
      changes: [],
      headline: 'Forecast has remained relatively steady.',
    };
  }

  const changes = diffSnapshots(prior, current);
  if (changes.length === 0) {
    return {
      priorCapturedAt: prior.capturedAt,
      comparedLabel: buildComparedLabel(prior.capturedAt),
      generatedAtUnchanged: false,
      isInitial: false,
      isUnchanged: true,
      changes: [],
      headline: 'Forecast has remained relatively steady.',
    };
  }

  changes.sort(
    (a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind),
  );
  const top = changes.slice(0, 3);
  const comparedLabel = buildComparedLabel(prior.capturedAt);
  const lead = top[0].summary.replace(/\.$/, '');
  const headline = `${lead} ${comparedLabel}.`;

  return {
    priorCapturedAt: prior.capturedAt,
    comparedLabel,
    generatedAtUnchanged: false,
    isInitial: false,
    isUnchanged: false,
    changes: top,
    headline,
  };
}
