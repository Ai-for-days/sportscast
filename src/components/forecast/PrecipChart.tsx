import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ForecastPoint } from '../../lib/types';
import { formatChartLabel } from '../../lib/weather-utils';

interface Props {
  hourly: ForecastPoint[];
  hours?: number;
}

export default function PrecipChart({ hourly, hours = 48 }: Props) {
  const data = hourly.slice(0, hours).map(pt => ({
    time: formatChartLabel(pt.time),
    precip: pt.precipMm,
    probability: pt.precipProbability,
  }));
  const labelInterval = Math.max(0, Math.ceil(data.length / 8) - 1);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-4 text-lg font-semibold text-text dark:text-text-dark">Precipitation</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
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
              tickFormatter={v => `${v}mm`}
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
                name === 'precip' ? `${value} mm` : `${value}%`,
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
