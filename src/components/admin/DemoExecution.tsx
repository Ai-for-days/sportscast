import { useState, useEffect } from 'react';

interface ExecutionConfig { mode: string; demoTradingEnabled: boolean; killSwitchEnabled: boolean; requireApproval: boolean; }
interface RiskCheck { name: string; passed: boolean; message: string; }
interface PreTradeRiskResult { allowed: boolean; checks: RiskCheck[]; reason?: string; }
interface DryRunOrder { source: string; mode: string; ticker: string; title: string; side: string; price: number; quantity: number; maxNotionalCents: number; pretradeRisk: PreTradeRiskResult; ready: boolean; }

interface Candidate {
  id: string; signalId: string; source: string; ticker: string; title: string; side: string;
  signalScore: number; edge: number; confidence: string; sizingTier: string;
  recommendedStakeCents: number; state: string; dryRunOrder?: DryRunOrder; riskResult?: PreTradeRiskResult;
}

interface DemoOrder {
  id: string; candidateId: string; createdAt: string; ticker: string; title: string;
  side: string; action: string; price: number; quantity: number;
  clientOrderId: string; kalshiOrderId?: string;
  status: string; errorMessage?: string; fillData?: any;
}

interface Summary { approvedCount: number; submittedCount: number; openCount: number; filledCount: number; failedCount: number; cancelledCount: number; }

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  open: 'bg-blue-100 text-blue-700',
  filled: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  failed: 'bg-red-100 text-red-700',
};

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

