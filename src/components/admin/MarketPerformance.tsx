import { useState, useEffect } from 'react';

interface MarketOverview {
  totalWithSnapshot: number;
  openCount: number;
  lockedCount: number;
  gradedCount: number;
  voidCount: number;
  avgHold: number | null;
  avgAbsLineDiff: number | null;
}

interface MarketTypeStats {
  kind: string;
  count: number;
  avgHold: number | null;
  avgAbsLineDiff: number | null;
}

interface OverUnderAnalytics {
  count: number;
  avgLineDiff: number;
  avgOverOddsDiff: number;
  avgUnderOddsDiff: number;
}

interface PointspreadAnalytics {
  count: number;
  avgSpreadDiff: number;
  avgLocAOddsDiff: number;
  avgLocBOddsDiff: number;
}

interface RangeOddsAnalytics {
  count: number;
  avgBandOddsDiff: number;
}

interface StatusGroup {
  status: string;
  count: number;
  avgHold: number | null;
  avgAbsLineDiff: number | null;
}

interface ShadedMarket {
  id: string;
  title: string;
  ticketNumber: string;
  kind: string;
  status: string;
  driftValue: number;
  driftLabel: string;
}

interface MarketTableRow {
  id: string;
  title: string;
  ticketNumber: string;
  kind: string;
  status: string;
  modelSummary: string;
  postedSummary: string;
  handle: number;
  liability: number;
}

