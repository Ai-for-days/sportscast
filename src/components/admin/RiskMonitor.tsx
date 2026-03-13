import { useState, useEffect } from 'react';

interface RiskOverview {
  openMarkets: number;
  lockedMarkets: number;
  gradedMarkets: number;
  totalHandle: number;
  totalLiability: number;
  largestLiability: number;
  avgHold: number | null;
  snapshotCount: number;
}

interface HighestRiskMarket {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  lockTime: string;
  betCount: number;
  handle: number;
  liability: number;
  worstOutcome: string;
  modelVsPosted: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface LopsidedMarket {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  handle: number;
  liability: number;
  dominantSide: string;
  dominantPct: number;
}

interface MissingModelMarket {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  status: string;
}

interface StaleMarket {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  betCount: number;
  lastActivity: string;
}

interface AttentionItem {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  handle: number;
  liability: number;
  reasons: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface RiskData {
  overview: RiskOverview;
  highestRisk: HighestRiskMarket[];
  lopsided: LopsidedMarket[];
  missingModel: MissingModelMarket[];
  staleMarkets: StaleMarket[];
  attentionNeeded: AttentionItem[];
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

const RISK_BADGE: Record<string, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
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

function RiskBadge({ level }: { level: string }) {
  const cls = RISK_BADGE[level] || RISK_BADGE.low;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {level}
    </span>
  );
}

export default function RiskMonitor() {
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/trading-desk/risk', { credentials: 'include' });
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

  if (loading) return <div className="text-center py-12 text-gray-500">Loading risk monitor...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;
  if (!data) return null;

  const { overview, highestRisk, lopsided, missingModel, staleMarkets, attentionNeeded } = data;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Risk Monitor</h1>
        <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">&larr; Back to Trading Desk</a>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
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
          <div className={statLabel}>Total Liability</div>
          <div className={`${statValue} ${overview.totalLiability > 0 ? 'text-red-600' : ''}`}>
            {fmtUSD(overview.totalLiability)}
          </div>
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

      {/* Attention Needed */}
      {attentionNeeded.length > 0 && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-red-700">Attention Needed ({attentionNeeded.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Risk</th>
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
                    <td className={tdClass}><RiskBadge level={item.riskLevel} /></td>
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

      {/* Highest-Risk Markets */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Highest-Risk Markets ({highestRisk.length})</h2>
        {highestRisk.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No high-risk markets.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Risk</th>
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Close</th>
                  <th className={thClass}>Bets</th>
                  <th className={thClass}>Handle</th>
                  <th className={thClass}>Liability</th>
                  <th className={thClass}>Worst Outcome</th>
                  <th className={thClass}>Model vs Posted</th>
                </tr>
              </thead>
              <tbody>
                {highestRisk.map(m => (
                  <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={tdClass}><RiskBadge level={m.riskLevel} /></td>
                    <td className={`${tdClass} font-mono text-xs`}>{m.ticketNumber}</td>
                    <td className={`${tdClass} font-medium`}>{m.title}</td>
                    <td className={tdClass}>{KIND_LABELS[m.kind] || m.kind}</td>
                    <td className={`${tdClass} text-xs`}>{formatET(m.lockTime)}</td>
                    <td className={tdClass}>{m.betCount}</td>
                    <td className={tdClass}>{fmtUSD(m.handle)}</td>
                    <td className={`${tdClass} ${m.liability > 0 ? 'text-red-600 font-semibold' : ''}`}>{fmtUSD(m.liability)}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{m.worstOutcome}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{m.modelVsPosted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lopsided Action */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Lopsided Action ({lopsided.length})</h2>
        {lopsided.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No lopsided markets.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Handle</th>
                  <th className={thClass}>Liability</th>
                  <th className={thClass}>Dominant Side</th>
                  <th className={thClass}>Dominant %</th>
                </tr>
              </thead>
              <tbody>
                {lopsided.map(m => (
                  <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={`${tdClass} font-mono text-xs`}>{m.ticketNumber}</td>
                    <td className={`${tdClass} font-medium`}>{m.title}</td>
                    <td className={tdClass}>{KIND_LABELS[m.kind] || m.kind}</td>
                    <td className={tdClass}>{fmtUSD(m.handle)}</td>
                    <td className={`${tdClass} ${m.liability > 0 ? 'text-red-600 font-semibold' : ''}`}>{fmtUSD(m.liability)}</td>
                    <td className={`${tdClass} font-medium`}>{m.dominantSide}</td>
                    <td className={`${tdClass} font-semibold ${m.dominantPct >= 0.8 ? 'text-red-600' : m.dominantPct >= 0.65 ? 'text-orange-600' : ''}`}>
                      {fmtPct(m.dominantPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Missing Model */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Missing Model ({missingModel.length})</h2>
        {missingModel.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">All markets have model data.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Status</th>
                </tr>
              </thead>
              <tbody>
                {missingModel.map(m => (
                  <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={`${tdClass} font-mono text-xs`}>{m.ticketNumber}</td>
                    <td className={`${tdClass} font-medium`}>{m.title}</td>
                    <td className={tdClass}>{KIND_LABELS[m.kind] || m.kind}</td>
                    <td className={tdClass}>{m.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stale Markets */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Stale Markets ({staleMarkets.length})</h2>
        {staleMarkets.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No stale markets.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Bets</th>
                  <th className={thClass}>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {staleMarkets.map(m => (
                  <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={`${tdClass} font-mono text-xs`}>{m.ticketNumber}</td>
                    <td className={`${tdClass} font-medium`}>{m.title}</td>
                    <td className={tdClass}>{KIND_LABELS[m.kind] || m.kind}</td>
                    <td className={tdClass}>{m.betCount}</td>
                    <td className={`${tdClass} text-xs`}>{formatET(m.lastActivity)}</td>
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
