import { useState, useEffect } from 'react';

interface ClosingLineMetrics {
  avgOpenToCloseDrift: number | null;
  avgModelToOpenDrift: number | null;
  avgModelToCloseDrift: number | null;
  marketsWithBothSnapshots: number;
  totalGraded: number;
}

interface ClosingLineMarket {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  status: string;
  openingSummary: string;
  closingSummary: string;
  modelSummary: string;
  openToCloseDrift: number | null;
  modelToOpenDrift: number | null;
  modelToCloseDrift: number | null;
  actualResult: string;
  actualVsOpenDrift: number | null;
  actualVsCloseDrift: number | null;
  movedTowardModel: boolean | null;
}

interface ClosingLineData {
  metrics: ClosingLineMetrics;
  markets: ClosingLineMarket[];
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

function fmtSign(n: number | null): string {
  if (n === null || n === undefined) return '—';
  const pct = (n * 100).toFixed(1);
  return n > 0 ? `+${pct}%` : `${pct}%`;
}

function driftColor(n: number | null): string {
  if (n === null || n === undefined) return '';
  if (n > 0) return 'text-green-600 font-semibold';
  if (n < 0) return 'text-red-600 font-semibold';
  return '';
}

function rowTint(market: ClosingLineMarket): string {
  if (market.movedTowardModel === true) return 'bg-green-50';
  if (market.movedTowardModel === false) return 'bg-red-50';
  return '';
}

export default function ClosingLineMonitor() {
  const [data, setData] = useState<ClosingLineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/trading-desk/closing-line', { credentials: 'include' });
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

  if (loading) return <div className="text-center py-12 text-gray-500">Loading closing line data...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;
  if (!data) return null;

  const { metrics, markets } = data;

  const biggestMovers = [...markets]
    .filter(m => m.openToCloseDrift !== null)
    .sort((a, b) => Math.abs(b.openToCloseDrift!) - Math.abs(a.openToCloseDrift!))
    .slice(0, 10);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Closing Line Intelligence</h1>
        <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">&larr; Back to Trading Desk</a>
      </div>

      {/* Overview Metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className={cardClass}>
          <div className={statLabel}>Avg Open &rarr; Close Drift</div>
          <div className={`${statValue} ${driftColor(metrics.avgOpenToCloseDrift)}`}>
            {fmtSign(metrics.avgOpenToCloseDrift)}
          </div>
        </div>
        <div className={cardClass}>
          <div className={statLabel}>Avg Model &rarr; Open Drift</div>
          <div className={`${statValue} ${driftColor(metrics.avgModelToOpenDrift)}`}>
            {fmtSign(metrics.avgModelToOpenDrift)}
          </div>
        </div>
        <div className={cardClass}>
          <div className={statLabel}>Avg Model &rarr; Close Drift</div>
          <div className={`${statValue} ${driftColor(metrics.avgModelToCloseDrift)}`}>
            {fmtSign(metrics.avgModelToCloseDrift)}
          </div>
        </div>
        <div className={cardClass}>
          <div className={statLabel}>Markets w/ Both Snapshots</div>
          <div className={statValue}>{metrics.marketsWithBothSnapshots}</div>
        </div>
        <div className={cardClass}>
          <div className={statLabel}>Total Graded</div>
          <div className={statValue}>{metrics.totalGraded}</div>
        </div>
      </div>

      {/* Biggest Open-to-Close Movers */}
      {biggestMovers.length > 0 && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Biggest Open-to-Close Movers</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Opening</th>
                  <th className={thClass}>Closing</th>
                  <th className={thClass}>Open &rarr; Close Drift</th>
                  <th className={thClass}>Toward Model?</th>
                </tr>
              </thead>
              <tbody>
                {biggestMovers.map(m => (
                  <tr key={m.id} className={`border-b border-gray-50 ${rowTint(m)}`}>
                    <td className={`${tdClass} font-mono text-xs`}>{m.ticketNumber}</td>
                    <td className={`${tdClass} font-medium`}>{m.title}</td>
                    <td className={tdClass}>{KIND_LABELS[m.kind] || m.kind}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{m.openingSummary}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{m.closingSummary}</td>
                    <td className={`${tdClass} font-mono ${driftColor(m.openToCloseDrift)}`}>
                      {fmtSign(m.openToCloseDrift)}
                    </td>
                    <td className={tdClass}>
                      {m.movedTowardModel === true && (
                        <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Yes</span>
                      )}
                      {m.movedTowardModel === false && (
                        <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">No</span>
                      )}
                      {m.movedTowardModel === null && <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full Markets Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">All Markets ({markets.length})</h2>
        {markets.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No closing line data available yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Opening</th>
                  <th className={thClass}>Closing</th>
                  <th className={thClass}>Model</th>
                  <th className={thClass}>Open &rarr; Close</th>
                  <th className={thClass}>Model &rarr; Open</th>
                  <th className={thClass}>Model &rarr; Close</th>
                  <th className={thClass}>Actual Result</th>
                  <th className={thClass}>Actual vs Open</th>
                  <th className={thClass}>Actual vs Close</th>
                  <th className={thClass}>Toward Model?</th>
                </tr>
              </thead>
              <tbody>
                {markets.map(m => (
                  <tr key={m.id} className={`border-b border-gray-50 hover:bg-gray-50 ${rowTint(m)}`}>
                    <td className={`${tdClass} font-mono text-xs`}>{m.ticketNumber}</td>
                    <td className={`${tdClass} font-medium max-w-xs truncate`}>{m.title}</td>
                    <td className={tdClass}>{KIND_LABELS[m.kind] || m.kind}</td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                        m.status === 'graded' ? 'bg-gray-100 text-gray-700' :
                        m.status === 'open' ? 'bg-blue-100 text-blue-700' :
                        m.status === 'locked' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {m.status}
                      </span>
                    </td>
                    <td className={`${tdClass} font-mono text-xs`}>{m.openingSummary || '—'}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{m.closingSummary || '—'}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{m.modelSummary || '—'}</td>
                    <td className={`${tdClass} font-mono ${driftColor(m.openToCloseDrift)}`}>
                      {fmtSign(m.openToCloseDrift)}
                    </td>
                    <td className={`${tdClass} font-mono ${driftColor(m.modelToOpenDrift)}`}>
                      {fmtSign(m.modelToOpenDrift)}
                    </td>
                    <td className={`${tdClass} font-mono ${driftColor(m.modelToCloseDrift)}`}>
                      {fmtSign(m.modelToCloseDrift)}
                    </td>
                    <td className={`${tdClass} font-mono text-xs`}>{m.actualResult || '—'}</td>
                    <td className={`${tdClass} font-mono ${driftColor(m.actualVsOpenDrift)}`}>
                      {fmtSign(m.actualVsOpenDrift)}
                    </td>
                    <td className={`${tdClass} font-mono ${driftColor(m.actualVsCloseDrift)}`}>
                      {fmtSign(m.actualVsCloseDrift)}
                    </td>
                    <td className={tdClass}>
                      {m.movedTowardModel === true && (
                        <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Yes</span>
                      )}
                      {m.movedTowardModel === false && (
                        <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">No</span>
                      )}
                      {m.movedTowardModel === null && <span className="text-gray-400">—</span>}
                    </td>
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
