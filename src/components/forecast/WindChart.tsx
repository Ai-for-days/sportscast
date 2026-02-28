import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ForecastPoint } from '../../lib/types';
import { formatChartLabel, windDirectionLabel } from '../../lib/weather-utils';

interface Props {
  hourly: ForecastPoint[];
  current: ForecastPoint;
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

export default function WindChart({ hourly, current, hours = 12, locationName }: Props) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const data = hourly.slice(0, hours).map(pt => ({
    time: formatChartLabel(pt.time),
    speed: pt.windSpeedMph,
    gust: pt.windGustMph,
  }));
  const labelInterval = Math.max(0, Math.ceil(data.length / (isMobile ? 5 : 8)) - 1);

  const dir = current.windDirectionDeg;
  const dirLabel = windDirectionLabel(dir);

  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm sm:p-5 dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-4 text-center text-base font-semibold text-text sm:text-lg dark:text-text-dark">Wind{locationName ? ` for ${locationName}` : ''}</h3>

      {/* Current Wind & Gusts — two compasses side by side */}
      <div className="mb-5 flex flex-wrap items-start justify-center gap-8">
        {/* Wind compass */}
        <div className="text-center">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">Current Wind</div>
          <div className="relative mx-auto h-24 w-24">
            <svg viewBox="0 0 100 100" className="h-full w-full">
              <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="1" className="text-border dark:text-border-dark" />
              <text x="50" y="12" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9" fontWeight="bold">N</text>
              <text x="92" y="54" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">E</text>
              <text x="50" y="96" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">S</text>
              <text x="8" y="54" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">W</text>
              <g transform={`rotate(${dir + 180}, 50, 50)`}>
                <line x1="50" y1="20" x2="50" y2="55" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
                <polygon points="50,16 44,28 56,28" fill="#3b82f6" />
              </g>
              <circle cx="50" cy="50" r="3" fill="#3b82f6" />
            </svg>
          </div>
          <div className="mt-1 text-2xl font-semibold text-text dark:text-text-dark">{current.windSpeedMph} <span className="text-xs font-normal">mph</span></div>
          <div className="text-xs text-text-muted dark:text-text-dark-muted">{dir}° {dirLabel}</div>
        </div>

        {/* Gusts compass */}
        <div className="text-center">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">Current Gusts</div>
          <div className="relative mx-auto h-24 w-24">
            <svg viewBox="0 0 100 100" className="h-full w-full">
              <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="1" className="text-border dark:text-border-dark" />
              <text x="50" y="12" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9" fontWeight="bold">N</text>
              <text x="92" y="54" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">E</text>
              <text x="50" y="96" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">S</text>
              <text x="8" y="54" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">W</text>
              <g transform={`rotate(${dir + 180}, 50, 50)`}>
                <line x1="50" y1="20" x2="50" y2="55" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
                <polygon points="50,16 44,28 56,28" fill="#ef4444" />
              </g>
              <circle cx="50" cy="50" r="3" fill="#ef4444" />
            </svg>
          </div>
          <div className="mt-1 text-2xl font-semibold text-text dark:text-text-dark">{current.windGustMph} <span className="text-xs font-normal">mph</span></div>
          <div className="text-xs text-text-muted dark:text-text-dark-muted">{dir}° {dirLabel}</div>
        </div>
      </div>

      {/* Wind Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={isMobile ? { left: -15, right: 5, top: 5, bottom: 0 } : { left: 0, right: 5, top: 5, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="time"
              tick={<StackedTick />}
              interval={labelInterval}
              height={45}
              stroke="#475569"
            />
            <YAxis
              tick={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, fill: '#1e293b' }}
              stroke="#475569"
              width={isMobile ? 45 : 55}
              tickFormatter={v => `${v} mph`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                color: '#f8fafc',
                fontSize: '13px',
              }}
              formatter={(value: number, name: string) => [`${value} mph`, name === 'speed' ? 'Wind Speed' : 'Gusts']}
            />
            <Line
              type="monotone"
              dataKey="speed"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="gust"
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-text-muted dark:text-text-dark-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-field" /> Wind Speed
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-alert" /> Gusts
        </span>
      </div>
    </div>
  );
}
