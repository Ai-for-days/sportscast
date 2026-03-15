import React, { useEffect, useState } from 'react';
const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });
const statusColor: Record<string, string> = { on_schedule: '#22c55e', delayed: '#f59e0b', stale: '#ef4444', no_data: '#64748b' };

export default function PipelineCadence() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch('/api/admin/system/pipeline-cadence').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, []);
  const navLinks = [{ href: '/admin/system/kalshi-integration', label: 'Kalshi Integration' }, { href: '/admin/system/pipeline-cadence', label: 'Pipeline Cadence', active: true }, { href: '/admin/system/quant-review', label: 'Quant Review' }];
  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading pipeline cadence...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load.</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>{navLinks.map(l => <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>)}</div>
      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Pipeline Cadence</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>Operational pipeline timing and staleness visibility. Cadences are heuristic — not automated scheduling.</p>
      <div style={grid4}>
        <div style={card}><div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>On Schedule</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{data.summary?.onSchedule || 0}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Delayed</div><div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{data.summary?.delayed || 0}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>Stale</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{data.summary?.stale || 0}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>No Data</div><div style={{ fontSize: 24, fontWeight: 700 }}>{data.summary?.noData || 0}</div></div>
      </div>
      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Pipeline Stage</th><th style={th}>Expected Cadence</th><th style={th}>Status</th><th style={th}>Last Run</th><th style={th}>Age</th><th style={th}>Summary</th></tr></thead>
          <tbody>{(data.stages || []).map((s: any) => <tr key={s.key}><td style={td}><span style={{ fontWeight: 600 }}>{s.label}</span></td><td style={td}><span style={{ fontSize: 12, color: '#94a3b8' }}>{s.expectedCadence}</span></td><td style={td}><span style={badge(statusColor[s.status] || '#64748b')}>{s.status.replace('_', ' ').toUpperCase()}</span></td><td style={td}><span style={{ fontSize: 11, color: '#64748b' }}>{s.lastRun ? new Date(s.lastRun).toLocaleString() : '—'}</span></td><td style={td}>{s.ageHours != null ? `${s.ageHours}h` : '—'}</td><td style={td}><span style={{ fontSize: 12, color: '#cbd5e1' }}>{s.summary}</span></td></tr>)}</tbody>
        </table>
      </div>
      <div style={{ ...card, background: '#0f172a', fontSize: 12, color: '#64748b' }}>Note: Cadence thresholds are heuristic guidelines for operator awareness. The platform does not currently schedule pipeline runs automatically. All pipelines are operator-triggered.</div>
    </div>
  );
}
