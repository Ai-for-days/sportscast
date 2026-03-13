import { useState, useEffect } from 'react';

interface ConcentrationEntry { key: string; totalExposureCents: number; signalCount: number; capCents: number; utilizationPct: number; }
interface PortfolioRecommendation { signalId: string; signalScore: number; sizingTier: string; recommendedStakeCents?: number; maxAllowedStakeCents?: number; portfolioReason: string; constrained: boolean; }
interface PortfolioOverview {
  totalRankedSignals: number; tradableSignals: number; smallCount: number; mediumCount: number;
  largeCount: number; noTradeCount: number; totalRecommendedExposureCents: number; constrainedCount: number;
  concentrationByCity: ConcentrationEntry[]; concentrationByDate: ConcentrationEntry[];
  concentrationByMetric: ConcentrationEntry[]; concentrationBySource: ConcentrationEntry[];
  recommendations: PortfolioRecommendation[];
}
interface RankedSignal { id: string; source: string; title: string; signalScore: number; sizingTier: string; edge: number; locationName?: string; metric?: string; targetDate?: string; rankingReason: string; }

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

const TIER_COLORS: Record<string, string> = { large: 'bg-green-100 text-green-700', medium: 'bg-blue-100 text-blue-700', small: 'bg-yellow-100 text-yellow-700', 'no-trade': 'bg-gray-100 text-gray-500' };
const SOURCE_COLORS: Record<string, string> = { sportsbook: 'bg-blue-100 text-blue-700', kalshi: 'bg-purple-100 text-purple-700' };
const METRIC_LABELS: Record<string, string> = { high_temp: 'High Temp', low_temp: 'Low Temp', actual_temp: 'Temp', actual_wind: 'Wind', actual_gust: 'Gust' };

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PortfolioDashboard() {
  const [portfolio, setPortfolio] = useState<PortfolioOverview | null>(null);
  const [signals, setSignals] = useState<RankedSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [concTab, setConcTab] = useState<'city' | 'date' | 'metric' | 'source'>('city');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/portfolio', { credentials: 'include' });
        if (!res.ok) { setError('Failed to load portfolio'); return; }
        const d = await res.json();
        setPortfolio(d.portfolio);
        setSignals(d.signals || []);
      } catch (err: any) { setError(err?.message || 'Failed'); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading portfolio...</div>;
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>;
  if (!portfolio) return null;

  const signalMap = new Map(signals.map(s => [s.id, s]));
  const tradableRecs = portfolio.recommendations.filter(r => r.sizingTier !== 'no-trade');

  const concData = concTab === 'city' ? portfolio.concentrationByCity :
    concTab === 'date' ? portfolio.concentrationByDate :
    concTab === 'metric' ? portfolio.concentrationByMetric :
    portfolio.concentrationBySource;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Portfolio Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Recommendation-only — no live execution</p>
        </div>
        <div className="flex gap-3">
          <a href="/admin/trade-journal" className="text-sm text-blue-600 hover:underline">Journal</a>
          <a href="/admin/signals" className="text-sm text-blue-600 hover:underline">Signals</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
          <a href="/admin/kalshi-lab" className="text-sm text-blue-600 hover:underline">Kalshi Lab</a>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        <div className={cardClass}><div className="text-xs text-gray-500">Total Signals</div><div className="text-lg font-bold text-gray-900">{portfolio.totalRankedSignals}</div></div>
        <div className={cardClass}><div className="text-xs text-gray-500">Tradable</div><div className="text-lg font-bold text-green-600">{portfolio.tradableSignals}</div></div>
        <div className={cardClass}><div className="text-xs text-gray-500">Large</div><div className="text-lg font-bold text-green-700">{portfolio.largeCount}</div></div>
        <div className={cardClass}><div className="text-xs text-gray-500">Medium</div><div className="text-lg font-bold text-blue-600">{portfolio.mediumCount}</div></div>
        <div className={cardClass}><div className="text-xs text-gray-500">Small</div><div className="text-lg font-bold text-yellow-600">{portfolio.smallCount}</div></div>
        <div className={cardClass}><div className="text-xs text-gray-500">No-Trade</div><div className="text-lg font-bold text-gray-400">{portfolio.noTradeCount}</div></div>
        <div className={cardClass}><div className="text-xs text-gray-500">Rec. Exposure</div><div className="text-lg font-bold text-gray-900">{fmtUSD(portfolio.totalRecommendedExposureCents)}</div></div>
        <div className={cardClass}><div className="text-xs text-gray-500">Constrained</div><div className={`text-lg font-bold ${portfolio.constrainedCount > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{portfolio.constrainedCount}</div></div>
      </div>

      {/* Concentration Tables */}
      <div className={cardClass}>
        <div className="flex items-center gap-4 mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Concentration</h2>
          <div className="flex gap-1">
            {(['city', 'date', 'metric', 'source'] as const).map(tab => (
              <button key={tab} onClick={() => setConcTab(tab)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${concTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
            ))}
          </div>
        </div>
        {concData.length === 0 ? (
          <p className="text-sm text-gray-500 py-2 text-center">No concentration data.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>{concTab}</th>
                  <th className={thClass}>Signals</th>
                  <th className={thClass}>Exposure</th>
                  <th className={thClass}>Cap</th>
                  <th className={thClass}>Utilization</th>
                </tr>
              </thead>
              <tbody>
                {concData.map(c => (
                  <tr key={c.key} className="border-b border-gray-50">
                    <td className={`${tdClass} font-medium`}>{concTab === 'metric' ? (METRIC_LABELS[c.key] || c.key) : c.key}</td>
                    <td className={tdClass}>{c.signalCount}</td>
                    <td className={tdClass}>{fmtUSD(c.totalExposureCents)}</td>
                    <td className={`${tdClass} text-gray-500`}>{fmtUSD(c.capCents)}</td>
                    <td className={tdClass}>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${c.utilizationPct > 80 ? 'bg-red-500' : c.utilizationPct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${Math.min(c.utilizationPct, 100)}%` }} />
                        </div>
                        <span className="text-xs">{c.utilizationPct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recommended Positions */}
      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Recommended Positions ({tradableRecs.length})</h2>
        {tradableRecs.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No tradable positions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className={thClass}>Title</th>
                  <th className={thClass}>Source</th>
                  <th className={thClass}>Score</th>
                  <th className={thClass}>Tier</th>
                  <th className={thClass}>Rec. Stake</th>
                  <th className={thClass}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {tradableRecs.map(r => {
                  const sig = signalMap.get(r.signalId);
                  return (
                    <tr key={r.signalId} className={`border-b border-gray-50 ${r.constrained ? 'bg-orange-50' : ''}`}>
                      <td className={`${tdClass} font-medium max-w-[200px] truncate`}>{sig?.title || r.signalId}</td>
                      <td className={tdClass}>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${SOURCE_COLORS[sig?.source || ''] || 'bg-gray-100 text-gray-500'}`}>{sig?.source || '—'}</span>
                      </td>
                      <td className={`${tdClass} font-mono font-bold`}>{r.signalScore}</td>
                      <td className={tdClass}>
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${TIER_COLORS[r.sizingTier]}`}>{r.sizingTier}</span>
                      </td>
                      <td className={`${tdClass} font-mono`}>{r.recommendedStakeCents ? fmtUSD(r.recommendedStakeCents) : '—'}</td>
                      <td className={`${tdClass} text-xs text-gray-600 max-w-[300px]`}>{r.portfolioReason}</td>
                    </tr>
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
