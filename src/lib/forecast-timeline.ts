// ── Step 131: Forecast revision timeline ────────────────────────────────────
//
// Converts a chain of compact forecast snapshots into a chronological
// "what changed and when" timeline for the weather page. Pure heuristic,
// pure data — same trust posture as Steps 129/130. No betting, pricing,
// settlement, or admin behavior touches this layer.
//
// The Step 130 ForecastRevisionSummary card already covers "what just
// changed" (the most-recent pair). The timeline answers "what came
// before that" — so by default we skip the most-recent pair to avoid
// duplicating the headline. Callers can override.

import type { ForecastSnapshot } from './forecast-revision-store';
import {
  diffSnapshots,
  buildComparedLabel,
  type ForecastRevisionChange,
  type ForecastRevisionKind,
} from './forecast-revision-analysis';

export type ForecastTimelineImportance = 'high' | 'medium' | 'low';

export interface ForecastTimelineEntry {
  /** Stable id for React keys — newer snapshot's id. */
  id: string;
  /** ISO timestamp of the newer snapshot in the diffed pair. */
  capturedAt: string;
  /** Customer-friendly relative phrase ("2 hours ago", "yesterday"). */
  relativeLabel: string;
  /** Single-line headline derived from the first change. */
  headline: string;
  /** Up to two additional one-liners; empty when only one change fired. */
  detail: string[];
  /** Severe alerts and large stability drops bubble up. */
  importance: ForecastTimelineImportance;
  /** Dominant change (priority-sorted) — drives the icon/tone. */
  primaryKind: ForecastRevisionKind;
  /** All changes for this entry; lets the UI render compact chips. */
  changes: ForecastRevisionChange[];
}

export interface ForecastTimelineResult {
  entries: ForecastTimelineEntry[];
  /** Optional one-line lead summarizing the chain ("Forecast has remained
   * relatively steady this week.") — null when the timeline is empty. */
  narrativeSummary: string | null;
}

interface BuildOptions {
  /**
   * Skip the most-recent (newest, second-newest) pair. Defaults to true
   * because the Step 130 ForecastRevisionSummary card already shows that
   * delta and we don't want a duplicate headline.
   */
  skipMostRecentPair?: boolean;
  /** Hard cap on returned entries. Defaults to 6. */
  maxEntries?: number;
  /** Override "now" for tests. */
  nowMs?: number;
}

function importanceFor(changes: ForecastRevisionChange[]): ForecastTimelineImportance {
  if (changes.some((c) => c.kind === 'severe_added')) return 'high';
  if (
    changes.some(
      (c) =>
        c.kind === 'less_stable' ||
        c.kind === 'severe_removed' ||
        c.kind === 'wetter' ||
        c.kind === 'windier',
    )
  ) {
    return 'medium';
  }
  return 'low';
}

function lowercaseFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * Build a chronological revision timeline from a snapshot chain (newest
 * first, as returned by `listSnapshots`).
 */
export function buildForecastTimeline(
  snapshots: ForecastSnapshot[],
  options: BuildOptions = {},
): ForecastTimelineResult {
  const skipMostRecent = options.skipMostRecentPair ?? true;
  const maxEntries = options.maxEntries ?? 6;
  const nowMs = options.nowMs ?? Date.now();

  if (snapshots.length < 2) {
    return { entries: [], narrativeSummary: null };
  }

  const entries: ForecastTimelineEntry[] = [];
  // Pairs: (newer = i, older = i+1). i=0 is the most-recent pair, optionally
  // skipped because the Step 130 card already covers it.
  const startIdx = skipMostRecent ? 1 : 0;

  for (let i = startIdx; i < snapshots.length - 1; i++) {
    if (entries.length >= maxEntries) break;
    const newer = snapshots[i];
    const older = snapshots[i + 1];
    const changes = diffSnapshots(older, newer);
    if (changes.length === 0) continue;

    const primary = changes[0];
    const relativeLabel = buildComparedLabel(newer.capturedAt, nowMs);
    const headlineLead = primary.summary.replace(/\.$/, '');
    const headline = `${headlineLead} ${relativeLabel}.`;
    const detail = changes.slice(1, 3).map((c) => c.summary);

    entries.push({
      id: newer.id,
      capturedAt: newer.capturedAt,
      relativeLabel,
      headline,
      detail,
      importance: importanceFor(changes),
      primaryKind: primary.kind,
      changes,
    });
  }

  // ── Narrative summary ────────────────────────────────────────────────────
  // Lightweight stability narrative continuity: a one-line lead that
  // summarizes the chain when the timeline has any entries.
  let narrativeSummary: string | null = null;
  if (entries.length === 0) {
    // No meaningful revisions across the visible chain.
    narrativeSummary = 'Forecast has remained relatively steady recently.';
  } else {
    const allKinds = entries.flatMap((e) => e.changes.map((c) => c.kind));
    const hasSevere = allKinds.includes('severe_added');
    const hasLessStable = allKinds.includes('less_stable');
    const hasMoreStable = allKinds.includes('more_stable');

    if (hasSevere) {
      narrativeSummary = 'Severe weather risk has shaped the recent forecast.';
    } else if (hasLessStable && !hasMoreStable) {
      narrativeSummary = 'Forecast volatility has been increasing recently.';
    } else if (hasMoreStable && !hasLessStable) {
      narrativeSummary = 'Forecast has been stabilizing over recent updates.';
    } else {
      narrativeSummary = `Recent forecast updates have ${lowercaseFirst(
        primaryNarrative(entries),
      )}`;
    }
  }

  return { entries, narrativeSummary };
}

function primaryNarrative(entries: ForecastTimelineEntry[]): string {
  // Use the most-recent timeline entry's primary kind to give the chain a
  // human-readable colour.
  const top = entries[0];
  switch (top.primaryKind) {
    case 'wetter':
      return 'Trended wetter.';
    case 'drier':
      return 'Trended drier.';
    case 'warming':
      return 'Trended warmer.';
    case 'cooling':
      return 'Trended cooler.';
    case 'windier':
      return 'Trended windier.';
    case 'calming':
      return 'Trended calmer.';
    case 'more_stable':
      return 'Stabilized.';
    case 'less_stable':
      return 'Become less stable.';
    case 'severe_added':
      return 'Introduced severe weather risk.';
    case 'severe_removed':
      return 'Cleared severe weather risk.';
    default:
      return 'Shifted modestly.';
  }
}
