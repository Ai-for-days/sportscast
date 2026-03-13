import { useState, useEffect } from 'react';

interface JournalEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: 'sportsbook' | 'kalshi';
  signalId?: string;
  relatedWagerId?: string;
  relatedPaperTradeId?: string;
  title: string;
  locationName?: string;
  metric?: string;
  targetDate?: string;
  side?: string;
  marketType: string;
  entry: { entryType: string; entryLine?: number; entryOdds?: any; entryProb?: number; entryPrice?: number };
  model: { modelProb?: number; marketProb?: number; edge?: number; signalScore?: number; confidence?: string; sizingTier?: string };
  context: { handle?: number; liability?: number; riskLevel?: string; modelDrift?: number; moveCount?: number; lopsidedPct?: number };
  outcome: { status: string; closingLine?: number; closingProb?: number; closingPrice?: number; settledResult?: string; pnlCents?: number };
  notes?: string;
  thesis?: string;
  postmortem?: string;
}

interface JournalSummary {
  total: number; open: number; settled: number; cancelled: number;
  totalPnlCents: number; avgEdge: number; avgSignalScore: number;
  winCount: number; lossCount: number; winRate: number | null;
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const CONFIDENCE_COLORS: Record<string, string> = { high: 'bg-green-100 text-green-700', medium: 'bg-blue-100 text-blue-700', low: 'bg-yellow-100 text-yellow-700' };
const TIER_COLORS: Record<string, string> = { large: 'bg-green-100 text-green-700', medium: 'bg-blue-100 text-blue-700', small: 'bg-yellow-100 text-yellow-700', 'no-trade': 'bg-gray-100 text-gray-500' };
const STATUS_COLORS: Record<string, string> = { open: 'bg-blue-100 text-blue-700', settled: 'bg-green-100 text-green-700', cancelled: 'bg-gray-100 text-gray-500' };

function fmtUSD(cents: number): string {
  const neg = cents < 0;
  return `${neg ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

type Filter = 'all' | 'sportsbook' | 'kalshi' | 'open' | 'settled' | 'high' | 'medium' | 'low' | 'large-tier' | 'medium-tier' | 'small-tier';

export default function TradeJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [summary, setSummary] = useState<JournalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [settleId, setSettleId] = useState<string | null>(null);
  const [settleResult, setSettleResult] = useState('');
  const [settlePnl, setSettlePnl] = useState('');
  const [settlePostmortem, setSettlePostmortem] = useState('');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/trade-journal', { credentials: 'include' });
      if (!res.ok) { setError('Failed to load'); return; }
      const d = await res.json();
      setEntries(d.entries || []);
      setSummary(d.summary || null);
    } catch (err: any) { setError(err?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSettle = async () => {
    if (!settleId) return;
    const res = await fetch('/api/admin/trade-journal', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'settle',
        id: settleId,
        result: settleResult,
        pnlCents: Math.round(parseFloat(settlePnl || '0') * 100),
        postmortem: settlePostmortem || undefined,
      }),
    });
    if (res.ok) {
      setSettleId(null);
      setSettleResult('');
      setSettlePnl('');
      setSettlePostmortem('');
      fetchData();
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading trade journal...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;

  const filtered = entries.filter(e => {
    if (filter === 'sportsbook') return e.source === 'sportsbook';
    if (filter === 'kalshi') return e.source === 'kalshi';
    if (filter === 'open') return e.outcome.status === 'open';
    if (filter === 'settled') return e.outcome.status === 'settled';
    if (filter === 'high') return e.model.confidence === 'high';
    if (filter === 'medium') return e.model.confidence === 'medium';
    if (filter === 'low') return e.model.confidence === 'low';
    if (filter === 'large-tier') return e.model.sizingTier === 'large';
    if (filter === 'medium-tier') return e.model.sizingTier === 'medium';
    if (filter === 'small-tier') return e.model.sizingTier === 'small';
    return true;
  });

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'sportsbook', label: 'Sportsbook' },
    { key: 'kalshi', label: 'Kalshi' },
    { key: 'open', label: 'Open' },
    { key: 'settled', label: 'Settled' },
    { key: 'high', label: 'High Conf' },
    { key: 'medium', label: 'Med Conf' },
    { key: 'low', label: 'Low Conf' },
    { key: 'large-tier', label: 'Large' },
    { key: 'medium-tier', label: 'Medium' },
    { key: 'small-tier', label: 'Small' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Trade Journal</h1>
        <div className="flex gap-3">
          <a href="/admin/backtesting" className="text-sm text-blue-600 hover:underline">Backtesting</a>
          <a href="/admin/signals" className="text-sm text-blue-600 hover:underline">Signals</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
          <a href="/admin/portfolio" className="text-sm text-blue-600 hover:underline">Portfolio</a>
        </div>
      </div>

      {/* Overview Cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <div className={cardClass}><div className="text-xs text-gray-500">Total Entries</div><div className="text-lg font-bold text-gray-900">{summary.total}</div></div>
          <div className={cardClass}><div className="text-xs text-gray-500">Open</div><div className="text-lg font-bold text-blue-600">{summary.open}</div></div>
          <div className={cardClass}><div className="text-xs text-gray-500">Settled</div><div className="text-lg font-bold text-green-600">{summary.settled}</div></div>
          <div className={cardClass}>
            <div className="text-xs text-gray-500">Total P&L</div>
            <div className={`text-lg font-bold ${summary.totalPnlCents >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(summary.totalPnlCents)}</div>
          </div>
          <div className={cardClass}><div className="text-xs text-gray-500">Win Rate</div><div className="text-lg font-bold text-gray-900">{fmtPct(summary.winRate)}</div></div>
          <div className={cardClass}><div className="text-xs text-gray-500">Avg Edge</div><div className="text-lg font-bold text-gray-900">{fmtPct(summary.avgEdge)}</div></div>
          <div className={cardClass}><div className="text-xs text-gray-500">Avg Score</div><div className="text-lg font-bold text-gray-900">{summary.avgSignalScore > 0 ? summary.avgSignalScore.toFixed(0) : '—'}</div></div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-1">
        {filters.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >{f.label}</button>
        ))}
      </div>

      {/* Journal Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Journal Entries ({filtered.length})</h2>
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No journal entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Source</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Edge</th>
                  <th className={thClass}>Confidence</th>
                  <th className={thClass}>Score</th>
                  <th className={thClass}>Tier</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>P&L</th>
                  <th className={thClass}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <>
                    <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                      <td className={tdClass}>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${e.source === 'kalshi' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{e.source}</span>
                      </td>
                      <td className={`${tdClass} font-medium max-w-[200px] truncate`}>{e.title}</td>
                      <td className={`${tdClass} font-mono`}>{fmtPct(e.model.edge)}</td>
                      <td className={tdClass}>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_COLORS[e.model.confidence || ''] || 'bg-gray-100 text-gray-500'}`}>{e.model.confidence || '—'}</span>
                      </td>
                      <td className={`${tdClass} font-mono font-bold`}>{e.model.signalScore != null ? e.model.signalScore.toFixed(0) : '—'}</td>
                      <td className={tdClass}>
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${TIER_COLORS[e.model.sizingTier || ''] || 'bg-gray-100 text-gray-500'}`}>{e.model.sizingTier || '—'}</span>
                      </td>
                      <td className={tdClass}>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[e.outcome.status] || ''}`}>{e.outcome.status}</span>
                      </td>
                      <td className={`${tdClass} font-mono ${(e.outcome.pnlCents || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {e.outcome.status === 'settled' ? fmtUSD(e.outcome.pnlCents || 0) : '—'}
                      </td>
                      <td className={tdClass}>
                        {e.outcome.status === 'open' && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); setSettleId(e.id); }}
                            className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                          >Settle</button>
                        )}
                      </td>
                    </tr>
                    {expanded === e.id && (
                      <tr key={`${e.id}-detail`} className="bg-gray-50">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <div className="font-semibold text-gray-700 mb-1">Entry Details</div>
                              <div>Type: {e.entry.entryType}</div>
                              {e.entry.entryProb != null && <div>Entry Prob: {fmtPct(e.entry.entryProb)}</div>}
                              {e.entry.entryPrice != null && <div>Entry Price: {e.entry.entryPrice}¢</div>}
                              {e.side && <div>Side: {e.side}</div>}
                              {e.locationName && <div>Location: {e.locationName}</div>}
                              {e.metric && <div>Metric: {e.metric}</div>}
                              {e.targetDate && <div>Target Date: {e.targetDate}</div>}
                            </div>
                            <div>
                              <div className="font-semibold text-gray-700 mb-1">Model</div>
                              {e.model.modelProb != null && <div>Model Prob: {fmtPct(e.model.modelProb)}</div>}
                              {e.model.marketProb != null && <div>Market Prob: {fmtPct(e.model.marketProb)}</div>}
                              <div>Edge: {fmtPct(e.model.edge)}</div>
                              <div>Score: {e.model.signalScore?.toFixed(0) || '—'}</div>
                            </div>
                            {e.thesis && (
                              <div className="col-span-2">
                                <div className="font-semibold text-gray-700 mb-1">Thesis</div>
                                <div className="bg-white rounded p-2 border border-gray-200">{e.thesis}</div>
                              </div>
                            )}
                            {e.notes && (
                              <div className="col-span-2">
                                <div className="font-semibold text-gray-700 mb-1">Notes</div>
                                <div className="bg-white rounded p-2 border border-gray-200">{e.notes}</div>
                              </div>
                            )}
                            {e.postmortem && (
                              <div className="col-span-2">
                                <div className="font-semibold text-gray-700 mb-1">Postmortem</div>
                                <div className="bg-white rounded p-2 border border-gray-200">{e.postmortem}</div>
                              </div>
                            )}
                            {e.outcome.status === 'settled' && (
                              <div className="col-span-2">
                                <div className="font-semibold text-gray-700 mb-1">Outcome</div>
                                <div>Result: {e.outcome.settledResult || '—'}</div>
                                <div>P&L: {fmtUSD(e.outcome.pnlCents || 0)}</div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Settle Modal */}
      {settleId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Settle Journal Entry</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Result</label>
              <select value={settleResult} onChange={e => setSettleResult(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
                <option value="">Select...</option>
                <option value="win">Win</option>
                <option value="loss">Loss</option>
                <option value="push">Push</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">P&L (dollars)</label>
              <input type="number" step="0.01" value={settlePnl} onChange={e => setSettlePnl(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm" placeholder="e.g. 5.00 or -3.50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Postmortem (optional)</label>
              <textarea value={settlePostmortem} onChange={e => setSettlePostmortem(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm" rows={3} placeholder="What happened? Was the process good?" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setSettleId(null)} className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={handleSettle} disabled={!settleResult} className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">Settle</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
