// ── Step 132: Weather Market Context surface ────────────────────────────────
//
// Compact non-advisory card that frames how recent forecast movement may
// matter for the weather markets shown below. Mounts directly above
// ForecastWagers. Renders nothing when there is no meaningful context.
//
// Strict copy rules: no betting advice, no "edge"/"profit"/"value"/etc.
// language. The disclaimer footer is always present so the card cannot
// be misread as guidance.

import React from 'react';
import type {
  WeatherMarketContextSummary,
  WeatherMarketContextTone,
} from '../../lib/weather-market-context';

interface Props {
  context: WeatherMarketContextSummary;
}

function toneSurface(tone: WeatherMarketContextTone): string {
  if (tone === 'uncertain') {
    return 'border-orange-200 bg-orange-50/70 dark:border-orange-800/60 dark:bg-orange-950/30';
  }
  if (tone === 'watch') {
    return 'border-amber-200 bg-amber-50/70 dark:border-amber-800/60 dark:bg-amber-950/30';
  }
  return 'border-border bg-surface dark:border-border-dark dark:bg-surface-dark-alt';
}

function toneLabel(tone: WeatherMarketContextTone): string {
  if (tone === 'uncertain') return 'Forecast may be shifting';
  if (tone === 'watch') return 'Forecast watch';
  return 'Steady';
}

function toneChipClass(tone: WeatherMarketContextTone): string {
  if (tone === 'uncertain') {
    return 'border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-700 dark:bg-orange-950/60 dark:text-orange-200';
  }
  if (tone === 'watch') {
    return 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200';
  }
  return 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200';
}

export default function WeatherMarketContextCard({ context }: Props) {
  if (context.isEmpty) return null;

  return (
    <section
      aria-label="Weather market context"
      className={`rounded-xl border p-4 shadow-sm sm:p-5 ${toneSurface(context.tone)}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="mr-1 text-sm font-bold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
          Market Context
        </h3>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneChipClass(context.tone)}`}
        >
          {toneLabel(context.tone)}
        </span>
      </div>

      <p className="text-sm font-medium text-text dark:text-text-dark">
        {context.headline}
      </p>

      {context.bullets.length > 0 && (
        <ul className="mt-2 ml-4 list-disc space-y-1 text-sm text-text dark:text-text-dark">
          {context.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs italic text-text-muted dark:text-text-dark-muted">
        {context.disclaimer}
      </p>
    </section>
  );
}
