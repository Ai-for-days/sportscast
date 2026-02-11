import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ForecastPoint } from '../../lib/types';

interface Props {
  hourly: ForecastPoint[];
}

export default function TrendsChart({ hourly }: Props) {
  const data = hourly.map(pt => ({
    hour: `${new Date(pt.time).getHours()}:00`,
    temp: pt.tempF,
    humidity: pt.humidity,
    wind: pt.windSpeedMph,
    precip: pt.precipMm,
  }));

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
        <h4 className="mb-3 text-sm font-semibold text-text dark:text-text-dark">Temperature & Humidity</h4>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={3} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc', fontSize: '12px' }}
              />
              <Line type="monotone" dataKey="temp" stroke="#f97316" strokeWidth={2} dot={false} name="Temp (°F)" />
              <Line type="monotone" dataKey="humidity" stroke="#0ea5e9" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Humidity (%)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
        <h4 className="mb-3 text-sm font-semibold text-text dark:text-text-dark">Wind & Precipitation</h4>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={3} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc', fontSize: '12px' }}
              />
              <Bar dataKey="precip" fill="#0ea5e9" radius={[2, 2, 0, 0]} name="Precip (mm)" />
              <Bar dataKey="wind" fill="#22c55e" radius={[2, 2, 0, 0]} name="Wind (mph)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