export default function DemoExecution() {
  const [config, setConfig] = useState<ExecutionConfig | null>(null);
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/demo-execution', { credentials: 'include' });
      if (!res.ok) { setError('Failed to load'); return; }
      const d = await res.json();
      setConfig(d.config);
      setOrders(d.orders || []);
      setCandidates(d.approvedCandidates || []);
      setSummary(d.summary);
    } catch (err: any) { setError(err?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const doSubmit = async (candidateId: string) => {
    setActing(candidateId);
    try {
      const res = await fetch('/api/admin/demo-execution', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', candidateId }),
      });
      const d = await res.json();
      if (!res.ok && d.order?.status === 'failed') {
        alert(`Blocked: ${d.order.errorMessage}`);
      }
      fetchData();
    } catch {} finally { setActing(null); }
  };

  const doCancel = async (orderId: string) => {
    setActing(orderId);
    try {
      await fetch('/api/admin/demo-execution', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', orderId }),
      });
      fetchData();
    } catch {} finally { setActing(null); }
  };

  const doRefresh = async (orderId: string) => {
    setActing(orderId);
    try {
      await fetch('/api/admin/demo-execution', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh', orderId }),
      });
      fetchData();
    } catch {} finally { setActing(null); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading demo execution...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;

  const demoReady = config && config.mode === 'demo' && config.demoTradingEnabled && !config.killSwitchEnabled;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Demo Execution</h1>
        <div className="flex gap-3">
          <a href="/admin/execution-control" className="text-sm text-blue-600 hover:underline">Execution Control</a>
          <a href="/admin/execution-candidates" className="text-sm text-blue-600 hover:underline">Candidates</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
        </div>
      </div>

      {/* Kill Switch Banner */}
      {config?.killSwitchEnabled && (
        <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-center">
          <div className="text-lg font-bold text-red-700">KILL SWITCH ACTIVE</div>
          <div className="text-sm text-red-600 mt-1">All demo execution is blocked.</div>
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Mode</div>
          <div className={`text-lg font-bold ${config?.mode === 'demo' ? 'text-yellow-600' : 'text-gray-400'}`}>{config?.mode?.toUpperCase()}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Demo Trading</div>
          <div className={`text-lg font-bold ${config?.demoTradingEnabled ? 'text-green-600' : 'text-gray-400'}`}>{config?.demoTradingEnabled ? 'ON' : 'OFF'}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Kill Switch</div>
          <div className={`text-lg font-bold ${config?.killSwitchEnabled ? 'text-red-600' : 'text-green-600'}`}>{config?.killSwitchEnabled ? 'ACTIVE' : 'OFF'}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Approved</div>
          <div className="text-lg font-bold text-blue-600">{summary?.approvedCount || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Submitted</div>
          <div className="text-lg font-bold text-gray-900">{summary?.submittedCount || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Open</div>
          <div className="text-lg font-bold text-blue-600">{summary?.openCount || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Filled</div>
          <div className="text-lg font-bold text-green-600">{summary?.filledCount || 0}</div>
        </div>
      </div>

      {/* Not Ready Warning */}
      {!demoReady && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Demo execution is not ready. Ensure mode is "demo", demo trading is enabled, and kill switch is off.
          <a href="/admin/execution-control" className="ml-2 text-amber-700 underline">Configure</a>
        </div>
      )}

      {/* Approved Candidates */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Approved Candidates ({candidates.length})</h2>
        {candidates.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No approved candidates. Approve candidates from <a href="/admin/execution-candidates" className="text-blue-600 underline">Execution Candidates</a>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Ticker</th>
                  <th className={thClass}>Side</th>
                  <th className={thClass}>Score</th>
                  <th className={thClass}>Edge</th>
                  <th className={thClass}>Stake</th>
                  <th className={thClass}>Risk</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={`${tdClass} font-medium max-w-[180px] truncate`}>{c.title}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{c.ticker}</td>
                    <td className={tdClass}>{c.side}</td>
                    <td className={`${tdClass} font-mono font-bold`}>{c.signalScore}</td>
                    <td className={`${tdClass} font-mono`}>{(c.edge * 100).toFixed(1)}%</td>
                    <td className={`${tdClass} font-mono`}>{fmtUSD(c.recommendedStakeCents)}</td>
                    <td className={tdClass}>
                      <span className={`text-xs font-semibold ${c.riskResult?.allowed ? 'text-green-600' : 'text-red-600'}`}>
                        {c.riskResult?.allowed ? 'PASS' : 'FAIL'}
                      </span>
                    </td>
                    <td className={tdClass}>
                      <button
                        onClick={() => doSubmit(c.id)}
                        disabled={acting === c.id || !demoReady}
                        className="rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-white hover:bg-yellow-700 disabled:opacity-50 whitespace-nowrap"
                      >{acting === c.id ? 'Sending...' : 'Send to Demo'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Demo Orders */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Demo Orders ({orders.length})</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No demo orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Time</th>
                  <th className={thClass}>Ticker</th>
                  <th className={thClass}>Side</th>
                  <th className={thClass}>Price</th>
                  <th className={thClass}>Qty</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Kalshi ID</th>
                  <th className={thClass}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className={`border-b border-gray-50 ${o.status === 'failed' ? 'bg-red-50' : ''}`}>
                    <td className={`${tdClass} text-xs whitespace-nowrap`}>{formatET(o.createdAt)}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{o.ticker}</td>
                    <td className={tdClass}>{o.side}</td>
                    <td className={`${tdClass} font-mono`}>{o.price}¢</td>
                    <td className={tdClass}>{o.quantity}</td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[o.status] || ''}`}>{o.status}</span>
                    </td>
                    <td className={`${tdClass} font-mono text-xs`}>{o.kalshiOrderId || '—'}</td>
                    <td className={tdClass}>
                      <div className="flex gap-1">
                        {(o.status === 'open' || o.status === 'pending') && (
                          <>
                            <button onClick={() => doRefresh(o.id)} disabled={acting === o.id}
                              className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">Refresh</button>
                            <button onClick={() => doCancel(o.id)} disabled={acting === o.id}
                              className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50">Cancel</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Failed/Error Panel */}
      {orders.filter(o => o.status === 'failed').length > 0 && (
        <div className={`${cardClass} border-red-200 bg-red-50`}>
          <h2 className="mb-3 text-sm font-semibold text-red-700">Failed Orders</h2>
          <div className="space-y-2">
            {orders.filter(o => o.status === 'failed').map(o => (
              <div key={o.id} className="rounded bg-white px-3 py-2 text-sm border border-red-200">
                <div className="font-medium text-red-700">{o.title || o.ticker}</div>
                <div className="text-xs text-red-600 mt-1">{o.errorMessage || 'Unknown error'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
