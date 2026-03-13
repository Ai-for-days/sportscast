import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Snapshot {
  id: string; snapshotDate: string; family: string; createdAt: string; metadata?: any; payload: any;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };
const selectStyle: React.CSSProperties = { ...inputStyle };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const FAMILY_COLORS: Record<string, string> = {
  forecasts: '#3b82f6', forecast_verification: '#6366f1', consensus: '#8b5cf6', pricing: '#a855f7',
  signals: '#ec4899', portfolio: '#f43f5e', execution_candidates: '#f97316', demo_orders: '#eab308',
  live_orders: '#22c55e', settlements: '#14b8a6', positions: '#06b6d4', pnl: '#0ea5e9',
  health_alerts: '#dc2626', operator_daily: '#64748b', active_models: '#334155',
};

export default function History() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [families, setFamilies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // Filters
  const [filterFamily, setFilterFamily] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Detail view
  const [detail, setDetail] = useState<Snapshot | null>(null);

  const fetchData = async (params = '') => {
    try {
      const res = await fetch(`/api/admin/history${params}`);
      if (res.ok) {
        const d = await res.json();
        setSnapshots(d.snapshots || []);
        if (d.families) setFamilies(d.families);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const applyFilter = () => {
    const params: string[] = [];
    if (filterFamily) params.push(`family=${filterFamily}`);
    if (filterDate) params.push(`date=${filterDate}`);
    if (fromDate && toDate && filterFamily) { params.push(`from=${fromDate}`); params.push(`to=${toDate}`); }
    fetchData(params.length ? `?${params.join('&')}` : '');
  };

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return; }
      setMsg(`Done — ${j.count ? j.count + ' families' : 'snapshot built'}`);
      await fetchData();
    } catch (e: any) { setMsg(e.message); }
  };

  const viewDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/history?action=get-snapshot&id=${id}`);
      if (res.ok) setDetail(await res.json());
    } catch { setMsg('Failed to load snapshot'); }
  };

  const exportJSON = (id: string) => window.open(`/api/admin/history?action=export-snapshot&id=${id}`, '_blank');

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading history...</div>;

  const navLinks = [
    { href: '/admin/trading-desk', label: 'Trading Desk' },
    { href: '/admin/operator-dashboard', label: 'Operator' },
    { href: '/admin/reports', label: 'Reports' },
    { href: '/admin/history', label: 'History', active: true },
  ];

  // Count by family
  const familyCounts: Record<string, number> = {};
  for (const s of snapshots) familyCounts[s.family] = (familyCounts[s.family] || 0) + 1;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Historical Data Warehouse</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Immutable snapshots for research, governance, and attribution</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Family cards */}
      <div style={grid3}>
        {families.map(f => (
          <div key={f} style={{ ...card, cursor: 'pointer', borderLeft: `3px solid ${FAMILY_COLORS[f] || '#64748b'}` }} onClick={() => { setFilterFamily(f); setTimeout(applyFilter, 0); }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{familyCounts[f] || 0}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{f.replace(/_/g, ' ')}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 140 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Family</label>
          <select value={filterFamily} onChange={e => setFilterFamily(e.target.value)} style={selectStyle}>
            <option value="">All</option>
            {families.map(f => <option key={f} value={f}>{f}</option>)}
          </select></div>
        <div style={{ minWidth: 120 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Date</label>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={inputStyle} /></div>
        <div style={{ minWidth: 120 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={inputStyle} /></div>
        <div style={{ minWidth: 120 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={inputStyle} /></div>
        <button onClick={applyFilter} style={btn('#6366f1')}>Filter</button>
        <button onClick={() => { setFilterFamily(''); setFilterDate(''); setFromDate(''); setToDate(''); fetchData(); }} style={btn('#334155')}>Reset</button>
        <button onClick={() => post({ action: 'build-daily-snapshot' })} style={btn('#22c55e')}>Build Daily Snapshot</button>
        {filterFamily && <button onClick={() => post({ action: 'build-family-snapshot', family: filterFamily })} style={btn('#3b82f6')}>Snap {filterFamily}</button>}
      </div>

      {/* Snapshot table */}
      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Snapshots ({snapshots.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Family</th><th style={th}>Created</th><th style={th}>Summary</th><th style={th}>Actions</th></tr></thead>
            <tbody>
              {snapshots.map(s => {
                const summary = typeof s.payload === 'object' ? (s.payload.count != null ? `${s.payload.count} records` : `${Object.keys(s.payload).length} keys`) : '—';
                return (
                  <tr key={s.id}>
                    <td style={td}>{s.snapshotDate}</td>
                    <td style={td}><span style={badge(FAMILY_COLORS[s.family] || '#64748b')}>{s.family}</span></td>
                    <td style={td}>{s.createdAt?.slice(11, 19)}</td>
                    <td style={td}>{summary}</td>
                    <td style={td}>
                      <button onClick={() => viewDetail(s.id)} style={{ ...btn('#6366f1'), marginRight: 4 }}>View</button>
                      <button onClick={() => exportJSON(s.id)} style={btn('#334155')}>JSON</button>
                    </td>
                  </tr>
                );
              })}
              {snapshots.length === 0 && <tr><td colSpan={5} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No snapshots. Build a daily snapshot to start.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 700, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>{detail.family} — {detail.snapshotDate}</h3>
                <p style={{ fontSize: 12, color: '#94a3b8' }}>Created: {detail.createdAt}</p>
              </div>
              <button onClick={() => setDetail(null)} style={btn('#334155')}>Close</button>
            </div>

            {detail.metadata && (
              <div style={{ marginBottom: 12 }}>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Metadata</h4>
                <pre style={{ background: '#0f172a', borderRadius: 6, padding: 10, fontSize: 11, overflow: 'auto', maxHeight: 150, color: '#cbd5e1' }}>
                  {JSON.stringify(detail.metadata, null, 2)}
                </pre>
              </div>
            )}

            <div>
              <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Payload</h4>
              <pre style={{ background: '#0f172a', borderRadius: 6, padding: 10, fontSize: 11, overflow: 'auto', maxHeight: 400, color: '#cbd5e1' }}>
                {JSON.stringify(detail.payload, null, 2)}
              </pre>
            </div>

            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button onClick={() => exportJSON(detail.id)} style={btn('#3b82f6')}>Export JSON</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
