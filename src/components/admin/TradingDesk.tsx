import { useState, useEffect } from 'react';

interface Overview {
  openMarkets: number;
  lockedMarkets: number;
  gradedMarkets: number;
  totalHandle: number;
  largestLiability: number;
  avgHold: number | null;
  snapshotCount: number;
}

interface OpenMarket {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  status: string;
  lockTime: string;
  targetDate: string;
  handle: number;
  liability: number;
  betCount: number;
  modelVsPosted: string;
  hasSnapshot: boolean;
}

interface AttentionItem {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  handle: number;
  liability: number;
  reasons: string[];
}

interface LineChange {
  changedAt: string;
  changedBy: string;
  marketType: string;
  summary: string;
  wagerId: string;
  wagerTitle: string;
  ticketNumber: string;
}

interface TradingDeskData {
  overview: Overview;
  openMarkets: OpenMarket[];
  attentionNeeded: AttentionItem[];
  recentLineChanges: LineChange[];
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const statLabel = 'text-xs text-gray-500';
const statValue = 'text-lg font-bold text-gray-900';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const KIND_LABELS: Record<string, string> = {
  'over-under': 'O/U',
  'odds': 'Range',
  'pointspread': 'Spread',
};

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return '—';
  return `${(n * 100).toFixed(1)}%`;
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
  } catch {
    return iso;
  }
}

interface HedgingSummary {
  highCriticalCount: number;
  topCandidates: { ticketNumber: string; title: string; riskLevel: string; recommendedAction: string; liability: number }[];
}

