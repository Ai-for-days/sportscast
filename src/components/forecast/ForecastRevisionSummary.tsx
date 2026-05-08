// ── Step 130: Forecast revision summary surface ─────────────────────────────
//
// Renders the "what changed since last time" view as a calm card under
// the Step 129 ForecastIntelligenceCard. Subtle directional icons, plain
// English, no trading-terminal aesthetics. Inherits the Step 128 stable
// card surface.
//
// Hides itself entirely when the prior snapshot is missing (initial view)
// to avoid mounting an empty placeholder card under the page hero.

import React from 'react';
import type {
  ForecastRevisionSummary,
  ForecastRevisionKind,
} from '../../lib/forecast-revision-analysis';

interface Props {
  summary: ForecastRevisionSummary;
}

const KIND_LABEL: Record<ForecastRevisionKind, string> = {
  severe_added: 'Severe alert',
  severe_removed: 'Alert cleared',
  less_stable: 'Less stable',
  more_stable: 'More stable',
  wetter: 'Wetter',
  drier: 'Drier',
  windier: 'Windier',
  calming: 'Calming',
  warming: 'Warmer',
  cooling: 'Cooler',
};

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

function kindTone(kind: ForecastRevisionKind): string {
  if (kind === 'severe_added') {
    return 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800/60 dark:bg-orange-950/40 dark:text-orange-200';
  }
  if (kind === 'severe_removed' || kind === 'more_stable') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200';
  }
  if (kind === 'less_stable') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200';
  }
  return 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-200';
}

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}
    >
      {children}
    </span>
  );
}

export default function ForecastRevisionSummaryCard({ summary }: Props) {
  // No prior snapshot — don't render anything; the Step 129 card already
  // covers the "how the forecast feels right now" surface.
  if (summary.isInitial) return null;

  const { isUnchanged, changes, comparedLabel, headline, generatedAtUnchanged } = summary;

  return (
    <section
      aria-label="Forecast revision summary"
      className="rounded-xl border border-border bg-surface p-4 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt sm:p-5"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="mr-1 text-sm font-bold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
          Forecast Changes
        </h3>
        {!isUnchanged && changes.map((c, i) => (
          <Chip key={i} tone={kindTone(c.kind)}>
            <span aria-hidden="true">{KIND_ICON[c.kind]}</span>
            <span>{KIND_LABEL[c.kind]}</span>
          </Chip>
        ))}
      </div>

      {isUnchanged ? (
        <p className="text-sm leading-relaxed text-text-muted dark:text-text-dark-muted">
          {generatedAtUnchanged
            ? `No new forecast run${comparedLabel ? ` ${comparedLabel}` : ''} — outlook unchanged.`
            : `Forecast has remained relatively steady${comparedLabel ? ` ${comparedLabel}` : ''}.`}
        </p>
      ) : (
        <div className="space-y-1.5 text-sm leading-relaxed text-text dark:text-text-dark">
          {headline && <p className="font-medium">{headline}</p>}
          {changes.length > 1 && (
            <ul className="ml-4 list-disc space-y-0.5 text-text-muted dark:text-text-dark-muted">
              {changes.slice(1).map((c, i) => (
                <li key={i}>{c.summary}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