interface Report {
  overview: MarketOverview;
  byType: MarketTypeStats[];
  byStatus: StatusGroup[];
  overUnder: OverUnderAnalytics | null;
  pointspread: PointspreadAnalytics | null;
  rangeOdds: RangeOddsAnalytics | null;
  topShaded: ShadedMarket[];
  marketTable: MarketTableRow[];
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const statLabel = 'text-xs text-gray-500';
const statValue = 'text-lg font-bold text-gray-900';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

function fmtPct(n: number | null): string {
  if (n === null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function fmtNum(n: number | null, dec = 2): string {
  if (n === null) return '—';
  return n.toFixed(dec);
}

function fmtSign(n: number | null, dec = 1): string {
  if (n === null) return '—';
  const s = n.toFixed(dec);
  return n > 0 ? `+${s}` : s;
}

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const KIND_LABELS: Record<string, string> = {
  'over-under': 'Over/Under',
  'odds': 'Range Odds',
  'pointspread': 'Pointspread',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  locked: 'Locked',
  graded: 'Graded',
  void: 'Void',
};

export default function MarketPerformance() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/market-performance/overview', { credentials: 'include' });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d.error || `Error ${res.status}`);
          return;
        }
        setReport(await res.json());
      } catch (err: any) {
        setError(err?.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading market performance...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;
  if (!report) return null;

  const { overview, byType, overUnder, pointspread, rangeOdds } = report;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Market Performance</h1>
        <a href="/admin/wagers" className="text-sm text-blue-600 hover:underline">&larr; Back to Wagers</a>
      </div>

      {overview.totalWithSnapshot === 0 ? (
        <div className={`${cardClass} text-center text-gray-500 py-8`}>
          No wagers with pricing snapshots yet. Create wagers using "Generate Suggested Lines" to start tracking market performance.
        </div>
      ) : (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            <div className={cardClass}>
              <div className={statLabel}>Total Markets</div>
              <div className={statValue}>{overview.totalWithSnapshot}</div>
            </div>
            <div className={cardClass}>
              <div className={statLabel}>Open</div>
              <div className={statValue}>{overview.openCount}</div>
            </div>
            <div className={cardClass}>
              <div className={statLabel}>Locked</div>
              <div className={statValue}>{overview.lockedCount}</div>
            </div>
            <div className={cardClass}>
              <div className={statLabel}>Graded</div>
              <div className={statValue}>{overview.gradedCount}</div>
            </div>
            <div className={cardClass}>
              <div className={statLabel}>Void</div>
              <div className={statValue}>{overview.voidCount}</div>
            </div>
            <div className={cardClass}>
              <div className={statLabel}>Avg Hold</div>
              <div className={statValue}>{fmtPct(overview.avgHold)}</div>
            </div>
            <div className={cardClass}>
              <div className={statLabel}>Avg |Line Diff|</div>
              <div className={statValue}>{fmtNum(overview.avgAbsLineDiff, 1)}</div>
            </div>
          </div>

          {/* By Market Type */}
          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">By Market Type</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className={thClass}>Type</th>
                    <th className={thClass}>Count</th>
                    <th className={thClass}>Avg Hold</th>
                    <th className={thClass}>Avg |Line Diff|</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map(t => (
                    <tr key={t.kind} className="border-b border-gray-50">
                      <td className={`${tdClass} font-medium`}>{KIND_LABELS[t.kind] || t.kind}</td>
                      <td className={tdClass}>{t.count}</td>
                      <td className={tdClass}>{fmtPct(t.avgHold)}</td>
                      <td className={tdClass}>{fmtNum(t.avgAbsLineDiff, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Model vs Posted — Over/Under */}
          {overUnder && (
            <div className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Over/Under: Model vs Posted ({overUnder.count} markets)</h2>
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <span className="text-gray-500">Avg Line Shade:</span>{' '}
                  <span className="font-mono font-bold">{fmtSign(overUnder.avgLineDiff)}</span>
                  <span className="text-xs text-gray-400 ml-1">(posted - model)</span>
                </div>
                <div>
                  <span className="text-gray-500">Avg Over Odds Diff:</span>{' '}
                  <span className="font-mono font-bold">{fmtSign(overUnder.avgOverOddsDiff, 0)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Avg Under Odds Diff:</span>{' '}
                  <span className="font-mono font-bold">{fmtSign(overUnder.avgUnderOddsDiff, 0)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Model vs Posted — Pointspread */}
          {pointspread && (
            <div className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Pointspread: Model vs Posted ({pointspread.count} markets)</h2>
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <span className="text-gray-500">Avg Spread Shade:</span>{' '}
                  <span className="font-mono font-bold">{fmtSign(pointspread.avgSpreadDiff)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Avg Loc A Odds Diff:</span>{' '}
                  <span className="font-mono font-bold">{fmtSign(pointspread.avgLocAOddsDiff, 0)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Avg Loc B Odds Diff:</span>{' '}
                  <span className="font-mono font-bold">{fmtSign(pointspread.avgLocBOddsDiff, 0)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Model vs Posted — Range Odds */}
          {rangeOdds && (
            <div className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Range Odds: Model vs Posted ({rangeOdds.count} markets)</h2>
              <div className="text-sm">
                <span className="text-gray-500">Avg Band Odds Diff:</span>{' '}
                <span className="font-mono font-bold">{fmtSign(rangeOdds.avgBandOddsDiff, 0)}</span>
                <span className="text-xs text-gray-400 ml-1">(posted - model, across all bands)</span>
              </div>
            </div>
          )}

          {/* By Status Grouping */}
          {report.byStatus && report.byStatus.length > 0 && (
            <div className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">By Status</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className={thClass}>Status</th>
                      <th className={thClass}>Count</th>
                      <th className={thClass}>Avg Hold</th>
                      <th className={thClass}>Avg |Line Diff|</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byStatus.map(g => (
                      <tr key={g.status} className="border-b border-gray-50">
                        <td className={`${tdClass} font-medium`}>{STATUS_LABELS[g.status] || g.status}</td>
                        <td className={tdClass}>{g.count}</td>
                        <td className={tdClass}>{fmtPct(g.avgHold)}</td>
                        <td className={tdClass}>{fmtNum(g.avgAbsLineDiff, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top Shaded Markets */}
          {report.topShaded && report.topShaded.length > 0 && (
            <div className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Top Shaded Markets (Biggest Model vs Posted Drift)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className={thClass}>Ticket</th>
                      <th className={thClass}>Title</th>
                      <th className={thClass}>Type</th>
                      <th className={thClass}>Status</th>
                      <th className={thClass}>Drift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topShaded.map(m => (
                      <tr key={m.id} className="border-b border-gray-50">
                        <td className={`${tdClass} font-mono text-xs`}>{m.ticketNumber}</td>
                        <td className={`${tdClass} font-medium`}>{m.title}</td>
                        <td className={tdClass}>{KIND_LABELS[m.kind] || m.kind}</td>
                        <td className={tdClass}>{STATUS_LABELS[m.status] || m.status}</td>
                        <td className={`${tdClass} font-mono font-bold`}>{m.driftLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Full Market Table */}
          {report.marketTable && report.marketTable.length > 0 && (
            <div className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">All Markets with Snapshots</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className={thClass}>Title</th>
                      <th className={thClass}>Type</th>
                      <th className={thClass}>Model</th>
                      <th className={thClass}>Posted</th>
                      <th className={thClass}>Handle</th>
                      <th className={thClass}>Liability</th>
                      <th className={thClass}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.marketTable.map(m => (
                      <tr key={m.id} className="border-b border-gray-50">
                        <td className={`${tdClass} font-medium`}>{m.title}</td>
                        <td className={tdClass}>{KIND_LABELS[m.kind] || m.kind}</td>
                        <td className={`${tdClass} font-mono text-xs`}>{m.modelSummary}</td>
                        <td className={`${tdClass} font-mono text-xs`}>{m.postedSummary}</td>
                        <td className={tdClass}>{fmtUSD(m.handle)}</td>
                        <td className={`${tdClass} ${m.liability > 0 ? 'text-red-600' : ''}`}>{fmtUSD(m.liability)}</td>
                        <td className={tdClass}>{STATUS_LABELS[m.status] || m.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
