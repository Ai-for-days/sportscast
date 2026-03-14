import React, { useEffect, useState } from 'react';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });
const prioColor: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
const effortColor: Record<string, string> = { small: '#22c55e', medium: '#f59e0b', large: '#ef4444' };

export default function CleanupBacklog() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetch('/api/admin/system/cleanup-backlog').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const navLinks = [
    { href: '/admin/system/pre-launch-audit', label: 'Pre-Launch Audit' },
    { href: '/admin/system/desk-dry-run', label: 'Desk Dry-Run' },
    { href: '/admin/system/cleanup-backlog', label: 'Cleanup Backlog', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading cleanup backlog...</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load backlog data.</div>;

  const filtered = filter === 'all' ? data.items : data.items.filter((i: any) => i.category === filter);

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map((l: any) => <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>)}
      </div>
      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Cleanup Backlog</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>Technical debt and improvement opportunities discovered during the hardening phase.</p>

      <div style={grid4}>
        <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Total Items</div><div style={{ fontSize: 24, fontWeight: 700 }}>{data.summary.total}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#ef4444', marginBottom: 4 }}>High Priority</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{data.summary.high}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Medium</div><div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{data.summary.medium}</div></div>
        <div style={card}><div style={{ fontSize: 11, color: '#3b82f6', marginBottom: 4 }}>Low</div><div style={{ fontSize: 24, fontWeight: 700, color: '#3b82f6' }}>{data.summary.low}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('all')} style={{ ...btn(filter === 'all' ? '#6366f1' : '#334155'), padding: '6px 14px' }}>All</button>
        {data.categories.map((c: string) => <button key={c} onClick={() => setFilter(c)} style={{ ...btn(filter === c ? '#6366f1' : '#334155'), padding: '6px 14px' }}>{c}</button>)}
      </div>

      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Title</th><th style={th}>Category</th><th style={th}>Priority</th><th style={th}>Effort</th><th style={th}>Description</th></tr></thead>
          <tbody>
            {filtered.map((i: any, idx: number) => (
              <tr key={idx}>
                <td style={td}><span style={{ fontWeight: 600 }}>{i.title}</span></td>
                <td style={td}><span style={{ fontSize: 12, color: '#94a3b8' }}>{i.category}</span></td>
                <td style={td}><span style={badge(prioColor[i.priority])}>{i.priority.toUpperCase()}</span></td>
                <td style={td}><span style={badge(effortColor[i.effort])}>{i.effort.toUpperCase()}</span></td>
                <td style={td}><span style={{ fontSize: 12, color: '#cbd5e1' }}>{i.description}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
