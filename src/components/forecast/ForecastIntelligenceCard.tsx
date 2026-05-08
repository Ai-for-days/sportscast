// ── Step 129: Forecast Confidence + Volatility surface ──────────────────────
//
// Quietly intelligent card that renders the heuristic forecast intelligence
// summary built in src/lib/forecast-intelligence.ts. Inherits the Step 128
// stable-surface hierarchy (opaque card, border, shadow). No charts, no
// dashboards — three small chips, two short sentences, optional freshness.

import React from 'react';
import type {
  ForecastIntelligenceSummary,
  ForecastConfidenceLevel,
  ForecastVolatilityLevel,
  ForecastTrendDirection,
} from '../../lib/forecast-intelligence';

interface Props {
  summary: ForecastIntelligenceSummary;
  /** Step 133: optional forecast source label, shown alongside the freshness
   * line so users can see which provider produced the forecast they are
   * looking at (e.g., "Open-Meteo · Updated 18 minutes ago"). */
  sourceLabel?: string;
}

const CONFIDENCE_LABELS: Record<ForecastConfidenceLevel, string> = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  low: 'Lower confidence',
};

const VOLATILITY_LABELS: Record<ForecastVolatilityLevel, string> = {
  stable: 'Stable',
  shifting: 'Shifting',
  volatile: 'Volatile',
};

const TREND_LABELS: Record<ForecastTrendDirection, string> = {
  warming: 'Warming',
  cooling: 'Cooling',
  wetter: 'Wetter',
  drier: 'Drier',
  windier: 'Windier',
  calming: 'Calming',
  stable: 'Steady',
};

const TREND_ICONS: Record<ForecastTrendDirection, string> = {
  warming: '↑',
  cooling: '↓',
  wetter: '↑',
  drier: '↓',
  windier: '↑',
  calming: '↓',
  stable: '·',
};

// Calm three-tone palette — emerald / amber / orange. Inherits Tailwind's
// dark variants automatically (border-emerald-200 dark:border-emerald-700/50).
function confidenceTone(level: ForecastConfidenceLevel): string {
  if (level === 'high') return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200';
  if (level === 'moderate') return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200';
  return 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800/60 dark:bg-orange-950/40 dark:text-orange-200';
}

function volatilityTone(level: ForecastVolatilityLevel): string {
  if (level === 'stable') return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200';
  if (level === 'shifting') return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200';
  return 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800/60 dark:bg-orange-950/40 dark:text-orange-200';
}

function trendTone(direction: ForecastTrendDirection): string {
  if (direction === 'stable') return 'border-border bg-surface-alt text-text-muted dark:border-border-dark dark:bg-surface-dark dark:text-text-dark-muted';
  // All movement directions share the same neutral-leaning slate-blue chip;
  // the icon and label carry the meaning, the chip stays calm.
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

export default function ForecastIntelligenceCard({ summary, sourceLabel }: Props) {
  const {
    confidence,
    confidenceExplanation,
    volatility,
    volatilityExplanation,
    trends,
    freshness,
  } = summary;

  // Step 133: combine source + freshness into a single subtle line. Either
  // half is optional. "Markets resolve using official observation rules"
  // is appended in italics so visitors aren't misled into thinking the
  // forecast source controls settlement.
  const sourceFreshnessLine =
    sourceLabel && freshness
      ? `${sourceLabel} · ${freshness}`
      : sourceLabel || freshness;

  return (
    <section
      aria-label="Forecast outlook"
      className="rounded-xl border border-border bg-surface p-4 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="mr-1 text-sm font-bold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
          Forecast Outlook
        </h3>
        <Chip tone={confidenceTone(confidence)}>
          {CONFIDENCE_LABELS[confidence]}
        </Chip>
        <Chip tone={volatilityTone(volatility)}>
          {VOLATILITY_LABELS[volatility]}
        </Chip>
        {trends.map((t, i) => (
          <Chip key={i} tone={trendTone(t.direction)}>
            <span aria-hidden="true">{TREND_ICONS[t.direction]}</span>
            <span>{TREND_LABELS[t.direction]}</span>
          </Chip>
        ))}
      </div>

      <div className="space-y-1.5 text-sm leading-relaxed text-text dark:text-text-dark">
        <p>{confidenceExplanation}</p>
        <p className="text-text-muted dark:text-text-dark-muted">{volatilityExplanation}</p>
        {trends.length > 0 && (
          <p className="text-text-muted dark:text-text-dark-muted">
            {trends[0].summary}
          </p>
        )}
      </div>

      {sourceFreshnessLine && (
        <div className="mt-3 space-y-0.5">
          <p className="text-xs text-text-muted dark:text-text-dark-muted">
            {sourceFreshnessLine}
          </p>
          {sourceLabel && (
            <p className="text-[11px] italic text-text-muted dark:text-text-dark-muted">
              Markets resolve using official observation rules.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
