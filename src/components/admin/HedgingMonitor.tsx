import { useState, useEffect } from 'react';

interface HedgingOverview {
  openMarketCount: number;
  countByRiskLevel: Record<string, number>;
  totalHandle: number;
  totalLiability: number;
  highCriticalCount: number;
}

interface HedgingRecommendation {
  wagerId: string;
  title: string;
  ticketNumber: string;
  marketType: string;
  riskLevel: string;
  recommendedAction: string;
  reason: string;
  inputs: {
    handle: number;
    liability: number;
    betCount: number;
    modelDrift?: number;
    moveCount?: number;
    lopsidedPct?: number;
    hasPricingSnapshot: boolean;
  };
  suggestedChanges?: {
    overUnder?: {
      suggestedLine?: number;
      suggestedOverOdds?: number;
      suggestedUnderOdds?: number;
    };
    pointspread?: {
      suggestedSpread?: number;
      suggestedLocationAOdds?: number;
      suggestedLocationBOdds?: number;
    };
    rangeOdds?: {
      suggestedBands?: Array<{ label: string; suggestedOdds: number }>;
    };
  };
  hedgeNotes?: string;
}

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const KIND_LABELS: Record<string, string> = {
  'over-under': 'O/U',
  'odds': 'Range',
  'pointspread': 'Spread',
};

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const ACTION_LABELS: Record<string, string> = {
  hold: 'Hold',
  move_line: 'Move Line',
  move_odds: 'Move Odds',
  reduce_limits: 'Reduce Limits',
  pause_market: 'Pause Market',
  hedge_external: 'Hedge External',
};

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getSuggestedChangeSummary(rec: HedgingRecommendation): string {
  const parts: string[] = [];
  const sc = rec.suggestedChanges;
  if (!sc) return '—';

  if (sc.overUnder) {
    if (sc.overUnder.suggestedLine != null) parts.push(`Line → ${sc.overUnder.suggestedLine}`);
    if (sc.overUnder.suggestedOverOdds != null) parts.push(`Over → ${sc.overUnder.suggestedOverOdds > 0 ? '+' : ''}${sc.overUnder.suggestedOverOdds}`);
    if (sc.overUnder.suggestedUnderOdds != null) parts.push(`Under → ${sc.overUnder.suggestedUnderOdds > 0 ? '+' : ''}${sc.overUnder.suggestedUnderOdds}`);
  }
  if (sc.pointspread) {
    if (sc.pointspread.suggestedSpread != null) parts.push(`Spread → ${sc.pointspread.suggestedSpread}`);
    if (sc.pointspread.suggestedLocationAOdds != null) parts.push(`A odds → ${sc.pointspread.suggestedLocationAOdds > 0 ? '+' : ''}${sc.pointspread.suggestedLocationAOdds}`);
    if (sc.pointspread.suggestedLocationBOdds != null) parts.push(`B odds → ${sc.pointspread.suggestedLocationBOdds > 0 ? '+' : ''}${sc.pointspread.suggestedLocationBOdds}`);
  }
  if (sc.rangeOdds?.suggestedBands) {
    parts.push(`${sc.rangeOdds.suggestedBands.length} band adjustments`);
  }

  return parts.length > 0 ? parts.join('; ') : '—';
}

