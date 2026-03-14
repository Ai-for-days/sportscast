import React, { useEffect, useState } from 'react';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

export default function DeskDryRun() {
  const [steps, setSteps] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/system/desk-dry-run');
      if (res.ok) { const d = await res.json(); setSteps(d.steps || []); setSummary(d.summary || null); }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const completeStep = async (key: string) => {
    const notes = prompt('Optional notes:');
    try {
      const res = await fetch('/api/admin/system/desk-dry-run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete-step', key, notes: notes || undefined }),
      });
      if (res.ok) { setMsg('Step marked complete'); await fetchData(); setTimeout(() => setMsg(''), 3000); }
    } catch {}
  };

  const resetAll = async () => {
    if (!confirm('Reset all dry-run progress?')) return;
    try {
      await fetch('/api/admin/system/desk-dry-run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-all' }),
      });
      setMsg('Progress reset'); await fetchData(); setTimeout(() => setMsg(''), 3000);
    } catch {}
  };

  const navLinks = [
    { href: '/admin/system/pre-launch-audit', label: 'Pre-Launch Audit' },
    { href: '/admin/system/desk-dry-run', label: 'Desk Dry-Run', active: true },
    { href: '/admin/system/cleanup-backlog', label: 'Cleanup Backlog' },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading desk dry-run...</div>;

  const stages = [...new Set(steps.map(s => s.stage))];

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map((l: any) => <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>)}
      </div>
      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Full Desk Dry-Run</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>Structured operator runbook for testing the entire platform workflow safely.</p>

      {msg && <div style={{ ...card, background: '#1e3a2f', padding: 12, fontSize: 13 }}>{msg}</div>}

      {summary && (
        <div style={grid4}>
          <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Total Steps</div><div style={{ fontSize: 24, fontWeight: 700 }}>{summary.total}</div></div>
          <div style={card}><div style={{ fontSize: 11, color: '#22c55e', marginBottom: 4 }}>Completed</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{summary.completed}</div></div>
          <div style={card}><div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Remaining</div><div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{summary.remaining}</div></div>
          <div style={card}><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Progress</div><div style={{ fontSize: 24, fontWeight: 700 }}>{summary.percent}%</div></div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <button style={btn('#ef4444')} onClick={resetAll}>Reset All Progress</button>
      </div>

      {stages.map(stage => {
        const stageSteps = steps.filter(s => s.stage === stage);
        const done = stageSteps.filter(s => s.completed).length;
        return (
          <div key={stage} style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>{stage} <span style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>({done}/{stageSteps.length})</span></h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Step</th><th style={th}>Description</th><th style={th}>Success Criteria</th><th style={th}>Status</th><th style={th}>Action</th></tr></thead>
              <tbody>
                {stageSteps.map(s => (
                  <tr key={s.key}>
                    <td style={td}><span style={{ fontWeight: 600 }}>{s.title}</span></td>
                    <td style={td}><span style={{ fontSize: 12, color: '#cbd5e1' }}>{s.description}</span></td>
                    <td style={td}><span style={{ fontSize: 12, color: '#94a3b8' }}>{s.successCriteria}</span></td>
                    <td style={td}>{s.completed ? <span style={badge('#22c55e')}>DONE</span> : <span style={badge('#64748b')}>PENDING</span>}</td>
                    <td style={td}>
                      {s.completed ? (
                        <span style={{ fontSize: 11, color: '#64748b' }}>{s.completedBy} {s.completedAt ? new Date(s.completedAt).toLocaleDateString() : ''}</span>
                      ) : (
                        <button style={btn('#6366f1')} onClick={() => completeStep(s.key)}>Mark Complete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
