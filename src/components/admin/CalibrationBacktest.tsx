import React, { useEffect, useState } from 'react';
import {
  BarChart, GaugeIndicator, HeatmapGrid, ProbabilityCandlestickChart,
  EmptyChart,
} from './charts';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });
const inputStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 };

const evidenceColor: Record<string, string> = {
  stronger: '#22c55e', moderate: '#3b82f6', early: '#f59e0b', insufficient: '#64748b',
};
const severityColor: Record<string, string> = {
  info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444',
};

type Tab = 'summary' | 'rawcal' | 'reliability' | 'components' | 'visuals' | 'recommendations' | 'methodology';

export default function CalibrationBacktest() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('summary');
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [source, setSource] = useState('');
  const [metric, setMetric] = useState('');
  const [location, setLocation] = useState('');
  const [mode, setMode] = useState<'all' | 'demo' | 'live'>('all');

  useEffect(() => { loadData({}); }, []);

  function buildQuery() {
    const p = new URLSearchParams();
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    if (source) p.set('source', source);
    if (metric) p.set('metric', metric);
    if (location) p.set('location', location);
    if (mode !== 'all') p.set('mode', mode);
    return p.toString();
  }

  async function loadData(_filters: any) {
    setLoading(true);
    try {
      const q = buildQuery();
      const res = await fetch(`/api/admin/system/calibration-backtest${q ? `?${q}` : ''}`, { credentials: 'include' });
      const j = await res.json();
      setData(j);
    } catch (e) { setData({ error: 'Failed to load' }); }
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const filters: any = {};
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
      if (source) filters.source = source;
      if (metric) filters.metric = metric;
      if (location) filters.location = location;
      if (mode !== 'all') filters.mode = mode;
      const res = await fetch('/api/admin/system/calibration-backtest', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh', filters }),
      });
      const j = await res.json();
      setData(j);
    } catch (e) { /* ignore */ }
    setRefreshing(false);
  }

  const navLinks = [
    { href: '/admin/system/quant-review', label: 'Quant Review' },
    { href: '/admin/system/quant-edge-audit', label: 'Quant Edge Audit' },
    { href: '/admin/system/outcome-evaluation', label: 'Outcome Evaluation' },
    { href: '/admin/system/calibration-lab', label: 'Calibration Lab' },
    { href: '/admin/system/calibration-backtest', label: 'Calibration Backtest', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading backtest report…</div>;
  if (!data || data.error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {data?.error || 'unknown'}</div>;

  const s = data.summary;
  const r = data.rawVsCalibrated.raw;
  const c = data.rawVsCalibrated.calibrated;
  const fmtPct = (v: number | null) => v == null ? '—' : `${v.toFixed(1)}%`;
  const fmtCents = (v: number | null) => v == null ? '—' : `$${(v / 100).toFixed(2)}`;
  const fmt4 = (v: number | null) => v == null ? '—' : v.toFixed(4);
  const fmtEdgePct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
  const evBadge = (lvl: string) => <span style={badge(evidenceColor[lvl] ?? '#64748b')}>{lvl.toUpperCase()}</span>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>
            {l.label}
          </a>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Calibration Backtest</h1>
          <p style={{ margin: '0 0 8px', fontSize: 14, color: '#94a3b8', maxWidth: 760 }}>
            Did Steps 69–71 actually improve signal quality? Compare raw vs calibrated strategies on resolved records and surface model-adjustment recommendations. Research-only — no execution changes.
          </p>
          <div style={{ marginTop: 4 }}>
            <span style={badge(evidenceColor[s.overallEvidence] ?? '#64748b')}>{s.overallEvidenceLabel.toUpperCase()}</span>
          </div>
        </div>
        <button onClick={refresh} disabled={refreshing} style={btn('#3b82f6')}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {/* Filters bar */}
      <div style={{ ...card, padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={inputStyle} type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="Date from" />
        <span style={{ color: '#64748b', fontSize: 12 }}>to</span>
        <input style={inputStyle} type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <input style={{ ...inputStyle, minWidth: 120 }} value={source} onChange={e => setSource(e.target.value)} placeholder="source (e.g. nws)" />
        <input style={{ ...inputStyle, minWidth: 120 }} value={metric} onChange={e => setMetric(e.target.value)} placeholder="metric" />
        <input style={{ ...inputStyle, minWidth: 140 }} value={location} onChange={e => setLocation(e.target.value)} placeholder="location contains" />
        <select style={inputStyle} value={mode} onChange={e => setMode(e.target.value as any)}>
          <option value="all">all modes</option>
          <option value="demo">demo only</option>
          <option value="live">live only</option>
        </select>
        <button onClick={() => loadData({})} style={btn('#6366f1')}>Apply</button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['summary', 'Summary'],
          ['rawcal', 'Raw vs Calibrated'],
          ['reliability', 'Reliability Buckets'],
          ['components', 'Component Diagnostics'],
          ['visuals', 'Visuals'],
          ['recommendations', `Recommendations (${s.recommendationCount})`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div>
          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Records analyzed</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.recordsAnalyzed}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Resolved</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{s.resolvedRecords}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Raw P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: s.rawStrategyPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtCents(s.rawStrategyPnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Calibrated P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: s.calibratedStrategyPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtCents(s.calibratedStrategyPnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Raw win rate</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtPct(s.rawWinRatePct)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Calibrated win rate</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtPct(s.calibratedWinRatePct)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Brier improvement</div><div style={{ fontSize: 24, fontWeight: 700, color: (s.brierImprovement ?? 0) > 0 ? '#22c55e' : (s.brierImprovement ?? 0) < 0 ? '#ef4444' : '#94a3b8' }}>{s.brierImprovement != null ? (s.brierImprovement >= 0 ? '+' : '') + s.brierImprovement.toFixed(4) : '—'}</div><div style={{ fontSize: 10, color: '#64748b' }}>raw − calibrated, lower is better</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Signals downgraded</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.signalsDowngraded}</div><div style={{ fontSize: 10, color: '#64748b' }}>{s.signalsDowngradedPct}% of records</div></div>
          </div>

          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Correct downgrades</div><div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{s.correctDowngrades}{s.correctDowngradesPct != null ? ` (${s.correctDowngradesPct}%)` : ''}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>False downgrades</div><div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{s.falseDowngrades}{s.falseDowngradesPct != null ? ` (${s.falseDowngradesPct}%)` : ''}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Recommendations</div><div style={{ fontSize: 20, fontWeight: 700 }}>{s.recommendationCount}</div></div>
          </div>
        </div>
      )}

      {tab === 'rawcal' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700 }}>Raw vs Calibrated</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Strategy</th>
                <th style={th}>Win rate</th>
                <th style={th}>Total P&L</th>
                <th style={th}>Avg edge</th>
                <th style={th}>Brier</th>
                <th style={th}>Top decile P&L</th>
                <th style={th}>Top quartile P&L</th>
                <th style={th}>Sample</th>
                <th style={th}>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {[r, c].map((row: any) => (
                <tr key={row.strategy}>
                  <td style={td}><strong style={{ textTransform: 'capitalize' }}>{row.strategy}</strong></td>
                  <td style={td}>{fmtPct(row.winRatePct)}</td>
                  <td style={td}><span style={{ color: row.totalPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtCents(row.totalPnlCents)}</span></td>
                  <td style={td}>{fmtEdgePct(row.avgEdge)}</td>
                  <td style={td}>{fmt4(row.brierScore)}</td>
                  <td style={td}>{fmtCents(row.topDecileAvgPnl)}</td>
                  <td style={td}>{fmtCents(row.topQuartileAvgPnl)}</td>
                  <td style={td}>{row.withPnl}</td>
                  <td style={td}>{evBadge(row.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: '#64748b', marginTop: 12 }}>
            Calibrated strategy excludes records that would have been forced to no-trade under Step 71 (reliabilityFactor &lt; 0.25). Brier uses shrunk probability for the calibrated strategy and raw model probability for the raw strategy.
          </p>
        </div>
      )}

      {tab === 'reliability' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700 }}>Reliability Buckets</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Bucket</th>
                <th style={th}>Count</th>
                <th style={th}>Resolved</th>
                <th style={th}>With P&L</th>
                <th style={th}>Win rate</th>
                <th style={th}>Total P&L</th>
                <th style={th}>Avg P&L</th>
                <th style={th}>Avg raw edge</th>
                <th style={th}>Avg calibrated edge</th>
                <th style={th}>Verdict</th>
                <th style={th}>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {data.reliabilityBuckets.map((b: any) => (
                <tr key={b.bucket}>
                  <td style={td}><strong>{b.bucket}</strong></td>
                  <td style={td}>{b.count}</td>
                  <td style={td}>{b.resolvedCount}</td>
                  <td style={td}>{b.withPnl}</td>
                  <td style={td}>{fmtPct(b.winRatePct)}</td>
                  <td style={td}><span style={{ color: b.totalPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtCents(b.totalPnlCents)}</span></td>
                  <td style={td}>{fmtCents(b.avgPnlCents)}</td>
                  <td style={td}>{fmtEdgePct(b.avgRawEdge)}</td>
                  <td style={td}>{fmtEdgePct(b.avgCalibratedEdge)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{b.verdict}</td>
                  <td style={td}>{evBadge(b.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'components' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700 }}>Component Diagnostics</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Component</th>
                <th style={th}>Records affected</th>
                <th style={th}>Avg factor</th>
                <th style={th}>Outcome correlation</th>
                <th style={th}>P&L correlation</th>
                <th style={th}>Evidence</th>
                <th style={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.componentDiagnostics.map((d: any) => (
                <tr key={d.component}>
                  <td style={td}><strong style={{ textTransform: 'capitalize' }}>{d.component}</strong></td>
                  <td style={td}>{d.recordsAffected}</td>
                  <td style={td}>{d.averageFactor != null ? d.averageFactor.toFixed(3) : '—'}</td>
                  <td style={td}>{d.outcomeCorrelation != null ? d.outcomeCorrelation.toFixed(3) : '—'}</td>
                  <td style={td}>{d.pnlCorrelation != null ? d.pnlCorrelation.toFixed(3) : '—'}</td>
                  <td style={td}>{evBadge(d.evidence)}</td>
                  <td style={{ ...td, fontSize: 11, color: d.warning ? '#f59e0b' : '#64748b' }}>{d.warning ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'visuals' && (
        <div>
          {/* Row 1: Raw vs Calibrated P&L + Brier comparison + Reliability gauge */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
            <div style={card}>
              <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Raw vs Calibrated total P&L</h4>
              <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Aggregate cents across all settled records.</p>
              <BarChart
                signColored
                valueFormatter={(v) => `$${(v / 100).toFixed(2)}`}
                data={[
                  { label: 'Raw', value: r.totalPnlCents },
                  { label: 'Calibrated', value: c.totalPnlCents },
                ]}
              />
            </div>
            <div style={card}>
              <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Brier score (lower is better)</h4>
              <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Coin-flip baseline = 0.25. {s.brierImprovement != null && (s.brierImprovement > 0 ? '↓ improvement' : s.brierImprovement < 0 ? '↑ deterioration' : '— flat')}</p>
              {(r.brierScore != null && c.brierScore != null) ? (
                <BarChart
                  valueFormatter={(v) => v.toFixed(3)}
                  data={[
                    { label: 'Raw',        value: r.brierScore, color: '#94a3b8' },
                    { label: 'Calibrated', value: c.brierScore, color: c.brierScore <= r.brierScore ? '#22c55e' : '#ef4444' },
                  ]}
                />
              ) : <EmptyChart title="Brier comparison" message="Need resolved outcomes with model probability to compute Brier." />}
            </div>
            <div style={card}>
              <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Calibration reliability gauge</h4>
              <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Average reliabilityFactor across analyzed records.</p>
              {(() => {
                const factors = data.reliabilityBuckets.flatMap((b: any) => Array(b.count).fill(0).map((_: any, i: number) => {
                  const mid = (parseFloat(b.bucket.split('–')[0]) + parseFloat(b.bucket.split('–')[1])) / 2;
                  return mid;
                }));
                if (factors.length === 0) return <EmptyChart title="Reliability gauge" message="No records yet." />;
                const avg = factors.reduce((sum: number, f: number) => sum + f, 0) / factors.length;
                return <GaugeIndicator value={avg} label="Average reliability" sublabel={`across ${factors.length} records`} />;
              })()}
            </div>
          </div>

          {/* Row 2: Reliability bucket bar + top decile / quartile bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginBottom: 16 }}>
            <div style={card}>
              <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Reliability buckets — total P&L</h4>
              <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Where is the calibrated model right and wrong?</p>
              <BarChart
                signColored
                valueFormatter={(v) => `$${(v / 100).toFixed(2)}`}
                data={data.reliabilityBuckets.map((b: any) => ({
                  label: b.bucket,
                  value: b.totalPnlCents,
                  sublabel: `n=${b.withPnl}${b.winRatePct != null ? `, ${b.winRatePct}%` : ''}`,
                }))}
              />
            </div>
            <div style={card}>
              <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Top-decile vs Top-quartile P&L</h4>
              <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Average P&L of the highest-edge slice under each strategy.</p>
              {(r.topDecileAvgPnl != null || c.topDecileAvgPnl != null) ? (
                <BarChart
                  signColored
                  valueFormatter={(v) => `$${(v / 100).toFixed(2)}`}
                  data={[
                    { label: 'Raw decile',     value: r.topDecileAvgPnl ?? 0 },
                    { label: 'Cal decile',     value: c.topDecileAvgPnl ?? 0 },
                    { label: 'Raw quartile',   value: r.topQuartileAvgPnl ?? 0 },
                    { label: 'Cal quartile',   value: c.topQuartileAvgPnl ?? 0 },
                  ]}
                />
              ) : <EmptyChart title="Top-decile / Top-quartile" message="Not enough records for slice analysis." />}
            </div>
          </div>

          {/* Row 3: edge × horizon heatmap */}
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Edge bucket × Horizon — avg P&L (¢)</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>Diverging color: green = positive avg P&L, red = negative. "—" means no records in that cell.</p>
            <HeatmapGrid
              diverging
              valueFormatter={(v) => `${v.toFixed(0)}¢`}
              cells={data.edgeHorizonHeatmap.map((c: any) => ({
                row: c.edgeBucket,
                col: c.horizonBucket,
                value: c.avgPnlCents,
                sample: c.sample,
              }))}
              rowLabels={['<2¢', '2–5¢', '5–10¢', '10–15¢', '15–25¢', '>25¢']}
              colLabels={['0–12h', '12–24h', '1–3d', '3–7d', '7–15d']}
              title="Edge × Horizon heatmap"
            />
          </div>

          {/* Row 4: probability candlestick */}
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Probability candlestick — market vs model vs calibrated view</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>
              Per recent trade: <strong>open</strong> = market probability, <strong>close</strong> = calibrated probability,
              <strong> wick</strong> = min/max across all three, <strong>yellow tick</strong> = raw model probability. Green body = calibrated &gt; market; red = calibrated &lt; market.
            </p>
            <ProbabilityCandlestickChart candles={data.recentCandlesticks ?? []} />
          </div>
        </div>
      )}

      {tab === 'recommendations' && (
        <div>
          {/* Severity counts header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <div style={{ ...card, borderLeft: `4px solid ${severityColor.critical}` }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Critical</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: severityColor.critical }}>{data.severityCounts?.critical ?? 0}</div>
            </div>
            <div style={{ ...card, borderLeft: `4px solid ${severityColor.warning}` }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Warning</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: severityColor.warning }}>{data.severityCounts?.warning ?? 0}</div>
            </div>
            <div style={{ ...card, borderLeft: `4px solid ${severityColor.info}` }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Info</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: severityColor.info }}>{data.severityCounts?.info ?? 0}</div>
            </div>
          </div>

          {data.recommendations.length === 0 && <div style={{ ...card, textAlign: 'center', color: '#64748b' }}>No recommendations generated.</div>}

          {/* Group by severity (critical → warning → info) */}
          {(['critical', 'warning', 'info'] as const).map(sev => {
            const items = data.recommendations.filter((r: any) => r.severity === sev);
            if (items.length === 0) return null;
            return (
              <div key={sev} style={{ marginBottom: 14 }}>
                <h4 style={{ margin: '4px 0 8px', fontSize: 12, color: severityColor[sev], textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {sev === 'critical' ? '🔴' : sev === 'warning' ? '🟡' : '🔵'} {sev} ({items.length})
                </h4>
                {items.map((rec: any) => (
                  <div key={rec.id} style={{ ...card, borderLeft: `4px solid ${severityColor[rec.severity]}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={badge(severityColor[rec.severity])}>{rec.severity.toUpperCase()}</span>
                      <span style={badge('#334155')}>{rec.category}</span>
                      <strong style={{ fontSize: 14 }}>{rec.title}</strong>
                      <span style={{ ...badge('#64748b'), marginLeft: 'auto', fontSize: 10 }}>autoApplied: {String(rec.autoApplied)}</span>
                    </div>
                    <p style={{ fontSize: 13, color: '#cbd5e1', margin: '4px 0' }}>{rec.message}</p>
                    {rec.suggestedAction && (
                      <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0' }}><strong>Suggested action: </strong>{rec.suggestedAction}</p>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Methodology</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' }}>
            {data.methodology.map((n: string, i: number) => <li key={i} style={{ marginBottom: 6 }}>{n}</li>)}
          </ul>
          <div style={{ marginTop: 16, fontSize: 11, color: '#64748b' }}>Generated: {data.generatedAt}</div>
        </div>
      )}
    </div>
  );
}
