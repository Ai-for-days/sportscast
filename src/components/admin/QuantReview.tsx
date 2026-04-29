import React, { useEffect, useState } from 'react';
import AdminEmptyState from './AdminEmptyState';
const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });
const sevColor: Record<string, string> = { low: '#22c55e', moderate: '#f59e0b', high: '#ef4444', unknown: '#64748b' };

export default function QuantReview() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'forecast' | 'pricing' | 'signals' | 'risks'>('forecast');
  useEffect(() => { fetch('/api/admin/system/quant-review').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, []);
  const navLinks = [{ href: '/admin/system/pipeline-cadence', label: 'Pipeline Cadence' }, { href: '/admin/system/quant-review', label: 'Quant Review', active: true }, { href: '/admin/system/pre-launch-audit', label: 'Pre-Launch Audit' }];
  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading quantitative review...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load.</div>;

  const f = data.forecast;
  const s = data.signals;

  // Empty-state guard so a fresh install doesn't show four tabs of zeros
  if ((!f || (f.totalForecasts ?? 0) === 0) && (!s || (s.totalSignals ?? 0) === 0)) {
    return (
      <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>{navLinks.map(l => <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>)}</div>
        <h1 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 800 }}>Quantitative Review</h1>
        <AdminEmptyState
          title="No forecasts or signals to review yet"
          description="This page summarizes forecast quality and signal diagnostics. It needs at least some forecasts and signals to populate."
          steps={[
            <>Generate forecasts at <a href="/admin/forecasts" style={{ color: '#6366f1' }}>/admin/forecasts</a>.</>,
            <>Run pricing or open the Signals dashboard to materialize signals.</>,
            <>Refresh this page once forecasts and signals exist.</>,
          ]}
          links={[{ href: '/admin/system/quant-edge-audit', label: 'Quant Edge Audit' }, { href: '/admin/system/calibration-lab', label: 'Calibration Lab' }]}
        />
      </div>
    );
  }

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>{navLinks.map(l => <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>)}</div>
      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Quantitative Review</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>Forecast quality, pricing behavior, signal diagnostics, and critical quant failure mode awareness.</p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['forecast', 'pricing', 'signals', 'risks'] as const).map(t => <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 18px', fontSize: 13 }}>{t === 'risks' ? 'Quant Risk Review' : t.charAt(0).toUpperCase() + t.slice(1) + ' Diagnostics'}</button>)}
      </div>

      {tab === 'forecast' && (
        <div>
          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Forecasts</div><div style={{ fontSize: 24, fontWeight: 700 }}>{f.totalForecasts}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Verifications</div><div style={{ fontSize: 24, fontWeight: 700 }}>{f.totalVerifications}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Consensus</div><div style={{ fontSize: 24, fontWeight: 700 }}>{f.totalConsensus}</div></div>
          </div>
          <div style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Tracked Forecast Sources</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Source</th><th style={th}>Label</th><th style={th}>Records (sample)</th><th style={th}>Status</th></tr></thead>
              <tbody>
                {f.trackedSources.map((src: string) => (
                  <tr key={src}>
                    <td style={td}><span style={{ fontWeight: 600 }}>{src}</span></td>
                    <td style={td}>{f.sourceLabels[src]}</td>
                    <td style={td}>{f.sourceDistribution[src] || 0}</td>
                    <td style={td}>{(f.sourceDistribution[src] || 0) > 0 ? <span style={badge('#22c55e')}>DATA</span> : <span style={badge('#64748b')}>NO DATA</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {f.nwsNote && <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>{f.nwsNote}</div>}
          </div>
        </div>
      )}

      {tab === 'pricing' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Pricing Diagnostics</h3>
          <div style={grid4}><div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Total Markets</div><div style={{ fontSize: 24, fontWeight: 700 }}>{data.pricing.totalMarkets}</div></div></div>
          <p style={{ fontSize: 13, color: '#94a3b8' }}>{data.pricing.note}</p>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>For detailed pricing analysis including vig, hold percentages, and spread distributions, use /admin/pricing-lab.</p>
        </div>
      )}

      {tab === 'signals' && (
        <div>
          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Total Signals</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.totalSignals}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Avg |Edge|</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.avgEdge != null ? `${(s.avgEdge * 100).toFixed(1)}%` : '—'}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Candidates</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.totalCandidates}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Conversion</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.conversionRate != null ? `${s.conversionRate}%` : '—'}</div></div>
          </div>
          {Object.keys(s.confidenceDistribution).length > 0 && (
            <div style={card}>
              <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Confidence Distribution</h3>
              <div style={{ display: 'flex', gap: 16 }}>{Object.entries(s.confidenceDistribution).map(([k, v]) => <div key={k} style={{ fontSize: 13 }}><span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{k}:</span> {v as number}</div>)}</div>
            </div>
          )}
          <div style={{ ...card, background: '#0f172a', fontSize: 12, color: '#64748b' }}>Note: Signal diagnostics are based on snapshot data. No systematic outcome tracking exists for resolved trades. Signal quality should be treated as indicative, not validated.</div>
        </div>
      )}

      {tab === 'risks' && (
        <div>
          <div style={{ ...card, background: '#1a1a2e', borderLeft: '4px solid #ef4444' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800, color: '#fca5a5' }}>Three Quant Mistakes That Destroy Prediction-Market Trading Systems</h3>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>These three failure modes account for the majority of prediction-market trading losses. The review below assesses this platform against each one honestly.</p>
            {data.quantRisks.map((risk: any, i: number) => (
              <div key={i} style={{ ...card, background: '#1e293b', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{i + 1}. {risk.title}</h4>
                  <span style={badge(sevColor[risk.severity])}>{risk.severity.toUpperCase()}</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {risk.findings.map((f: string, j: number) => <li key={j} style={{ marginBottom: 6, fontSize: 13, color: '#cbd5e1' }}>{f}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
