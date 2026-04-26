import React, { useEffect, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const inputStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 13 };

const modeColor: Record<string, string> = {
  decision_support: '#64748b',
  operator_approved: '#3b82f6',
  systematic_research: '#a855f7',
};

export default function StrategyMode() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pendingMode, setPendingMode] = useState<string>('decision_support');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { reload(); }, []);

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/system/strategy-mode', { credentials: 'include' });
      const j = await res.json();
      setData(j);
      setPendingMode(j.current?.mode ?? 'decision_support');
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function save() {
    if (!pendingMode) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/system/strategy-mode', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-mode', mode: pendingMode, notes }),
      });
      if (res.ok) {
        setToast(`Mode set to "${pendingMode}".`);
        setNotes('');
        await reload();
      } else {
        const err = await res.json().catch(() => ({}));
        setToast(`Error: ${err.error || 'failed'}`);
      }
    } catch (e: any) {
      setToast(`Error: ${e?.message || 'network'}`);
    }
    setSaving(false);
    setTimeout(() => setToast(null), 2500);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading strategy mode…</div>;
  if (!data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load.</div>;

  const cur = data.current;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/strategy-mode" /></div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Strategy Mode</h1>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: '#94a3b8', maxWidth: 760 }}>
        Choose how the platform behaves with respect to validated edge. All three modes are read-only / labeling-only —
        live execution always remains a manual operator action.
      </p>

      {/* Current */}
      <div style={card}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Current mode</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 6, background: modeColor[cur.mode] ?? '#64748b', color: '#fff', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>{cur.mode.replace(/_/g, ' ')}</span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>updated {new Date(cur.updatedAt).toLocaleString()} by {cur.updatedBy}</span>
        </div>
        {cur.notes && <p style={{ fontSize: 12, color: '#cbd5e1', margin: '8px 0 0' }}>{cur.notes}</p>}
      </div>

      {/* Mode descriptions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 16 }}>
        {data.modes.map((m: string) => (
          <div key={m} style={{ ...card, borderLeft: `4px solid ${modeColor[m] ?? '#64748b'}` }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>{m.replace(/_/g, ' ')}</h4>
            <p style={{ fontSize: 13, color: '#cbd5e1', margin: '0 0 8px' }}>{data.descriptions[m]}</p>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Safety</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#94a3b8' }}>
              {data.safety[m].map((s: string, i: number) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {/* Change mode form */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>Change mode</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <select value={pendingMode} onChange={e => setPendingMode(e.target.value)} style={inputStyle}>
            {data.modes.map((m: string) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={save} disabled={saving || pendingMode === cur.mode} style={btn(pendingMode === cur.mode ? '#475569' : '#6366f1')}>{saving ? 'Saving…' : 'Apply mode change'}</button>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Optional notes — why this change?"
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
        />
        <p style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
          Mode changes are audit-logged. They affect display + labeling only — they do not enable autonomous trading,
          automatic order submission, or candidate auto-creation. Live execution always requires explicit operator action.
        </p>
      </div>

      {/* History */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>Audit history</h3>
        {data.history.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>No prior mode changes.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Previous → New</th>
                <th style={th}>Operator</th>
                <th style={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h: any) => (
                <tr key={h.id}>
                  <td style={td}>{new Date(h.updatedAt).toLocaleString()}</td>
                  <td style={td}>
                    <span style={{ color: '#94a3b8' }}>{h.previousMode.replace(/_/g, ' ')}</span>
                    <span style={{ margin: '0 6px', color: '#475569' }}>→</span>
                    <strong>{h.mode.replace(/_/g, ' ')}</strong>
                  </td>
                  <td style={td}>{h.updatedBy}</td>
                  <td style={{ ...td, fontSize: 12, color: '#cbd5e1' }}>{h.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '10px 16px', borderRadius: 6, fontSize: 13 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
