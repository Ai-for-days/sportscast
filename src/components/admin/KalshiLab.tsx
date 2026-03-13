import { useState, useEffect } from 'react';

interface KalshiSignal {
  ticker: string;
  title: string;
  locationName?: string;
  metric?: string;
  targetDate?: string;
  threshold?: number;
  marketProbYes: number;
  marketProbNo: number;
  modelProbYes: number;
  modelProbNo: number;
  edgeYes: number;
  edgeNo: number;
  recommendedSide: 'yes' | 'no' | 'none';
  confidence: 'low' | 'medium' | 'high';
  mapped: boolean;
  reason?: string;
}

interface PaperTrade {
  id: string;
  createdAt: string;
  ticker: string;
  title: string;
  side: 'yes' | 'no';
  entryPrice: number;
  modelProb: number;
  marketProb: number;
  edge: number;
  confidence: string;
  stakeCents: number;
  status: 'open' | 'settled' | 'cancelled';
  settlementPrice?: number;
  pnlCents?: number;
  notes?: string;
}

interface PaperTradeSummary {
  openCount: number;
  settledCount: number;
  cancelledCount: number;
  totalPnlCents: number;
  winCount: number;
  lossCount: number;
  winRate: number | null;
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const CONFIDENCE_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-green-100 text-green-700',
};

const METRIC_LABELS: Record<string, string> = {
  high_temp: 'High Temp',
  low_temp: 'Low Temp',
  actual_temp: 'Temp',
  actual_wind: 'Wind',
  actual_gust: 'Gust',
};

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtEdge(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatET(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }) + ' ET';
  } catch { return iso; }
}

type SignalFilter = 'all' | 'mapped' | 'edge' | 'yes' | 'no' | 'high' | 'medium' | 'low';

