import { useState, useEffect } from 'react';

interface RecentChange {
  changedAt: string;
  ticketNumber: string;
  wagerTitle: string;
  marketType: string;
  status: string;
  summary: string;
  changedBy: string;
  wagerId: string;
}

interface BiggestMover {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  moveCount: number;
  cumulativeLineMove: number;
  cumulativeOddsMove: number;
}

interface MarketHistoryEntry {
  changedAt: string;
  summary: string;
  changedBy: string;
}

interface LineMovementData {
  recentChanges: RecentChange[];
  biggestMovers: BiggestMover[];
  marketDetails: Record<string, MarketHistoryEntry[]>;
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const KIND_LABELS: Record<string, string> = {
  'over-under': 'O/U',
  'odds': 'Range',
  'pointspread': 'Spread',
};

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

type MarketTypeFilter = 'all' | 'over-under' | 'odds' | 'pointspread';
type StatusFilter = 'all' | 'open' | 'locked' | 'graded';

const marketTypeTabs: { key: MarketTypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'over-under', label: 'O/U' },
  { key: 'odds', label: 'Range' },
  { key: 'pointspread', label: 'Spread' },
];

const statusTabs: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'locked', label: 'Locked' },
  { key: 'graded', label: 'Graded' },
];

const tabBase = 'px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors';
const tabActive = `${tabBase} bg-blue-600 text-white`;
const tabInactive = `${tabBase} bg-gray-100 text-gray-600 hover:bg-gray-200`;

export default function LineMovementMonitor() {
  const [data, setData] = useState<LineMovementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [marketTypeFilter, setMarketTypeFilter] = useState<MarketTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedMovers, setExpandedMovers] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/trading-desk/line-movement', { credentials: 'include' });
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

  function toggleExpanded(id: string) {
    setExpandedMovers(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading line movement data...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;
  if (!data) return null;

  const filteredChanges = data.recentChanges.filter(c => {
    if (marketTypeFilter !== 'all' && c.marketType !== marketTypeFilter) return false;
    if (statusFilter !== 'all' && c.status.toLowerCase() !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Line Movement Monitor</h1>
        <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">&larr; Back to Trading Desk</a>
      </div>

      {/* Filter Tabs */}
      <div className={`${cardClass} flex flex-wrap items-center gap-6`}>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium mr-1">Market:</span>
          {marketTypeTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setMarketTypeFilter(tab.key)}
              className={marketTypeFilter === tab.key ? tabActive : tabInactive}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium mr-1">Status:</span>
          {statusTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={statusFilter === tab.key ? tabActive : tabInactive}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Recent Line Changes Feed */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          Recent Line Changes ({filteredChanges.length})
        </h2>
        {filteredChanges.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No line changes match the current filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Time</th>
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Market</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Change</th>
                  <th className={thClass}>Changed By</th>
                </tr>
              </thead>
              <tbody>
                {filteredChanges.map((c, i) => (
                  <tr key={`${c.wagerId}-${i}`} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={`${tdClass} text-xs`}>{formatET(c.changedAt)}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{c.ticketNumber}</td>
                    <td className={`${tdClass} font-medium`}>{c.wagerTitle}</td>
                    <td className={tdClass}>{KIND_LABELS[c.marketType] || c.marketType}</td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.status.toLowerCase() === 'open' ? 'bg-green-100 text-green-700' :
                        c.status.toLowerCase() === 'locked' ? 'bg-yellow-100 text-yellow-700' :
                        c.status.toLowerCase() === 'graded' ? 'bg-gray-100 text-gray-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className={`${tdClass} font-mono text-xs`}>{c.summary}</td>
                    <td className={`${tdClass} text-xs text-gray-500`}>{c.changedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Biggest Movers */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          Biggest Movers ({data.biggestMovers.length})
        </h2>
        {data.biggestMovers.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No market movements recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}></th>
                  <th className={thClass}>Ticket</th>
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Moves</th>
                  <th className={thClass}>Cumulative Line Move</th>
                  <th className={thClass}>Cumulative Odds Move</th>
                </tr>
              </thead>
              <tbody>
                {data.biggestMovers.map(m => {
                  const isExpanded = expandedMovers.has(m.id);
                  const history = data.marketDetails[m.id] || [];
                  return (
                    <>
                      <tr
                        key={m.id}
                        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                        onClick={() => toggleExpanded(m.id)}
                      >
                        <td className={`${tdClass} text-xs text-gray-400`}>
                          {isExpanded ? '\u25BC' : '\u25B6'}
                        </td>
                        <td className={`${tdClass} font-mono text-xs`}>{m.ticketNumber}</td>
                        <td className={`${tdClass} font-medium`}>{m.title}</td>
                        <td className={tdClass}>{KIND_LABELS[m.kind] || m.kind}</td>
                        <td className={tdClass}>
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            m.moveCount >= 5 ? 'bg-red-100 text-red-700' :
                            m.moveCount >= 3 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {m.moveCount}
                          </span>
                        </td>
                        <td className={`${tdClass} font-mono text-xs ${m.cumulativeLineMove !== 0 ? 'text-blue-700 font-semibold' : ''}`}>
                          {m.cumulativeLineMove > 0 ? '+' : ''}{m.cumulativeLineMove}
                        </td>
                        <td className={`${tdClass} font-mono text-xs ${m.cumulativeOddsMove !== 0 ? 'text-purple-700 font-semibold' : ''}`}>
                          {m.cumulativeOddsMove > 0 ? '+' : ''}{m.cumulativeOddsMove}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${m.id}-detail`} className="border-b border-gray-100">
                          <td colSpan={7} className="px-3 py-3 bg-gray-50">
                            {history.length === 0 ? (
                              <p className="text-xs text-gray-400 text-center py-2">No history available.</p>
                            ) : (
                              <div className="ml-6">
                                <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">
                                  Line History Timeline
                                </h3>
                                <div className="relative border-l-2 border-gray-200 pl-4 space-y-3">
                                  {history.map((entry, idx) => (
                                    <div key={idx} className="relative">
                                      <div className="absolute -left-[1.3rem] top-1 h-2 w-2 rounded-full bg-blue-500"></div>
                                      <div className="text-xs text-gray-500">{formatET(entry.changedAt)}</div>
                                      <div className="text-sm font-mono text-gray-800">{entry.summary}</div>
                                      <div className="text-xs text-gray-400">by {entry.changedBy}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
