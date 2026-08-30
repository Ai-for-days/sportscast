import { useState } from 'react';
import type { DailyForecast as DailyForecastType } from '../../lib/types';
import type { WesResult } from '../../lib/wes';
import { getWesBand, wesChipVars } from '../../lib/wes-scale';
import { formatTemp } from '../../lib/weather-utils';
import type { CSSProperties } from 'react';
import WeatherIcon from '../WeatherIcon';
import { sharedDaily } from '../../lib/client/shared-forecast';

interface Props {
  daily?: DailyForecastType[];
  locationName?: string;
  /** Predicted WES per day, same index as `daily`. null where the forecast doesn't reach that far out yet. */
  wes?: (WesResult | null)[];
}

const MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Friday" / "Aug. 22" — two lines, per Derek (was "08-22-2026"). */
function formatDayDate(dateStr: string): { weekday: string; monthDay: string } {
  const [y, mo, da] = dateStr.slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(y, (mo || 1) - 1, da || 1));
  return { weekday: WEEKDAY_NAMES[d.getUTCDay()], monthDay: `${MONTH_ABBR[(mo || 1) - 1]} ${da}` };
}

export default function DailyForecast({ daily: dailyProp, locationName, wes }: Props) {
  const daily = sharedDaily<DailyForecastType>(dailyProp);
  const [unit, setUnit] = useState<'F' | 'C'>('F');

  const tempRange = Math.max(...daily.map(d => d.highF)) - Math.min(...daily.map(d => d.lowF));
  const minOverall = Math.min(...daily.map(d => d.lowF));

  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm sm:p-5 dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-text sm:text-lg dark:text-text-dark">
            {daily.length}-Day Forecast{locationName ? ` for ${locationName}` : ''}
          </h3>
        </div>
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
      {/* Column headers — desktop */}
      <div className="mb-2 hidden items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted sm:flex dark:text-text-dark-muted">
        <div className="w-56 shrink-0"></div>
        <div className="w-14 shrink-0 text-center"></div>
        <div className="w-10 shrink-0 text-right">Low</div>
        <div className="flex-1 text-center"></div>
        <div className="w-10 shrink-0 text-left">High</div>
        <div className="w-10 shrink-0 text-right">Precip</div>
      </div>

      <div className="space-y-1 sm:space-y-2">
        {daily.map((day, i) => {
          const lowPct = tempRange > 0 ? ((day.lowF - minOverall) / tempRange) * 100 : 0;
          const highPct = tempRange > 0 ? ((day.highF - minOverall) / tempRange) * 100 : 100;
          const { weekday, monthDay } = formatDayDate(day.date);
          const weekdayLabel = i === 0 ? 'Today' : weekday;
          const dayWes = wes?.[i];
          // Per Derek (2026-08-25): every day gets the same full score-band
          // color/adjective/link treatment as Today — dailyWes ([...slug].astro)
          // already computes a real WES for all 15 days, this used to only
          // apply the band (and show the label + "What's WES?" link) on day 0.
          const dayBand = dayWes ? getWesBand(dayWes.wesFinal) : null;
          const bandVars = dayBand ? (wesChipVars(dayBand) as CSSProperties) : undefined;

          return (
            <div key={i} className="rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-alt sm:px-3 sm:py-2 dark:hover:bg-surface-dark">
              {/* Mobile: day label on its own rows */}
              <div className="mb-1 sm:hidden">
                <div className="text-sm font-semibold text-text dark:text-text-dark">{weekdayLabel}</div>
                <div className="text-xs font-normal text-text-muted dark:text-text-dark-muted">
                  {monthDay}
                  {day.dayDescription && <span className="ml-2">{day.dayDescription}</span>}
                </div>
                {dayWes && dayBand && (
                  <div
                    className="wes-chip mt-0.5 inline-flex w-fit items-baseline gap-1 rounded-full border px-2 py-0.5"
                    style={bandVars}
                    title={`Environmental ${Math.round(dayWes.environmental)}, Fan Feel ${Math.round(dayWes.fanFeel)}, Player Feel ${Math.round(dayWes.playerFeel)} (v${dayWes.wesVersion})`}
                  >
                    <span className="text-[9px] font-semibold uppercase tracking-wide">WES</span>
                    <span className="text-xs font-bold">{Math.round(dayWes.wesFinal)}</span>
                    <span className="text-[9px] font-semibold">{dayBand.label}</span>
                  </div>
                )}
                {dayWes && (
                  <a href="/what-is-wes" className="mt-0.5 block text-[10px] font-medium text-text-muted underline decoration-dotted dark:text-text-dark-muted">What's WES?</a>
                )}
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                {/* Desktop: day label + forecast, stacked so WES sits under the date */}
                <div className="hidden shrink-0 sm:flex sm:w-56 sm:flex-col">
                  <span className="shrink-0 text-sm font-semibold text-text dark:text-text-dark">{weekdayLabel}</span>
                  <span className="text-xs text-text-muted dark:text-text-dark-muted">
                    {monthDay}
                    {day.dayDescription && <span className="ml-2">{day.dayDescription}</span>}
                  </span>
                  {dayWes && dayBand && (
                    <div
                      className="wes-chip mt-0.5 inline-flex w-fit items-baseline gap-1 rounded-full border px-2 py-0.5"
                      style={bandVars}
                      title={`Environmental ${Math.round(dayWes.environmental)}, Fan Feel ${Math.round(dayWes.fanFeel)}, Player Feel ${Math.round(dayWes.playerFeel)} (v${dayWes.wesVersion})`}
                    >
                      <span className="text-[9px] font-semibold uppercase tracking-wide">WES</span>
                      <span className="text-xs font-bold">{Math.round(dayWes.wesFinal)}</span>
                      <span className="text-[9px] font-semibold">{dayBand.label}</span>
                    </div>
                  )}
                  {dayWes && (
                    <a href="/what-is-wes" className="mt-0.5 text-[10px] font-medium text-text-muted underline decoration-dotted dark:text-text-dark-muted">What's WES?</a>
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
                  <div className="w-10 shrink-0 text-right text-xs text-text-muted dark:text-text-dark-muted">—</div>
                )}
              </div>
              {day.nightDescription && (
                <div className="mt-0.5 text-xs text-text-muted sm:ml-56 dark:text-text-dark-muted">
                  <span className="hidden sm:inline">Night: {day.nightDescription}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
