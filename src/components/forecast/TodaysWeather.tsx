import type { DailyForecast } from '../../lib/types';
import { formatTemp } from '../../lib/weather-utils';

interface Props {
  today: DailyForecast;
}

export default function TodaysWeather({ today }: Props) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">Today's Weather</h3>
        <span className="text-sm text-text-muted dark:text-text-dark-muted">
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="space-y-3">
        {/* Daytime */}
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-lg">☀️</span>
          <div>
            <span className="text-sm text-text dark:text-text-dark">
              {today.dayDescription || today.description}
            </span>
            <span className="ml-1 text-sm font-semibold text-text dark:text-text-dark">
              Hi: {formatTemp(today.highF)}
            </span>
          </div>
        </div>

        {/* Tonight */}
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-lg">🌙</span>
          <div>
            <span className="text-sm text-text-muted dark:text-text-dark-muted">Tonight: </span>
            <span className="text-sm text-text dark:text-text-dark">
              {today.nightDescription || 'Clear'}
            </span>
            <span className="ml-1 text-sm font-semibold text-text dark:text-text-dark">
              Lo: {formatTemp(today.lowF)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
