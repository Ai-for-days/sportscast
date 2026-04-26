import React, { useEffect, useState } from 'react';
import { BarChart, LineChart, EmptyChart, HeatmapGrid } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 700, background: bg, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 });
const inputStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 };

const verdictColor: Record<string, string> = {
  'Healthy': '#22c55e', 'Watch': '#3b82f6', 'Risky': '#f59e0b', 'Unsafe': '#ef4444',
};
const warnColor: Record<string, string> = {
  'low': '#22c55e', 'medium': '#f59e0b', 'high': '#ef4444', 'critical': '#7f1d1d',
};

type Tab = 'summary' | 'mc' | 'stress' | 'drawdown' | 'concentration' | 'methodology';

export default function AllocationStressTest() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('summary');
  const [sims, setSims] = useState(1000);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { reload(sims); }, []);

  async function reload(n: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/system/allocation-stress-test?simulations=${n}`, { credentials: 'include' });
      const j = await res.json();
      setData(j);
    } catch { setData({ error: 'Failed to load' }); }
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    await reload(sims);
    setRefreshing(false);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Running simulations…</div>;
  if (!data || data.error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {data?.error || 'unknown'}</div>;

  const mc = data.monteCarlo;
  const v = data.verdict;
  const a = data.allocationSummary;
  const fmtCents = (v: number | null | undefined) => v == null ? '—' : `$${(v / 100).toFixed(2)}`;
  const fmtSignedCents = (v: number | null | undefined) => v == null ? '—' : `${v >= 0 ? '+' : ''}$${(v / 100).toFixed(2)}`;
  const fmtPct = (v: number | null | undefined) => v == null ? '—' : `${v.toFixed(1)}%`;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/allocation-stress-test" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Allocation Stress Test</h1>
            <span style={badge(verdictColor[v.verdict] ?? '#64748b')}>{v.verdict}</span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94a3b8', maxWidth: 760 }}>
            Would the Step 78 allocation survive realistic losing streaks, drawdowns, and correlated failures?
            Read-only simulation — no execution changes.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#cbd5e1' }}>{v.reason}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>simulations</label>
          <input type="number" min={50} max={10000} step={100} value={sims} onChange={e => setSims(parseInt(e.target.value, 10) || 1000)} style={{ ...inputStyle, width: 100 }} />
          <button onClick={refresh} disabled={refreshing} style={btn('#3b82f6')}>{refreshing ? 'Running…' : 'Re-run'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['summary', 'Summary'],
          ['mc', 'Monte Carlo'],
          ['stress', 'Stress Scenarios'],
          ['drawdown', 'Drawdown'],
          ['concentration', 'Concentration'],
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
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Allocated signals</div><div style={{ fontSize: 24, fontWeight: 700 }}>{a.signals}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Total allocated</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCents(a.totalAllocatedCents)}</div><div style={{ fontSize: 10, color: '#64748b' }}>bankroll {fmtCents(a.bankrollCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Expected P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: mc.expectedPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSignedCents(mc.expectedPnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Median sim P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: mc.medianPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSignedCents(mc.medianPnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>5th percentile P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: mc.p5PnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSignedCents(mc.p5PnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Worst-case drawdown</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{fmtCents(mc.worstMaxDrawdownCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Probability of loss</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtPct(mc.probLoss)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Verdict</div><div style={{ fontSize: 24, fontWeight: 800, color: verdictColor[v.verdict] }}>{v.verdict}</div></div>
          </div>

          <div style={card}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Loss-tail probabilities</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <Tile label="Any loss"           value={fmtPct(mc.probLoss)}      color="#94a3b8" />
              <Tile label="Lose &gt;10% of capital" value={fmtPct(mc.probLoss10Pct)} color="#f59e0b" />
              <Tile label="Lose &gt;20% of capital" value={fmtPct(mc.probLoss20Pct)} color="#ef4444" />
              <Tile label="Lose &gt;30% of capital" value={fmtPct(mc.probLoss30Pct)} color="#7f1d1d" />
              <Tile label="Longest losing streak" value={`${mc.longestLosingStreak}`} color="#cbd5e1" />
            </div>
          </div>
        </div>
      )}

      {tab === 'mc' && (
        <div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Final P&L distribution</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>{mc.simulations} simulations. Each bar is a bucket of final portfolio P&Ls.</p>
            {mc.histogram.length === 0
              ? <EmptyChart title="P&L distribution" message="No allocated signals to simulate." />
              : <BarChart valueFormatter={(v: number) => `${v}`} data={mc.histogram.map((h: any) => ({ label: fmtSignedCents(h.binCenter), value: h.count }))} />
            }
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Quantiles</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Statistic</th><th style={th}>Value</th></tr></thead>
              <tbody>
                {[
                  ['Mean', fmtSignedCents(mc.meanPnlCents)],
                  ['Std dev', fmtCents(mc.stdDevPnlCents)],
                  ['Worst', fmtSignedCents(mc.worstPnlCents)],
                  ['5th pct', fmtSignedCents(mc.p5PnlCents)],
                  ['25th pct', fmtSignedCents(mc.p25PnlCents)],
                  ['Median', fmtSignedCents(mc.medianPnlCents)],
                  ['75th pct', fmtSignedCents(mc.p75PnlCents)],
                  ['95th pct', fmtSignedCents(mc.p95PnlCents)],
                  ['Best', fmtSignedCents(mc.bestPnlCents)],
                ].map(([k, vv]) => (
                  <tr key={k as string}><td style={td}><strong>{k}</strong></td><td style={td}>{vv}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'stress' && (
        <div style={card}>
          <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Stress scenarios</h4>
          <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>Deterministic point estimates (not Monte Carlo). Each scenario isolates a single failure mode.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Scenario</th>
                <th style={th}>P&L</th>
                <th style={th}>Drawdown</th>
                <th style={th}>Affected exposure</th>
                <th style={th}>Warning</th>
                <th style={th}>Description</th>
              </tr>
            </thead>
            <tbody>
              {data.stressScenarios.map((s: any) => (
                <tr key={s.scenario}>
                  <td style={td}><strong>{s.label}</strong></td>
                  <td style={{ ...td, color: s.pnlCents >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{fmtSignedCents(s.pnlCents)}</td>
                  <td style={td}>{fmtCents(s.drawdownCents)}</td>
                  <td style={td}>{fmtCents(s.affectedExposureCents)}</td>
                  <td style={td}><span style={badge(warnColor[s.warning] ?? '#64748b')}>{s.warning}</span></td>
                  <td style={{ ...td, fontSize: 12, color: '#cbd5e1' }}>{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 16 }}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Stress P&L</h4>
            {data.stressScenarios.length === 0
              ? <EmptyChart title="Stress P&L" message="No allocated signals to stress-test." />
              : <BarChart signColored valueFormatter={(v: number) => fmtSignedCents(v)} data={data.stressScenarios.map((s: any) => ({ label: s.label.replace(/ /g, '\n'), value: s.pnlCents }))} />}
          </div>
        </div>
      )}

      {tab === 'drawdown' && (
        <div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Drawdown statistics</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <Tile label="Mean max drawdown"    value={fmtCents(mc.meanMaxDrawdownCents)}   color="#cbd5e1" />
              <Tile label="Median max drawdown"  value={fmtCents(mc.medianMaxDrawdownCents)} color="#f59e0b" />
              <Tile label="Worst max drawdown"   value={fmtCents(mc.worstMaxDrawdownCents)}  color="#ef4444" />
            </div>
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Sample cumulative-PnL paths</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Up to 50 sampled simulation paths. Random resolution order per path.</p>
            {mc.paths.length === 0
              ? <EmptyChart title="Sample paths" message="No allocated signals to simulate." />
              : (() => {
                  // Show one representative path (the worst by drawdown) as a line chart for clarity
                  const worstIdx = mc.paths.reduce((bi: number, p: any, i: number, arr: any[]) => {
                    const ddCur = Math.max(...arr[bi].cumulativePnl) - Math.min(...arr[bi].cumulativePnl);
                    const ddMe  = Math.max(...p.cumulativePnl)         - Math.min(...p.cumulativePnl);
                    return ddMe > ddCur ? i : bi;
                  }, 0);
                  const path = mc.paths[worstIdx].cumulativePnl;
                  return (
                    <LineChart
                      yLabel="Cumulative $"
                      valueFormatter={(v: number) => fmtSignedCents(v)}
                      data={path.map((c: number, i: number) => ({ x: `#${i + 1}`, y: c }))}
                    />
                  );
                })()
            }
          </div>
        </div>
      )}

      {tab === 'concentration' && (
        <div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Concentration heatmap</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>Allocated exposure as % of portfolio, by city / date / metric. Lighter = more concentrated.</p>
            {(() => {
              const all = [
                ...data.concentration.byCity.map((c: any) => ({ row: c.bucket, col: 'city', value: c.pctOfPortfolio })),
                ...data.concentration.byDate.map((c: any) => ({ row: c.bucket, col: 'date', value: c.pctOfPortfolio })),
                ...data.concentration.byMetric.map((c: any) => ({ row: c.bucket, col: 'metric', value: c.pctOfPortfolio })),
              ];
              if (all.length === 0) return <EmptyChart title="Concentration heatmap" message="No allocated exposure yet." />;
              const rows = Array.from(new Set(all.map(x => x.row)));
              return <HeatmapGrid cells={all} rowLabels={rows} colLabels={['city', 'date', 'metric']} valueFormatter={v => `${(v * 100).toFixed(0)}%`} />;
            })()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {[
              { title: 'By city',   rows: data.concentration.byCity },
              { title: 'By date',   rows: data.concentration.byDate },
              { title: 'By metric', rows: data.concentration.byMetric },
            ].map(g => (
              <div key={g.title} style={card}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>{g.title}</h4>
                {g.rows.length === 0 && <div style={{ color: '#64748b', fontSize: 12 }}>no exposure</div>}
                {g.rows.slice(0, 8).map((r: any) => (
                  <div key={r.bucket} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
                    <span style={{ color: '#cbd5e1', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.bucket}>{r.bucket}</span>
                    <span style={{ color: r.pctOfPortfolio > 0.4 ? '#fbbf24' : '#e2e8f0' }}>{fmtCents(r.cents)} <span style={{ color: '#64748b' }}>({(r.pctOfPortfolio * 100).toFixed(0)}%)</span></span>
                  </div>
                ))}
              </div>
            ))}
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

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
