import React, { useEffect, useState } from 'react';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });
const evColor: Record<string, string> = { sufficient: '#22c55e', limited: '#f59e0b', insufficient: '#64748b', none: '#64748b', approaching: '#3b82f6', 'not yet trackable': '#64748b', 'not tracked in current schema': '#64748b', 'not yet implemented': '#64748b', 'insufficient data': '#64748b' };

function fmtUSD(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

export default function OutcomeEvaluation() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'edge' | 'confidence' | 'funnel' | 'proves' | 'next'>('overview');

  useEffect(() => { fetch('/api/admin/system/outcome-evaluation').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, []);

  const navLinks = [
    { href: '/admin/system/quant-edge-audit', label: 'Quant Edge Audit' },
    { href: '/admin/system/outcome-evaluation', label: 'Outcome Evaluation', active: true },
    { href: '/admin/system/quant-review', label: 'Quant Review' },
    { href: '/admin/system/calibration-lab', label: 'Calibration Lab' },
    { href: '/admin/system/calibration-backtest', label: 'Calibration Backtest' },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading outcome evaluation...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load evaluation data.</div>;

  const s = data.summary;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>)}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Outcome Evaluation</h1>
      <p style={{ margin: '0 0 4px', fontSize: 14, color: '#94a3b8' }}>Ex-post signal and execution evaluation — comparing expected edge to realized results.</p>
      <div style={{ marginBottom: 20 }}><span style={badge(evColor[s.overallEvidence])}>{s.overallEvidence === 'none' ? 'NO RESOLVED DATA' : s.overallEvidence === 'insufficient' ? 'INSUFFICIENT EVIDENCE' : 'LIMITED EVIDENCE'}</span></div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['overview', 'edge', 'confidence', 'funnel', 'proves', 'next'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {t === 'overview' ? 'Overview' : t === 'edge' ? 'Edge Buckets' : t === 'confidence' ? 'Confidence' : t === 'funnel' ? 'Funnel' : t === 'proves' ? 'What This Proves' : 'Next Tests'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Total Orders</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.totalOrders}</div><div style={{ fontSize: 10, color: '#64748b' }}>{s.demoOrders} demo / {s.liveOrders} live</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Filled</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{s.totalFilled}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Settled (P&L)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.settledWithPnl}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>Wins</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{s.wins}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>Losses</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{s.losses}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Pushes</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.pushes}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Total P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: s.totalPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{s.totalPnlCents != null ? fmtUSD(s.totalPnlCents) : '—'}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Avg P&L/Trade</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.avgPnlCents != null ? fmtUSD(s.avgPnlCents) : '—'}</div></div>
          </div>
          {s.settledWithPnl === 0 && <div style={{ ...card, background: '#0f172a', padding: 20, textAlign: 'center', color: '#64748b' }}>No settled outcomes yet. Execute trades and run settlement to populate this evaluation.</div>}
        </div>
      )}

      {tab === 'edge' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Edge Bucket Analysis</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Expected edge at signal generation vs realized outcomes. Only orders linked to candidates with edge data are included.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Edge Bucket</th><th style={th}>Count</th><th style={th}>Resolved</th><th style={th}>With P&L</th><th style={th}>Wins</th><th style={th}>Hit Rate</th><th style={th}>Avg P&L</th><th style={th}>Evidence</th></tr></thead>
            <tbody>{(data.edgeBuckets || []).map((b: any) => (
              <tr key={b.bucket}>
                <td style={td}><span style={{ fontWeight: 600 }}>{b.bucket}</span></td>
                <td style={td}>{b.count}</td>
                <td style={td}>{b.resolved}</td>
                <td style={td}>{b.withPnl}</td>
                <td style={td}>{b.wins}</td>
                <td style={td}>{b.hitRate != null ? `${b.hitRate}%` : '—'}</td>
                <td style={td}>{b.avgPnlCents != null ? fmtUSD(b.avgPnlCents) : '—'}</td>
                <td style={td}><span style={badge(evColor[b.evidenceLevel])}>{b.evidenceLevel.toUpperCase()}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'confidence' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Confidence Bucket Analysis</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Signal confidence level vs realized win rate.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Confidence</th><th style={th}>Count</th><th style={th}>With P&L</th><th style={th}>Wins</th><th style={th}>Hit Rate</th><th style={th}>Evidence</th></tr></thead>
            <tbody>{(data.confBuckets || []).map((b: any) => (
              <tr key={b.confidence}>
                <td style={td}><span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{b.confidence}</span></td>
                <td style={td}>{b.count}</td>
                <td style={td}>{b.withPnl}</td>
                <td style={td}>{b.wins}</td>
                <td style={td}>{b.hitRate != null ? `${b.hitRate}%` : '—'}</td>
                <td style={td}><span style={badge(evColor[b.evidenceLevel])}>{b.evidenceLevel.toUpperCase()}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'funnel' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Signal → Outcome Funnel</h3>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            {['signals', 'candidates', 'executions', 'filled', 'settled'].map((stage, i) => (
              <React.Fragment key={stage}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{(data.funnel as any)[stage]}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>{stage}</div>
                </div>
                {i < 4 && <div style={{ fontSize: 18, color: '#334155' }}>→</div>}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {tab === 'proves' && (
        <div>
          <div style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>What This Actually Proves</h3>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{(data.whatThisProves || []).map((p: string, i: number) => <li key={i} style={{ marginBottom: 8, fontSize: 13, color: '#cbd5e1' }}>{p}</li>)}</ul>
          </div>
          <div style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>What Remains Unproven</h3>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{(data.whatRemains || []).map((p: string, i: number) => <li key={i} style={{ marginBottom: 8, fontSize: 13, color: '#f59e0b' }}>{p}</li>)}</ul>
          </div>
        </div>
      )}

      {tab === 'next' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Professional Next Tests</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Tests a professional desk would want once enough resolved outcomes exist.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Test</th><th style={th}>Requirement</th><th style={th}>Current Status</th></tr></thead>
            <tbody>{(data.nextTests || []).map((t: any) => (
              <tr key={t.test}>
                <td style={td}><span style={{ fontWeight: 600 }}>{t.test}</span></td>
                <td style={td}><span style={{ fontSize: 12, color: '#94a3b8' }}>{t.requirement}</span></td>
                <td style={td}><span style={badge(evColor[t.currentStatus] || '#64748b')}>{t.currentStatus.toUpperCase()}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
