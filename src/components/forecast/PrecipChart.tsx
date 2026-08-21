import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ForecastPoint, DailyForecast } from '../../lib/types';
import { formatChartLabel } from '../../lib/weather-utils';
import { useChartTheme } from './useChartTheme';
import { sharedHourly } from '../../lib/client/shared-forecast';

interface Props {
  hourly?: ForecastPoint[];
  current: ForecastPoint;
  today: DailyForecast;
  hours?: number;
  locationName?: string;
}

/** Custom X-axis tick: day on top, time below, horizontal */
function StackedTick({ x, y, payload, primary, secondary }: any) {
  const parts = (payload.value as string).split(' ');
  const day = parts[0] || '';
  const time = parts[1] || '';
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fontSize={12} fontWeight={700} fill={primary}>{day}</text>
      <text x={0} y={0} dy={26} textAnchor="middle" fontSize={11} fontWeight={600} fill={secondary}>{time}</text>
    </g>
  );
}

export default function PrecipChart({ hourly: hourlyProp, current, today, hours = 12, locationName }: Props) {
  const hourly = sharedHourly<ForecastPoint>(hourlyProp);
  const [isMobile, setIsMobile] = useState(false);
  const theme = useChartTheme();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const todayPrecip = today.precipMm;
  const inchesToday = Math.round(todayPrecip * 0.03937 * 100) / 100;

  // 48 hours in 12h buckets. Each bar SUMS the bucket's hourly precip rather
  // than sampling one instant 12 hours from the last bar — precipitation is
  // bursty (unlike temp/wind, which change gradually), so a single-hour
  // reading routinely missed the rain entirely: a shower at hour 5 left both
  // neighboring 12h-apart samples (hour 0, hour 12) at 0, even on a day that
  // accumulated well over an inch. Probability uses the bucket's peak
  // (worst-case chance), not an average, matching the "peak" convention
  // already used for precip elsewhere on the site.
  const BUCKET_HOURS = 12;
  const data = [0, 1, 2, 3, 4]
    .map(i => i * BUCKET_HOURS)
    .filter(start => start < hourly.length)
    .map(start => {
      const bucket = hourly.slice(start, start + BUCKET_HOURS);
      const precipMmSum = bucket.reduce((sum, h) => sum + h.precipMm, 0);
      const peakProbability = bucket.reduce((max, h) => Math.max(max, h.precipProbability), 0);
      return {
        time: formatChartLabel(hourly[start].time),
        precip: Math.round(precipMmSum * 0.03937 * 100) / 100,
        probability: peakProbability,
      };
    });

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
              dataKey="time"
              tick={<StackedTick primary={theme.tickPrimary} secondary={theme.tickSecondary} />}
              interval={0}
              height={45}
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
              formatter={(value: number, name: string) => [
                name === 'precip' ? `${value}"` : `${value}%`,
                name === 'precip' ? `Precip (${BUCKET_HOURS}hr total)` : 'Peak probability',
              ]}
            />
            <Bar
              dataKey="precip"
              fill="#0ea5e9"
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
