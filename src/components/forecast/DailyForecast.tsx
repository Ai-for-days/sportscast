import { useState } from 'react';
import type { DailyForecast as DailyForecastType } from '../../lib/types';
import { formatTemp, formatDate } from '../../lib/weather-utils';

interface Props {
  daily: DailyForecastType[];
}

export default function DailyForecast({ daily }: Props) {
  const [unit, setUnit] = useState<'F' | 'C'>('F');

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">
          {daily.length}-Day Forecast
        </h3>
        <button
          onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
          className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-muted hover:bg-surface-alt dark:border-border-dark dark:text-text-dark-muted"
        >
          °{unit}
        </button>
      </div>

      <div className="space-y-2">
        {daily.map((day, i) => {
          const tempRange = Math.max(...daily.map(d => d.highF)) - Math.min(...daily.map(d => d.lowF));
          const minOverall = Math.min(...daily.map(d => d.lowF));
          const lowPct = ((day.lowF - minOverall) / tempRange) * 100;
          const highPct = ((day.highF - minOverall) / tempRange) * 100;

          return (
            <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-surface-alt dark:hover:bg-surface-dark">
              <div className="w-16 shrink-0 text-sm font-medium text-text dark:text-text-dark">
                {i === 0 ? 'Today' : formatDate(day.date + 'T12:00:00')}
              </div>
              <div className="w-8 shrink-0 text-center text-lg">{day.icon}</div>
              <div className="w-10 shrink-0 text-right text-sm text-text-muted dark:text-text-dark-muted">
                {formatTemp(day.lowF, unit)}
              </div>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-alt dark:bg-surface-dark">
                <div
                  className="absolute h-full rounded-full bg-gradient-to-r from-sky to-heat"
                  style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
                />
              </div>
              <div className="w-10 shrink-0 text-sm font-semibold text-text dark:text-text-dark">
                {formatTemp(day.highF, unit)}
                {(day.feelsLikeHighF !== undefined && Math.abs(day.feelsLikeHighF - day.highF) >= 3) && (
                  <div className="text-[10px] font-normal text-text-muted dark:text-text-dark-muted">
                    FL {formatTemp(day.feelsLikeHighF, unit)}
                  </div>
                )}
              </div>
              {day.precipProbability > 0 && (
                <div className="w-10 shrink-0 text-right text-xs text-sky-dark dark:text-sky-light">
                  {day.precipProbability}%
                </div>
              )}
              {day.precipProbability === 0 && <div className="w-10 shrink-0" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
