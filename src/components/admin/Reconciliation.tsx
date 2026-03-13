import { useState, useEffect } from 'react';

interface ReconciliationRecord {
  orderId: string; mode: 'demo' | 'live'; ticker: string; title: string;
  localStatus: string; remoteStatus?: string; reconciled: boolean;
  discrepancies: string[]; checkedAt: string; reviewed?: boolean;
}
interface Position {
  id: string; source: string; ticker: string; title: string; side: string;
  contracts: number; avgEntryPrice: number; notionalCents: number;
  status: string; openedAt: string; closedAt?: string;
  realizedPnlCents: number; unrealizedPnlCents: number; orderIds: string[];
}
interface PositionSummary {
  totalPositions: number; openPositions: number; closedPositions: number;
  totalRealizedPnlCents: number; totalUnrealizedPnlCents: number; totalNotionalCents: number;
}
interface LedgerEntry {
  id: string; createdAt: string; source: string; type: string;
  orderId?: string; ticker?: string; side?: string;
  amountCents: number; realized: boolean; notes?: string;
}
interface LedgerSummary {
  totalEntries: number; realizedPnlCents: number; unrealizedCostCents: number; netPnlCents: number;
  bySource: Record<string, { entries: number; totalCents: number }>;
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

function fmtUSD(cents: number): string {
  const neg = cents < 0;
  return `${neg ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

const TYPE_COLORS: Record<string, string> = {
  fill: 'bg-blue-100 text-blue-700',
  settlement: 'bg-green-100 text-green-700',
  cancel: 'bg-gray-100 text-gray-500',
  mark: 'bg-purple-100 text-purple-700',
  adjustment: 'bg-yellow-100 text-yellow-700',
};

export default function Reconciliation() {
  const [reconRecords, setReconRecords] = useState<ReconciliationRecord[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [posSummary, setPosSummary] = useState<PositionSummary | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummary | null>(null);
  const [unreconciledCount, setUnreconciledCount] = useState(0);
  const [orderCounts, setOrderCounts] = useState<{ demo: number; live: number }>({ demo: 0, live: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/reconciliation', { credentials: 'include' });
      if (!res.ok) { setError('Failed to load'); return; }
      const d = await res.json();
      setReconRecords(d.reconRecords || []);
      setPositions(d.positions || []);
      setPosSummary(d.positionSummary);
      setLedgerEntries(d.ledgerEntries || []);
      setLedgerSummary(d.ledgerSummary);
      setUnreconciledCount(d.unreconciledCount || 0);
      setOrderCounts(d.orderCounts || { demo: 0, live: 0 });
    } catch (err: any) { setError(err?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const doPost = async (action: string, extra: any = {}) => {
    setActing(action);
    try {
      await fetch('/api/admin/reconciliation', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      fetchData();
    } catch {} finally { setActing(null); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading reconciliation...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;

  const discrepancies = reconRecords.filter(r => !r.reconciled && !r.reviewed);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reconciliation & P&L</h1>
        <div className="flex gap-3">
          <a href="/admin/reports" className="text-sm text-blue-600 hover:underline">Reports</a>
          <a href="/admin/operator-dashboard" className="text-sm text-blue-600 hover:underline">Operator</a>
          <a href="/admin/live-execution" className="text-sm text-blue-600 hover:underline">Live Execution</a>
          <a href="/admin/demo-execution" className="text-sm text-blue-600 hover:underline">Demo Execution</a>
          <a href="/admin/execution-control" className="text-sm text-blue-600 hover:underline">Execution Control</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
        </div>
      </div>

      {/* A. Overview Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Live Orders</div>
          <div className="text-lg font-bold text-gray-900">{orderCounts.live}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Demo Orders</div>
          <div className="text-lg font-bold text-gray-900">{orderCounts.demo}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Open Positions</div>
          <div className="text-lg font-bold text-blue-600">{posSummary?.openPositions || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Realized P&L</div>
          <div className={`text-lg font-bold ${(ledgerSummary?.realizedPnlCents || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {fmtUSD(ledgerSummary?.realizedPnlCents || 0)}
          </div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Unrealized Cost</div>
          <div className="text-lg font-bold text-gray-600">{fmtUSD(ledgerSummary?.unrealizedCostCents || 0)}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Unreconciled</div>
          <div className={`text-lg font-bold ${unreconciledCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{unreconciledCount}</div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 flex-wrap">
        <button onClick={() => doPost('refresh-all-safe')} disabled={acting !== null}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {acting === 'refresh-all-safe' ? 'Reconciling...' : 'Reconcile All Orders'}
        </button>
        <button onClick={() => doPost('rebuild-positions')} disabled={acting !== null}
          className="rounded bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
          {acting === 'rebuild-positions' ? 'Building...' : 'Rebuild Positions'}
        </button>
        <button onClick={() => doPost('rebuild-ledger')} disabled={acting !== null}
          className="rounded bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
          {acting === 'rebuild-ledger' ? 'Building...' : 'Rebuild Ledger'}
        </button>
      </div>

      {/* E. Discrepancy Panel */}
      {discrepancies.length > 0 && (
        <div className={`${cardClass} border-red-200 bg-red-50`}>
          <h2 className="mb-3 text-sm font-semibold text-red-700">Discrepancies ({discrepancies.length})</h2>
          <div className="space-y-2">
            {discrepancies.map(r => (
              <div key={`${r.mode}:${r.orderId}`} className="rounded bg-white px-3 py-2 text-sm border border-red-200 flex items-start justify-between">
                <div>
                  <div className="font-medium text-red-700">
                    <span className="text-xs font-mono bg-gray-100 px-1 rounded mr-1">{r.mode}</span>
                    {r.ticker} — {r.title}
                  </div>
                  <div className="text-xs text-red-600 mt-1">
                    {r.discrepancies.join('; ')}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Local: {r.localStatus} | Remote: {r.remoteStatus || '—'} | {formatET(r.checkedAt)}
                  </div>
                </div>
                <div className="flex gap-1 ml-2 flex-shrink-0">
                  <button onClick={() => doPost('refresh-order', { orderId: r.orderId, mode: r.mode })}
                    disabled={acting !== null}
                    className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">Refresh</button>
                  <button onClick={() => doPost('mark-reviewed', { orderId: r.orderId, mode: r.mode })}
                    disabled={acting !== null}
                    className="rounded bg-gray-500 px-2 py-1 text-xs text-white hover:bg-gray-600 disabled:opacity-50">Reviewed</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* B. Reconciliation Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Reconciliation Records ({reconRecords.length})</h2>
        {reconRecords.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No reconciliation records. Click "Reconcile All Orders" to start.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Ticker</th>
                  <th className={thClass}>Mode</th>
                  <th className={thClass}>Local</th>
                  <th className={thClass}>Remote</th>
                  <th className={thClass}>Reconciled</th>
                  <th className={thClass}>Discrepancies</th>
                  <th className={thClass}>Checked</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {reconRecords.map(r => (
                  <tr key={`${r.mode}:${r.orderId}`} className={`border-b border-gray-50 ${!r.reconciled && !r.reviewed ? 'bg-red-50/30' : ''}`}>
                    <td className={`${tdClass} font-mono text-xs`}>{r.ticker}</td>
                    <td className={tdClass}>
                      <span className={`text-xs font-semibold ${r.mode === 'live' ? 'text-red-600' : 'text-yellow-600'}`}>{r.mode}</span>
                    </td>
                    <td className={`${tdClass} text-xs`}>{r.localStatus}</td>
                    <td className={`${tdClass} text-xs`}>{r.remoteStatus || '—'}</td>
                    <td className={tdClass}>
                      <span className={`text-xs font-semibold ${r.reconciled ? 'text-green-600' : r.reviewed ? 'text-gray-500' : 'text-red-600'}`}>
                        {r.reconciled ? 'YES' : r.reviewed ? 'REVIEWED' : 'NO'}
                      </span>
                    </td>
                    <td className={`${tdClass} text-xs max-w-[200px] truncate`}>{r.discrepancies.join('; ') || '—'}</td>
                    <td className={`${tdClass} text-xs whitespace-nowrap`}>{formatET(r.checkedAt)}</td>
                    <td className={tdClass}>
                      <button onClick={() => doPost('refresh-order', { orderId: r.orderId, mode: r.mode })}
                        disabled={acting !== null}
                        className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">Refresh</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* C. Positions Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Positions ({positions.length})</h2>
        {positions.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No positions. Click "Rebuild Positions" after orders have been filled.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Ticker</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Source</th>
                  <th className={thClass}>Side</th>
                  <th className={thClass}>Contracts</th>
                  <th className={thClass}>Avg Entry</th>
                  <th className={thClass}>Notional</th>
                  <th className={thClass}>Realized P&L</th>
                  <th className={thClass}>Unrealized P&L</th>
                  <th className={thClass}>Status</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.id} className={`border-b border-gray-50 ${p.status === 'closed' ? 'opacity-60' : ''}`}>
                    <td className={`${tdClass} font-mono text-xs`}>{p.ticker}</td>
                    <td className={`${tdClass} max-w-[160px] truncate`}>{p.title}</td>
                    <td className={tdClass}>
                      <span className={`text-xs font-semibold ${p.source === 'kalshi-live' ? 'text-red-600' : 'text-yellow-600'}`}>{p.source}</span>
                    </td>
                    <td className={tdClass}>{p.side}</td>
                    <td className={`${tdClass} font-mono`}>{p.contracts}</td>
                    <td className={`${tdClass} font-mono`}>{p.avgEntryPrice}¢</td>
                    <td className={`${tdClass} font-mono`}>{fmtUSD(p.notionalCents)}</td>
                    <td className={`${tdClass} font-mono ${p.realizedPnlCents >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmtUSD(p.realizedPnlCents)}
                    </td>
                    <td className={`${tdClass} font-mono`}>{fmtUSD(p.unrealizedPnlCents)}</td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${p.status === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* D. Ledger Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">P&L Ledger ({ledgerEntries.length})</h2>
        {ledgerEntries.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No ledger entries. Click "Rebuild Ledger" after orders have been filled.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Time</th>
                  <th className={thClass}>Source</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Ticker</th>
                  <th className={thClass}>Amount</th>
                  <th className={thClass}>Realized</th>
                  <th className={thClass}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {ledgerEntries.map(e => (
                  <tr key={e.id} className="border-b border-gray-50">
                    <td className={`${tdClass} text-xs whitespace-nowrap`}>{formatET(e.createdAt)}</td>
                    <td className={tdClass}>
                      <span className={`text-xs font-semibold ${e.source === 'live' ? 'text-red-600' : 'text-yellow-600'}`}>{e.source}</span>
                    </td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_COLORS[e.type] || ''}`}>{e.type}</span>
                    </td>
                    <td className={`${tdClass} font-mono text-xs`}>{e.ticker || '—'}</td>
                    <td className={`${tdClass} font-mono ${e.amountCents >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmtUSD(e.amountCents)}
                    </td>
                    <td className={tdClass}>
                      <span className={`text-xs font-semibold ${e.realized ? 'text-green-600' : 'text-gray-400'}`}>
                        {e.realized ? 'YES' : 'NO'}
                      </span>
                    </td>
                    <td className={`${tdClass} text-xs max-w-[200px] truncate`}>{e.notes || '—'}</td>
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
