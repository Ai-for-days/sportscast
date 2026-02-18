import { useState } from 'react';
import type { ForecastPoint } from '../../lib/types';
import { formatTemp, formatTime, windDirectionLabel, parseLocalHour } from '../../lib/weather-utils';

interface Props {
  hourly: ForecastPoint[];
}

export default function HourlyForecast({ hourly }: Props) {
  const [unit, setUnit] = useState<'F' | 'C'>('F');
  const next48 = hourly.slice(0, 48);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">Hourly Forecast</h3>
        <button
          onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
          className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-muted hover:bg-surface-alt dark:border-border-dark dark:text-text-dark-muted"
        >
          °{unit}
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {next48.map((pt, i) => {
          const hour = parseLocalHour(pt.time);
          const isNewDay = i > 0 && hour === 0;

          return (
            <div key={i} className="flex flex-col items-center gap-1">
              {isNewDay && (
                <div className="mb-1 w-full border-t border-border dark:border-border-dark" />
              )}
              <div className="whitespace-nowrap text-xs text-text-muted dark:text-text-dark-muted">
                {i === 0 ? 'Now' : formatTime(pt.time)}
              </div>
              <div className="text-xl">{pt.icon}</div>
              <div className="text-sm font-semibold text-text dark:text-text-dark">
                {formatTemp(pt.tempF, unit)}
              </div>
              {pt.precipProbability > 0 && (
                <div className="text-xs text-sky-dark dark:text-sky-light">
                  {pt.precipProbability}%
                </div>
              )}
              <div className="text-xs text-text-muted dark:text-text-dark-muted">
                {pt.windSpeedMph} mph
              </div>
              <div className="text-xs text-text-muted dark:text-text-dark-muted">
                {windDirectionLabel(pt.windDirectionDeg)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
