import type { ForecastPoint } from '../../lib/types';
import { formatChartLabel } from '../../lib/weather-utils';

interface Props {
  hourly: ForecastPoint[];
  locationName?: string;
}

export default function TemperatureChart({ hourly, locationName }: Props) {
  // Data points: last hour (index 0), +12h, +24h, +36h, +48h
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

  const title = locationName ? `Temperature Trend for ${locationName}` : 'Temperature Trend';

  // Find min/max for visual reference
  const allTemps = points.flatMap(p => [p.temp, p.feelsLike]);
  const minTemp = Math.min(...allTemps);
  const maxTemp = Math.max(...allTemps);
  const range = maxTemp - minTemp || 1;

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

      {/* Temperature trend points */}
      <div className="flex items-stretch justify-between gap-1 sm:gap-3">
        {points.map((pt, i) => (
          <div key={i} className="flex flex-1 flex-col items-center rounded-xl bg-surface-alt/50 p-2 sm:p-3 dark:bg-surface-dark/50">
            {/* Label */}
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
              {pt.label}
            </div>

            {/* Time */}
            <div className="mb-2 text-[10px] text-text-muted dark:text-text-dark-muted">
              {pt.time}
            </div>

            {/* Temperature */}
            <div className="text-2xl font-bold sm:text-3xl" style={{ color: tempColor(pt.temp) }}>
              {pt.temp}°
            </div>

            {/* Divider */}
            <div className="my-1.5 h-px w-8 bg-border dark:bg-border-dark" />

            {/* Feels Like */}
            <div className="text-[10px] font-medium uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
              Feels
            </div>
            <div className="text-lg font-semibold text-storm dark:text-purple-400">
              {pt.feelsLike}°
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex justify-center gap-4 text-xs text-text-muted dark:text-text-dark-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full bg-heat" /> Temperature
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full bg-storm" /> Feels Like
        </span>
      </div>
    </div>
  );
}
