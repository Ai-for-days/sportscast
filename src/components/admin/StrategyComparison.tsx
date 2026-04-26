import React, { useEffect, useState } from 'react';
import { BarChart, ScatterPlot, EmptyChart, HeatmapGrid } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 700, background: bg, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 });
const inputStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 };

const verdictColor: Record<string, string> = {
  not_ready: '#ef4444', watch: '#f59e0b', promotion_candidate: '#3b82f6', ready_for_pilot: '#22c55e',
};
const stressColor: Record<string, string> = {
  Healthy: '#22c55e', Watch: '#3b82f6', Risky: '#f59e0b', Unsafe: '#ef4444',
};

type Tab = 'summary' | 'variants' | 'promotion' | 'risk' | 'methodology';

export default function StrategyComparison() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('summary');
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [source, setSource] = useState('');
  const [metric, setMetric] = useState('');
  const [mode, setMode] = useState<'all' | 'demo' | 'live'>('all');

  useEffect(() => { reload(); }, []);

  async function reload() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      if (source) p.set('source', source);
      if (metric) p.set('metric', metric);
      if (mode !== 'all') p.set('mode', mode);
      const q = p.toString();
      const res = await fetch(`/api/admin/system/strategy-comparison${q ? `?${q}` : ''}`, { credentials: 'include' });
      const j = await res.json();
      setData(j);
    } catch { setData({ error: 'Failed to load' }); }
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Comparing strategies…</div>;
  if (!data || data.error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {data?.error || 'unknown'}</div>;

  const fmtCents = (v: number | null | undefined) => v == null ? '—' : `$${(v / 100).toFixed(2)}`;
  const fmtSignedCents = (v: number | null | undefined) => v == null ? '—' : `${v >= 0 ? '+' : ''}$${(v / 100).toFixed(2)}`;
  const fmtPct = (v: number | null | undefined) => v == null ? '—' : `${v.toFixed(1)}%`;
  const fmtSigned = (v: number | null | undefined) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

  const variants: any[] = data.variants ?? [];
  const bestRoi = variants.reduce((b: any, v: any) => (b == null || (v.metrics.roiPct ?? -Infinity) > (b.metrics.roiPct ?? -Infinity) ? v : b), null);
  const bestDD = variants.reduce((b: any, v: any) => (b == null || v.metrics.maxDrawdownCents < b.metrics.maxDrawdownCents ? v : b), null);
  const biggestSample = variants.reduce((b: any, v: any) => (b == null || v.metrics.settled > b.metrics.settled ? v : b), null);
  const candidates = variants.filter((v: any) => v.verdict === 'promotion_candidate' || v.verdict === 'ready_for_pilot').length;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/strategy-comparison" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Strategy Comparison</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 760 }}>
            Compare strategy variants on the same trade pool plus the Step 80 paper portfolio. Promotion verdicts are recommendations only — no automatic promotion.
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing} style={btn('#3b82f6')}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {/* Filters */}
      <div style={{ ...card, padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={inputStyle} type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span style={{ color: '#64748b', fontSize: 12 }}>to</span>
        <input style={inputStyle} type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <select style={inputStyle} value={source} onChange={e => setSource(e.target.value)}>
          <option value="">all sources</option>
          <option value="kalshi">kalshi</option>
          <option value="sportsbook">sportsbook</option>
        </select>
        <input style={{ ...inputStyle, minWidth: 120 }} value={metric} onChange={e => setMetric(e.target.value)} placeholder="metric" />
        <select style={inputStyle} value={mode} onChange={e => setMode(e.target.value as any)}>
          <option value="all">all modes</option>
          <option value="demo">demo only</option>
          <option value="live">live only</option>
        </select>
        <button onClick={reload} style={btn('#6366f1')}>Apply</button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['summary', 'Summary'],
          ['variants', 'Strategy Variants'],
          ['promotion', 'Promotion Readiness'],
          ['risk', 'Risk Comparison'],
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
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Variants compared</div><div style={{ fontSize: 24, fontWeight: 700 }}>{variants.length}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Best ROI</div><div style={{ fontSize: 18, fontWeight: 700 }}>{bestRoi?.name ?? '—'}</div><div style={{ fontSize: 14, color: (bestRoi?.metrics.roiPct ?? 0) >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{fmtSigned(bestRoi?.metrics.roiPct)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Best drawdown</div><div style={{ fontSize: 18, fontWeight: 700 }}>{bestDD?.name ?? '—'}</div><div style={{ fontSize: 14, color: '#22c55e' }}>{fmtCents(bestDD?.metrics.maxDrawdownCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Highest sample</div><div style={{ fontSize: 18, fontWeight: 700 }}>{biggestSample?.name ?? '—'}</div><div style={{ fontSize: 14, color: '#cbd5e1' }}>{biggestSample?.metrics.settled} settled</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Promotion candidates</div><div style={{ fontSize: 24, fontWeight: 700, color: candidates > 0 ? '#22c55e' : '#94a3b8' }}>{candidates}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Stress verdict</div><div style={{ fontSize: 18, fontWeight: 700, color: stressColor[data.stressVerdict] }}>{data.stressVerdict}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Edge validation</div><div style={{ fontSize: 14, fontWeight: 700 }}>{data.edgeValidationVerdict}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Concentration warning</div><div style={{ fontSize: 18, fontWeight: 700, color: data.hasConcentrationWarning ? '#ef4444' : '#22c55e' }}>{data.hasConcentrationWarning ? 'YES' : 'no'}</div></div>
          </div>

          {/* Recommendation */}
          <div style={{ ...card, borderLeft: `4px solid ${verdictColor[data.recommendation.verdict] ?? '#64748b'}` }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Recommendation</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={badge(verdictColor[data.recommendation.verdict] ?? '#64748b')}>{data.recommendation.verdict.replace(/_/g, ' ')}</span>
              <strong style={{ fontSize: 16 }}>{variants.find((v: any) => v.id === data.recommendation.variantId)?.name ?? data.recommendation.variantId}</strong>
            </div>
            <p style={{ fontSize: 12, color: '#cbd5e1', margin: 0 }}>{data.recommendation.rationale}</p>
          </div>
        </div>
      )}

      {tab === 'variants' && (
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Strategy</th>
                  <th style={th}>Sample</th>
                  <th style={th}>Win rate</th>
                  <th style={th}>Total P&L</th>
                  <th style={th}>ROI</th>
                  <th style={th}>Max drawdown</th>
                  <th style={th}>Sharpe-like</th>
                  <th style={th}>Avg cal edge</th>
                  <th style={th}>Avg reliability</th>
                  <th style={th}>Avg stake</th>
                  <th style={th}>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v: any) => (
                  <tr key={v.id}>
                    <td style={td}><strong>{v.name}</strong><div style={{ fontSize: 11, color: '#64748b' }}>{v.mode}</div></td>
                    <td style={td}>{v.metrics.settled}<div style={{ fontSize: 10, color: '#64748b' }}>{v.metrics.evidenceLabel.toLowerCase()}</div></td>
                    <td style={td}>{fmtPct(v.metrics.winRatePct)}</td>
                    <td style={{ ...td, color: v.metrics.totalPnlCents >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{fmtSignedCents(v.metrics.totalPnlCents)}</td>
                    <td style={{ ...td, color: (v.metrics.roiPct ?? 0) >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{fmtSigned(v.metrics.roiPct)}</td>
                    <td style={td}>{fmtCents(v.metrics.maxDrawdownCents)}</td>
                    <td style={td}>{v.metrics.sharpeLike != null ? v.metrics.sharpeLike.toFixed(2) : '—'}</td>
                    <td style={td}>{v.metrics.avgCalibratedEdge != null ? `${(v.metrics.avgCalibratedEdge * 100).toFixed(2)}%` : '—'}</td>
                    <td style={td}>{v.metrics.avgReliabilityFactor != null ? `${(v.metrics.avgReliabilityFactor * 100).toFixed(0)}%` : '—'}</td>
                    <td style={td}>{fmtCents(v.metrics.avgStakeCents)}</td>
                    <td style={td}><span style={badge(verdictColor[v.verdict] ?? '#64748b')}>{v.verdict.replace(/_/g, ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'promotion' && (
        <div>
          {variants.map((v: any) => (
            <div key={v.id} style={{ ...card, borderLeft: `4px solid ${verdictColor[v.verdict] ?? '#64748b'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={badge(verdictColor[v.verdict] ?? '#64748b')}>{v.verdict.replace(/_/g, ' ')}</span>
                <strong style={{ fontSize: 14 }}>{v.name}</strong>
                <span style={{ fontSize: 11, color: '#64748b' }}>mode: {v.mode}</span>
              </div>
              <p style={{ fontSize: 13, color: '#cbd5e1', margin: '4px 0 6px' }}>{v.description}</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#94a3b8' }}>
                {v.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
              </ul>
              <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
                Filters: {Object.keys(v.filters).length === 0 ? 'none' : Object.entries(v.filters).map(([k, val]) => `${k}=${val}`).join(', ')}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'risk' && (
        <div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>ROI by strategy</h4>
            {variants.every((v: any) => v.metrics.roiPct == null)
              ? <EmptyChart title="ROI" message="No settled trades to compute ROI." />
              : <BarChart signColored valueFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`} data={variants.map((v: any) => ({ label: v.name, value: v.metrics.roiPct ?? 0, sublabel: `n=${v.metrics.settled}` }))} />}
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Max drawdown by strategy</h4>
            <BarChart valueFormatter={(v) => fmtCents(v)} data={variants.map((v: any) => ({ label: v.name, value: v.metrics.maxDrawdownCents, sublabel: fmtCents(v.metrics.totalPnlCents), color: '#ef4444' }))} />
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Sample size by strategy</h4>
            <BarChart valueFormatter={(v) => `${v}`} data={variants.map((v: any) => ({ label: v.name, value: v.metrics.settled, sublabel: v.metrics.evidenceLabel.toLowerCase(), color: '#3b82f6' }))} />
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Risk / reward scatter</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>X = drawdown as fraction of bankroll; Y = ROI%. Bubble size = sample. Top-right = high reward + high risk; top-left = ideal.</p>
            {(() => {
              const points = variants
                .filter((v: any) => v.metrics.settled > 0 && v.metrics.roiPct != null)
                .map((v: any) => ({
                  x: Math.min(0.99, v.metrics.maxDrawdownCents / Math.max(1, data.bankrollCents)),
                  y: Math.max(-0.5, Math.min(0.99, (v.metrics.roiPct ?? 0) / 100)),
                  size: v.metrics.settled,
                  label: v.name,
                }));
              return points.length > 0
                ? <ScatterPlot data={points} xLabel="Drawdown (% of bankroll)" yLabel="ROI" yRange={[-0.25, 0.25]} xRange={[0, 0.5]} />
                : <EmptyChart title="Risk / reward" message="Need settled trades with ROI to plot." />;
            })()}
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Promotion readiness heatmap</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>Each variant tested against the four readiness gates. Green = pass; red = fail; gray = insufficient data.</p>
            <PromotionHeatmap variants={variants} bankrollCents={data.bankrollCents} stressVerdict={data.stressVerdict} edgeVerdict={data.edgeValidationVerdict} concentration={data.hasConcentrationWarning} />
          </div>
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Methodology</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' }}>
            {data.notes.map((n: string, i: number) => <li key={i} style={{ marginBottom: 6 }}>{n}</li>)}
          </ul>
          <div style={{ marginTop: 16, fontSize: 11, color: '#64748b' }}>Generated: {data.generatedAt}</div>
        </div>
      )}
    </div>
  );
}

// Promotion-readiness heatmap helper
function PromotionHeatmap({ variants, bankrollCents, stressVerdict, edgeVerdict, concentration }: { variants: any[]; bankrollCents: number; stressVerdict: string; edgeVerdict: string; concentration: boolean; }) {
  const gates = ['Sample ≥ 30', 'Positive ROI', 'Drawdown ≤ 25%', 'Stress not Unsafe', 'Edge ≠ Overestimated'];
  const cells: any[] = [];
  for (const v of variants) {
    const dd = v.metrics.maxDrawdownCents / Math.max(1, bankrollCents);
    const checks = [
      v.metrics.settled >= 30,
      (v.metrics.roiPct ?? -1) > 0,
      dd <= 0.25,
      stressVerdict !== 'Unsafe',
      edgeVerdict !== 'Overestimated',
    ];
    checks.forEach((pass, i) => {
      cells.push({ row: v.name, col: gates[i], value: v.metrics.settled === 0 ? null : (pass ? 1 : 0) });
    });
  }
  return (
    <HeatmapGrid
      cells={cells}
      rowLabels={variants.map((v: any) => v.name)}
      colLabels={gates}
      valueFormatter={(v: number) => v >= 0.5 ? '✓' : '✗'}
    />
  );
}
