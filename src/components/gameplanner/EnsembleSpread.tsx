import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { EnsembleForecast } from '../../lib/types';
import { formatTime } from '../../lib/weather-utils';

interface Props {
  ensemble: EnsembleForecast[];
}

export default function EnsembleSpread({ ensemble }: Props) {
  const data = ensemble.map(pt => ({
    time: formatTime(pt.time),
    median: pt.median.tempF,
    p10: pt.p10.tempF,
    p25: pt.p25.tempF,
    p75: pt.p75.tempF,
    p90: pt.p90.tempF,
    range10_90: [pt.p10.tempF, pt.p90.tempF],
    range25_75: [pt.p25.tempF, pt.p75.tempF],
  }));

  // Calculate summary stats
  const avgTemp = Math.round(ensemble.reduce((s, e) => s + e.median.tempF, 0) / ensemble.length);
  const tempRange = `${Math.min(...ensemble.map(e => e.p10.tempF))}-${Math.max(...ensemble.map(e => e.p90.tempF))}`;
  const maxPrecipProb = Math.max(...ensemble.map(e => e.precipProbability));

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-2 text-lg font-semibold text-text dark:text-text-dark">Ensemble Temperature Spread</h3>
      <p className="mb-4 text-sm text-text-muted dark:text-text-dark-muted">
        64-member ensemble showing probability ranges
      </p>

      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <div className="rounded-lg bg-heat/5 px-3 py-2">
          <span className="text-text-muted dark:text-text-dark-muted">Median: </span>
          <span className="font-semibold text-text dark:text-text-dark">{avgTemp}°F</span>
        </div>
        <div className="rounded-lg bg-storm/5 px-3 py-2">
          <span className="text-text-muted dark:text-text-dark-muted">Range: </span>
          <span className="font-semibold text-text dark:text-text-dark">{tempRange}°F</span>
        </div>
        <div className="rounded-lg bg-sky/5 px-3 py-2">
          <span className="text-text-muted dark:text-text-dark-muted">Rain chance: </span>
          <span className="font-semibold text-text dark:text-text-dark">{maxPrecipProb}%</span>
        </div>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="ensembleOuter" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="ensembleInner" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} interval={2} stroke="#94a3b8" />
            <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={v => `${v}°`} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc', fontSize: '13px' }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = { p90: '90th pctl', p75: '75th pctl', median: 'Median', p25: '25th pctl', p10: '10th pctl' };
                return [`${value}°F`, labels[name] || name];
              }}
            />
            <Area type="monotone" dataKey="p90" stroke="none" fill="url(#ensembleOuter)" />
            <Area type="monotone" dataKey="p75" stroke="none" fill="url(#ensembleInner)" />
            <Area type="monotone" dataKey="median" stroke="#f97316" strokeWidth={2.5} fill="none" dot={false} />
            <Area type="monotone" dataKey="p25" stroke="none" fill="url(#ensembleInner)" />
            <Area type="monotone" dataKey="p10" stroke="none" fill="url(#ensembleOuter)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-text-muted dark:text-text-dark-muted">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-heat" /> Median</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-4 rounded bg-sky/20" /> 25th-75th percentile</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-4 rounded bg-storm/10" /> 10th-90th percentile</span>
      </div>
    </div>
  );
}