export default function TradingDesk() {
  const [data, setData] = useState<TradingDeskData | null>(null);
  const [hedging, setHedging] = useState<HedgingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [tdRes, hedgeRes] = await Promise.all([
          fetch('/api/admin/trading-desk', { credentials: 'include' }),
          fetch('/api/admin/hedging/recommendations', { credentials: 'include' }).catch(() => null),
        ]);
        if (!tdRes.ok) {
          const d = await tdRes.json().catch(() => ({}));
          setError(d.error || `Error ${tdRes.status}`);
          return;
        }
        setData(await tdRes.json());

        if (hedgeRes?.ok) {
          const hd = await hedgeRes.json();
          const recs = hd.recommendations || [];
          const highCritical = recs.filter((r: any) => r.riskLevel === 'high' || r.riskLevel === 'critical');
          setHedging({
            highCriticalCount: highCritical.length,
            topCandidates: highCritical.slice(0, 5).map((r: any) => ({
              ticketNumber: r.ticketNumber,
              title: r.title,
              riskLevel: r.riskLevel,
              recommendedAction: r.recommendedAction,
              liability: r.inputs.liability,
            })),
          });
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading trading desk...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;
  if (!data) return null;

  const { overview, openMarkets, attentionNeeded, recentLineChanges } = data;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Trading Desk</h1>
        <div className="flex gap-3">
          <a href="/admin/operator-dashboard" className="text-sm text-blue-600 hover:underline">Operator</a>
          <a href="/admin/reconciliation" className="text-sm text-blue-600 hover:underline">Reconciliation</a>
          <a href="/admin/live-readiness" className="text-sm text-blue-600 hover:underline">Live Readiness</a>
          <a href="/admin/execution-control" className="text-sm text-blue-600 hover:underline">Execution</a>
          <a href="/admin/execution-candidates" className="text-sm text-blue-600 hover:underline">Candidates</a>
          <a href="/admin/demo-execution" className="text-sm text-blue-600 hover:underline">Demo Execution</a>
          <a href="/admin/trade-journal" className="text-sm text-blue-600 hover:underline">Journal</a>
          <a href="/admin/backtesting" className="text-sm text-blue-600 hover:underline">Backtesting</a>
          <a href="/admin/signals" className="text-sm text-blue-600 hover:underline">Signals</a>
          <a href="/admin/portfolio" className="text-sm text-blue-600 hover:underline">Portfolio</a>
          <a href="/admin/kalshi-lab" className="text-sm text-blue-600 hover:underline">Kalshi Lab</a>
          <a href="/admin/wagers" className="text-sm text-blue-600 hover:underline">Wagers</a>
          <a href="/admin/pricing-lab" className="text-sm text-blue-600 hover:underline">Pricing Lab</a>
          <a href="/admin/market-performance" className="text-sm text-blue-600 hover:underline">Market Performance</a>
        </div>
      </div>

      {/* Monitor Navigation */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <a href="/admin/trading-desk/risk" className={`${cardClass} hover:border-red-300 hover:bg-red-50 transition-colors group`}>
          <div className="text-sm font-semibold text-red-700 group-hover:text-red-800">Risk Monitor</div>
          <div className="text-xs text-gray-500 mt-1">Portfolio risk, liability alerts, lopsided action, stale markets</div>
        </a>
        <a href="/admin/trading-desk/line-movement" className={`${cardClass} hover:border-blue-300 hover:bg-blue-50 transition-colors group`}>
          <div className="text-sm font-semibold text-blue-700 group-hover:text-blue-800">Line Movement Monitor</div>
          <div className="text-xs text-gray-500 mt-1">Line change feed, biggest movers, movement history</div>
        </a>
        <a href="/admin/trading-desk/closing-line" className={`${cardClass} hover:border-purple-300 hover:bg-purple-50 transition-colors group`}>
          <div className="text-sm font-semibold text-purple-700 group-hover:text-purple-800">Closing Line Intelligence</div>
          <div className="text-xs text-gray-500 mt-1">Opening vs closing drift, model accuracy, result analysis</div>
        </a>
        <a href="/admin/trading-desk/hedging" className={`${cardClass} hover:border-amber-300 hover:bg-amber-50 transition-colors group`}>
          <div className="text-sm font-semibold text-amber-700 group-hover:text-amber-800">Exposure Hedging</div>
          <div className="text-xs text-gray-500 mt-1">Hedge recommendations, risk actions, suggested line/odds changes</div>
        </a>
      </div>

      {/* A. Overview Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <div className={cardClass}>
          <div className={statLabel}>Open Markets</div>
          <div className={statValue}>{overview.openMarkets}</div>
        </div>
        <div className={cardClass}>
          <div className={statLabel}>Locked Markets</div>
          <div className={statValue}>{overview.lockedMarkets}</div>
        </div>
        <div className={cardClass}>
          <div className={statLabel}>Graded Markets</div>
          <div className={statValue}>{overview.gradedMarkets}</div>
        </div>
        <div className={cardClass}>
          <div className={statLabel}>Total Handle</div>
          <div className={statValue}>{fmtUSD(overview.totalHandle)}</div>
        </div>
        <div className={cardClass}>
          <div className={statLabel}>Largest Liability</div>
          <div className={`${statValue} ${overview.largestLiability > 0 ? 'text-red-600' : ''}`}>
            {fmtUSD(overview.largestLiability)}
          </div>
        </div>
        <div className={cardClass}>
          <div className={statLabel}>Avg Hold</div>
          <div className={statValue}>{fmtPct(overview.avgHold)}</div>
        </div>
        <div className={cardClass}>
          <div className={statLabel}>w/ Snapshots</div>
          <div className={statValue}>{overview.snapshotCount}</div>
        </div>
      </div>

      {/* C. Attention Needed */}
      {attentionNeeded.length > 0 && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-red-700">Attention Needed ({attentionNeeded.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Handle</th>
                  <th className={thClass}>Liability</th>
                  <th className={thClass}>Issues</th>
                </tr>
              </thead>
              <tbody>
                {attentionNeeded.map(item => (
                  <tr key={item.id} className="border-b border-gray-50">
                    <td className={`${tdClass} font-mono text-xs`}>{item.ticketNumber}</td>
                    <td className={`${tdClass} font-medium`}>{item.title}</td>
                    <td className={tdClass}>{KIND_LABELS[item.kind] || item.kind}</td>
                    <td className={tdClass}>{fmtUSD(item.handle)}</td>
                    <td className={`${tdClass} ${item.liability > 0 ? 'text-red-600 font-semibold' : ''}`}>{fmtUSD(item.liability)}</td>
                    <td className={tdClass}>
                      <div className="flex flex-wrap gap-1">
                        {item.reasons.map((r, i) => (
                          <span key={i} className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{r}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hedging Summary */}
      {hedging && hedging.highCriticalCount > 0 && (
        <div className={`${cardClass} border-amber-200 bg-amber-50`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-amber-800">
              Hedge Candidates ({hedging.highCriticalCount} high/critical)
            </h2>
            <a href="/admin/trading-desk/hedging" className="text-xs text-amber-700 hover:underline">
              View all recommendations →
            </a>
          </div>
          <div className="space-y-2">
            {hedging.topCandidates.map(c => (
              <div key={c.ticketNumber} className="flex items-center justify-between rounded bg-white px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                    c.riskLevel === 'critical' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                  }`}>{c.riskLevel.toUpperCase()}</span>
                  <span className="font-mono text-xs text-gray-500">{c.ticketNumber}</span>
                  <span className="font-medium text-gray-900 truncate max-w-[200px]">{c.title}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {c.recommendedAction.replace('_', ' ')}
                  </span>
                  <span className="text-xs font-semibold text-red-600">{fmtUSD(c.liability)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* B. Open Markets Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Open Markets ({openMarkets.length})</h2>
        {openMarkets.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No open markets.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Close</th>
                  <th className={thClass}>Bets</th>
                  <th className={thClass}>Handle</th>
                  <th className={thClass}>Liability</th>
                  <th className={thClass}>Model vs Posted</th>
                </tr>
              </thead>
              <tbody>
                {openMarkets.map(m => (
                  <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={`${tdClass} font-mono text-xs`}>{m.ticketNumber}</td>
                    <td className={`${tdClass} font-medium`}>{m.title}</td>
                    <td className={tdClass}>{KIND_LABELS[m.kind] || m.kind}</td>
                    <td className={`${tdClass} text-xs`}>{formatET(m.lockTime)}</td>
                    <td className={tdClass}>{m.betCount}</td>
                    <td className={tdClass}>{fmtUSD(m.handle)}</td>
                    <td className={`${tdClass} ${m.liability > 0 ? 'text-red-600 font-semibold' : ''}`}>{fmtUSD(m.liability)}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{m.modelVsPosted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* D. Recent Line Changes */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Recent Line Changes</h2>
        {recentLineChanges.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No line changes recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Time</th>
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Market</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Change</th>
                </tr>
              </thead>
              <tbody>
                {recentLineChanges.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className={`${tdClass} text-xs`}>{formatET(c.changedAt)}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{c.ticketNumber}</td>
                    <td className={`${tdClass} font-medium`}>{c.wagerTitle}</td>
                    <td className={tdClass}>{KIND_LABELS[c.marketType] || c.marketType}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{c.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* E. Quick Links */}
      <div className={`${cardClass} flex flex-wrap gap-3`}>
        <a href="/admin/wagers" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          Create Wager
        </a>
        <a href="/admin/pricing-lab" className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700">
          Open Pricing Lab
        </a>
        <a href="/admin/market-performance" className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
          Market Performance
        </a>
      </div>
    </div>
  );
}