export default function KalshiLab() {
  const [signals, setSignals] = useState<KalshiSignal[]>([]);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [summary, setSummary] = useState<PaperTradeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<SignalFilter>('all');

  // Paper trade creation state
  const [tradeSignal, setTradeSignal] = useState<KalshiSignal | null>(null);
  const [tradeSide, setTradeSide] = useState<'yes' | 'no'>('yes');
  const [tradeStake, setTradeStake] = useState('1000');
  const [tradeNotes, setTradeNotes] = useState('');
  const [creating, setCreating] = useState(false);

  // Settle state
  const [settleId, setSettleId] = useState('');
  const [settlePrice, setSettlePrice] = useState('');
  const [settling, setSettling] = useState(false);

  const [activeTab, setActiveTab] = useState<'signals' | 'trades'>('signals');

  // Portfolio ranking data
  const [rankingMap, setRankingMap] = useState<Record<string, { signalScore: number; sizingTier: string; recommendedStake?: number }>>({});

  const fetchData = async () => {
    try {
      const [sigRes, tradeRes, portRes] = await Promise.all([
        fetch('/api/admin/kalshi/signals', { credentials: 'include' }),
        fetch('/api/admin/kalshi/paper-trades', { credentials: 'include' }),
        fetch('/api/admin/portfolio', { credentials: 'include' }).catch(() => null),
      ]);
      if (sigRes.ok) {
        const d = await sigRes.json();
        setSignals(d.signals || []);
      }
      if (tradeRes.ok) {
        const d = await tradeRes.json();
        setTrades(d.trades || []);
        setSummary(d.summary || null);
      }
      if (portRes?.ok) {
        const pd = await portRes.json();
        const rMap: Record<string, { signalScore: number; sizingTier: string; recommendedStake?: number }> = {};
        const sigs = pd.signals || [];
        const recs = pd.portfolio?.recommendations || [];
        for (const s of sigs) {
          if (s.source === 'kalshi') {
            const ticker = s.id.replace('ks_', '');
            const rec = recs.find((r: any) => r.signalId === s.id);
            rMap[ticker] = { signalScore: s.signalScore, sizingTier: s.sizingTier, recommendedStake: rec?.recommendedStakeCents };
          }
        }
        setRankingMap(rMap);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreateTrade = async () => {
    if (!tradeSignal) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/kalshi/paper-trades', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          signal: tradeSignal,
          side: tradeSide,
          stakeCents: parseInt(tradeStake, 10) || 1000,
          notes: tradeNotes || undefined,
        }),
      });
      if (res.ok) {
        setTradeSignal(null);
        setTradeNotes('');
        fetchData();
      }
    } catch { /* ignore */ }
    setCreating(false);
  };

  const handleSettle = async () => {
    if (!settleId || settlePrice === '') return;
    setSettling(true);
    try {
      const res = await fetch('/api/admin/kalshi/paper-trades', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'settle',
          id: settleId,
          settlementPrice: parseInt(settlePrice, 10),
        }),
      });
      if (res.ok) {
        setSettleId('');
        setSettlePrice('');
        fetchData();
      }
    } catch { /* ignore */ }
    setSettling(false);
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading Kalshi Lab...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;

  const mappedCount = signals.filter(s => s.mapped).length;
  const unmappedCount = signals.filter(s => !s.mapped).length;
  const withEdge = signals.filter(s => s.recommendedSide !== 'none').length;

  // Filter signals
  let filtered = signals;
  if (filter === 'mapped') filtered = signals.filter(s => s.mapped);
  else if (filter === 'edge') filtered = signals.filter(s => s.recommendedSide !== 'none');
  else if (filter === 'yes') filtered = signals.filter(s => s.recommendedSide === 'yes');
  else if (filter === 'no') filtered = signals.filter(s => s.recommendedSide === 'no');
  else if (filter === 'high') filtered = signals.filter(s => s.confidence === 'high');
  else if (filter === 'medium') filtered = signals.filter(s => s.confidence === 'medium');
  else if (filter === 'low') filtered = signals.filter(s => s.confidence === 'low');

  const openTrades = trades.filter(t => t.status === 'open');
  const settledTrades = trades.filter(t => t.status === 'settled');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kalshi Weather Trading Lab</h1>
          <p className="text-sm text-gray-500 mt-1">Paper trading only — no live trades executed</p>
        </div>
        <div className="flex gap-3">
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
          <a href="/admin/pricing-lab" className="text-sm text-blue-600 hover:underline">Pricing Lab</a>
        </div>
      </div>

      {/* A. Overview Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Mapped Markets</div>
          <div className="text-lg font-bold text-gray-900">{mappedCount}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Unmapped</div>
          <div className="text-lg font-bold text-gray-400">{unmappedCount}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Signals w/ Edge</div>
          <div className="text-lg font-bold text-green-600">{withEdge}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Open Trades</div>
          <div className="text-lg font-bold text-blue-600">{summary?.openCount || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Settled Trades</div>
          <div className="text-lg font-bold text-gray-900">{summary?.settledCount || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Paper P&L</div>
          <div className={`text-lg font-bold ${(summary?.totalPnlCents || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {fmtUSD(summary?.totalPnlCents || 0)}
          </div>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('signals')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'signals' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >Signals ({signals.length})</button>
        <button
          onClick={() => setActiveTab('trades')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'trades' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >Paper Trades ({trades.length})</button>
      </div>

      {activeTab === 'signals' && (
        <>
          {/* C. Signal Filters */}
          <div className="flex flex-wrap gap-2">
            {([
              ['all', 'All'],
              ['mapped', 'Mapped Only'],
              ['edge', 'Edge > Threshold'],
              ['yes', 'Rec: YES'],
              ['no', 'Rec: NO'],
              ['high', 'High Confidence'],
              ['medium', 'Medium'],
              ['low', 'Low'],
            ] as [SignalFilter, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${filter === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >{label}</button>
            ))}
          </div>

          {/* B. Signals Table */}
          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              Kalshi Markets & Signals ({filtered.length})
            </h2>
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No signals match the filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className={thClass}>Ticker</th>
                      <th className={thClass}>Title</th>
                      <th className={thClass}>Mapped</th>
                      <th className={thClass}>Location</th>
                      <th className={thClass}>Metric</th>
                      <th className={thClass}>Date</th>
                      <th className={thClass}>Mkt YES</th>
                      <th className={thClass}>Model YES</th>
                      <th className={thClass}>Edge</th>
                      <th className={thClass}>Rec</th>
                      <th className={thClass}>Conf</th>
                      <th className={thClass}>Score</th>
                      <th className={thClass}>Tier</th>
                      <th className={thClass}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(s => {
                      const bestEdge = Math.abs(s.edgeYes) >= Math.abs(s.edgeNo) ? s.edgeYes : s.edgeNo;
                      const ranking = rankingMap[s.ticker];
                      return (
                        <tr key={s.ticker} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className={`${tdClass} font-mono text-xs`}>{s.ticker}</td>
                          <td className={`${tdClass} max-w-[200px] truncate`}>{s.title}</td>
                          <td className={tdClass}>
                            {s.mapped ? (
                              <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Yes</span>
                            ) : (
                              <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">No</span>
                            )}
                          </td>
                          <td className={tdClass}>{s.locationName || '—'}</td>
                          <td className={tdClass}>{s.metric ? (METRIC_LABELS[s.metric] || s.metric) : '—'}</td>
                          <td className={`${tdClass} text-xs`}>{s.targetDate || '—'}</td>
                          <td className={`${tdClass} font-mono`}>{s.marketProbYes > 0 ? fmtPct(s.marketProbYes) : '—'}</td>
                          <td className={`${tdClass} font-mono`}>{s.modelProbYes > 0 ? fmtPct(s.modelProbYes) : '—'}</td>
                          <td className={`${tdClass} font-mono font-semibold ${bestEdge > 0 ? 'text-green-600' : bestEdge < 0 ? 'text-red-600' : ''}`}>
                            {s.mapped ? fmtEdge(bestEdge) : '—'}
                          </td>
                          <td className={tdClass}>
                            {s.recommendedSide === 'yes' && <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">YES</span>}
                            {s.recommendedSide === 'no' && <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">NO</span>}
                            {s.recommendedSide === 'none' && <span className="text-xs text-gray-400">—</span>}
                          </td>
                          <td className={tdClass}>
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_COLORS[s.confidence]}`}>
                              {s.confidence}
                            </span>
                          </td>
                          <td className={`${tdClass} font-mono`}>{ranking ? ranking.signalScore : '—'}</td>
                          <td className={tdClass}>
                            {ranking ? (
                              <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                                ranking.sizingTier === 'large' ? 'bg-green-100 text-green-700' :
                                ranking.sizingTier === 'medium' ? 'bg-blue-100 text-blue-700' :
                                ranking.sizingTier === 'small' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-gray-100 text-gray-500'
                              }`}>{ranking.sizingTier}</span>
                            ) : '—'}
                          </td>
                          <td className={tdClass}>
                            {s.mapped && s.recommendedSide !== 'none' && (
                              <button
                                onClick={() => {
                                  setTradeSignal(s);
                                  setTradeSide(s.recommendedSide as 'yes' | 'no');
                                  const r = rankingMap[s.ticker];
                                  if (r?.recommendedStake) setTradeStake(String(r.recommendedStake));
                                }}
                                className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                              >Paper Trade</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* D. Paper Trade Creation Modal */}
          {tradeSignal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Create Paper Trade</h3>
                <div className="space-y-3 text-sm">
                  <div><span className="text-gray-500">Ticker:</span> <span className="font-mono">{tradeSignal.ticker}</span></div>
                  <div><span className="text-gray-500">Title:</span> {tradeSignal.title}</div>
                  <div className="flex gap-4">
                    <div><span className="text-gray-500">Market YES:</span> {fmtPct(tradeSignal.marketProbYes)}</div>
                    <div><span className="text-gray-500">Model YES:</span> {fmtPct(tradeSignal.modelProbYes)}</div>
                  </div>
                  <div className="flex gap-4">
                    <div><span className="text-gray-500">Edge YES:</span> <span className={tradeSignal.edgeYes > 0 ? 'text-green-600 font-semibold' : ''}>{fmtEdge(tradeSignal.edgeYes)}</span></div>
                    <div><span className="text-gray-500">Edge NO:</span> <span className={tradeSignal.edgeNo > 0 ? 'text-green-600 font-semibold' : ''}>{fmtEdge(tradeSignal.edgeNo)}</span></div>
                  </div>
                  <div>
                    <label className="block text-gray-500 mb-1">Side</label>
                    <select value={tradeSide} onChange={e => setTradeSide(e.target.value as 'yes' | 'no')} className="w-full rounded border border-gray-300 px-3 py-2">
                      <option value="yes">YES</option>
                      <option value="no">NO</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-500 mb-1">Stake (cents)</label>
                    <input type="number" value={tradeStake} onChange={e => setTradeStake(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2" />
                    <div className="text-xs text-gray-400 mt-0.5">{fmtUSD(parseInt(tradeStake, 10) || 0)}</div>
                  </div>
                  <div>
                    <label className="block text-gray-500 mb-1">Notes (optional)</label>
                    <input type="text" value={tradeNotes} onChange={e => setTradeNotes(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2" placeholder="Optional notes..." />
                  </div>
                </div>
                <div className="mt-4 flex gap-3 justify-end">
                  <button onClick={() => setTradeSignal(null)} className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
                  <button onClick={handleCreateTrade} disabled={creating} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    {creating ? 'Creating...' : 'Create Paper Trade'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'trades' && (
        <>
          {/* Summary Stats */}
          {summary && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className={cardClass}>
                <div className="text-xs text-gray-500">Win Rate</div>
                <div className="text-lg font-bold text-gray-900">{summary.winRate != null ? fmtPct(summary.winRate) : '—'}</div>
              </div>
              <div className={cardClass}>
                <div className="text-xs text-gray-500">Wins / Losses</div>
                <div className="text-lg font-bold text-gray-900">{summary.winCount}W / {summary.lossCount}L</div>
              </div>
              <div className={cardClass}>
                <div className="text-xs text-gray-500">Total P&L</div>
                <div className={`text-lg font-bold ${summary.totalPnlCents >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(summary.totalPnlCents)}</div>
              </div>
              <div className={cardClass}>
                <div className="text-xs text-gray-500">Cancelled</div>
                <div className="text-lg font-bold text-gray-400">{summary.cancelledCount}</div>
              </div>
            </div>
          )}

          {/* E. Open Trades */}
          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Open Trades ({openTrades.length})</h2>
            {openTrades.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No open paper trades.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className={thClass}>Created</th>
                      <th className={thClass}>Ticker</th>
                      <th className={thClass}>Side</th>
                      <th className={thClass}>Entry</th>
                      <th className={thClass}>Model</th>
                      <th className={thClass}>Edge</th>
                      <th className={thClass}>Stake</th>
                      <th className={thClass}>Conf</th>
                      <th className={thClass}>Notes</th>
                      <th className={thClass}>Settle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTrades.map(t => (
                      <tr key={t.id} className="border-b border-gray-50">
                        <td className={`${tdClass} text-xs`}>{formatET(t.createdAt)}</td>
                        <td className={`${tdClass} font-mono text-xs`}>{t.ticker}</td>
                        <td className={tdClass}>
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${t.side === 'yes' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {t.side.toUpperCase()}
                          </span>
                        </td>
                        <td className={`${tdClass} font-mono`}>{fmtPct(t.entryPrice)}</td>
                        <td className={`${tdClass} font-mono`}>{fmtPct(t.modelProb)}</td>
                        <td className={`${tdClass} font-mono text-green-600`}>{fmtEdge(t.edge)}</td>
                        <td className={tdClass}>{fmtUSD(t.stakeCents)}</td>
                        <td className={tdClass}>
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${CONFIDENCE_COLORS[t.confidence]}`}>{t.confidence}</span>
                        </td>
                        <td className={`${tdClass} text-xs text-gray-500 max-w-[150px] truncate`}>{t.notes || '—'}</td>
                        <td className={tdClass}>
                          <div className="flex gap-1">
                            <button onClick={() => { setSettleId(t.id); setSettlePrice('100'); }} className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700">Won</button>
                            <button onClick={() => { setSettleId(t.id); setSettlePrice('0'); }} className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700">Lost</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Settled Trades */}
          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Settled Trades ({settledTrades.length})</h2>
            {settledTrades.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No settled paper trades yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className={thClass}>Created</th>
                      <th className={thClass}>Ticker</th>
                      <th className={thClass}>Side</th>
                      <th className={thClass}>Entry</th>
                      <th className={thClass}>Settlement</th>
                      <th className={thClass}>Stake</th>
                      <th className={thClass}>P&L</th>
                      <th className={thClass}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settledTrades.map(t => (
                      <tr key={t.id} className="border-b border-gray-50">
                        <td className={`${tdClass} text-xs`}>{formatET(t.createdAt)}</td>
                        <td className={`${tdClass} font-mono text-xs`}>{t.ticker}</td>
                        <td className={tdClass}>
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${t.side === 'yes' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {t.side.toUpperCase()}
                          </span>
                        </td>
                        <td className={`${tdClass} font-mono`}>{fmtPct(t.entryPrice)}</td>
                        <td className={`${tdClass} font-mono`}>{t.settlementPrice ?? '—'}</td>
                        <td className={tdClass}>{fmtUSD(t.stakeCents)}</td>
                        <td className={`${tdClass} font-mono font-semibold ${(t.pnlCents ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {t.pnlCents != null ? fmtUSD(t.pnlCents) : '—'}
                        </td>
                        <td className={`${tdClass} text-xs text-gray-500 max-w-[150px] truncate`}>{t.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Settle confirmation */}
          {settleId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Settle Paper Trade</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Settlement price: <span className="font-mono font-bold">{settlePrice === '100' ? '100 (YES won)' : '0 (NO won)'}</span>
                </p>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setSettleId(''); setSettlePrice(''); }} className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
                  <button onClick={handleSettle} disabled={settling} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    {settling ? 'Settling...' : 'Confirm Settle'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
