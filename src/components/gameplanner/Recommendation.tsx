import type { SportsMetrics } from '../../lib/types';

interface Props {
  metrics: SportsMetrics;
}

const config: Record<string, { label: string; bg: string; text: string; description: string }> = {
  play: {
    label: 'PLAY',
    bg: 'bg-field',
    text: 'text-white',
    description: 'Conditions are favorable. Enjoy your game!',
  },
  monitor: {
    label: 'MONITOR',
    bg: 'bg-heat',
    text: 'text-white',
    description: 'Conditions are acceptable but could change. Keep an eye on updates.',
  },
  delay: {
    label: 'DELAY',
    bg: 'bg-heat-dark',
    text: 'text-white',
    description: 'Conditions are concerning. Consider delaying start time if possible.',
  },
  cancel: {
    label: 'CANCEL',
    bg: 'bg-alert',
    text: 'text-white',
    description: 'Conditions are unsafe for outdoor play. Postpone or move indoors.',
  },
};

export default function Recommendation({ metrics }: Props) {
  const rec = config[metrics.recommendation];

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-4 text-lg font-semibold text-text dark:text-text-dark">Recommendation</h3>

      <div className="mb-4 flex items-center gap-4">
        <span className={`rounded-xl px-6 py-3 text-2xl font-bold ${rec.bg} ${rec.text} shadow-lg`}>
          {rec.label}
        </span>
        <span className="rounded-full border border-border px-3 py-1 text-sm font-medium capitalize text-text-muted dark:border-border-dark dark:text-text-dark-muted">
          {metrics.playability}
        </span>
      </div>

      <p className="mb-4 text-sm text-text-muted dark:text-text-dark-muted">{rec.description}</p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        {metrics.heatIndex !== null && (
          <div className="rounded-lg bg-heat/5 px-3 py-2">
            <div className="text-xs text-text-muted dark:text-text-dark-muted">Heat Index</div>
            <div className="text-lg font-bold text-heat-dark">{metrics.heatIndex}°F</div>
          </div>
        )}
        {metrics.windChill !== null && (
          <div className="rounded-lg bg-sky/5 px-3 py-2">
            <div className="text-xs text-text-muted dark:text-text-dark-muted">Wind Chill</div>
            <div className="text-lg font-bold text-sky-dark">{metrics.windChill}°F</div>
          </div>
        )}
        <div className="rounded-lg bg-surface-alt px-3 py-2 dark:bg-surface-dark">
          <div className="text-xs text-text-muted dark:text-text-dark-muted">Precip Risk</div>
          <div className="text-lg font-bold capitalize text-text dark:text-text-dark">{metrics.precipRisk}</div>
        </div>
      </div>

      {metrics.sportNotes.length > 0 && (
        <div className="space-y-2 border-t border-border pt-4 dark:border-border-dark">
          <h4 className="text-sm font-semibold text-text dark:text-text-dark">Details</h4>
          {metrics.sportNotes.map((note, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-text-muted dark:text-text-dark-muted">
              <span className="mt-0.5 shrink-0">
                {metrics.recommendation === 'cancel' || metrics.recommendation === 'delay' ? '⚠️' : 'ℹ️'}
              </span>
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
