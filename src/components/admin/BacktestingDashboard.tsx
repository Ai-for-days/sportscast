import { useState } from 'react';

interface BacktestBucket {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnlCents: number;
  avgPnlCents: number | null;
}

interface BacktestResult {
  config: any;
  summary: {
    totalEntries: number;
    filteredEntries: number;
    settledEntries: number;
    tradesTaken: number;
    wins: number;
    losses: number;
    winRate: number | null;
    avgEdge: number | null;
    totalPnlCents: number;
    avgPnlPerTrade: number | null;
    bestTradePnl: number | null;
    worstTradePnl: number | null;
  };
  bySource: BacktestBucket[];
  byConfidence: BacktestBucket[];
  bySizingTier: BacktestBucket[];
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

function fmtUSD(cents: number): string {
  const neg = cents < 0;
  return `${neg ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function BucketTable({ title, data }: { title: string; data: BacktestBucket[] }) {
  if (data.length === 0) return null;
  return (
    <div className={cardClass}>
      <h3 className="mb-3 text-sm font-semibold text-gray-700">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className={thClass}>Bucket</th>
              <th className={thClass}>Trades</th>
              <th className={thClass}>Wins</th>
              <th className={thClass}>Losses</th>
              <th className={thClass}>Win Rate</th>
              <th className={thClass}>Total P&L</th>
              <th className={thClass}>Avg P&L</th>
            </tr>
          </thead>
          <tbody>
            {data.map(b => (
              <tr key={b.key} className="border-b border-gray-50">
                <td className={`${tdClass} font-medium`}>{b.key}</td>
                <td className={tdClass}>{b.trades}</td>
                <td className={`${tdClass} text-green-600`}>{b.wins}</td>
                <td className={`${tdClass} text-red-600`}>{b.losses}</td>
                <td className={tdClass}>{fmtPct(b.winRate)}</td>
                <td className={`${tdClass} font-mono ${b.totalPnlCents >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(b.totalPnlCents)}</td>
                <td className={`${tdClass} font-mono`}>{b.avgPnlCents != null ? fmtUSD(b.avgPnlCents) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BacktestingDashboard() {
  const [minEdge, setMinEdge] = useState('3');
  const [confidenceFilter, setConfidenceFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sizingTierFilter, setSizingTierFilter] = useState('');
  const [maxTradeSize, setMaxTradeSize] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runTest = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/backtesting', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minEdge: parseFloat(minEdge) / 100,
          confidenceFilter: confidenceFilter || undefined,
          sourceFilter: sourceFilter || undefined,
          sizingTierFilter: sizingTierFilter || undefined,
          maxTradeSizeCents: maxTradeSize ? Math.round(parseFloat(maxTradeSize) * 100) : undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
      });
      if (!res.ok) { setError('Backtest failed'); return; }
      const d = await res.json();
      setResult(d.result);
    } catch (err: any) { setError(err?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Backtesting</h1>
        <div className="flex gap-3">
          <a href="/admin/trade-journal" className="text-sm text-blue-600 hover:underline">Trade Journal</a>
          <a href="/admin/signals" className="text-sm text-blue-600 hover:underline">Signals</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
        </div>
      </div>

      {/* Strategy Controls */}
      <div className={cardClass}>
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Strategy Configuration</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Min Edge (%)</label>
            <input type="number" step="0.5" value={minEdge} onChange={e => setMinEdge(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Confidence</label>
            <select value={confidenceFilter} onChange={e => setConfidenceFilter(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="sportsbook">Sportsbook</option>
              <option value="kalshi">Kalshi</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sizing Tier</label>
            <select value={sizingTierFilter} onChange={e => setSizingTierFilter(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="large">Large</option>
              <option value="medium">Medium</option>
              <option value="small">Small</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Max Trade Size ($)</label>
            <input type="number" step="1" value={maxTradeSize} onChange={e => setMaxTradeSize(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm" placeholder="No limit" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex items-end">
            <button onClick={runTest} disabled={loading}
              className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Running...' : 'Run Backtest'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="text-center py-4 text-red-600">{error}</div>}

      {/* Results */}
      {result && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            <div className={cardClass}><div className="text-xs text-gray-500">Trades Taken</div><div className="text-lg font-bold text-gray-900">{result.summary.tradesTaken}</div></div>
            <div className={cardClass}><div className="text-xs text-gray-500">Settled</div><div className="text-lg font-bold text-gray-900">{result.summary.settledEntries}</div></div>
            <div className={cardClass}><div className="text-xs text-gray-500">Win Rate</div><div className="text-lg font-bold text-gray-900">{fmtPct(result.summary.winRate)}</div></div>
            <div className={cardClass}><div className="text-xs text-gray-500">Avg Edge</div><div className="text-lg font-bold text-gray-900">{fmtPct(result.summary.avgEdge)}</div></div>
            <div className={cardClass}>
              <div className="text-xs text-gray-500">Total P&L</div>
              <div className={`text-lg font-bold ${result.summary.totalPnlCents >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(result.summary.totalPnlCents)}</div>
            </div>
            <div className={cardClass}>
              <div className="text-xs text-gray-500">Avg P&L/Trade</div>
              <div className={`text-lg font-bold ${(result.summary.avgPnlPerTrade || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{result.summary.avgPnlPerTrade != null ? fmtUSD(result.summary.avgPnlPerTrade) : '—'}</div>
            </div>
            <div className={cardClass}>
              <div className="text-xs text-gray-500">Best / Worst</div>
              <div className="text-sm font-bold">
                <span className="text-green-600">{result.summary.bestTradePnl != null ? fmtUSD(result.summary.bestTradePnl) : '—'}</span>
                {' / '}
                <span className="text-red-600">{result.summary.worstTradePnl != null ? fmtUSD(result.summary.worstTradePnl) : '—'}</span>
              </div>
            </div>
          </div>

          {/* Breakdown Tables */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <BucketTable title="By Source" data={result.bySource} />
            <BucketTable title="By Confidence" data={result.byConfidence} />
            <BucketTable title="By Sizing Tier" data={result.bySizingTier} />
          </div>
        </>
      )}

      {!result && !loading && (
        <div className="text-center py-12 text-gray-500">
          Configure your strategy above and click "Run Backtest" to simulate performance.
        </div>
      )}
    </div>
  );
}
