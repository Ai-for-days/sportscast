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

export default function TradingDesk() {
  const [data, setData] = useState<TradingDeskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/trading-desk', { credentials: 'include' });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d.error || `Error ${res.status}`);
          return;
        }
        setData(await res.json());
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
          <a href="/admin/wagers" className="text-sm text-blue-600 hover:underline">Wagers</a>
          <a href="/admin/pricing-lab" className="text-sm text-blue-600 hover:underline">Pricing Lab</a>
          <a href="/admin/market-performance" className="text-sm text-blue-600 hover:underline">Market Performance</a>
        </div>
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
