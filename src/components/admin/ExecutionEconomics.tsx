import React, { useEffect, useState } from 'react';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });
const evColor: Record<string, string> = { sufficient: '#22c55e', limited: '#f59e0b', insufficient: '#64748b', none: '#64748b' };

function fmtUSD(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

export default function ExecutionEconomics() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'edge' | 'mode' | 'gaps'>('overview');

  useEffect(() => { fetch('/api/admin/system/execution-economics').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, []);

  const navLinks = [
    { href: '/admin/system/outcome-evaluation', label: 'Outcome Evaluation' },
    { href: '/admin/system/execution-economics', label: 'Execution Economics', active: true },
    { href: '/admin/system/quant-edge-audit', label: 'Quant Edge Audit' },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading execution economics...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load.</div>;

  const s = data.summary;
  const ev = data.expectedVsRealized;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>)}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Execution Economics</h1>
      <p style={{ margin: '0 0 4px', fontSize: 14, color: '#94a3b8' }}>Expected edge vs realized execution economics — slippage, cost basis, and proxy ROI analysis.</p>
      <div style={{ marginBottom: 20 }}><span style={badge(evColor[s.overallEvidence])}>{s.overallEvidence === 'none' ? 'NO DATA' : s.overallEvidence.toUpperCase()}</span> <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>All ROI and slippage figures are proxy metrics — see Schema Gaps tab for details</span></div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['overview', 'edge', 'mode', 'gaps'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 16px', fontSize: 13 }}>
            {t === 'overview' ? 'Expected vs Realized' : t === 'edge' ? 'Edge Buckets' : t === 'mode' ? 'Demo vs Live' : 'Schema Gaps'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Total Orders</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.totalOrders}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>With Edge Data</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.withEdgeData}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>With ROI Data</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.withRoiData}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>With Slippage</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.withSlippageData}</div></div>
          </div>

          <div style={{ ...card, borderLeft: '4px solid #f59e0b' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Expected vs Realized</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={{ ...td, fontWeight: 600 }}>Avg Expected Edge</td><td style={td}>{ev.avgExpectedEdge}</td><td style={{ ...td, fontSize: 11, color: '#64748b' }}>From candidate edge at signal time</td></tr>
                <tr><td style={{ ...td, fontWeight: 600 }}>Avg Proxy ROI</td><td style={td}>{ev.avgRealizedRoi}</td><td style={{ ...td, fontSize: 11, color: '#64748b' }}>Settlement P&L / inferred cost basis</td></tr>
                <tr><td style={{ ...td, fontWeight: 600 }}>Avg Slippage Proxy</td><td style={td}>{ev.avgSlippageProxy}</td><td style={{ ...td, fontSize: 11, color: '#64748b' }}>Edge minus realized ROI (percentage points)</td></tr>
                <tr><td style={{ ...td, fontWeight: 600 }}>Total Fees</td><td style={td}>{fmtUSD(ev.totalFeesCents)}</td><td style={{ ...td, fontSize: 11, color: '#64748b' }}>From settlement records</td></tr>
                <tr><td style={{ ...td, fontWeight: 600 }}>Sample Size</td><td style={td}>{ev.sampleSize} trades</td><td style={{ ...td, fontSize: 11, color: '#64748b' }}></td></tr>
              </tbody>
            </table>
            <div style={{ marginTop: 12, fontSize: 12, color: '#f59e0b' }}>{ev.assessment}</div>
          </div>

          {s.withRoiData === 0 && <div style={{ ...card, background: '#0f172a', textAlign: 'center', color: '#64748b', padding: 20 }}>No resolved trades with cost basis data yet. Execute trades and run settlement to populate execution economics.</div>}
        </div>
      )}

      {tab === 'edge' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>ROI by Edge Bucket</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Expected edge at signal time vs proxy realized ROI. ROI is inferred from settlement P&L / (order price x quantity).</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Edge Bucket</th><th style={th}>Count</th><th style={th}>Avg Edge</th><th style={th}>With P&L</th><th style={th}>Avg Proxy ROI</th><th style={th}>Evidence</th></tr></thead>
            <tbody>{(data.edgeBuckets || []).map((b: any) => (
              <tr key={b.bucket}>
                <td style={td}><span style={{ fontWeight: 600 }}>{b.bucket}</span></td>
                <td style={td}>{b.count}</td>
                <td style={td}>{b.avgEdge}</td>
                <td style={td}>{b.withPnl}</td>
                <td style={td}>{b.avgRoi}</td>
                <td style={td}><span style={badge(evColor[b.evidence])}>{b.evidence.toUpperCase()}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'mode' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Demo vs Live Breakdown</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Mode</th><th style={th}>Total Orders</th><th style={th}>Resolved</th><th style={th}>With P&L</th><th style={th}>Avg Proxy ROI</th></tr></thead>
            <tbody>{(data.modeBreakdown || []).map((m: any) => (
              <tr key={m.mode}>
                <td style={td}><span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{m.mode}</span></td>
                <td style={td}>{m.count}</td>
                <td style={td}>{m.resolved}</td>
                <td style={td}>{m.withPnl}</td>
                <td style={td}>{m.avgRoi}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'gaps' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Schema Gaps Blocking Better Quant Proof</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Missing fields or structures that prevent stronger execution economics evaluation.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Missing Field</th><th style={th}>Description</th><th style={th}>Impact</th></tr></thead>
            <tbody>{(data.schemaGaps || []).map((g: any) => (
              <tr key={g.field}>
                <td style={td}><span style={{ fontWeight: 600 }}>{g.field}</span></td>
                <td style={td}><span style={{ fontSize: 12, color: '#cbd5e1' }}>{g.description}</span></td>
                <td style={td}><span style={{ fontSize: 12, color: '#fca5a5' }}>{g.impact}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
