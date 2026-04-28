import { useState, useEffect } from 'react';
import SystemNav from './SystemNav';

interface OperatorTask {
  id: string; category: string; priority: string; title: string;
  description: string; link?: string; status: string;
}
interface RepriceItem {
  id: string; title: string; type: string; liability: number;
  modelDrift: string; lopsidedPct: number; suggestedAction: string;
}
interface HedgeItem {
  id: string; title: string; ticker?: string; source: string;
  exposureCents: number; riskLevel: string; suggestedAction: string;
}
interface ReconcileItem {
  orderId: string; ticker: string; issue: string; severity: string;
  lastChecked: string; link: string; mode: string;
}
interface DailySummary {
  signalsToday: number; candidatesToday: number; ordersToday: number;
  fillsToday: number; realizedPnlToday: number;
  unresolvedDiscrepancies: number; openPositions: number;
  topWins: { ticker: string; pnlCents: number }[];
  topLosses: { ticker: string; pnlCents: number }[];
}
interface Overview {
  openTasks: number; criticalTasks: number; openPositions: number;
  unreconciledItems: number; todayRealizedPnl: number;
  todayOrders: number; topSignals: number; marketsNeedingReprice: number;
}
interface BucketBreakdown { key: string; count: number; avgEdge: number; avgSignalScore: number; }
interface Analytics {
  signals: { total: number; avgScore: number; avgEdge: number };
  candidates: { total: number; approved: number; blocked: number; sent: number };
  orders: { demoTotal: number; demoFilled: number; demoFillRate: number; liveTotal: number; liveFilled: number; liveFillRate: number };
  pnl: { realizedCents: number; unrealizedCostCents: number; netCents: number; winCount: number; lossCount: number; winRate: number };
  averages: { edgeAtEntry: number; signalScoreAtEntry: number };
  bySource: BucketBreakdown[]; byConfidence: BucketBreakdown[]; bySizingTier: BucketBreakdown[];
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-500',
};
const CAT_COLORS: Record<string, string> = {
  safety: 'bg-red-50 text-red-600',
  risk: 'bg-orange-50 text-orange-600',
  pricing: 'bg-purple-50 text-purple-600',
  execution: 'bg-blue-50 text-blue-600',
  reconciliation: 'bg-cyan-50 text-cyan-600',
  review: 'bg-gray-50 text-gray-600',
};

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

