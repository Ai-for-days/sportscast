import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ForecastPoint, DailyForecast } from '../../lib/types';
import { formatChartLabel } from '../../lib/weather-utils';

interface Props {
  hourly: ForecastPoint[];
  current: ForecastPoint;
  today: DailyForecast;
  hours?: number;
  locationName?: string;
}

/** Custom X-axis tick: day on top, time below, horizontal */
function StackedTick({ x, y, payload }: any) {
  const parts = (payload.value as string).split(' ');
  const day = parts[0] || '';
  const time = parts[1] || '';
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fontSize={12} fontWeight={700} fill="#1e293b">{day}</text>
      <text x={0} y={0} dy={26} textAnchor="middle" fontSize={11} fontWeight={600} fill="#475569">{time}</text>
    </g>
  );
}

export default function PrecipChart({ hourly, current, today, hours = 12, locationName }: Props) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const todayPrecip = today.precipMm;
  const inchesToday = Math.round(todayPrecip * 0.03937 * 100) / 100;

  // 48 hours in 12h increments
  const chartIndices = [0, 12, 24, 36, 48];
  const data = chartIndices
    .filter(idx => idx < hourly.length)
    .map(idx => ({
      time: formatChartLabel(hourly[idx].time),
      precip: Math.round(hourly[idx].precipMm * 0.03937 * 100) / 100,
      probability: hourly[idx].precipProbability,
    }));

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
          <BarChart data={data} margin={isMobile ? { left: -15, right: 5, top: 5, bottom: 0 } : { left: 0, right: 5, top: 5, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="time"
              tick={<StackedTick />}
              interval={0}
              height={45}
              stroke="#475569"
            />
            <YAxis
              tick={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, fill: '#1e293b' }}
              stroke="#475569"
              width={isMobile ? 40 : 50}
              tickFormatter={v => `${v}"`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                color: '#f8fafc',
                fontSize: '13px',
              }}
              formatter={(value: number, name: string) => [
                name === 'precip' ? `${value}"` : `${value}%`,
                name === 'precip' ? 'Precipitation' : 'Probability',
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
