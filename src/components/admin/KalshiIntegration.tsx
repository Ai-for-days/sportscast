import React, { useEffect, useState } from 'react';
const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });
const statusColor: Record<string, string> = { pass: '#22c55e', warning: '#f59e0b', fail: '#ef4444' };

export default function KalshiIntegration() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchData = async () => { try { const r = await fetch('/api/admin/system/kalshi-integration'); if (r.ok) setData(await r.json()); } catch {} setLoading(false); };
  useEffect(() => { fetchData(); }, []);

  const runVerification = async () => {
    setRunning(true); setMsg('');
    try {
      const r = await fetch('/api/admin/system/kalshi-integration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run-verification' }) });
      if (r.ok) { setData(await r.json()); setMsg('Verification complete'); setTimeout(() => setMsg(''), 4000); }
    } catch {} finally { setRunning(false); }
  };

  const navLinks = [{ href: '/admin/kalshi-lab', label: 'Kalshi Lab' }, { href: '/admin/system/kalshi-integration', label: 'Kalshi Integration', active: true }, { href: '/admin/system/pipeline-cadence', label: 'Pipeline Cadence' }];
  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading Kalshi integration...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load.</div>;

  const categories = data.categories || ['external_connectivity', 'local_data', 'execution_readiness'];
  const catLabels = data.categoryLabels || { external_connectivity: 'External Connectivity', local_data: 'Local Data Presence', execution_readiness: 'Execution Readiness' };

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>{navLinks.map(l => <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>)}</div>
      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Kalshi Integration Verification</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>External connectivity, local data presence, and execution readiness checks. No live orders are placed.</p>
      {msg && <div style={{ ...card, background: '#1e3a2f', padding: 12, fontSize: 13 }}>{msg}</div>}

      <div style={grid4}>
        <div style={card}><div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>Pass</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{data.summary?.pass || 0}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Warning</div><div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{data.summary?.warning || 0}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>Fail</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{data.summary?.fail || 0}</div></div>
      </div>

      <div style={{ marginBottom: 20 }}><button style={{ ...btn('#3b82f6'), padding: '10px 24px', fontSize: 14 }} onClick={runVerification} disabled={running}>{running ? 'Verifying...' : 'Run Kalshi Verification'}</button></div>

      {categories.map((cat: string) => {
        const catChecks = (data.checks || []).filter((c: any) => c.category === cat);
        if (catChecks.length === 0) return null;
        return (
          <div key={cat} style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>{catLabels[cat] || cat}</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Check</th><th style={th}>Status</th><th style={th}>Summary</th></tr></thead>
              <tbody>{catChecks.map((c: any) => (
                <tr key={c.key}>
                  <td style={td}><span style={{ fontWeight: 600 }}>{c.title}</span></td>
                  <td style={td}><span style={badge(statusColor[c.status] || '#64748b')}>{c.status.toUpperCase()}</span></td>
                  <td style={td}><span style={{ fontSize: 12, color: c.status === 'fail' ? '#fca5a5' : '#cbd5e1' }}>{c.summary}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
