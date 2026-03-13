import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Incident {
  id: string; createdAt: string; updatedAt: string; title: string;
  severity: string; status: string; category: string; description: string;
  owner?: string; notes: string[]; linkedRunbookId?: string; sourceAlertId?: string;
}
interface Runbook {
  id: string; createdAt: string; title: string; category: string;
  steps: string[]; severity: string; linkedAlertTypes?: string[]; linkedPages?: string[];
}
interface Handoff {
  id: string; createdAt: string; operator: string; summary: string;
  openIssues: string[]; priorityItems: string[]; notes?: string;
}
interface Signoff {
  id: string; createdAt: string; date: string; signoffType: string; actor: string; notes?: string;
}
interface IncidentSummary {
  total: number; open: number; investigating: number; mitigated: number;
  critical: number; high: number; withoutOwner: number;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };
const selectStyle: React.CSSProperties = { ...inputStyle };
const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 60, resize: 'vertical' as const };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const SEV_COLORS: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#64748b', warning: '#f59e0b', info: '#3b82f6' };
const STATUS_COLORS: Record<string, string> = { open: '#ef4444', investigating: '#f59e0b', mitigated: '#3b82f6', resolved: '#22c55e', closed: '#64748b' };

const SIGNOFF_LABELS: Record<string, string> = {
  preopen: 'Pre-Open Review', midday: 'Midday Check', eod: 'End-of-Day Review',
  reconciliation: 'Reconciliation Review', settlement: 'Settlement / Accounting',
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function OperationsCenter() {
  const [incSummary, setIncSummary] = useState<IncidentSummary | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [todaySignoffs, setTodaySignoffs] = useState<Signoff[]>([]);
  const [missingSignoffs, setMissingSignoffs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'summary' | 'incidents' | 'runbooks' | 'handoffs' | 'signoffs'>('summary');

  // Modals
  const [showNewIncident, setShowNewIncident] = useState(false);
  const [showNewHandoff, setShowNewHandoff] = useState(false);
  const [viewRunbook, setViewRunbook] = useState<Runbook | null>(null);
  const [viewIncident, setViewIncident] = useState<Incident | null>(null);
  const [noteText, setNoteText] = useState('');

  // New incident form
  const [niTitle, setNiTitle] = useState('');
  const [niSeverity, setNiSeverity] = useState('medium');
  const [niCategory, setNiCategory] = useState('ops');
  const [niDescription, setNiDescription] = useState('');
  const [niOwner, setNiOwner] = useState('');

  // New handoff form
  const [nhOperator, setNhOperator] = useState('');
  const [nhSummary, setNhSummary] = useState('');
  const [nhOpenIssues, setNhOpenIssues] = useState('');
  const [nhPriority, setNhPriority] = useState('');
  const [nhNotes, setNhNotes] = useState('');

  const fetchAll = async () => {
    try {
      const res = await fetch('/api/admin/operations-center');
      if (res.ok) {
        const d = await res.json();
        setIncSummary(d.incidentSummary || null);
        setIncidents(d.activeIncidents || []);
        setHandoffs(d.recentHandoffs || []);
        setTodaySignoffs(d.todaySignoffs || []);
        setMissingSignoffs(d.missingSignoffs || []);
      }
    } catch { /* ignore */ }

    try {
      const res = await fetch('/api/admin/operations-center?action=runbooks');
      if (res.ok) {
        const d = await res.json();
        setRunbooks(d.runbooks || []);
      }
    } catch { /* ignore */ }

    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/operations-center', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return j; }
      setMsg('Done');
      await fetchAll();
      return j;
    } catch (e: any) { setMsg(e.message); return null; }
  };

  const createIncidentSubmit = async () => {
    if (!niTitle || !niDescription) { setMsg('Title and description required'); return; }
    await post({ action: 'create-incident', title: niTitle, severity: niSeverity, category: niCategory, description: niDescription, owner: niOwner || undefined });
    setShowNewIncident(false);
    setNiTitle(''); setNiDescription(''); setNiOwner('');
  };

  const createHandoffSubmit = async () => {
    if (!nhOperator || !nhSummary) { setMsg('Operator and summary required'); return; }
    await post({
      action: 'create-handoff', operator: nhOperator, summary: nhSummary,
      openIssues: nhOpenIssues.split('\n').filter(Boolean),
      priorityItems: nhPriority.split('\n').filter(Boolean),
      notes: nhNotes || undefined,
    });
    setShowNewHandoff(false);
    setNhOperator(''); setNhSummary(''); setNhOpenIssues(''); setNhPriority(''); setNhNotes('');
  };

  const doSignoff = async (type: string) => {
    await post({ action: 'create-signoff', signoffType: type, actor: 'admin' });
  };

  const seedRunbooks = async () => {
    const r = await post({ action: 'seed-runbooks' });
    if (r) setMsg(r.message || 'Done');
  };

  const updateIncidentStatus = async (id: string, status: string) => {
    await post({ action: 'update-incident', id, status });
    setViewIncident(null);
  };

  const addNote = async (id: string) => {
    if (!noteText) return;
    await post({ action: 'add-incident-note', id, note: noteText });
    setNoteText('');
    // Refresh incident detail
    const res = await fetch('/api/admin/operations-center?action=incidents');
    if (res.ok) {
      const d = await res.json();
      const updated = (d.incidents || []).find((i: Incident) => i.id === id);
      if (updated) setViewIncident(updated);
    }
  };

  const navLinks = [
    { href: '/admin/trading-desk', label: 'Trading Desk' },
    { href: '/admin/operator-dashboard', label: 'Operator' },
    { href: '/admin/alerts', label: 'Alerts' },
    { href: '/admin/security', label: 'Security' },
    { href: '/admin/operations-center', label: 'Ops Center', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading operations center...</div>;

  const completedSignoffs = new Set(todaySignoffs.map(s => s.signoffType));

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Operations Center</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Institutional operations — incidents, runbooks, handoffs, and signoffs</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['summary', 'incidents', 'runbooks', 'handoffs', 'signoffs'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {/* ═══════ SUMMARY TAB ═══════ */}
      {tab === 'summary' && (
        <>
          {/* Command center cards */}
          {incSummary && (
            <div style={grid4}>
              <div style={{ ...card, borderLeft: `3px solid ${incSummary.critical > 0 ? '#ef4444' : '#22c55e'}` }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{incSummary.open + incSummary.investigating + incSummary.mitigated}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Open Incidents</div>
              </div>
              <div style={{ ...card, borderLeft: '3px solid #ef4444' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{incSummary.critical}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Critical</div>
              </div>
              <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{incSummary.withoutOwner}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Unassigned</div>
              </div>
              <div style={{ ...card, borderLeft: '3px solid #3b82f6' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{runbooks.length}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Runbooks</div>
              </div>
              <div style={{ ...card, borderLeft: '3px solid #8b5cf6' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{todaySignoffs.length} / 5</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Today Signoffs</div>
              </div>
              <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{handoffs.length}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Recent Handoffs</div>
              </div>
            </div>
          )}

          {/* Escalation / Attention */}
          {(incSummary && (incSummary.critical > 0 || incSummary.withoutOwner > 0 || missingSignoffs.length > 0)) && (
            <div style={{ ...card, borderLeft: '3px solid #ef4444', background: '#1c1917' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#fca5a5' }}>Needs Attention</h3>
              {incSummary.critical > 0 && <div style={{ fontSize: 13, marginBottom: 4 }}>{incSummary.critical} critical incident(s) active</div>}
              {incSummary.withoutOwner > 0 && <div style={{ fontSize: 13, marginBottom: 4 }}>{incSummary.withoutOwner} incident(s) without owner</div>}
              {missingSignoffs.length > 0 && <div style={{ fontSize: 13, marginBottom: 4 }}>Missing signoffs: {missingSignoffs.map(s => SIGNOFF_LABELS[s] || s).join(', ')}</div>}
              {handoffs.length === 0 && <div style={{ fontSize: 13 }}>No recent handoff notes</div>}
            </div>
          )}

          {/* Active incidents */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>Active Incidents</h3>
              <button onClick={() => setShowNewIncident(true)} style={btn('#ef4444')}>New Incident</button>
            </div>
            {incidents.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 13 }}>No active incidents</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Title</th><th style={th}>Category</th><th style={th}>Owner</th><th style={th}>Created</th><th style={th}>Actions</th></tr></thead>
                  <tbody>
                    {incidents.map(inc => (
                      <tr key={inc.id}>
                        <td style={td}><span style={badge(SEV_COLORS[inc.severity] || '#64748b')}>{inc.severity}</span></td>
                        <td style={td}><span style={badge(STATUS_COLORS[inc.status] || '#64748b')}>{inc.status}</span></td>
                        <td style={td}>{inc.title}</td>
                        <td style={td}>{inc.category}</td>
                        <td style={td}>{inc.owner || <span style={{ color: '#f59e0b' }}>unassigned</span>}</td>
                        <td style={td}>{inc.createdAt.slice(0, 16).replace('T', ' ')}</td>
                        <td style={td}><button onClick={() => setViewIncident(inc)} style={btn('#6366f1')}>View</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Latest handoff */}
          {handoffs.length > 0 && (
            <div style={card}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Latest Handoff</h3>
              <div style={{ fontSize: 13 }}>
                <div><strong>{handoffs[0].operator}</strong> — {handoffs[0].createdAt.slice(0, 16).replace('T', ' ')}</div>
                <div style={{ marginTop: 4 }}>{handoffs[0].summary}</div>
                {handoffs[0].openIssues.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>Open Issues:</span>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>{handoffs[0].openIssues.map((iss, i) => <li key={i}>{iss}</li>)}</ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════ INCIDENTS TAB ═══════ */}
      {tab === 'incidents' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>All Incidents</h3>
            <button onClick={() => setShowNewIncident(true)} style={btn('#ef4444')}>New Incident</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Title</th><th style={th}>Category</th><th style={th}>Owner</th><th style={th}>Notes</th><th style={th}>Created</th><th style={th}>Actions</th></tr></thead>
              <tbody>
                {incidents.map(inc => (
                  <tr key={inc.id}>
                    <td style={td}><span style={badge(SEV_COLORS[inc.severity] || '#64748b')}>{inc.severity}</span></td>
                    <td style={td}><span style={badge(STATUS_COLORS[inc.status] || '#64748b')}>{inc.status}</span></td>
                    <td style={td}>{inc.title}</td>
                    <td style={td}>{inc.category}</td>
                    <td style={td}>{inc.owner || '—'}</td>
                    <td style={td}>{inc.notes.length}</td>
                    <td style={td}>{inc.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td style={td}><button onClick={() => setViewIncident(inc)} style={btn('#6366f1')}>View</button></td>
                  </tr>
                ))}
                {incidents.length === 0 && <tr><td colSpan={8} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No incidents</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ RUNBOOKS TAB ═══════ */}
      {tab === 'runbooks' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Runbooks ({runbooks.length})</h3>
            <button onClick={seedRunbooks} style={btn('#22c55e')}>Seed Defaults</button>
          </div>
          {runbooks.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>No runbooks. Click "Seed Defaults" to create starter runbooks.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {runbooks.map(rb => (
                <div key={rb.id} style={{ ...card, margin: 0, cursor: 'pointer', borderLeft: `3px solid ${SEV_COLORS[rb.severity] || '#64748b'}` }} onClick={() => setViewRunbook(rb)}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{rb.title}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{rb.category} — {rb.steps.length} steps</div>
                  <span style={badge(SEV_COLORS[rb.severity] || '#64748b')}>{rb.severity}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════ HANDOFFS TAB ═══════ */}
      {tab === 'handoffs' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Shift Handoffs</h3>
            <button onClick={() => setShowNewHandoff(true)} style={btn('#8b5cf6')}>New Handoff</button>
          </div>
          {handoffs.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>No handoff notes yet.</div>
          ) : (
            handoffs.map(h => (
              <div key={h.id} style={{ ...card, margin: '0 0 12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong>{h.operator}</strong>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{h.createdAt.slice(0, 16).replace('T', ' ')}</span>
                </div>
                <div style={{ fontSize: 13, marginBottom: 6 }}>{h.summary}</div>
                {h.openIssues.length > 0 && (
                  <div style={{ fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: '#94a3b8' }}>Open Issues:</span>
                    <ul style={{ margin: '2px 0 0 16px', padding: 0 }}>{h.openIssues.map((iss, i) => <li key={i}>{iss}</li>)}</ul>
                  </div>
                )}
                {h.priorityItems.length > 0 && (
                  <div style={{ fontSize: 12 }}>
                    <span style={{ color: '#94a3b8' }}>Priority:</span>
                    <ul style={{ margin: '2px 0 0 16px', padding: 0 }}>{h.priorityItems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </div>
                )}
                {h.notes && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{h.notes}</div>}
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══════ SIGNOFFS TAB ═══════ */}
      {tab === 'signoffs' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Daily Signoff Checklist</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 16 }}>
            {Object.entries(SIGNOFF_LABELS).map(([type, label]) => {
              const done = completedSignoffs.has(type);
              return (
                <div key={type} style={{ ...card, margin: 0, borderLeft: `3px solid ${done ? '#22c55e' : '#f59e0b'}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{label}</div>
                  {done ? (
                    <span style={badge('#22c55e')}>Completed</span>
                  ) : (
                    <button onClick={() => doSignoff(type)} style={btn('#6366f1')}>Sign Off</button>
                  )}
                </div>
              );
            })}
          </div>

          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Recent Signoffs</h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Date</th><th style={th}>Type</th><th style={th}>Actor</th><th style={th}>Time</th><th style={th}>Notes</th></tr></thead>
              <tbody>
                {todaySignoffs.map(s => (
                  <tr key={s.id}>
                    <td style={td}>{s.date}</td>
                    <td style={td}>{SIGNOFF_LABELS[s.signoffType] || s.signoffType}</td>
                    <td style={td}>{s.actor}</td>
                    <td style={td}>{s.createdAt.slice(11, 19)}</td>
                    <td style={td}>{s.notes || '—'}</td>
                  </tr>
                ))}
                {todaySignoffs.length === 0 && <tr><td colSpan={5} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No signoffs today</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ NEW INCIDENT MODAL ═══════ */}
      {showNewIncident && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 500, width: '95%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>New Incident</h3>
              <button onClick={() => setShowNewIncident(false)} style={btn('#334155')}>Close</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Title</label><input value={niTitle} onChange={e => setNiTitle(e.target.value)} style={inputStyle} /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Severity</label>
                  <select value={niSeverity} onChange={e => setNiSeverity(e.target.value)} style={selectStyle}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                  </select></div>
                <div style={{ flex: 1 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Category</label>
                  <select value={niCategory} onChange={e => setNiCategory(e.target.value)} style={selectStyle}>
                    <option value="execution">Execution</option><option value="pricing">Pricing</option><option value="data">Data</option>
                    <option value="security">Security</option><option value="reconciliation">Reconciliation</option>
                    <option value="settlement">Settlement</option><option value="ops">Ops</option>
                  </select></div>
              </div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Owner</label><input value={niOwner} onChange={e => setNiOwner(e.target.value)} placeholder="optional" style={inputStyle} /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Description</label><textarea value={niDescription} onChange={e => setNiDescription(e.target.value)} style={textareaStyle} /></div>
              <button onClick={createIncidentSubmit} style={btn('#ef4444')}>Create Incident</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ VIEW INCIDENT MODAL ═══════ */}
      {viewIncident && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 600, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>{viewIncident.title}</h3>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span style={badge(SEV_COLORS[viewIncident.severity] || '#64748b')}>{viewIncident.severity}</span>
                  <span style={badge(STATUS_COLORS[viewIncident.status] || '#64748b')}>{viewIncident.status}</span>
                  <span style={badge('#334155')}>{viewIncident.category}</span>
                </div>
              </div>
              <button onClick={() => setViewIncident(null)} style={btn('#334155')}>Close</button>
            </div>

            <div style={{ fontSize: 13, marginBottom: 12 }}>{viewIncident.description}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              Owner: {viewIncident.owner || 'unassigned'} | Created: {viewIncident.createdAt.slice(0, 16).replace('T', ' ')}
            </div>

            {/* Status update */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
              {['investigating', 'mitigated', 'resolved', 'closed'].map(s => (
                <button key={s} onClick={() => updateIncidentStatus(viewIncident.id, s)} style={btn(STATUS_COLORS[s] || '#334155')} disabled={viewIncident.status === s}>{s}</button>
              ))}
            </div>

            {/* Notes timeline */}
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Notes</h4>
            {viewIncident.notes.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>No notes yet</div>
            ) : (
              <div style={{ marginBottom: 8 }}>
                {viewIncident.notes.map((n, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid #334155' }}>{n}</div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add note..." style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => addNote(viewIncident.id)} style={btn('#6366f1')}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ VIEW RUNBOOK MODAL ═══════ */}
      {viewRunbook && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 600, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>{viewRunbook.title}</h3>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span style={badge(SEV_COLORS[viewRunbook.severity] || '#64748b')}>{viewRunbook.severity}</span>
                  <span style={badge('#334155')}>{viewRunbook.category}</span>
                </div>
              </div>
              <button onClick={() => setViewRunbook(null)} style={btn('#334155')}>Close</button>
            </div>

            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Steps</h4>
            <ol style={{ paddingLeft: 20, margin: 0 }}>
              {viewRunbook.steps.map((step, i) => (
                <li key={i} style={{ fontSize: 13, marginBottom: 6 }}>{step}</li>
              ))}
            </ol>

            {viewRunbook.linkedPages && viewRunbook.linkedPages.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Linked Pages</h4>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {viewRunbook.linkedPages.map(p => (
                    <a key={p} href={p} style={{ ...btn('#334155'), textDecoration: 'none' }}>{p}</a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ NEW HANDOFF MODAL ═══════ */}
      {showNewHandoff && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 500, width: '95%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>New Shift Handoff</h3>
              <button onClick={() => setShowNewHandoff(false)} style={btn('#334155')}>Close</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Operator</label><input value={nhOperator} onChange={e => setNhOperator(e.target.value)} style={inputStyle} /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Summary</label><textarea value={nhSummary} onChange={e => setNhSummary(e.target.value)} style={textareaStyle} /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Open Issues (one per line)</label><textarea value={nhOpenIssues} onChange={e => setNhOpenIssues(e.target.value)} style={textareaStyle} /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Priority Items (one per line)</label><textarea value={nhPriority} onChange={e => setNhPriority(e.target.value)} style={textareaStyle} /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Notes</label><textarea value={nhNotes} onChange={e => setNhNotes(e.target.value)} style={textareaStyle} /></div>
              <button onClick={createHandoffSubmit} style={btn('#8b5cf6')}>Create Handoff</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
