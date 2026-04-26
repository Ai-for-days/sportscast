import React, { useEffect, useState } from 'react';
import { BarChart, LineChart, EmptyChart, HeatmapGrid } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });
const inputStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 };

const verdictColor: Record<string, string> = {
  'Validated Edge': '#22c55e',
  'Overestimated': '#ef4444',
  'Neutral': '#3b82f6',
  'Insufficient sample': '#64748b',
};

type Tab = 'summary' | 'segments' | 'visuals' | 'methodology';

export default function EdgeValidation() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('summary');
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [source, setSource] = useState('');
  const [mode, setMode] = useState<'all' | 'demo' | 'live'>('all');
  const [location, setLocation] = useState('');

  useEffect(() => { reload(); }, []);

  function buildQS() {
    const p = new URLSearchParams();
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    if (source) p.set('source', source);
    if (location) p.set('location', location);
    if (mode !== 'all') p.set('mode', mode);
    return p.toString();
  }
  async function reload() {
    setLoading(true);
    try {
      const q = buildQS();
      const res = await fetch(`/api/admin/edge-validation${q ? `?${q}` : ''}`, { credentials: 'include' });
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

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading edge validation report…</div>;
  if (!data || data.error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {data?.error || 'unknown'}</div>;

  const o = data.overall;
  const fmtPct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(2)}%`;
  const fmtSigned = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
  const fmtCents = (v: number | null) => v == null ? '—' : `$${(v / 100).toFixed(2)}`;
  const fmtZ = (v: number | null) => v == null ? '—' : v.toFixed(2);
  const fmtP = (v: number | null) => v == null ? '—' : v < 0.0001 ? '<0.0001' : v.toFixed(4);
  const verdictBadge = (verdict: string) => <span style={badge(verdictColor[verdict] ?? '#64748b')}>{verdict.toUpperCase()}</span>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/edge-validation" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Edge Validation</h1>
          <p style={{ margin: '0 0 8px', fontSize: 14, color: '#94a3b8', maxWidth: 760 }}>
            Decision-grade quant: do calibrated signals produce statistically reliable positive edge over time?
            Realized vs Expected, Z-scores, 95% CIs, segment verdicts. Read-only.
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
        <select style={inputStyle} value={mode} onChange={e => setMode(e.target.value as any)}>
          <option value="all">all modes</option>
          <option value="demo">demo only</option>
          <option value="live">live only</option>
        </select>
        <input style={{ ...inputStyle, minWidth: 160 }} value={location} onChange={e => setLocation(e.target.value)} placeholder="location contains" />
        <button onClick={reload} style={btn('#6366f1')}>Apply</button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['summary', 'Summary'],
          ['segments', 'Segments'],
          ['visuals', 'Visuals'],
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
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Total trades</div><div style={{ fontSize: 24, fontWeight: 700 }}>{o.total}</div><div style={{ fontSize: 10, color: '#64748b' }}>{o.withPnl} settled</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Win rate</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtPct(o.hitRate)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Expected edge (EV)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtSigned(o.expectedEdge)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Realized edge (RV)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtSigned(o.realizedEdge)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Edge gap (RV − EV)</div><div style={{ fontSize: 24, fontWeight: 700, color: (o.edgeGap ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSigned(o.edgeGap)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Z-score</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtZ(o.zScore)}</div><div style={{ fontSize: 10, color: '#64748b' }}>p = {fmtP(o.pValue)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Total P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: o.totalPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtCents(o.totalPnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Sharpe-like</div><div style={{ fontSize: 24, fontWeight: 700 }}>{o.sharpeLike != null ? o.sharpeLike.toFixed(2) : '—'}</div><div style={{ fontSize: 10, color: '#64748b' }}>mean / std (informational)</div></div>
          </div>
          <div style={card}>
            <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700 }}>Overall verdict</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {verdictBadge(o.verdict)}
              {o.ci95Low != null && o.ci95High != null && (
                <span style={{ color: '#94a3b8', fontSize: 13 }}>
                  95% CI on hit rate: <strong style={{ color: '#e2e8f0' }}>{(o.ci95Low * 100).toFixed(1)}% – {(o.ci95High * 100).toFixed(1)}%</strong>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'segments' && (
        <div>
          {[
            { title: 'By source',     rows: data.bySource },
            { title: 'By confidence', rows: data.byConfidence },
            { title: 'By sizing tier', rows: data.byTier },
            { title: 'By edge bucket', rows: data.byEdgeBucket },
            { title: 'By horizon',    rows: data.byHorizon },
          ].map(group => (
            <div key={group.title} style={card}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>{group.title}</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Segment</th>
                      <th style={th}>n (decisive)</th>
                      <th style={th}>Win rate</th>
                      <th style={th}>EV</th>
                      <th style={th}>RV</th>
                      <th style={th}>Gap</th>
                      <th style={th}>Z</th>
                      <th style={th}>p</th>
                      <th style={th}>Total P&L</th>
                      <th style={th}>Sharpe-like</th>
                      <th style={th}>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.length === 0 && <tr><td colSpan={11} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No segments.</td></tr>}
                    {group.rows.map((s: any) => (
                      <tr key={s.segment}>
                        <td style={td}><strong>{s.segment}</strong></td>
                        <td style={td}>{s.wins + s.losses}</td>
                        <td style={td}>{fmtPct(s.hitRate)}</td>
                        <td style={td}>{fmtSigned(s.expectedEdge)}</td>
                        <td style={td}>{fmtSigned(s.realizedEdge)}</td>
                        <td style={{ ...td, color: (s.edgeGap ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSigned(s.edgeGap)}</td>
                        <td style={td}>{fmtZ(s.zScore)}</td>
                        <td style={td}>{fmtP(s.pValue)}</td>
                        <td style={{ ...td, color: s.totalPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtCents(s.totalPnlCents)}</td>
                        <td style={td}>{s.sharpeLike != null ? s.sharpeLike.toFixed(2) : '—'}</td>
                        <td style={td}>{verdictBadge(s.verdict)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'visuals' && (
        <div>
          {/* EV vs RV by source */}
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>EV vs RV by source</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Side-by-side bars: expected edge (calibratedEdge avg) vs realized edge (winRate − 0.5). Same units.</p>
            {data.evVsRv.length === 0 ? <EmptyChart title="EV vs RV" message="No source-segmented data yet." /> : (
              <BarChart
                signColored
                valueFormatter={(v: number) => `${(v * 100).toFixed(2)}%`}
                data={data.evVsRv.flatMap((row: any) => [
                  { label: `${row.segment}\nEV`, value: row.ev ?? 0, color: '#94a3b8' },
                  { label: `${row.segment}\nRV`, value: row.rv ?? 0, color: (row.rv ?? 0) > (row.ev ?? 0) ? '#22c55e' : '#ef4444' },
                ])}
              />
            )}
          </div>

          {/* Cumulative P&L curve */}
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Cumulative P&L curve</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Settled trades in chronological order. Y axis is dollars.</p>
            {data.pnlCurve.length === 0 ? <EmptyChart title="Cumulative P&L" message="No settled trades yet." /> : (
              <LineChart
                yLabel="Cumulative $"
                valueFormatter={(v: number) => `$${(v / 100).toFixed(2)}`}
                data={data.pnlCurve.map((p: any) => ({ x: `#${p.idx}`, y: p.cumulativePnlCents }))}
              />
            )}
          </div>

          {/* CI bands per source */}
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>95% CI on hit rate (by source)</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Bars show CI low and CI high; the visual gap is the uncertainty band on the realized hit rate.</p>
            {(() => {
              const rows = data.bySource.filter((s: any) => s.ci95Low != null && s.ci95High != null);
              if (rows.length === 0) return <EmptyChart title="95% CI" message="Need decisive trades to compute hit-rate CIs." />;
              return (
                <BarChart
                  valueFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                  data={rows.flatMap((s: any) => [
                    { label: `${s.segment}\nCI low`,  value: s.ci95Low,  color: '#94a3b8' },
                    { label: `${s.segment}\nhit`,     value: s.hitRate,  color: '#3b82f6' },
                    { label: `${s.segment}\nCI high`, value: s.ci95High, color: '#94a3b8' },
                  ])}
                />
              );
            })()}
          </div>

          {/* Step 77: Segment verdict heatmap */}
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Segment verdict heatmap</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>
              Across all 5 segmentations, color shows verdict: <span style={{ color: '#22c55e' }}>● Validated</span> &nbsp;
              <span style={{ color: '#3b82f6' }}>● Neutral</span> &nbsp;
              <span style={{ color: '#ef4444' }}>● Overestimated</span> &nbsp;
              <span style={{ color: '#64748b' }}>● Insufficient</span>
            </p>
            <VerdictHeatmap data={data} />
          </div>

          {/* Step 77: Edge gap waterfall */}
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Edge gap waterfall</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>
              Where does the expected edge go? Raw edge → calibrated edge (after Step 70 reliability) → realized edge (hit rate − 0.5) → net P&L per trade. Colors flag drops and gains.
            </p>
            <EdgeGapWaterfall data={data} />
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

