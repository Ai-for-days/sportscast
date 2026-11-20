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
function StackedTick({ x, y, payload, primary, secondary, labelAt }: any) {
  const parts = String(labelAt ? labelAt(payload.value) : payload.value).split(' ');
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
    .map((idx, i) => {
      const pt = idx === 0 && current ? { ...hourly[0], ...current } : hourly[idx];
      return {
        i,
        time: formatChartLabel(hourly[idx].time),
        temp: pt.tempF,
        feelsLike: pt.feelsLikeF,
      };
    });

  const title = locationName ? `48-Hour Temperature Trend for ${locationName}` : '48-Hour Temperature Trend';
  const isDark = theme.mode === 'dark';
  const gradientId = `tempLineGradient-${useId().replace(/[:]/g, '')}`;

  // DBD 2026-11-20: on mobile the cards did not line up with the graph. The cards
  // scrolled on their own while the graph squeezed to the screen and skipped every
  // other label. Now the cards and the graph share one set of equal columns: the
  // card row is indented by the Y-axis width, and the X axis is numeric with the
  // domain [-0.5, n-0.5], so point i sits at the centre of column i at any width.
  // On a phone the whole block scrolls sideways as one piece.
  const Y_AXIS_W = isMobile ? 40 : 50;
  const MOBILE_COL_W = 64;
  const n = Math.min(points.length, chartData.length);
  const labelAt = (i: number) => chartData[Math.round(i)]?.time ?? '';

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

      {/* Cards and graph share one column grid (see Y_AXIS_W above). On a phone
          the pair scrolls sideways together, so a card never drifts off its point. */}
      <div className={isMobile ? 'overflow-x-auto pb-1' : ''} data-testid="temp-trend-scroll">
      <div style={isMobile ? { width: Y_AXIS_W + n * MOBILE_COL_W } : undefined}>
      <div
        className="mb-4 grid items-stretch"
        style={{ paddingLeft: Y_AXIS_W, gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {points.slice(0, n).map((pt, i) => (
          <div key={i} className="px-0.5 sm:px-1">
          <div className="flex h-full flex-col items-center rounded-xl border border-border bg-surface-alt px-0.5 py-1.5 sm:p-2 dark:border-border-dark dark:bg-surface-dark">
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
          </div>
        ))}
      </div>

      {/* Line chart */}
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData.slice(0, n)} margin={{ left: 0, right: 0, top: 5, bottom: 0 }}>
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
              dataKey="i"
              type="number"
              domain={[-0.5, n - 0.5]}
              ticks={Array.from({ length: n }, (_, i) => i)}
              tickFormatter={labelAt}
              tick={<StackedTick primary={theme.tickPrimary} secondary={theme.tickSecondary} labelAt={labelAt} />}
              interval={0}
              height={45}
              stroke={theme.axis}
            />
            <YAxis
              tick={{ fontSize: isMobile ? 12 : 14, fontWeight: 600, fill: theme.tickPrimary }}
              stroke={theme.axis}
              width={Y_AXIS_W}
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
              labelFormatter={(v: any) => labelAt(Number(v))}
              formatter={(value: number, name: string) => [`${value}°F`, name === 'temp' ? 'Temperature' : 'Feels Like']}
            />
            <Area
              type="monotone"
              dataKey="temp"
              stroke={`url(#${gradientId})`}
              strokeWidth={2}
              fill="url(#tempGradient)"
              dot={{ r: 3, strokeWidth: 0, fill: theme.tickPrimary }}
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
      </div>
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
