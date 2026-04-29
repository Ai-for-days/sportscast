import React, { useEffect, useState } from 'react';
import AdminEmptyState from './AdminEmptyState';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const sevColor: Record<string, string> = { 'low concern': '#22c55e', 'moderate concern': '#f59e0b', 'high concern': '#ef4444', 'unknown / insufficient evidence': '#64748b' };
const testStatusColor: Record<string, string> = { available: '#22c55e', partially_available: '#f59e0b', not_available: '#64748b' };

export default function QuantEdgeAudit() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'verdict' | 'forecast' | 'pricing' | 'signals' | 'mistakes' | 'tests'>('verdict');

  useEffect(() => { fetch('/api/admin/system/quant-edge-audit').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, []);

  const navLinks = [
    { href: '/admin/system/quant-review', label: 'Quant Review' },
    { href: '/admin/system/quant-edge-audit', label: 'Quant Edge Audit', active: true },
    { href: '/admin/system/calibration-lab', label: 'Calibration Lab' },
    { href: '/admin/system/calibration-backtest', label: 'Calibration Backtest' },
    { href: '/admin/system/outcome-evaluation', label: 'Outcome Evaluation' },
    { href: '/admin/system/pre-launch-audit', label: 'Pre-Launch Audit' },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading quant edge audit...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load audit data.</div>;

  const { forecast: f, pricing: p, signals: s, quantMistakes, statTests, verdict } = data;

  // Empty-state guard: forecast and signal sample sizes are both zero on a fresh install
  if ((!f || f.sampleSize === 0) && (!s || s.sampleSize === 0) && (!p || (p.candidates ?? 0) === 0)) {
    return (
      <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {navLinks.map(l => <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>)}
        </div>
        <h1 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 800 }}>Quant Edge Audit</h1>
        <AdminEmptyState
          title="Not enough data to audit yet"
          description="The quant edge audit assesses forecast calibration, pricing credibility, and signal edge quality. It needs forecasts, candidates, and ideally settled orders to produce meaningful numbers."
          steps={[
            <>Generate forecasts at <a href="/admin/forecasts" style={{ color: '#6366f1' }}>/admin/forecasts</a> so the verification log fills in.</>,
            <>Run pricing at <a href="/admin/pricing-lab" style={{ color: '#6366f1' }}>/admin/pricing-lab</a> and create execution candidates.</>,
            <>Submit demo orders, settle them, and run reconciliation so realized P&L is recorded.</>,
          ]}
          links={[{ href: '/admin/system/calibration-lab', label: 'Calibration Lab' }, { href: '/admin/system/quant-review', label: 'Quant Review' }]}
        />
      </div>
    );
  }

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>)}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Quant Edge Audit</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>Rigorous quantitative assessment of forecast calibration, pricing credibility, and signal edge quality.</p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['verdict', 'forecast', 'pricing', 'signals', 'mistakes', 'tests'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 16px', fontSize: 13 }}>
            {t === 'verdict' ? 'Verdict' : t === 'forecast' ? 'Forecast' : t === 'pricing' ? 'Pricing' : t === 'signals' ? 'Signals' : t === 'mistakes' ? 'Quant Risks' : 'Stat Tests'}
          </button>
        ))}
      </div>

      {/* VERDICT */}
      {tab === 'verdict' && (
        <div>
          <div style={{ ...card, background: '#1a1a2e', borderLeft: '4px solid #f59e0b' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800 }}>Quant Audit Verdict</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={{ ...td, fontWeight: 600 }}>Forecast Evidence</td><td style={td}>{verdict.forecastEvidence}</td></tr>
                <tr><td style={{ ...td, fontWeight: 600 }}>Pricing Evidence</td><td style={td}>{verdict.pricingEvidence}</td></tr>
                <tr><td style={{ ...td, fontWeight: 600 }}>Signal Evidence</td><td style={td}>{verdict.signalEvidence}</td></tr>
                <tr><td style={{ ...td, fontWeight: 600, color: '#fca5a5' }}>Overall Readiness</td><td style={{ ...td, color: '#fca5a5' }}>{verdict.overallReadiness}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FORECAST */}
      {tab === 'forecast' && (
        <div>
          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Forecasts</div><div style={{ fontSize: 24, fontWeight: 700 }}>{f.totalForecasts}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Verifications</div><div style={{ fontSize: 24, fontWeight: 700 }}>{f.totalVerifications}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Sample Size</div><div style={{ fontSize: 24, fontWeight: 700 }}>{f.sampleSize}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>MAE</div><div style={{ fontSize: 24, fontWeight: 700 }}>{f.mae != null ? f.mae : '—'}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Bias</div><div style={{ fontSize: 24, fontWeight: 700 }}>{f.meanBias != null ? f.meanBias : '—'}</div></div>
          </div>
          {f.sourceComparison.length > 0 && (
            <div style={card}>
              <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Source Comparison</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Source</th><th style={th}>MAE</th><th style={th}>Bias</th><th style={th}>Samples</th></tr></thead>
                <tbody>{f.sourceComparison.map((s: any) => <tr key={s.source}><td style={td}><span style={{ fontWeight: 600 }}>{s.label}</span></td><td style={td}>{s.mae}</td><td style={td}>{s.bias}</td><td style={td}>{s.count}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <div style={card}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Quality Assessment</h3>
            <p style={{ fontSize: 13, color: '#cbd5e1', margin: '0 0 8px' }}>{f.qualityAssessment}</p>
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>{f.calibrationNote}</p>
          </div>
          <div style={card}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Missing for Rigorous Assessment</h3>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{f.missing.map((m: string, i: number) => <li key={i} style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{m}</li>)}</ul>
          </div>
        </div>
      )}

      {/* PRICING */}
      {tab === 'pricing' && (
        <div>
          <div style={grid4}><div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Markets</div><div style={{ fontSize: 24, fontWeight: 700 }}>{p.totalMarkets}</div></div></div>
          <div style={card}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Pricing Usefulness Assessment</h3>
            <p style={{ fontSize: 13, color: '#cbd5e1', margin: '0 0 8px' }}>{p.assessment}</p>
            <p style={{ fontSize: 13, color: '#fca5a5', margin: '0 0 8px' }}>{p.frictionAwareness}</p>
          </div>
          <div style={card}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Missing for Deeper Analysis</h3>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{p.missing.map((m: string, i: number) => <li key={i} style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{m}</li>)}</ul>
          </div>
        </div>
      )}

      {/* SIGNALS */}
      {tab === 'signals' && (
        <div>
          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Signals</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.totalSignals}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Avg |Edge|</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.rawAvgEdge != null ? `${(s.rawAvgEdge * 100).toFixed(1)}%` : '—'}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Below 3%</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{s.belowThreePercentShare != null ? `${s.belowThreePercentShare}%` : '—'}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Candidates</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.candidateCount}</div></div>
          </div>
          <div style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Friction Haircut Analysis</h3>
            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>How many signals survive after accounting for execution friction.</p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Haircut</th><th style={th}>Signals</th><th style={th}>Surviving</th><th style={th}>Eliminated</th><th style={th}>Survival Rate</th><th style={th}>Avg Surviving Edge</th></tr></thead>
              <tbody>{(s.haircutAnalysis || []).map((h: any) => (
                <tr key={h.haircut}>
                  <td style={td}><span style={{ fontWeight: 600 }}>{h.haircut}</span></td>
                  <td style={td}>{h.totalSignals}</td>
                  <td style={td}><span style={{ color: '#22c55e' }}>{h.surviving}</span></td>
                  <td style={td}><span style={{ color: '#ef4444' }}>{h.eliminated}</span></td>
                  <td style={td}><span style={{ fontWeight: 700 }}>{h.survivalRate}%</span></td>
                  <td style={td}>{h.avgSurvivingEdge > 0 ? `${(h.avgSurvivingEdge * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ ...card, background: '#0f172a', fontSize: 12, color: '#64748b' }}>{s.qualityNote}</div>
        </div>
      )}

      {/* QUANT MISTAKES */}
      {tab === 'mistakes' && (
        <div style={{ ...card, background: '#1a1a2e', borderLeft: '4px solid #ef4444' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800, color: '#fca5a5' }}>Three Quant Mistakes That Destroy Prediction-Market Trading Systems</h3>
          {quantMistakes.map((m: any, i: number) => (
            <div key={i} style={{ ...card, background: '#1e293b', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{i + 1}. {m.title}</h4>
                <span style={badge(sevColor[m.severity] || '#64748b')}>{m.severity.toUpperCase()}</span>
              </div>
              <div style={{ fontSize: 13, marginBottom: 8 }}><strong style={{ color: '#94a3b8' }}>What it means:</strong> <span style={{ color: '#cbd5e1' }}>{m.meaning}</span></div>
              <div style={{ fontSize: 13, marginBottom: 8 }}><strong style={{ color: '#94a3b8' }}>Current evidence:</strong> <span style={{ color: '#cbd5e1' }}>{m.evidence}</span></div>
              <div style={{ fontSize: 13, marginBottom: 8 }}><strong style={{ color: '#94a3b8' }}>Missing:</strong> <span style={{ color: '#f59e0b' }}>{m.missing}</span></div>
              <div style={{ fontSize: 13 }}><strong style={{ color: '#94a3b8' }}>Caution:</strong> <span style={{ color: '#fca5a5' }}>{m.caution}</span></div>
            </div>
          ))}
        </div>
      )}

      {/* STATISTICAL TESTS */}
      {tab === 'tests' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Statistical Tests a Professional Desk Would Want</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Availability of standard quantitative diagnostics based on current platform data.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Test</th><th style={th}>Category</th><th style={th}>Status</th><th style={th}>Value</th><th style={th}>Notes</th></tr></thead>
            <tbody>{statTests.map((t: any) => (
              <tr key={t.name}>
                <td style={td}><span style={{ fontWeight: 600 }}>{t.name}</span></td>
                <td style={td}><span style={{ fontSize: 12, color: '#94a3b8' }}>{t.category}</span></td>
                <td style={td}><span style={badge(testStatusColor[t.status] || '#64748b')}>{t.status.replace('_', ' ').toUpperCase()}</span></td>
                <td style={td}>{t.value || '—'}</td>
                <td style={td}><span style={{ fontSize: 11, color: '#64748b' }}>{t.note || ''}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
