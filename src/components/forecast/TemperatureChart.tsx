import { useState, useEffect, useId } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ForecastPoint } from '../../lib/types';
import { formatChartLabel, formatChartLabelParts } from '../../lib/weather-utils';
import { useChartTheme } from './useChartTheme';
import { sharedHourly, sharedCurrent } from '../../lib/client/shared-forecast';

interface Props {
  hourly?: ForecastPoint[];
  current?: ForecastPoint | null;
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

export default function TemperatureChart({ hourly: hourlyProp, current: currentProp, hours = 12, locationName }: Props) {
  const hourly = sharedHourly<ForecastPoint>(hourlyProp);
  const current = sharedCurrent<ForecastPoint>(currentProp);
  const [isMobile, setIsMobile] = useState(false);
  const theme = useChartTheme();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Data points for the summary cards: now, +6h, +12h, +18h, +24h, +30h, +36h, +42h, +48h
  const indices = [0, 6, 12, 18, 24, 30, 36, 42, 48];
  const labels = ['Now', '+6h', '+12h', '+18h', '+24h', '+30h', '+36h', '+42h', '+48h'];

  const points = indices.map((idx, i) => {
    // "Now" must be the live observation, not hourly[0] — that is the current
    // hour's model value and reads a couple of degrees off from the hero card.
    const pt = idx === 0 && current ? { ...hourly[0], ...current } : hourly[idx];
    if (!pt) return null;
    return {
      label: labels[i],
      time: formatChartLabel(pt.time),
      temp: pt.tempF,
      feelsLike: pt.feelsLikeF,
    };
  }).filter(Boolean) as { label: string; time: string; temp: number; feelsLike: number }[];

  // Data for the line chart — 48 hours in 6h increments to match the summary cards
  const chartIndices = [0, 6, 12, 18, 24, 30, 36, 42, 48];
  const chartData = chartIndices
    .filter(idx => idx < hourly.length)
    .map(idx => {
      const pt = idx === 0 && current ? { ...hourly[0], ...current } : hourly[idx];
      return {
        time: formatChartLabel(hourly[idx].time),
        temp: pt.tempF,
        feelsLike: pt.feelsLikeF,
      };
    });

  const title = locationName ? `Temperature Trend for ${locationName}` : 'Temperature Trend';
  const isDark = theme.mode === 'dark';
  const gradientId = `tempLineGradient-${useId().replace(/[:]/g, '')}`;

  /**
   * Heat-spectrum colour for a temperature: cold blues → warm oranges → hot
   * reds.
   *
   * Returns Tailwind classes, not a hex, because this needs a DIFFERENT colour
   * per theme. The original returned one bright hex tuned for the dark navy
   * card — then light mode shipped and those same values landed on white:
   * the 70s band (#fde68a, pale amber) became invisible, which is exactly what
   * Derek reported. A single value cannot serve both backgrounds.
   *
   * Light values are the 600/700 shades (>= 3.9:1 on white — these render at
   * text-xl/2xl bold, which is WCAG "large text", so AA wants 3:1). Dark values
   * are the original hexes exactly, so dark mode is unchanged.
   */
  function tempColorClass(temp: number): string {
    if (temp <= 32) return 'text-blue-600 dark:text-blue-300';      // dark: #93c5fd
    if (temp <= 50) return 'text-indigo-600 dark:text-indigo-300';  // dark: #a5b4fc
    if (temp <= 65) return 'text-slate-600 dark:text-slate-50';     // dark: #f8fafc
    if (temp <= 78) return 'text-amber-600 dark:text-amber-200';    // dark: #fde68a
    if (temp <= 90) return 'text-orange-600 dark:text-orange-400';  // dark: #fb923c
    if (temp <= 100) return 'text-red-600 dark:text-red-300';       // dark: #fca5a5
    return 'text-red-700 dark:text-red-400';                        // dark: #f87171
  }

  /**
   * Same heat-spectrum bands as `tempColorClass`, as hex — the chart line
   * below is an SVG stroke, which can't consume a Tailwind class. Per Derek:
   * the line should "change colors to match the degrees above it," so these
   * are the exact hex values `tempColorClass` uses for each band/theme.
   */
  function tempColorHex(temp: number, dark: boolean): string {
    if (temp <= 32) return dark ? '#93c5fd' : '#2563eb';
    if (temp <= 50) return dark ? '#a5b4fc' : '#4f46e5';
    if (temp <= 65) return dark ? '#f8fafc' : '#475569';
    if (temp <= 78) return dark ? '#fde68a' : '#d97706';
    if (temp <= 90) return dark ? '#fb923c' : '#ea580c';
    if (temp <= 100) return dark ? '#fca5a5' : '#dc2626';
    return dark ? '#f87171' : '#b91c1c';
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm sm:p-5 dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-4 text-center text-base font-semibold text-text sm:text-lg dark:text-text-dark">{title}</h3>

      {/* Temperature trend data points */}
      <div className="mb-4 flex items-stretch gap-1 overflow-x-auto pb-1 sm:gap-2">
        {points.map((pt, i) => (
          <div key={i} className="flex min-w-[4.5rem] flex-1 flex-col items-center rounded-xl border border-border bg-surface-alt p-1.5 sm:min-w-0 sm:p-2 dark:border-border-dark dark:bg-surface-dark">
            <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
              {pt.label}
            </div>
            <div className="mb-1 text-[9px] text-text-muted dark:text-text-dark-muted">
              {pt.time}
            </div>
            <div className={`text-xl font-bold sm:text-2xl ${tempColorClass(pt.temp)}`}>
              {pt.temp}°
            </div>
            <div className="my-1 h-px w-6 bg-border dark:bg-border-dark" />
            <div className="text-[9px] font-medium uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
              Feels
            </div>
            <div className="text-base font-semibold text-storm dark:text-purple-400">
              {pt.feelsLike}°
            </div>
          </div>
        ))}
      </div>

      {/* Line chart */}
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={isMobile ? { left: -5, right: 5, top: 5, bottom: 0 } : { left: 0, right: 5, top: 5, bottom: 0 }}>
            <defs>
              <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
              {/* Horizontal gradient along the line itself, one stop per data
                  point, colored the same as that point's degree readout above
                  (tempColorHex === tempColorClass, just as hex). */}
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                {chartData.map((d, i) => (
                  <stop
                    key={i}
                    offset={`${chartData.length > 1 ? (i / (chartData.length - 1)) * 100 : 0}%`}
                    stopColor={tempColorHex(d.temp, isDark)}
                  />
                ))}
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
            <XAxis
              dataKey="time"
              tick={<StackedTick primary={theme.tickPrimary} secondary={theme.tickSecondary} />}
              interval={isMobile ? 1 : 0}
              height={45}
              stroke={theme.axis}
            />
            <YAxis
              tick={{ fontSize: isMobile ? 12 : 14, fontWeight: 600, fill: theme.tickPrimary }}
              stroke={theme.axis}
              width={isMobile ? 40 : 50}
              domain={['auto', 'auto']}
              tickFormatter={v => `${v}°`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: theme.tooltipBg,
                border: 'none',
                borderRadius: '8px',
                color: theme.tooltipText,
                fontSize: '13px',
              }}
              formatter={(value: number, name: string) => [`${value}°F`, name === 'temp' ? 'Temperature' : 'Feels Like']}
            />
            <Area
              type="monotone"
              dataKey="temp"
              stroke={`url(#${gradientId})`}
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
