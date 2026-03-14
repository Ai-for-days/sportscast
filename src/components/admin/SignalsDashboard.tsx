import { useState, useEffect } from 'react';

interface RankedSignal {
  id: string;
  source: 'sportsbook' | 'kalshi';
  marketType: string;
  title: string;
  locationName?: string;
  metric?: string;
  targetDate?: string;
  edge: number;
  confidence: string;
  signalScore: number;
  sizingTier: string;
  rankingReason: string;
  handle?: number;
  liability?: number;
  riskLevel?: string;
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const TIER_COLORS: Record<string, string> = {
  large: 'bg-green-100 text-green-700',
  medium: 'bg-blue-100 text-blue-700',
  small: 'bg-yellow-100 text-yellow-700',
  'no-trade': 'bg-gray-100 text-gray-500',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-500',
};

const SOURCE_COLORS: Record<string, string> = {
  sportsbook: 'bg-blue-100 text-blue-700',
  kalshi: 'bg-purple-100 text-purple-700',
};

const METRIC_LABELS: Record<string, string> = {
  high_temp: 'High Temp', low_temp: 'Low Temp', actual_temp: 'Temp',
  actual_wind: 'Wind', actual_gust: 'Gust',
};

type Filter = 'all' | 'sportsbook' | 'kalshi' | 'high' | 'medium' | 'low' | 'large' | 'med-tier' | 'small' | 'edge';

export default function SignalsDashboard() {
  const [signals, setSignals] = useState<RankedSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [journaling, setJournaling] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/signals', { credentials: 'include' });
        if (!res.ok) { setError('Failed to load signals'); return; }
        const d = await res.json();
        setSignals(d.signals || []);
      } catch (err: any) { setError(err?.message || 'Failed'); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading signals...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;

  let filtered = signals;
  if (filter === 'sportsbook') filtered = signals.filter(s => s.source === 'sportsbook');
  else if (filter === 'kalshi') filtered = signals.filter(s => s.source === 'kalshi');
  else if (filter === 'high') filtered = signals.filter(s => s.confidence === 'high');
  else if (filter === 'medium') filtered = signals.filter(s => s.confidence === 'medium');
  else if (filter === 'low') filtered = signals.filter(s => s.confidence === 'low');
  else if (filter === 'large') filtered = signals.filter(s => s.sizingTier === 'large');
  else if (filter === 'med-tier') filtered = signals.filter(s => s.sizingTier === 'medium');
  else if (filter === 'small') filtered = signals.filter(s => s.sizingTier === 'small');
  else if (filter === 'edge') filtered = signals.filter(s => s.edge >= 0.05);

  const tradable = signals.filter(s => s.sizingTier !== 'no-trade').length;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Signal Rankings</h1>
          <p className="text-sm text-gray-500 mt-1">{signals.length} signals ranked, {tradable} tradable</p>
        </div>
        <div className="flex gap-3">
          <a href="/admin/trade-journal" className="text-sm text-blue-600 hover:underline">Journal</a>
          <a href="/admin/backtesting" className="text-sm text-blue-600 hover:underline">Backtesting</a>
          <a href="/admin/portfolio" className="text-sm text-blue-600 hover:underline">Portfolio</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
          <a href="/admin/kalshi-lab" className="text-sm text-blue-600 hover:underline">Kalshi Lab</a>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'All'], ['sportsbook', 'Sportsbook'], ['kalshi', 'Kalshi'],
          ['high', 'High Conf'], ['medium', 'Med Conf'], ['low', 'Low Conf'],
          ['large', 'Large Tier'], ['med-tier', 'Medium Tier'], ['small', 'Small Tier'],
          ['edge', 'Edge ≥ 5%'],
        ] as [Filter, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filter === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >{label}</button>
        ))}
      </div>

      {/* Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Ranked Signals ({filtered.length})</h2>
        {filtered.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500">No signals match the current filter.</p>
            <p className="text-xs text-gray-400 mt-2">Try selecting a different filter above, or run signal generation from the Kalshi Lab to populate signals.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Source</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Location</th>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>Edge</th>
                  <th className={thClass}>Conf</th>
                  <th className={thClass}>Score</th>
                  <th className={thClass}>Tier</th>
                  <th className={thClass}>Reason</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${SOURCE_COLORS[s.source]}`}>{s.source}</span>
                    </td>
                    <td className={`${tdClass} font-medium max-w-[200px] truncate`}>{s.title}</td>
                    <td className={`${tdClass} text-xs`}>{s.locationName || '—'}</td>
                    <td className={`${tdClass} text-xs`}>{s.targetDate || '—'}</td>
                    <td className={`${tdClass} font-mono font-semibold ${s.edge > 0.05 ? 'text-green-600' : ''}`}>
                      {(s.edge * 100).toFixed(1)}%
                    </td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_COLORS[s.confidence]}`}>{s.confidence}</span>
                    </td>
                    <td className={`${tdClass} font-mono font-bold`}>{s.signalScore}</td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${TIER_COLORS[s.sizingTier]}`}>{s.sizingTier}</span>
                    </td>
                    <td className={`${tdClass} text-xs text-gray-600 max-w-[250px]`}>{s.rankingReason}</td>
                    <td className={tdClass}>
                      <button
                        disabled={journaling === s.id}
                        onClick={async () => {
                          setJournaling(s.id);
                          try {
                            await fetch('/api/admin/trade-journal', {
                              method: 'POST',
                              credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'create-from-signal', signalId: s.id }),
                            });
                            setJournaling(null);
                            setJournaling(null);
                            // Visual feedback instead of alert
                            const btn = document.activeElement as HTMLButtonElement;
                            if (btn) { btn.textContent = 'Created!'; setTimeout(() => { btn.textContent = 'Add to Journal'; }, 1500); }
                            return;
                          } catch { setJournaling(null); }
                        }}
                        className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                      >{journaling === s.id ? '...' : 'Add to Journal'}</button>
                      <button
                        onClick={async () => {
                          try {
                            await fetch('/api/admin/execution-candidates', {
                              method: 'POST',
                              credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'create', signalId: s.id, stakeCents: 500 }),
                            });
                            // Visual feedback instead of alert
                            const btn2 = document.activeElement as HTMLButtonElement;
                            if (btn2) { btn2.textContent = 'Created!'; setTimeout(() => { btn2.textContent = 'Create Candidate'; }, 1500); }
                          } catch {}
                        }}
                        className="rounded bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-700 whitespace-nowrap"
                      >Create Candidate</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
