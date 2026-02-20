import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ForecastPoint } from '../../lib/types';
import { formatChartLabel } from '../../lib/weather-utils';

interface Props {
  hourly: ForecastPoint[];
  hours?: number;
}

export default function WindChart({ hourly, hours = 48 }: Props) {
  const data = hourly.slice(0, hours).map(pt => ({
    time: formatChartLabel(pt.time),
    speed: pt.windSpeedMph,
    gust: pt.windGustMph,
  }));
  const labelInterval = Math.max(0, Math.ceil(data.length / 8) - 1);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-4 text-lg font-semibold text-text dark:text-text-dark">Wind Speed</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 12 }}
              interval={labelInterval}
              angle={0}
              textAnchor="middle"
              height={35}
              stroke="#94a3b8"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="#94a3b8"
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
