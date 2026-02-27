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

  const data = hourly.slice(0, hours).map(pt => ({
    time: formatChartLabel(pt.time),
    precip: Math.round(pt.precipMm * 0.03937 * 100) / 100, // mm → inches
    probability: pt.precipProbability,
  }));
  const labelInterval = Math.max(0, Math.ceil(data.length / (isMobile ? 5 : 8)) - 1);

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
              tick={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, fill: '#1e293b' }}
              interval={labelInterval}
              angle={isMobile ? -45 : -45}
              textAnchor="end"
              height={isMobile ? 50 : 55}
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
