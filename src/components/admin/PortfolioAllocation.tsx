import React, { useEffect, useState } from 'react';
import { BarChart, EmptyChart } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const modeColor: Record<string, string> = {
  decision_support: '#64748b',
  operator_approved: '#3b82f6',
  systematic_research: '#a855f7',
};
const modeBlurb: Record<string, string> = {
  decision_support: 'Sizing shown is informational. Operator decides everything manually.',
  operator_approved: 'Sizing flagged for operator review. No automatic candidate creation or execution.',
  systematic_research: 'Full portfolio allocation view. Filter to eligible-only signals. Live execution remains manual.',
};

type Tab = 'summary' | 'records' | 'charts' | 'methodology';

export default function PortfolioAllocation() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('summary');
  const [eligibleOnly, setEligibleOnly] = useState(true);

  useEffect(() => { reload(); }, []);
  async function reload() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/portfolio-allocation', { credentials: 'include' });
      const j = await res.json();
      setData(j);
    } catch { setData({ error: 'Failed to load' }); }
    setLoading(false);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading portfolio allocation…</div>;
  if (!data || data.error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {data?.error || 'unknown'}</div>;

  const s = data.summary;
  const fmtCents = (v: number | null | undefined) => v == null ? '—' : `$${(v / 100).toFixed(2)}`;
  const fmtPct = (v: number | null | undefined) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
  const fmtFrac = (v: number | null | undefined) => v == null ? '—' : `${(v * 100).toFixed(2)}%`;

  const filteredRecords = (data.records ?? []).filter((r: any) => !eligibleOnly || r.systematicEligible);

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/portfolio-allocation" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Portfolio Allocation</h1>
            {data.strategyMode && (
              <a href="/admin/system/strategy-mode" style={{ ...badge(modeColor[data.strategyMode] ?? '#64748b'), textDecoration: 'none', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                MODE: {data.strategyMode.replace(/_/g, ' ')}
              </a>
            )}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94a3b8', maxWidth: 760 }}>
            Sizing recommendations for systematicEligible signals. {modeBlurb[data.strategyMode] ?? ''}
          </p>
        </div>
        <button onClick={reload} style={btn('#3b82f6')}>Refresh</button>
      </div>

      {data.summary.warnings.length > 0 && (
        <div style={{ ...card, background: '#3b1d1d', borderLeft: '4px solid #ef4444' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#fca5a5' }}>Risk concentration warnings</h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {data.summary.warnings.map((w: string, i: number) => <li key={i} style={{ marginBottom: 3 }}>{w}</li>)}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['summary', 'Summary'],
          ['records', `Records (${filteredRecords.length})`],
          ['charts', 'Charts'],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
        {tab === 'records' && (
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#cbd5e1' }}>
            <input type="checkbox" checked={eligibleOnly} onChange={e => setEligibleOnly(e.target.checked)} />
            Show eligible only
          </label>
        )}
      </div>

      {tab === 'summary' && (
        <div>
          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Eligible signals</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.totalEligible}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Allocated (stake &gt; 0)</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{s.totalAllocated}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Total recommended (raw)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCents(s.totalRecommendedExposureCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Total after caps</div><div style={{ fontSize: 24, fontWeight: 700, color: s.totalCappedExposureCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtCents(s.totalCappedExposureCents)}</div><div style={{ fontSize: 10, color: '#64748b' }}>portfolio cap {fmtCents(data.config.MAX_PORTFOLIO_CENTS)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Avg stake</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCents(s.avgStakeCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Max stake (single)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCents(s.maxRecord?.cappedStakeCents)}</div><div style={{ fontSize: 10, color: '#64748b', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.maxRecord?.title}>{s.maxRecord?.title ?? '—'}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Bankroll</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCents(data.config.BANKROLL_CENTS)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Risk scaling</div><div style={{ fontSize: 24, fontWeight: 700 }}>{(data.config.RISK_SCALING_FACTOR * 100).toFixed(0)}%</div><div style={{ fontSize: 10, color: '#64748b' }}>fractional Kelly</div></div>
          </div>

          {/* Risk buckets */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {[
              { title: 'By source', rows: s.riskBuckets.bySource.map((r: any) => ({ key: r.source, cents: r.cents, pct: r.pct })) },
              { title: 'By city',   rows: s.riskBuckets.byCity.map((r: any) =>   ({ key: r.city,   cents: r.cents, pct: r.pct })) },
              { title: 'By date',   rows: s.riskBuckets.byDate.map((r: any) =>   ({ key: r.date,   cents: r.cents, pct: r.pct })) },
              { title: 'By metric', rows: s.riskBuckets.byMetric.map((r: any) => ({ key: r.metric, cents: r.cents, pct: r.pct })) },
            ].map(g => (
              <div key={g.title} style={card}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>{g.title}</h4>
                {g.rows.length === 0 && <div style={{ color: '#64748b', fontSize: 12 }}>no exposure</div>}
                {g.rows.slice(0, 8).map((r: any) => (
                  <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
                    <span style={{ color: '#cbd5e1', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.key}>{r.key}</span>
                    <span style={{ color: r.pct > 0.4 ? '#fbbf24' : '#e2e8f0' }}>{fmtCents(r.cents)} <span style={{ color: '#64748b' }}>({fmtPct(r.pct)})</span></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'records' && (
        <div style={card}>
          {filteredRecords.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              {eligibleOnly ? 'No systematic-eligible signals at the moment.' : 'No allocation records.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Signal</th>
                    <th style={th}>Side</th>
                    <th style={th}>Cal edge</th>
                    <th style={th}>Reliability</th>
                    <th style={th}>Kelly fraction</th>
                    <th style={th}>Adjusted</th>
                    <th style={th}>Recommended</th>
                    <th style={th}>Capped</th>
                    <th style={th}>Cap reason</th>
                    <th style={th}>Formula</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((r: any) => (
                    <tr key={r.signalId}>
                      <td style={{ ...td, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.title}>{r.title}</td>
                      <td style={td}>{r.side ?? '—'}</td>
                      <td style={td}>{r.calibratedEdge != null ? `${(r.calibratedEdge * 100).toFixed(2)}%` : '—'}</td>
                      <td style={td}>{r.reliabilityFactor != null ? `${(r.reliabilityFactor * 100).toFixed(0)}%` : '—'}</td>
                      <td style={td}>{fmtFrac(r.kellyFraction)}</td>
                      <td style={td}>{fmtFrac(r.adjustedFraction)}</td>
                      <td style={td}>{fmtCents(r.rawRecommendedStakeCents)}</td>
                      <td style={{ ...td, color: r.cappedStakeCents > 0 ? '#22c55e' : '#64748b', fontWeight: 700 }}>{fmtCents(r.cappedStakeCents)}</td>
                      <td style={{ ...td, fontSize: 11, color: '#fbbf24' }}>{r.capReason ?? ''}</td>
                      <td style={td}><span style={badge(r.kellyFormula === 'kelly' ? '#22c55e' : '#64748b')}>{r.kellyFormula}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'charts' && (
        <div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Exposure by source</h4>
            {s.riskBuckets.bySource.length === 0
              ? <EmptyChart title="By source" message="No allocated exposure yet." />
              : <BarChart valueFormatter={(v) => fmtCents(v)} data={s.riskBuckets.bySource.map((r: any) => ({ label: r.source, value: r.cents }))} />}
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Exposure by city (top 10)</h4>
            {s.riskBuckets.byCity.length === 0
              ? <EmptyChart title="By city" message="No city-level exposure." />
              : <BarChart valueFormatter={(v) => fmtCents(v)} data={s.riskBuckets.byCity.slice(0, 10).map((r: any) => ({ label: r.city, value: r.cents, sublabel: fmtPct(r.pct) }))} />}
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Stake distribution</h4>
            {(() => {
              const records = filteredRecords.filter((r: any) => r.cappedStakeCents > 0);
              if (records.length === 0) return <EmptyChart title="Stake distribution" message="No allocated stakes." />;
              // Bucket by $5 increments up to $50
              const buckets = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];
              const histo = buckets.map((min, i) => {
                const max = buckets[i + 1] ?? Infinity;
                const inBucket = records.filter((r: any) => r.cappedStakeCents >= min && r.cappedStakeCents < max);
                return { label: `$${min / 100}-${max === Infinity ? '+' : (max / 100).toFixed(0)}`, value: inBucket.length };
              });
              return <BarChart valueFormatter={(v) => `${v}`} data={histo} />;
            })()}
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
