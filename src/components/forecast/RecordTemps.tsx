import { useState, useEffect } from 'react';

interface RecordData {
  recordHigh: number;
  recordHighYear: string;
  recordLow: number;
  recordLowYear: string;
  avgHigh: number;
  avgLow: number;
  yearsOfData: number;
}

interface Props {
  lat: number;
  lon: number;
  today: string; // ISO date string YYYY-MM-DD
  currentHigh: number;
  currentLow: number;
}

export default function RecordTemps({ lat, lon, today, currentHigh, currentLow }: Props) {
  const [data, setData] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const [, m, d] = today.split('-').map(Number);
    fetch(`/api/records?lat=${lat}&lon=${lon}&month=${m}&day=${d}`)
      .then(res => res.ok ? res.json() : null)
      .then(result => { if (result && !result.error) setData(result); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [lat, lon, today]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
        <div className="text-center text-sm text-text-muted dark:text-text-dark-muted">Loading records...</div>
      </div>
    );
  }

  if (!data) return null;

  const date = new Date(today + 'T12:00:00');
  const dateLabel = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  const highDiff = currentHigh - data.avgHigh;
  const lowDiff = currentLow - data.avgLow;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-4 flex items-center justify-center gap-2">
        <span className="text-xl">📊</span>
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">Records for {dateLabel}</h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Record High */}
        <div className="rounded-lg bg-heat/5 p-3 text-center dark:bg-heat/10">
          <div className="text-xs font-semibold uppercase tracking-wide text-heat-dark">Record High</div>
          <div className="mt-1 text-3xl font-bold text-heat-dark">{data.recordHigh}°</div>
          <div className="text-xs text-text-muted dark:text-text-dark-muted">Set in {data.recordHighYear}</div>
        </div>

        {/* Record Low */}
        <div className="rounded-lg bg-sky/5 p-3 text-center dark:bg-sky/10">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-dark">Record Low</div>
          <div className="mt-1 text-3xl font-bold text-sky-dark">{data.recordLow}°</div>
          <div className="text-xs text-text-muted dark:text-text-dark-muted">Set in {data.recordLowYear}</div>
        </div>

        {/* Average High */}
        <div className="rounded-lg bg-surface-alt/50 p-3 text-center dark:bg-surface-dark/50">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-dark-muted">Avg High</div>
          <div className="mt-1 text-2xl font-bold text-text dark:text-text-dark">{data.avgHigh}°</div>
          <div className={`text-xs font-medium ${highDiff > 0 ? 'text-heat' : highDiff < 0 ? 'text-sky' : 'text-text-muted dark:text-text-dark-muted'}`}>
            Today: {currentHigh}° ({highDiff > 0 ? '+' : ''}{highDiff}°)
          </div>
        </div>

        {/* Average Low */}
        <div className="rounded-lg bg-surface-alt/50 p-3 text-center dark:bg-surface-dark/50">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-dark-muted">Avg Low</div>
          <div className="mt-1 text-2xl font-bold text-text dark:text-text-dark">{data.avgLow}°</div>
          <div className={`text-xs font-medium ${lowDiff > 0 ? 'text-heat' : lowDiff < 0 ? 'text-sky' : 'text-text-muted dark:text-text-dark-muted'}`}>
            Today: {currentLow}° ({lowDiff > 0 ? '+' : ''}{lowDiff}°)
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-[10px] text-text-muted/60 dark:text-text-dark-muted/60">
        Based on {data.yearsOfData} years of data (1980–2024)
      </div>
    </div>
  );
}
