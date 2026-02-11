import { useState } from 'react';
import type { ForecastPoint, SportType } from '../../lib/types';
import { assessPlayability, formatTemp } from '../../lib/weather-utils';

interface Props {
  forecast: ForecastPoint;
  defaultSport?: SportType;
}

const sportLabels: Record<SportType, string> = {
  baseball: 'Baseball',
  football: 'Football',
  soccer: 'Soccer',
  tennis: 'Tennis',
  golf: 'Golf',
  youth: 'Youth Sports',
};

const playabilityColors: Record<string, string> = {
  excellent: 'bg-field/10 text-field-dark border-field/30',
  good: 'bg-field/10 text-field-dark border-field/20',
  fair: 'bg-heat/10 text-heat-dark border-heat/30',
  poor: 'bg-heat/10 text-heat-dark border-heat/20',
  dangerous: 'bg-alert/10 text-alert-dark border-alert/30',
};

const recommendationConfig: Record<string, { label: string; color: string }> = {
  play: { label: 'PLAY', color: 'bg-field text-white' },
  monitor: { label: 'MONITOR', color: 'bg-heat text-white' },
  delay: { label: 'DELAY', color: 'bg-heat-dark text-white' },
  cancel: { label: 'CANCEL', color: 'bg-alert text-white' },
};

export default function SportsMetrics({ forecast, defaultSport = 'youth' }: Props) {
  const [sport, setSport] = useState<SportType>(defaultSport);
  const metrics = assessPlayability(forecast, sport);
  const rec = recommendationConfig[metrics.recommendation];

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">Sports Playability</h3>
        <select
          value={sport}
          onChange={e => setSport(e.target.value as SportType)}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
        >
          {Object.entries(sportLabels).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex items-center gap-4">
        <span className={`rounded-full px-4 py-2 text-lg font-bold ${rec.color}`}>
          {rec.label}
        </span>
        <span className={`rounded-full border px-3 py-1 text-sm font-medium capitalize ${playabilityColors[metrics.playability]}`}>
          {metrics.playability}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.heatIndex !== null && (
          <div className="rounded-lg bg-heat/5 px-3 py-2">
            <div className="text-xs font-medium text-heat-dark">Heat Index</div>
            <div className="text-lg font-bold text-heat-dark">{formatTemp(metrics.heatIndex)}</div>
          </div>
        )}
        {metrics.windChill !== null && (
          <div className="rounded-lg bg-sky/5 px-3 py-2">
            <div className="text-xs font-medium text-sky-dark">Wind Chill</div>
            <div className="text-lg font-bold text-sky-dark">{formatTemp(metrics.windChill)}</div>
          </div>
        )}
        <div className={`rounded-lg px-3 py-2 ${
          metrics.precipRisk === 'high' ? 'bg-alert/5' :
          metrics.precipRisk === 'moderate' ? 'bg-heat/5' : 'bg-field/5'
        }`}>
          <div className="text-xs font-medium text-text-muted dark:text-text-dark-muted">Precip Risk</div>
          <div className="text-lg font-bold capitalize text-text dark:text-text-dark">{metrics.precipRisk}</div>
        </div>
      </div>

      {metrics.sportNotes.length > 0 && (
        <div className="space-y-1">
          {metrics.sportNotes.map((note, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-text-muted dark:text-text-dark-muted">
              <span className="mt-1 shrink-0">
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
