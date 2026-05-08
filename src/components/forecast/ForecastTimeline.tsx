// ── Step 131: Forecast revision timeline surface ────────────────────────────
//
// Calm chronological list of recent forecast revisions. Mounts beneath
// ForecastRevisionSummary (Step 130). Renders nothing when the snapshot
// chain hasn't accumulated enough material — the page stays breathable.
//
// Visual posture: stable Step 128 surface, vertical timeline with timestamp
// chip + dot + headline + optional bullets. First three entries visible by
// default; "Show more / Show less" toggle for the rest.

import React, { useState } from 'react';
import type {
  ForecastTimelineResult,
  ForecastTimelineEntry,
  ForecastTimelineImportance,
} from '../../lib/forecast-timeline';
import type { ForecastRevisionKind } from '../../lib/forecast-revision-analysis';

interface Props {
  timeline: ForecastTimelineResult;
}

const KIND_ICON: Record<ForecastRevisionKind, string> = {
  severe_added: '!',
  severe_removed: '✓',
  less_stable: '↻',
  more_stable: '·',
  wetter: '↑',
  drier: '↓',
  windier: '↑',
  calming: '↓',
  warming: '↑',
  cooling: '↓',
};

function dotTone(importance: ForecastTimelineImportance, kind: ForecastRevisionKind): string {
  if (importance === 'high') {
    return 'border-orange-400 bg-orange-100 text-orange-800 dark:border-orange-700 dark:bg-orange-950/60 dark:text-orange-200';
  }
  if (kind === 'more_stable' || kind === 'severe_removed') {
    return 'border-emerald-400 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200';
  }
  if (kind === 'less_stable') {
    return 'border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200';
  }
  return 'border-sky-400 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-200';
}

function TimelineRow({ entry, isLast }: { entry: ForecastTimelineEntry; isLast: boolean }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* Vertical line behind the dot — stops at the last item. */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-3 top-7 h-[calc(100%-1.5rem)] w-px bg-border dark:bg-border-dark"
        />
      )}

      {/* Dot */}
      <span
        aria-hidden="true"
        className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${dotTone(entry.importance, entry.primaryKind)}`}
      >
        {KIND_ICON[entry.primaryKind]}
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
          {entry.relativeLabel}
        </div>
        <p className="text-sm font-medium text-text dark:text-text-dark">
          {entry.headline}
        </p>
        {entry.detail.length > 0 && (
          <ul className="mt-1 ml-4 list-disc space-y-0.5 text-xs text-text-muted dark:text-text-dark-muted">
            {entry.detail.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export default function ForecastTimeline({ timeline }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (timeline.entries.length === 0) return null;

  const initialCount = 3;
  const visible = showAll
    ? timeline.entries
    : timeline.entries.slice(0, initialCount);
  const hasMore = timeline.entries.length > initialCount;

  return (
    <section
      aria-label="Forecast revision timeline"
      className="rounded-xl border border-border bg-surface p-4 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt sm:p-5"
    >
      <div className="mb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
          Forecast History
        </h3>
        {timeline.narrativeSummary && (
          <p className="mt-1 text-sm text-text dark:text-text-dark">
            {timeline.narrativeSummary}
          </p>
        )}
      </div>

      <ol className="space-y-0">
        {visible.map((entry, i) => (
          <TimelineRow
            key={entry.id}
            entry={entry}
            isLast={i === visible.length - 1}
          />
        ))}
      </ol>

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs font-semibold text-field-dark hover:underline dark:text-field-light"
        >
          {showAll
            ? 'Show less'
            : `Show ${timeline.entries.length - initialCount} more`}
        </button>
      )}
    </section>
  );
}