export default function HedgingMonitor() {
  const [overview, setOverview] = useState<HedgingOverview | null>(null);
  const [recommendations, setRecommendations] = useState<HedgingRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [riskFilter, setRiskFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const [overviewRes, recsRes] = await Promise.all([
          fetch('/api/admin/hedging/overview', { credentials: 'include' }),
          fetch('/api/admin/hedging/recommendations', { credentials: 'include' }),
        ]);
        if (!overviewRes.ok || !recsRes.ok) {
          setError('Failed to load hedging data');
          return;
        }
        const ov = await overviewRes.json();
        const rc = await recsRes.json();
        setOverview(ov);
        setRecommendations(rc.recommendations || []);
      } catch (err: any) {
        setError(err?.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading hedging engine...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;
  if (!overview) return null;

  // Client-side filtering
  let filteredRecs = recommendations;
  if (riskFilter) filteredRecs = filteredRecs.filter(r => r.riskLevel === riskFilter);
  if (typeFilter) filteredRecs = filteredRecs.filter(r => r.marketType === typeFilter);

  const criticalRecs = recommendations.filter(r => r.riskLevel === 'critical' || r.riskLevel === 'high');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Exposure Hedging Engine</h1>
          <p className="text-sm text-gray-500 mt-1">Recommendation-only — no actions are auto-executed</p>
        </div>
        <div className="flex gap-3">
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
          <a href="/admin/trading-desk/risk" className="text-sm text-blue-600 hover:underline">Risk Monitor</a>
        </div>
      </div>

      {/* A. Overview Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Open Markets</div>
          <div className="text-lg font-bold text-gray-900">{overview.openMarketCount}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Low Risk</div>
          <div className="text-lg font-bold text-green-600">{overview.countByRiskLevel.low || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Medium Risk</div>
          <div className="text-lg font-bold text-yellow-600">{overview.countByRiskLevel.medium || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">High Risk</div>
          <div className="text-lg font-bold text-orange-600">{overview.countByRiskLevel.high || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Critical Risk</div>
          <div className="text-lg font-bold text-red-600">{overview.countByRiskLevel.critical || 0}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs text-gray-500">Total Liability</div>
          <div className={`text-lg font-bold ${overview.totalLiability > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {fmtUSD(overview.totalLiability)}
          </div>
        </div>
      </div>

      {/* C. Critical/High Markets Panel */}
      {criticalRecs.length > 0 && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-red-800">
            Critical & High Risk Markets ({criticalRecs.length})
          </h2>
          <div className="space-y-3">
            {criticalRecs.map(rec => (
              <div key={rec.wagerId} className="rounded-lg border border-red-200 bg-white p-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${RISK_COLORS[rec.riskLevel]}`}>
                        {rec.riskLevel.toUpperCase()}
                      </span>
                      <span className="font-mono text-xs text-gray-500">{rec.ticketNumber}</span>
                      <span className="text-sm font-medium text-gray-900">{rec.title}</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-600">{rec.reason}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-500">Liability</div>
                    <div className="text-sm font-bold text-red-600">{fmtUSD(rec.inputs.liability)}</div>
                  </div>
                </div>
                {/* D. Quick Action Suggestions */}
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-block rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                    {ACTION_LABELS[rec.recommendedAction] || rec.recommendedAction}
                  </span>
                  {getSuggestedChangeSummary(rec) !== '—' && (
                    <span className="inline-block rounded bg-blue-100 px-2 py-1 text-xs text-blue-700">
                      {getSuggestedChangeSummary(rec)}
                    </span>
                  )}
                  {rec.hedgeNotes && (
                    <span className="inline-block rounded bg-purple-100 px-2 py-1 text-xs text-purple-700">
                      {rec.hedgeNotes}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <label className="text-sm text-gray-600">
          Risk:
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value)}
            className="ml-1 rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="text-sm text-gray-600">
          Type:
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="ml-1 rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">All</option>
            <option value="over-under">Over/Under</option>
            <option value="pointspread">Pointspread</option>
            <option value="odds">Range Odds</option>
          </select>
        </label>
        <span className="text-xs text-gray-400">
          Showing {filteredRecs.length} of {recommendations.length} markets
        </span>
      </div>

      {/* B. Recommendations Table */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          All Recommendations ({filteredRecs.length})
        </h2>
        {filteredRecs.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No open markets.</p>
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
                  <th className={thClass}>Risk</th>
                  <th className={thClass}>Action</th>
                  <th className={thClass}>Reason</th>
                  <th className={thClass}>Suggested Changes</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecs.map(rec => (
                  <tr key={rec.wagerId} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className={`${tdClass} font-mono text-xs`}>{rec.ticketNumber}</td>
                    <td className={`${tdClass} font-medium max-w-[200px] truncate`}>{rec.title}</td>
                    <td className={tdClass}>{KIND_LABELS[rec.marketType] || rec.marketType}</td>
                    <td className={tdClass}>{fmtUSD(rec.inputs.handle)}</td>
                    <td className={`${tdClass} ${rec.inputs.liability > 0 ? 'text-red-600 font-semibold' : ''}`}>
                      {fmtUSD(rec.inputs.liability)}
                    </td>
                    <td className={tdClass}>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${RISK_COLORS[rec.riskLevel]}`}>
                        {rec.riskLevel.toUpperCase()}
                      </span>
                    </td>
                    <td className={tdClass}>
                      <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {ACTION_LABELS[rec.recommendedAction] || rec.recommendedAction}
                      </span>
                    </td>
                    <td className={`${tdClass} max-w-[250px] text-xs text-gray-600`}>{rec.reason}</td>
                    <td className={`${tdClass} max-w-[200px] text-xs font-mono`}>{getSuggestedChangeSummary(rec)}</td>
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