export default function OperatorDashboard() {
  const [tasks, setTasks] = useState<OperatorTask[]>([]);
  const [repriceQueue, setRepriceQueue] = useState<RepriceItem[]>([]);
  const [hedgeQueue, setHedgeQueue] = useState<HedgeItem[]>([]);
  const [reconcileQueue, setReconcileQueue] = useState<ReconcileItem[]>([]);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/operator-dashboard', { credentials: 'include' });
      if (!res.ok) { setError('Failed to load'); return; }
      const d = await res.json();
      setTasks(d.tasks || []);
      setRepriceQueue(d.repriceQueue || []);
      setHedgeQueue(d.hedgeQueue || []);
      setReconcileQueue(d.reconcileQueue || []);
      setDailySummary(d.dailySummary);
      setOverview(d.overview);
      setAnalytics(d.analytics);
    } catch (err: any) { setError(err?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const markDone = async (taskId: string) => {
    setActing(taskId);
    try {
      await fetch('/api/admin/operator-dashboard', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-task-done', taskId }),
      });
      fetchData();
    } catch {} finally { setActing(null); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading operator dashboard...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;

  const openTasks = tasks.filter(t => t.status === 'open');
  const doneTasks = tasks.filter(t => t.status === 'done');

  return (
    <div className="space-y-6">
      <SystemNav />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Operator Dashboard</h1>
        <div className="flex gap-3">
          <a href="/admin/system/desk-queue" className="text-sm font-semibold text-emerald-700 hover:underline">Open Desk Queue →</a>
          <a href="/admin/system/strategy-brief" className="text-sm text-blue-600 hover:underline">Strategy Brief</a>
          <a href="/admin/system/strategy-scorecard" className="text-sm text-blue-600 hover:underline">Scorecard</a>
          <a href="/admin/reports" className="text-sm text-blue-600 hover:underline">Reports</a>
          <a href="/admin/reconciliation" className="text-sm text-blue-600 hover:underline">Reconciliation</a>
          <a href="/admin/live-execution" className="text-sm text-blue-600 hover:underline">Live Execution</a>
          <a href="/admin/execution-control" className="text-sm text-blue-600 hover:underline">Execution Control</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
          <a href="/admin/signals" className="text-sm text-blue-600 hover:underline">Signals</a>
        </div>
      </div>

      {/* A. Top Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Open Tasks</div>
          <div className={`text-lg font-bold ${(overview?.openTasks || 0) > 0 ? 'text-blue-600' : 'text-green-600'}`}>{overview?.openTasks || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Critical</div>
          <div className={`text-lg font-bold ${(overview?.criticalTasks || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>{overview?.criticalTasks || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Open Positions</div>
          <div className="text-lg font-bold text-blue-600">{overview?.openPositions || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Unreconciled</div>
          <div className={`text-lg font-bold ${(overview?.unreconciledItems || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>{overview?.unreconciledItems || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Today P&L</div>
          <div className={`text-lg font-bold ${(overview?.todayRealizedPnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(overview?.todayRealizedPnl || 0)}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Today Orders</div>
          <div className="text-lg font-bold text-gray-900">{overview?.todayOrders || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Signals</div>
          <div className="text-lg font-bold text-blue-600">{overview?.topSignals || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Need Reprice</div>
          <div className={`text-lg font-bold ${(overview?.marketsNeedingReprice || 0) > 0 ? 'text-amber-600' : 'text-green-600'}`}>{overview?.marketsNeedingReprice || 0}</div>
        </div>
      </div>

      {/* Strategy Analytics Summary */}
      {analytics && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Strategy Analytics</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Total Signals</div>
              <div className="text-sm font-bold">{analytics.signals.total}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Avg Signal Score</div>
              <div className="text-sm font-bold">{analytics.signals.avgScore.toFixed(1)}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Avg Edge</div>
              <div className="text-sm font-bold">{(analytics.signals.avgEdge * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Candidates</div>
              <div className="text-sm font-bold">{analytics.candidates.total} ({analytics.candidates.approved} approved)</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Demo Fill Rate</div>
              <div className="text-sm font-bold">{(analytics.orders.demoFillRate * 100).toFixed(0)}% ({analytics.orders.demoFilled}/{analytics.orders.demoTotal})</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Live Fill Rate</div>
              <div className="text-sm font-bold">{(analytics.orders.liveFillRate * 100).toFixed(0)}% ({analytics.orders.liveFilled}/{analytics.orders.liveTotal})</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Realized P&L</div>
              <div className={`text-sm font-bold ${analytics.pnl.realizedCents >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(analytics.pnl.realizedCents)}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Win Rate</div>
              <div className="text-sm font-bold">{(analytics.pnl.winRate * 100).toFixed(0)}% ({analytics.pnl.winCount}W/{analytics.pnl.lossCount}L)</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Avg Edge at Entry</div>
              <div className="text-sm font-bold">{(analytics.averages.edgeAtEntry * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Avg Score at Entry</div>
              <div className="text-sm font-bold">{analytics.averages.signalScoreAtEntry.toFixed(1)}</div>
            </div>
          </div>
          {analytics.bySource.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-gray-500 mb-1">By Source</div>
              <div className="flex gap-2 flex-wrap">
                {analytics.bySource.map(b => (
                  <span key={b.key} className="text-xs bg-gray-100 rounded px-2 py-1">
                    {b.key}: {b.count} | edge {(b.avgEdge * 100).toFixed(1)}% | score {b.avgSignalScore.toFixed(0)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* B. Morning Checklist */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Morning Checklist ({openTasks.length} open / {doneTasks.length} done)</h2>
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className={`flex items-start gap-3 rounded border px-3 py-2 ${t.status === 'done' ? 'border-green-100 bg-green-50/30 opacity-60' : 'border-gray-100'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_COLORS[t.priority] || ''}`}>{t.priority}</span>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${CAT_COLORS[t.category] || ''}`}>{t.category}</span>
                  <span className="text-sm font-medium text-gray-900">{t.title}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">{t.description}</div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {t.link && (
                  <a href={t.link} className="rounded bg-gray-100 px-2 py-1 text-xs text-blue-600 hover:bg-gray-200">Go</a>
                )}
                {t.status === 'open' && (
                  <button onClick={() => markDone(t.id)} disabled={acting === t.id}
                    className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50">
                    {acting === t.id ? '...' : 'Done'}
                  </button>
                )}
                {t.status === 'done' && (
                  <span className="text-xs text-green-600 font-semibold px-2 py-1">Done</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* C. Reprice Queue */}
      {repriceQueue.length > 0 && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Reprice Queue ({repriceQueue.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Liability</th>
                  <th className={thClass}>Model Drift</th>
                  <th className={thClass}>Lopsided %</th>
                  <th className={thClass}>Suggested</th>
                </tr>
              </thead>
              <tbody>
                {repriceQueue.map(r => (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className={`${tdClass} font-medium`}>{r.title}</td>
                    <td className={`${tdClass} text-xs`}>{r.type}</td>
                    <td className={`${tdClass} font-mono`}>{fmtUSD(r.liability)}</td>
                    <td className={`${tdClass} text-xs`}>{r.modelDrift}</td>
                    <td className={`${tdClass} font-mono`}>{r.lopsidedPct.toFixed(0)}%</td>
                    <td className={`${tdClass} text-xs font-semibold text-amber-600`}>{r.suggestedAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* D. Hedge Queue */}
      {hedgeQueue.length > 0 && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Hedge Queue ({hedgeQueue.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Title / Ticker</th>
                  <th className={thClass}>Source</th>
                  <th className={thClass}>Exposure</th>
                  <th className={thClass}>Risk Level</th>
                  <th className={thClass}>Suggested</th>
                </tr>
              </thead>
              <tbody>
                {hedgeQueue.map(h => (
                  <tr key={h.id} className="border-b border-gray-50">
                    <td className={`${tdClass} font-medium`}>{h.title}{h.ticker ? ` (${h.ticker})` : ''}</td>
                    <td className={`${tdClass} text-xs`}>{h.source}</td>
                    <td className={`${tdClass} font-mono`}>{fmtUSD(h.exposureCents)}</td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${h.riskLevel === 'critical' ? 'bg-red-100 text-red-700' : h.riskLevel === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'}`}>{h.riskLevel}</span>
                    </td>
                    <td className={`${tdClass} text-xs font-semibold text-orange-600`}>{h.suggestedAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* E. Reconcile Queue */}
      {reconcileQueue.length > 0 && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-red-700">Reconcile Queue ({reconcileQueue.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Ticker</th>
                  <th className={thClass}>Mode</th>
                  <th className={thClass}>Issue</th>
                  <th className={thClass}>Severity</th>
                  <th className={thClass}>Last Checked</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {reconcileQueue.map(r => (
                  <tr key={`${r.mode}:${r.orderId}`} className="border-b border-gray-50 bg-red-50/20">
                    <td className={`${tdClass} font-mono text-xs`}>{r.ticker}</td>
                    <td className={`${tdClass} text-xs font-semibold ${r.mode === 'live' ? 'text-red-600' : 'text-yellow-600'}`}>{r.mode}</td>
                    <td className={`${tdClass} text-xs max-w-[200px] truncate`}>{r.issue}</td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${r.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{r.severity}</span>
                    </td>
                    <td className={`${tdClass} text-xs whitespace-nowrap`}>{formatET(r.lastChecked)}</td>
                    <td className={tdClass}>
                      <a href={r.link} className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700">View</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* F. End-of-Day Summary */}
      {dailySummary && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Daily Summary</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Signals</div>
              <div className="text-sm font-bold">{dailySummary.signalsToday}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Candidates</div>
              <div className="text-sm font-bold">{dailySummary.candidatesToday}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Orders</div>
              <div className="text-sm font-bold">{dailySummary.ordersToday}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Fills</div>
              <div className="text-sm font-bold">{dailySummary.fillsToday}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Realized P&L</div>
              <div className={`text-sm font-bold ${dailySummary.realizedPnlToday >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(dailySummary.realizedPnlToday)}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Open Positions</div>
              <div className="text-sm font-bold">{dailySummary.openPositions}</div>
            </div>
            <div className="rounded border border-gray-100 p-2">
              <div className="text-xs text-gray-500">Unresolved</div>
              <div className={`text-sm font-bold ${dailySummary.unresolvedDiscrepancies > 0 ? 'text-red-600' : 'text-green-600'}`}>{dailySummary.unresolvedDiscrepancies}</div>
            </div>
          </div>
          {(dailySummary.topWins.length > 0 || dailySummary.topLosses.length > 0) && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {dailySummary.topWins.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-green-600 mb-1">Top Wins</div>
                  {dailySummary.topWins.map((w, i) => (
                    <div key={i} className="text-xs text-gray-700">{w.ticker}: <span className="font-mono text-green-600">{fmtUSD(w.pnlCents)}</span></div>
                  ))}
                </div>
              )}
              {dailySummary.topLosses.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-red-600 mb-1">Top Losses</div>
                  {dailySummary.topLosses.map((l, i) => (
                    <div key={i} className="text-xs text-gray-700">{l.ticker}: <span className="font-mono text-red-600">{fmtUSD(l.pnlCents)}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
