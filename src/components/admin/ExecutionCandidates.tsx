import { useState, useEffect } from 'react';

interface RiskCheck { name: string; passed: boolean; message: string; }
interface PreTradeRiskResult { allowed: boolean; checks: RiskCheck[]; reason?: string; }
interface DryRunOrder { source: string; mode: string; ticker: string; title: string; side: string; price: number; quantity: number; maxNotionalCents: number; pretradeRisk: PreTradeRiskResult; ready: boolean; }

interface ExecutionCandidate {
  id: string; createdAt: string; updatedAt: string;
  signalId: string; source: string; ticker: string; title: string; side: string;
  signalScore: number; edge: number; confidence: string; sizingTier: string;
  recommendedStakeCents: number; locationName?: string; metric?: string; targetDate?: string;
  state: string; dryRunOrder?: DryRunOrder; riskResult?: PreTradeRiskResult;
  blockReason?: string; notes?: string;
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const STATE_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  candidate: 'bg-blue-100 text-blue-700',
  blocked: 'bg-red-100 text-red-700',
  approved: 'bg-green-100 text-green-700',
  sent: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-gray-100 text-gray-400',
};

const TIER_COLORS: Record<string, string> = { large: 'bg-green-100 text-green-700', medium: 'bg-blue-100 text-blue-700', small: 'bg-yellow-100 text-yellow-700' };

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ExecutionCandidates() {
  const [candidates, setCandidates] = useState<ExecutionCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/execution-candidates', { credentials: 'include' });
      if (!res.ok) { setError('Failed to load'); return; }
      const d = await res.json();
      setCandidates(d.candidates || []);
    } catch (err: any) { setError(err?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const doAction = async (id: string, action: string) => {
    setActing(id);
    try {
      await fetch('/api/admin/execution-candidates', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      });
      fetchData();
    } catch {} finally { setActing(null); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading candidates...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;

  const active = candidates.filter(c => c.state !== 'cancelled' && c.state !== 'sent');
  const history = candidates.filter(c => c.state === 'cancelled' || c.state === 'sent');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Execution Candidates</h1>
        <div className="flex gap-3">
          <a href="/admin/execution-control" className="text-sm text-blue-600 hover:underline">Execution Control</a>
          <a href="/admin/signals" className="text-sm text-blue-600 hover:underline">Signals</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
        </div>
      </div>

      {/* Active Candidates */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Active Candidates ({active.length})</h2>
        {active.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No active candidates. Promote signals from /admin/signals or /admin/portfolio.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Source</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Score</th>
                  <th className={thClass}>Edge</th>
                  <th className={thClass}>Tier</th>
                  <th className={thClass}>Stake</th>
                  <th className={thClass}>State</th>
                  <th className={thClass}>Risk</th>
                  <th className={thClass}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.map(c => (
                  <>
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                      <td className={tdClass}>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${c.source === 'kalshi' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{c.source}</span>
                      </td>
                      <td className={`${tdClass} font-medium max-w-[180px] truncate`}>{c.title}</td>
                      <td className={`${tdClass} font-mono font-bold`}>{c.signalScore}</td>
                      <td className={`${tdClass} font-mono`}>{(c.edge * 100).toFixed(1)}%</td>
                      <td className={tdClass}>
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${TIER_COLORS[c.sizingTier] || 'bg-gray-100 text-gray-500'}`}>{c.sizingTier}</span>
                      </td>
                      <td className={`${tdClass} font-mono`}>{fmtUSD(c.recommendedStakeCents)}</td>
                      <td className={tdClass}>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_COLORS[c.state]}`}>{c.state}</span>
                      </td>
                      <td className={tdClass}>
                        {c.riskResult ? (
                          <span className={`text-xs font-semibold ${c.riskResult.allowed ? 'text-green-600' : 'text-red-600'}`}>
                            {c.riskResult.allowed ? 'PASS' : 'FAIL'}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={tdClass}>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          {c.state === 'candidate' && (
                            <button onClick={() => doAction(c.id, 'approve')} disabled={acting === c.id}
                              className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50">Approve</button>
                          )}
                          {(c.state === 'candidate' || c.state === 'draft') && (
                            <button onClick={() => doAction(c.id, 'block')} disabled={acting === c.id}
                              className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50">Block</button>
                          )}
                          {c.state !== 'cancelled' && (
                            <button onClick={() => doAction(c.id, 'cancel')} disabled={acting === c.id}
                              className="rounded bg-gray-500 px-2 py-1 text-xs text-white hover:bg-gray-600 disabled:opacity-50">Cancel</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === c.id && (
                      <tr key={`${c.id}-detail`} className="bg-gray-50">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <div className="font-semibold text-gray-700 mb-1">Signal Details</div>
                              <div>Signal ID: <span className="font-mono">{c.signalId}</span></div>
                              {c.locationName && <div>Location: {c.locationName}</div>}
                              {c.metric && <div>Metric: {c.metric}</div>}
                              {c.targetDate && <div>Target: {c.targetDate}</div>}
                              <div>Side: {c.side}</div>
                              <div>Confidence: {c.confidence}</div>
                            </div>
                            <div>
                              <div className="font-semibold text-gray-700 mb-1">Dry-Run Order</div>
                              {c.dryRunOrder ? (
                                <>
                                  <div>Mode: <span className="font-mono">{c.dryRunOrder.mode}</span></div>
                                  <div>Price: {c.dryRunOrder.price}¢</div>
                                  <div>Notional: {fmtUSD(c.dryRunOrder.maxNotionalCents)}</div>
                                  <div>Ready: <span className={c.dryRunOrder.ready ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{c.dryRunOrder.ready ? 'YES' : 'NO'}</span></div>
                                </>
                              ) : <div className="text-gray-400">No dry-run order</div>}
                            </div>
                            {c.riskResult && (
                              <div className="col-span-2">
                                <div className="font-semibold text-gray-700 mb-1">Risk Checks</div>
                                <div className="space-y-1">
                                  {c.riskResult.checks.map((ch, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                      <span className={`inline-block w-2 h-2 rounded-full ${ch.passed ? 'bg-green-500' : 'bg-red-500'}`} />
                                      <span className="font-mono text-xs">{ch.name}</span>
                                      <span className="text-gray-500">{ch.message}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {c.blockReason && (
                              <div className="col-span-2">
                                <div className="font-semibold text-red-700 mb-1">Block Reason</div>
                                <div className="bg-red-50 rounded p-2 border border-red-200 text-red-700">{c.blockReason}</div>
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

      {/* History */}
      {history.length > 0 && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">History ({history.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Source</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Score</th>
                  <th className={thClass}>State</th>
                  <th className={thClass}>Stake</th>
                </tr>
              </thead>
              <tbody>
                {history.map(c => (
                  <tr key={c.id} className="border-b border-gray-50">
                    <td className={tdClass}><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${c.source === 'kalshi' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{c.source}</span></td>
                    <td className={`${tdClass} font-medium`}>{c.title}</td>
                    <td className={`${tdClass} font-mono`}>{c.signalScore}</td>
                    <td className={tdClass}><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_COLORS[c.state]}`}>{c.state}</span></td>
                    <td className={`${tdClass} font-mono`}>{fmtUSD(c.recommendedStakeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
