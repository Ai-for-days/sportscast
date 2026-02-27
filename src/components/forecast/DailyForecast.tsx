import { useState } from 'react';
import type { DailyForecast as DailyForecastType } from '../../lib/types';
import { formatTemp, formatDate } from '../../lib/weather-utils';
import WeatherIcon from '../WeatherIcon';

interface Props {
  daily: DailyForecastType[];
  locationName?: string;
}

export default function DailyForecast({ daily, locationName }: Props) {
  const [unit, setUnit] = useState<'F' | 'C'>('F');

  const tempRange = Math.max(...daily.map(d => d.highF)) - Math.min(...daily.map(d => d.lowF));
  const minOverall = Math.min(...daily.map(d => d.lowF));

  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm sm:p-5 dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-text sm:text-lg dark:text-text-dark">
          {daily.length}-Day Forecast{locationName ? ` for ${locationName}` : ''}
        </h3>
        <button
          onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
          className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-muted hover:bg-surface-alt dark:border-border-dark dark:text-text-dark-muted"
        >
          °{unit === 'F' ? 'C' : 'F'}
        </button>
      </div>

      {/* Column headers — mobile */}
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted sm:hidden dark:text-text-dark-muted">
        <div className="w-9 shrink-0 text-center"></div>
        <div className="w-9 shrink-0 text-right">Low</div>
        <div className="flex-1 text-center"></div>
        <div className="w-9 shrink-0 text-left">High</div>
        <div className="w-10 shrink-0 text-right">Precip</div>
      </div>

      <div className="space-y-1 sm:space-y-2">
        {daily.map((day, i) => {
          const lowPct = tempRange > 0 ? ((day.lowF - minOverall) / tempRange) * 100 : 0;
          const highPct = tempRange > 0 ? ((day.highF - minOverall) / tempRange) * 100 : 100;
          const dayLabel = i === 0 ? 'Today' : formatDate(day.date + 'T12:00:00');

          return (
            <div key={i} className="rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-alt sm:px-3 sm:py-2 dark:hover:bg-surface-dark">
              {/* Mobile: day label on its own row */}
              <div className="mb-1 text-sm font-semibold text-text sm:hidden dark:text-text-dark">
                {dayLabel}
                {day.dayDescription && (
                  <span className="ml-2 text-xs font-normal text-text-muted dark:text-text-dark-muted">{day.dayDescription}</span>
                )}
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                {/* Desktop: day label inline + forecast */}
                <div className="hidden shrink-0 sm:flex sm:w-44 sm:items-baseline sm:gap-2">
                  <span className="text-sm font-semibold text-text dark:text-text-dark">{dayLabel}</span>
                  {day.dayDescription && (
                    <span className="truncate text-xs text-text-muted dark:text-text-dark-muted">{day.dayDescription}</span>
                  )}
                </div>
                <div className="w-11 shrink-0 text-center sm:w-14"><WeatherIcon icon={day.icon} size={44} /></div>
                <div className="w-9 shrink-0 text-right text-xs text-text-muted sm:w-10 sm:text-sm dark:text-text-dark-muted">
                  {formatTemp(day.lowF, unit)}
                </div>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-alt dark:bg-surface-dark">
                  <div
                    className="absolute h-full rounded-full"
                    style={{ background: 'linear-gradient(to right, #4d93dd, #4bdce3, #a1edde, #eff2b1, #ffd512, #f53b3b)', left: `${lowPct}%`, width: `${Math.max(highPct - lowPct, 2)}%` }}
                  />
                </div>
                <div className="w-9 shrink-0 text-xs font-semibold text-text sm:w-10 sm:text-sm dark:text-text-dark">
                  {formatTemp(day.highF, unit)}
                </div>
                {day.precipProbability > 0 ? (
                  <div className="w-10 shrink-0 text-right text-xs text-sky-dark dark:text-sky-light">
                    {day.precipProbability}%
                  </div>
                ) : (
                  <div className="w-10 shrink-0 text-right text-xs text-text-muted/40 dark:text-text-dark-muted/40">—</div>
                )}
              </div>
              {day.nightDescription && (
                <div className="mt-0.5 text-xs text-text-muted sm:ml-44 dark:text-text-dark-muted">
                  <span className="hidden opacity-70 sm:inline">Night: {day.nightDescription}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
