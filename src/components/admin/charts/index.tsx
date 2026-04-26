// ── Step 73: Chart primitives for quant validation pages ────────────────────
//
// Lightweight SVG-based chart components. No external chart libs.
// Designed to match the dark-themed admin inline-styles aesthetic.
// Every chart degrades gracefully on missing / insufficient data.

import React from 'react';

const colors = {
  positive: '#22c55e',
  negative: '#ef4444',
  neutral: '#64748b',
  axis: '#475569',
  grid: '#1e293b',
  text: '#94a3b8',
  textBright: '#e2e8f0',
  band: ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e'] as const,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// EmptyChart — render when sample is too small to be meaningful
// ────────────────────────────────────────────────────────────────────────────

export function EmptyChart({ title, message }: { title: string; message: string }) {
  return (
    <div style={{
      background: '#0f172a', border: '1px dashed #334155', borderRadius: 8,
      padding: 24, textAlign: 'center', color: colors.text, minHeight: 160,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: colors.textBright }}>{title}</div>
      <div style={{ fontSize: 12 }}>{message}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BarChart — vertical bars with optional sign-based coloring + value labels
// ────────────────────────────────────────────────────────────────────────────

export interface BarDatum { label: string; value: number; color?: string; sublabel?: string; }
export function BarChart({ data, height = 220, valueFormatter, signColored }: {
  data: BarDatum[];
  height?: number;
  valueFormatter?: (v: number) => string;
  signColored?: boolean;
}) {
  if (data.length === 0) return <EmptyChart title="No data" message="No values to plot." />;
  const padding = { top: 24, right: 12, bottom: 60, left: 12 };
  const w = Math.max(360, data.length * 80);
  const innerH = height - padding.top - padding.bottom;
  const innerW = w - padding.left - padding.right;
  const maxAbs = Math.max(0.01, ...data.map(d => Math.abs(d.value)));
  const hasNegatives = data.some(d => d.value < 0);
  const zeroY = padding.top + (hasNegatives ? innerH / 2 : innerH);
  const halfH = hasNegatives ? innerH / 2 : innerH;
  const barW = Math.max(20, innerW / data.length - 18);
  const fmt = valueFormatter ?? ((v: number) => `${v}`);

  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height, display: 'block' }}>
      <line x1={padding.left} y1={zeroY} x2={w - padding.right} y2={zeroY} stroke={colors.axis} strokeWidth={1} />
      {data.map((d, i) => {
        const x = padding.left + (innerW / data.length) * i + (innerW / data.length - barW) / 2;
        const h = (Math.abs(d.value) / maxAbs) * halfH;
        const y = d.value >= 0 ? zeroY - h : zeroY;
        const fill = d.color ?? (signColored ? (d.value >= 0 ? colors.positive : colors.negative) : '#3b82f6');
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(1, h)} fill={fill} rx={2} />
            <text x={x + barW / 2} y={d.value >= 0 ? y - 6 : y + h + 14} textAnchor="middle" fontSize={11} fill={colors.textBright}>
              {fmt(d.value)}
            </text>
            <text x={x + barW / 2} y={height - 32} textAnchor="middle" fontSize={11} fill={colors.text}>{d.label}</text>
            {d.sublabel && <text x={x + barW / 2} y={height - 16} textAnchor="middle" fontSize={10} fill={colors.text}>{d.sublabel}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GaugeIndicator — semicircle gauge with 4 colored bands
// ────────────────────────────────────────────────────────────────────────────

export function GaugeIndicator({ value, label, sublabel, height = 180 }: {
  value: number | null; // 0..1
  label: string;
  sublabel?: string;
  height?: number;
}) {
  if (value == null) return <EmptyChart title={label} message="No reliability data yet." />;
  const v = Math.max(0, Math.min(1, value));
  const w = height * 1.6;
  const cx = w / 2;
  const cy = height - 20;
  const r = height - 40;
  // 4 bands: 0-0.25 red, 0.25-0.5 amber, 0.5-0.75 blue, 0.75-1.0 green
  const bandStops = [0, 0.25, 0.5, 0.75, 1];
  const arcs = bandStops.slice(0, -1).map((from, i) => {
    const to = bandStops[i + 1];
    const a1 = Math.PI * (1 - from);
    const a2 = Math.PI * (1 - to);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy - r * Math.sin(a2);
    return { d: `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`, color: colors.band[i] };
  });
  const needleAngle = Math.PI * (1 - v);
  const nx = cx + (r - 12) * Math.cos(needleAngle);
  const ny = cy - (r - 12) * Math.sin(needleAngle);

  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height, display: 'block' }}>
      {arcs.map((a, i) => <path key={i} d={a.d} stroke={a.color} strokeWidth={14} fill="none" strokeLinecap="butt" />)}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={colors.textBright} strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill={colors.textBright} />
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={22} fontWeight={700} fill={colors.textBright}>
        {(v * 100).toFixed(0)}%
      </text>
      <text x={cx} y={cy - r - 8} textAnchor="middle" fontSize={12} fill={colors.text}>{label}</text>
      {sublabel && <text x={cx} y={cy + 32} textAnchor="middle" fontSize={11} fill={colors.text}>{sublabel}</text>}
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ScatterPlot — points with optional bubble size and a perfect-line overlay
// ────────────────────────────────────────────────────────────────────────────

export interface ScatterDatum { x: number; y: number; size?: number; label?: string; }
export function ScatterPlot({ data, xLabel, yLabel, height = 280, perfectLine = false, xRange = [0, 1], yRange = [0, 1] }: {
  data: ScatterDatum[];
  xLabel: string;
  yLabel: string;
  height?: number;
  perfectLine?: boolean;
  xRange?: [number, number];
  yRange?: [number, number];
}) {
  if (data.length === 0) return <EmptyChart title={`${yLabel} vs ${xLabel}`} message="No bucket data with sufficient samples to plot." />;
  const padding = { top: 18, right: 18, bottom: 40, left: 50 };
  const w = 540;
  const innerW = w - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const sx = (x: number) => padding.left + ((x - xRange[0]) / (xRange[1] - xRange[0])) * innerW;
  const sy = (y: number) => padding.top + (1 - (y - yRange[0]) / (yRange[1] - yRange[0])) * innerH;
  const maxSize = Math.max(1, ...data.map(d => d.size ?? 1));

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height, display: 'block' }}>
      {/* gridlines */}
      {ticks.map((t, i) => (
        <g key={`gx-${i}`}>
          <line x1={sx(t)} y1={padding.top} x2={sx(t)} y2={padding.top + innerH} stroke={colors.grid} />
          <text x={sx(t)} y={height - 14} textAnchor="middle" fontSize={10} fill={colors.text}>{(t * 100).toFixed(0)}%</text>
        </g>
      ))}
      {ticks.map((t, i) => (
        <g key={`gy-${i}`}>
          <line x1={padding.left} y1={sy(t)} x2={padding.left + innerW} y2={sy(t)} stroke={colors.grid} />
          <text x={padding.left - 6} y={sy(t) + 4} textAnchor="end" fontSize={10} fill={colors.text}>{(t * 100).toFixed(0)}%</text>
        </g>
      ))}
      {/* perfect line */}
      {perfectLine && (
        <line x1={sx(xRange[0])} y1={sy(xRange[0])} x2={sx(xRange[1])} y2={sy(xRange[1])} stroke="#475569" strokeWidth={1} strokeDasharray="4 4" />
      )}
      {/* points */}
      {data.map((d, i) => {
        const r = 4 + (d.size ?? 1) / maxSize * 14;
        return (
          <g key={i}>
            <circle cx={sx(d.x)} cy={sy(d.y)} r={r} fill="#6366f1" fillOpacity={0.7} stroke="#a5b4fc" />
            {d.label && <text x={sx(d.x)} y={sy(d.y) - r - 4} textAnchor="middle" fontSize={10} fill={colors.text}>{d.label}</text>}
          </g>
        );
      })}
      <text x={padding.left + innerW / 2} y={height - 2} textAnchor="middle" fontSize={11} fill={colors.text}>{xLabel}</text>
      <text x={12} y={padding.top + innerH / 2} textAnchor="middle" fontSize={11} fill={colors.text} transform={`rotate(-90 12 ${padding.top + innerH / 2})`}>{yLabel}</text>
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// LineChart — simple polyline with point markers
// ────────────────────────────────────────────────────────────────────────────

export interface LinePoint { x: string; y: number | null; }
export function LineChart({ data, yLabel, valueFormatter, height = 240, yRange }: {
  data: LinePoint[];
  yLabel: string;
  valueFormatter?: (v: number) => string;
  height?: number;
  yRange?: [number, number];
}) {
  const present = data.filter((p): p is { x: string; y: number } => p.y != null);
  if (present.length < 2) return <EmptyChart title={yLabel} message="Need at least 2 buckets with data to draw a line." />;
  const padding = { top: 18, right: 18, bottom: 36, left: 50 };
  const w = 600;
  const innerW = w - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const ys = present.map(p => p.y);
  const yMin = yRange?.[0] ?? Math.min(...ys);
  const yMax = yRange?.[1] ?? Math.max(...ys);
  const span = Math.max(yMax - yMin, 0.001);
  const sx = (i: number) => padding.left + (i / Math.max(1, data.length - 1)) * innerW;
  const sy = (y: number) => padding.top + (1 - (y - yMin) / span) * innerH;
  const fmt = valueFormatter ?? ((v: number) => v.toFixed(1));

  const path = data.map((p, i) => {
    if (p.y == null) return null;
    return `${i === 0 ? 'M' : 'L'} ${sx(i)} ${sy(p.y)}`;
  }).filter(Boolean).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height, display: 'block' }}>
      <line x1={padding.left} y1={padding.top + innerH} x2={padding.left + innerW} y2={padding.top + innerH} stroke={colors.axis} />
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + innerH} stroke={colors.axis} />
      <path d={path} stroke="#3b82f6" strokeWidth={2} fill="none" />
      {data.map((p, i) => p.y == null ? null : (
        <g key={i}>
          <circle cx={sx(i)} cy={sy(p.y)} r={4} fill="#3b82f6" />
          <text x={sx(i)} y={sy(p.y) - 8} textAnchor="middle" fontSize={10} fill={colors.textBright}>{fmt(p.y)}</text>
          <text x={sx(i)} y={height - 12} textAnchor="middle" fontSize={11} fill={colors.text}>{p.x}</text>
        </g>
      ))}
      <text x={12} y={padding.top + innerH / 2} textAnchor="middle" fontSize={11} fill={colors.text} transform={`rotate(-90 12 ${padding.top + innerH / 2})`}>{yLabel}</text>
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// HeatmapGrid — rows × cols with diverging or sequential color
// ────────────────────────────────────────────────────────────────────────────

export interface HeatmapCell { row: string; col: string; value: number | null; sample?: number; }
export function HeatmapGrid({ cells, rowLabels, colLabels, title, valueFormatter, diverging }: {
  cells: HeatmapCell[];
  rowLabels: string[];
  colLabels: string[];
  title?: string;
  valueFormatter?: (v: number) => string;
  diverging?: boolean; // if true: -∞..0..+∞ red-blue
}) {
  const present = cells.filter((c): c is HeatmapCell & { value: number } => c.value != null);
  if (present.length === 0) return <EmptyChart title={title ?? 'Heatmap'} message="No bucket pairs with data yet." />;

  const values = present.map(c => c.value);
  const maxAbs = Math.max(0.001, ...values.map(Math.abs));
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const fmt = valueFormatter ?? ((v: number) => v.toFixed(2));

  const colorFor = (v: number) => {
    if (diverging) {
      const t = Math.max(-1, Math.min(1, v / maxAbs));
      if (t >= 0) {
        const a = t; // 0..1
        const r = Math.round(15 + (34 - 15) * a);
        const g = Math.round(23 + (197 - 23) * a);
        const b = Math.round(42 + (94 - 42) * a);
        return `rgb(${r}, ${g}, ${b})`;
      } else {
        const a = -t;
        const r = Math.round(15 + (239 - 15) * a);
        const g = Math.round(23 + (68 - 23) * a);
        const b = Math.round(42 + (68 - 42) * a);
        return `rgb(${r}, ${g}, ${b})`;
      }
    }
    const t = (v - minV) / Math.max(0.001, maxV - minV);
    const r = Math.round(15 + (99 - 15) * t);
    const g = Math.round(23 + (102 - 23) * t);
    const b = Math.round(42 + (241 - 42) * t);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const cellW = 100;
  const cellH = 36;
  const labelW = 130;
  const headerH = 36;
  const w = labelW + cellW * colLabels.length + 16;
  const h = headerH + cellH * rowLabels.length + 16;

  const get = (row: string, col: string) => cells.find(c => c.row === row && c.col === col);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', minWidth: w, height: h, display: 'block' }}>
        {colLabels.map((c, i) => (
          <text key={`col-${i}`} x={labelW + cellW * i + cellW / 2} y={20} textAnchor="middle" fontSize={11} fill={colors.text}>{c}</text>
        ))}
        {rowLabels.map((row, ri) => (
          <g key={`row-${ri}`}>
            <text x={labelW - 6} y={headerH + cellH * ri + cellH / 2 + 4} textAnchor="end" fontSize={11} fill={colors.text}>{row}</text>
            {colLabels.map((col, ci) => {
              const cell = get(row, col);
              const x = labelW + cellW * ci;
              const y = headerH + cellH * ri;
              if (!cell || cell.value == null) {
                return (
                  <g key={`c-${ri}-${ci}`}>
                    <rect x={x} y={y} width={cellW - 2} height={cellH - 2} fill="#0f172a" stroke="#1e293b" rx={3} />
                    <text x={x + cellW / 2} y={y + cellH / 2 + 4} textAnchor="middle" fontSize={11} fill={colors.text}>—</text>
                  </g>
                );
              }
              return (
                <g key={`c-${ri}-${ci}`}>
                  <rect x={x} y={y} width={cellW - 2} height={cellH - 2} fill={colorFor(cell.value)} rx={3} />
                  <text x={x + cellW / 2} y={y + cellH / 2 + 4} textAnchor="middle" fontSize={11} fill={colors.textBright} fontWeight={600}>{fmt(cell.value)}</text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CandlestickChart — probability candlestick (NOT financial OHLC)
//   open  = market probability
//   high  = max(market, model, calibrated)
//   low   = min(market, model, calibrated)
//   close = calibrated probability
//   tick  = model probability marker
// ────────────────────────────────────────────────────────────────────────────

export interface ProbCandle {
  label: string;
  marketProb: number;
  modelProb: number;
  calibratedProb: number;
}
export function ProbabilityCandlestickChart({ candles, height = 260 }: { candles: ProbCandle[]; height?: number }) {
  if (candles.length === 0) return <EmptyChart title="Probability candlestick — market vs model vs calibrated view" message="No resolved records with model probability yet." />;
  const padding = { top: 28, right: 12, bottom: 50, left: 50 };
  const w = Math.max(540, candles.length * 56);
  const innerW = w - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const sy = (p: number) => padding.top + (1 - p) * innerH; // 0..1
  const stride = innerW / candles.length;
  const bodyW = Math.min(28, stride - 16);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height, display: 'block' }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padding.left} y1={sy(t)} x2={padding.left + innerW} y2={sy(t)} stroke={colors.grid} />
          <text x={padding.left - 6} y={sy(t) + 4} textAnchor="end" fontSize={10} fill={colors.text}>{(t * 100).toFixed(0)}%</text>
        </g>
      ))}
      {candles.map((c, i) => {
        const x = padding.left + stride * i + stride / 2;
        const high = Math.max(c.marketProb, c.modelProb, c.calibratedProb);
        const low = Math.min(c.marketProb, c.modelProb, c.calibratedProb);
        const open = c.marketProb;
        const close = c.calibratedProb;
        const greenBody = close >= open;
        const bodyTop = sy(Math.max(open, close));
        const bodyBot = sy(Math.min(open, close));
        const fill = greenBody ? colors.positive : colors.negative;
        return (
          <g key={i}>
            {/* wick */}
            <line x1={x} y1={sy(high)} x2={x} y2={sy(low)} stroke={colors.text} strokeWidth={1} />
            {/* body */}
            <rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={Math.max(2, bodyBot - bodyTop)} fill={fill} fillOpacity={0.85} stroke={fill} />
            {/* model prob tick (yellow) */}
            <line x1={x - bodyW / 2 - 4} y1={sy(c.modelProb)} x2={x + bodyW / 2 + 4} y2={sy(c.modelProb)} stroke="#fbbf24" strokeWidth={2} />
            <text x={x} y={height - 16} textAnchor="middle" fontSize={10} fill={colors.text}>{c.label}</text>
          </g>
        );
      })}
      {/* legend */}
      <g transform={`translate(${padding.left}, 12)`}>
        <rect width={10} height={10} fill={colors.positive} /><text x={14} y={9} fontSize={10} fill={colors.text}>cal &gt; market</text>
        <rect x={92} width={10} height={10} fill={colors.negative} /><text x={106} y={9} fontSize={10} fill={colors.text}>cal &lt; market</text>
        <line x1={184} y1={5} x2={196} y2={5} stroke="#fbbf24" strokeWidth={2} /><text x={200} y={9} fontSize={10} fill={colors.text}>model prob</text>
        <line x1={272} y1={5} x2={284} y2={5} stroke={colors.text} /><text x={288} y={9} fontSize={10} fill={colors.text}>min/max wick</text>
      </g>
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MiniBar — 2-segment horizontal bar comparing two values (Signals Dashboard)
// ────────────────────────────────────────────────────────────────────────────

export function MiniBar({ raw, calibrated, max, height = 14, width = 80 }: {
  raw: number;
  calibrated: number;
  max?: number;
  height?: number;
  width?: number;
}) {
  const cap = max ?? Math.max(0.0001, Math.abs(raw), Math.abs(calibrated)) * 1.1;
  const rawW = (Math.abs(raw) / cap) * width;
  const calW = (Math.abs(calibrated) / cap) * width;
  return (
    <svg width={width} height={height + 4} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <rect x={0} y={0} width={rawW} height={(height - 4) / 2} fill="#94a3b8" rx={1} />
      <rect x={0} y={(height - 4) / 2 + 4} width={calW} height={(height - 4) / 2} fill={calibrated >= raw * 0.95 ? '#22c55e' : '#f59e0b'} rx={1} />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TrustIndicator — small red/yellow/green dot with reliability % beside it
// ────────────────────────────────────────────────────────────────────────────

export function TrustIndicator({ reliabilityFactor }: { reliabilityFactor?: number }) {
  if (reliabilityFactor == null) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8' }}><span style={{ width: 8, height: 8, borderRadius: 4, background: '#475569' }} />n/a</span>;
  }
  let color = '#22c55e';
  let label = 'high trust';
  if (reliabilityFactor < 0.4) { color = '#ef4444'; label = 'low trust'; }
  else if (reliabilityFactor < 0.7) { color = '#f59e0b'; label = 'med trust'; }
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8' }}><span style={{ width: 8, height: 8, borderRadius: 4, background: color }} title={label} />{label}</span>;
}
