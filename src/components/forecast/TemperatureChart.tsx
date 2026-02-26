import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ForecastPoint } from '../../lib/types';
import { formatChartLabel } from '../../lib/weather-utils';

interface Props {
  hourly: ForecastPoint[];
  hours?: number;
  locationName?: string;
}

export default function TemperatureChart({ hourly, hours = 48, locationName }: Props) {
  const data = hourly.slice(0, hours).map(pt => ({
    time: formatChartLabel(pt.time),
    temp: pt.tempF,
    feelsLike: pt.feelsLikeF,
  }));
  const labelInterval = Math.max(0, Math.ceil(data.length / 8) - 1);

  const title = locationName ? `Temperature Trend for ${locationName}` : 'Temperature Trend';

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-4 text-center text-lg font-semibold text-text dark:text-text-dark">{title}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 12, fontWeight: 600, fill: '#64748b' }}
              interval={labelInterval}
              angle={-35}
              textAnchor="end"
              height={55}
              stroke="#94a3b8"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="#94a3b8"
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
      <div className="mt-2 flex gap-4 text-xs text-text-muted dark:text-text-dark-muted">
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
