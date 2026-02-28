import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ForecastPoint } from '../../lib/types';
import { formatChartLabel, formatChartLabelParts } from '../../lib/weather-utils';

interface Props {
  hourly: ForecastPoint[];
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

export default function TemperatureChart({ hourly, hours = 12, locationName }: Props) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Data points for the summary cards: now, +12h, +24h, +36h, +48h
  const indices = [0, 12, 24, 36, 48];
  const labels = ['Now', 'in 12h', 'in 24h', 'in 36h', 'in 48h'];

  const points = indices.map((idx, i) => {
    const pt = hourly[idx];
    if (!pt) return null;
    return {
      label: labels[i],
      time: formatChartLabel(pt.time),
      temp: pt.tempF,
      feelsLike: pt.feelsLikeF,
    };
  }).filter(Boolean) as { label: string; time: string; temp: number; feelsLike: number }[];

  // Data for the line chart — 48 hours in 12h increments to match the 5 summary cards
  const chartIndices = [0, 12, 24, 36, 48];
  const chartData = chartIndices
    .filter(idx => idx < hourly.length)
    .map(idx => ({
      time: formatChartLabel(hourly[idx].time),
      temp: hourly[idx].tempF,
      feelsLike: hourly[idx].feelsLikeF,
    }));

  const title = locationName ? `Temperature Trend for ${locationName}` : 'Temperature Trend';

  // Color based on temperature
  function tempColor(temp: number): string {
    if (temp >= 95) return '#dc2626';
    if (temp >= 85) return '#f97316';
    if (temp >= 70) return '#eab308';
    if (temp >= 55) return '#22c55e';
    if (temp >= 40) return '#0ea5e9';
    if (temp >= 25) return '#3b82f6';
    return '#8b5cf6';
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm sm:p-5 dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-4 text-center text-base font-semibold text-text sm:text-lg dark:text-text-dark">{title}</h3>

      {/* Temperature trend data points */}
      <div className="mb-4 flex items-stretch justify-between gap-1 sm:gap-3">
        {points.map((pt, i) => (
          <div key={i} className="flex flex-1 flex-col items-center rounded-xl bg-surface-alt/50 p-2 sm:p-3 dark:bg-surface-dark/50">
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
              {pt.label}
            </div>
            <div className="mb-2 text-[10px] text-text-muted dark:text-text-dark-muted">
              {pt.time}
            </div>
            <div className="text-2xl font-bold sm:text-3xl" style={{ color: tempColor(pt.temp) }}>
              {pt.temp}°
            </div>
            <div className="my-1.5 h-px w-8 bg-border dark:bg-border-dark" />
            <div className="text-[10px] font-medium uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
              Feels
            </div>
            <div className="text-lg font-semibold text-storm dark:text-purple-400">
              {pt.feelsLike}°
            </div>
          </div>
        ))}
      </div>

      {/* Line chart */}
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={isMobile ? { left: -15, right: 5, top: 5, bottom: 0 } : { left: 0, right: 5, top: 5, bottom: 0 }}>
            <defs>
              <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="time"
              tick={<StackedTick />}
              interval={0}
              height={45}
              stroke="#475569"
            />
            <YAxis
              tick={{ fontSize: isMobile ? 12 : 14, fontWeight: 600, fill: '#1e293b' }}
              stroke="#475569"
              width={isMobile ? 40 : 50}
              domain={['auto', 'auto']}
              tickFormatter={v => `${v}°`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                color: '#f8fafc',
                fontSize: '13px',
              }}
              formatter={(value: number, name: string) => [`${value}°F`, name === 'temp' ? 'Temperature' : 'Feels Like']}
            />
            <Area
              type="monotone"
              dataKey="temp"
              stroke="#f97316"
              strokeWidth={2}
              fill="url(#tempGradient)"
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="feelsLike"
              stroke="#8b5cf6"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              fill="none"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="mt-2 flex justify-center gap-4 text-xs text-text-muted dark:text-text-dark-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-heat" /> Temperature
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-storm" /> Feels Like
        </span>
      </div>
    </div>
  );
}
