import { useState, useEffect } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { DailyForecast } from '../../lib/types';
import type { ObservedDailyPrecip } from '../../lib/precip-history';
import { useChartTheme } from './useChartTheme';
import { sharedDaily } from '../../lib/client/shared-forecast';

interface Props {
  today: DailyForecast;
  /** Last 3 full calendar days' ACTUAL (NWS-observed) precipitation, oldest first. May be shorter than 3 (or empty) when observations aren't available. */
  observedPast?: ObservedDailyPrecip[];
  /** Today + upcoming days' forecast. Falls back to the page's shared daily payload when omitted (same pattern as sharedHourly elsewhere). */
  daily?: DailyForecast[];
  locationName?: string;
}

const ACTUAL_COLOR = '#64748b'; // slate — already happened, official
const FORECAST_COLOR = '#0ea5e9'; // blue — prediction, moves as new info comes in

interface DayBar {
  label: string;
  precip: number;
  probability: number | null;
  kind: 'actual' | 'forecast';
}

/** "Today" for the first forecast day, else "Fri 8/22" — a real calendar date, not an hour. */
function dayLabel(dateStr: string, isToday: boolean): string {
  if (isToday) return 'Today';
  const [y, mo, da] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, (mo || 1) - 1, da || 1));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getUTCDay()]} ${mo}/${da}`;
}

/** Bold "Today", regular weight for every other day. */
function DayTick({ x, y, payload, color }: any) {
  const isToday = payload.value === 'Today';
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={14} textAnchor="middle" fontSize={12} fontWeight={isToday ? 800 : 600} fill={color}>{payload.value}</text>
    </g>
  );
}

export default function PrecipChart({ today, observedPast, daily: dailyProp, locationName }: Props) {
  const daily = sharedDaily<DailyForecast>(dailyProp);
  const [isMobile, setIsMobile] = useState(false);
  const theme = useChartTheme();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const inchesToday = Math.round(today.precipMm * 0.03937 * 100) / 100;

  // Last 3 real days (actual, NWS-observed) to the left of today, then
  // today + the next 3 days (forecast — adjusts as new model runs come in).
  const observed = observedPast ?? [];
  const forecastDays = daily.slice(0, 4);

  const data: DayBar[] = [
    ...observed.map((o) => ({
      label: dayLabel(o.date, false),
      precip: o.precipIn,
      probability: null,
      kind: 'actual' as const,
    })),
    ...forecastDays.map((d, i) => ({
      label: dayLabel(d.date, i === 0),
      precip: Math.round(d.precipMm * 0.03937 * 100) / 100,
      probability: d.precipProbability,
      kind: 'forecast' as const,
    })),
  ];

  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm sm:p-5 dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-4 text-center text-base font-semibold text-text sm:text-lg dark:text-text-dark">Precipitation{locationName ? ` for ${locationName}` : ''}</h3>

      {/* Current precipitation summary */}
      <div className="mb-4 text-center">
        <div className="text-3xl font-semibold text-text dark:text-text-dark">{inchesToday}" <span className="text-base font-normal">Inches Today</span></div>
        <p className="mt-1 text-sm text-text-muted dark:text-text-dark-muted">
          {today.precipProbability > 0
            ? `${today.precipProbability}% chance of precipitation today.`
            : 'No precipitation expected today.'}
        </p>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={isMobile ? { left: -5, right: 5, top: 5, bottom: 0 } : { left: 0, right: 5, top: 5, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
            <XAxis
              dataKey="label"
              tick={<DayTick color={theme.tickPrimary} />}
              interval={0}
              height={28}
              stroke={theme.axis}
            />
            <YAxis
              tick={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, fill: theme.tickPrimary }}
              stroke={theme.axis}
              width={isMobile ? 40 : 50}
              tickFormatter={v => `${v}"`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: theme.tooltipBg,
                border: 'none',
                borderRadius: '8px',
                color: theme.tooltipText,
                fontSize: '13px',
              }}
              formatter={(value: number, _name: string, item: any) => {
                const kind = item?.payload?.kind;
                const probability = item?.payload?.probability;
                const label = kind === 'actual' ? 'Actual precipitation' : 'Forecast precipitation';
                const suffix = kind === 'forecast' && probability != null ? ` (${probability}% chance)` : '';
                return [`${value}"${suffix}`, label];
              }}
            />
            <Bar dataKey="precip" radius={[2, 2, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.kind === 'actual' ? ACTUAL_COLOR : FORECAST_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex items-center justify-center gap-4 text-xs text-text-muted dark:text-text-dark-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ACTUAL_COLOR }} />Actual</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: FORECAST_COLOR }} />Forecast</span>
      </div>
    </div>
  );
}
