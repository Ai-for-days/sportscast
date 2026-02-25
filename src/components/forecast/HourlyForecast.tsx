import { useState } from 'react';
import type { ForecastPoint } from '../../lib/types';
import { formatTemp, formatTime, windDirectionLabel, parseLocalHour, formatDayLabel } from '../../lib/weather-utils';
import WeatherIcon from '../WeatherIcon';

interface Props {
  hourly: ForecastPoint[];
}

export default function HourlyForecast({ hourly }: Props) {
  const [unit, setUnit] = useState<'F' | 'C'>('F');
  const next168 = hourly.slice(0, 168);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">7-Day Hourly Forecast</h3>
        <button
          onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
          className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-muted hover:bg-surface-alt dark:border-border-dark dark:text-text-dark-muted"
        >
          °{unit}
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {next168.map((pt, i) => {
          const hour = parseLocalHour(pt.time);
          const isNewDay = i > 0 && hour === 0;
          const dayLabel = formatDayLabel(pt.time);

          return (
            <div key={i} className="flex flex-col items-center gap-1">
              {isNewDay && (
                <div className="flex w-full flex-col items-center border-l-2 border-field pl-2">
                  <div className="whitespace-nowrap text-xs font-bold text-field">
                    {dayLabel}
                  </div>
                </div>
              )}
              <div className="whitespace-nowrap text-xs text-text-muted dark:text-text-dark-muted">
                {i === 0 ? 'Now' : formatTime(pt.time)}
              </div>
              <div><WeatherIcon icon={pt.icon} size={36} /></div>
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