// ── Step 77 visuals ─────────────────────────────────────────────────────────

const VERDICT_COLORS: Record<string, string> = {
  'Validated Edge': '#22c55e',
  'Overestimated': '#ef4444',
  'Neutral': '#3b82f6',
  'Insufficient sample': '#64748b',
};

interface VerdictHeatmapProps {
  data: {
    bySource: any[]; byConfidence: any[]; byTier: any[]; byEdgeBucket: any[]; byHorizon: any[];
  };
}

function VerdictHeatmap({ data }: VerdictHeatmapProps) {
  const groups = [
    { label: 'Source',     rows: data.bySource },
    { label: 'Confidence', rows: data.byConfidence },
    { label: 'Tier',       rows: data.byTier },
    { label: 'Edge bucket', rows: data.byEdgeBucket },
    { label: 'Horizon',    rows: data.byHorizon },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {groups.map(g => (
        <div key={g.label}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>{g.label}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {g.rows.length === 0 && <span style={{ fontSize: 12, color: '#64748b' }}>no data</span>}
            {g.rows.map((s: any) => (
              <div key={s.segment} style={{
                background: VERDICT_COLORS[s.verdict] ?? '#64748b',
                color: '#fff',
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: 11,
                minWidth: 92,
              }} title={`${s.verdict}\nWin rate: ${s.hitRate != null ? (s.hitRate * 100).toFixed(1) : '—'}%\nn = ${s.wins + s.losses}\nZ = ${s.zScore != null ? s.zScore.toFixed(2) : '—'}`}>
                <div style={{ fontWeight: 700 }}>{s.segment}</div>
                <div style={{ fontSize: 10, opacity: 0.85 }}>n={s.wins + s.losses}{s.hitRate != null ? `, ${(s.hitRate * 100).toFixed(0)}%` : ''}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface EdgeGapWaterfallProps {
  data: {
    bySource: any[];
    overall: any;
  };
}

function EdgeGapWaterfall({ data }: EdgeGapWaterfallProps) {
  // For each source segment with enough data, render a 4-bar mini-chart:
  //   raw edge (≈ rawEdge candidate)  — currently same as expectedEdge in Step 76
  //   calibrated edge (expectedEdge after Step 70)
  //   realized edge (RV)
  //   avg P&L (in cents) — different units, plotted on its own scale
  const sources = data.bySource.filter((s: any) => s.withPnl > 0);
  if (sources.length === 0) {
    return <EmptyChart title="Edge gap waterfall" message="No source segments with settled trades yet." />;
  }
  const fmtPct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(2)}%`;
  const fmtCents = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v}¢`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sources.map((s: any) => {
        const stages = [
          { label: 'EV (calibrated)', value: s.expectedEdge ?? 0, units: 'pct' },
          { label: 'Realized (RV)',   value: s.realizedEdge ?? 0, units: 'pct' },
          { label: 'Edge gap',        value: s.edgeGap ?? 0,      units: 'pct' },
          { label: 'Avg P&L',         value: s.avgPnlCents ?? 0,  units: 'cents' },
        ];
        const pctStages = stages.filter(st => st.units === 'pct').map(st => st.value);
        const maxAbsPct = Math.max(0.001, ...pctStages.map(Math.abs));
        const maxAbsCents = Math.max(1, Math.abs(s.avgPnlCents ?? 0));
        return (
          <div key={s.segment} style={{ background: '#0f172a', padding: 12, borderRadius: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{s.segment}</div>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: VERDICT_COLORS[s.verdict] ?? '#64748b', color: '#fff', fontWeight: 600 }}>{s.verdict}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              {stages.map((st, i) => {
                const isCents = st.units === 'cents';
                const range = isCents ? maxAbsCents : maxAbsPct;
                const pct = Math.abs(st.value) / range;
                const positive = st.value >= 0;
                const barH = Math.max(4, Math.round(pct * 80));
                return (
                  <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      height: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                    }}>
                      <div style={{
                        width: '70%',
                        height: barH,
                        background: positive ? '#22c55e' : '#ef4444',
                        borderRadius: 4,
                        opacity: 0.85,
                      }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#e2e8f0', marginTop: 4, fontWeight: 600 }}>
                      {isCents ? fmtCents(st.value as number) : fmtPct(st.value as number)}
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>{st.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
