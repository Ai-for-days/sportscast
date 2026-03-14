import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface DrillCheck { name: string; passed: boolean; detail?: string; }
interface Drill {
  id: string; createdAt: string; updatedAt: string; scenarioType: string;
  status: string; severity: string; initiatedBy: string; parameters?: any;
  expectedOutcome?: string; observedOutcome?: string; checks: DrillCheck[];
  notes: string[]; linkedIncidentIds: string[]; linkedNotificationIds: string[];
}
interface Scenario {
  type: string; label: string; description: string; severity: string; expectedChecks: string[];
}
interface DrillSummary {
  total: number; running: number; completed: number; cancelled: number;
  failedChecks: number; lastCritical?: string;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };
const selectStyle: React.CSSProperties = { ...inputStyle };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const SEV_COLORS: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#64748b' };
const STATUS_COLORS: Record<string, string> = { planned: '#3b82f6', running: '#f59e0b', completed: '#22c55e', cancelled: '#64748b' };

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function Resilience() {
  const [summary, setSummary] = useState<DrillSummary | null>(null);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'overview' | 'run' | 'history'>('overview');

  // Run form
  const [selectedScenario, setSelectedScenario] = useState('');
  const [expectedOutcome, setExpectedOutcome] = useState('');
  const [runningDrill, setRunningDrill] = useState(false);

  // Detail
  const [viewDrill, setViewDrill] = useState<Drill | null>(null);
  const [noteText, setNoteText] = useState('');

  const fetchAll = async () => {
    try {
      const res = await fetch('/api/admin/resilience');
      if (res.ok) {
        const d = await res.json();
        setSummary(d.summary || null);
        setDrills(d.drills || []);
        setScenarios(d.scenarios || []);
        if (!selectedScenario && d.scenarios?.length) setSelectedScenario(d.scenarios[0].type);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/resilience', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return null; }
      setMsg('Done');
      await fetchAll();
      return j;
    } catch (e: any) { setMsg(e.message); return null; }
  };

  const runDrill = async () => {
    if (!selectedScenario) return;
    setRunningDrill(true);
    const result = await post({
      action: 'run-drill', scenarioType: selectedScenario,
      expectedOutcome: expectedOutcome || undefined,
    });
    setRunningDrill(false);
    if (result?.drill) setViewDrill(result.drill);
  };

  const addNote = async (id: string) => {
    if (!noteText) return;
    const result = await post({ action: 'add-drill-note', id, note: noteText });
    setNoteText('');
    if (result?.drill) setViewDrill(result.drill);
  };

  const selectedDef = scenarios.find(s => s.type === selectedScenario);

  const navLinks = [
    { href: '/admin/operations-center', label: 'Ops Center' },
    { href: '/admin/alerts', label: 'Alerts' },
    { href: '/admin/change-control', label: 'Change Control' },
    { href: '/admin/resilience', label: 'Resilience', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading resilience center...</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Resilience / Chaos Testing</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Controlled failure simulation — verify platform response without real damage</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['overview', 'run', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {/* ═══════ OVERVIEW ═══════ */}
      {tab === 'overview' && summary && (
        <>
          <div style={grid4}>
            <div style={card}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.total}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Total Drills</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.running}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Running</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.completed}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Completed</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #ef4444' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.failedChecks}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Failed Checks</div>
            </div>
            {summary.lastCritical && (
              <div style={{ ...card, borderLeft: '3px solid #ef4444' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{summary.lastCritical.slice(0, 10)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Last Critical Drill</div>
              </div>
            )}
          </div>

          {/* Recent drills */}
          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Recent Drills</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Time</th><th style={th}>Scenario</th><th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Pass Rate</th><th style={th}>By</th><th style={th}>Actions</th></tr></thead>
                <tbody>
                  {drills.slice(0, 10).map(d => {
                    const passed = d.checks.filter(c => c.passed).length;
                    return (
                      <tr key={d.id}>
                        <td style={td}>{d.createdAt.slice(0, 16).replace('T', ' ')}</td>
                        <td style={td}>{scenarios.find(s => s.type === d.scenarioType)?.label || d.scenarioType}</td>
                        <td style={td}><span style={badge(SEV_COLORS[d.severity] || '#64748b')}>{d.severity}</span></td>
                        <td style={td}><span style={badge(STATUS_COLORS[d.status] || '#64748b')}>{d.status}</span></td>
                        <td style={td}><span style={{ color: passed === d.checks.length ? '#22c55e' : '#f59e0b' }}>{passed}/{d.checks.length}</span></td>
                        <td style={td}>{d.initiatedBy}</td>
                        <td style={td}><button onClick={() => setViewDrill(d)} style={btn('#6366f1')}>View</button></td>
                      </tr>
                    );
                  })}
                  {drills.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No drills yet. Run one from the "Run" tab.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══════ RUN TAB ═══════ */}
      {tab === 'run' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Run Resilience Drill</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 600 }}>
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Scenario</label>
              <select value={selectedScenario} onChange={e => setSelectedScenario(e.target.value)} style={selectStyle}>
                {scenarios.map(s => <option key={s.type} value={s.type}>{s.label} ({s.severity})</option>)}
              </select>
            </div>

            {selectedDef && (
              <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{selectedDef.label}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{selectedDef.description}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Expected checks:</div>
                <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12 }}>
                  {selectedDef.expectedChecks.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>Expected Outcome (optional)</label>
              <input value={expectedOutcome} onChange={e => setExpectedOutcome(e.target.value)} placeholder="What should happen?" style={inputStyle} />
            </div>

            <div style={{ padding: '8px 12px', background: '#1c1917', borderRadius: 6, borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontSize: 12, color: '#fca5a5', fontWeight: 600 }}>SIMULATION ONLY</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>This drill creates synthetic alerts, incidents, and notifications tagged as [DRILL]. No real production data is damaged.</div>
            </div>

            <button onClick={runDrill} disabled={runningDrill} style={btn(runningDrill ? '#64748b' : '#ef4444')}>
              {runningDrill ? 'Running...' : 'Run Drill'}
            </button>
          </div>
        </div>
      )}

      {/* ═══════ HISTORY TAB ═══════ */}
      {tab === 'history' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Drill History ({drills.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Time</th><th style={th}>Scenario</th><th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Checks</th><th style={th}>By</th><th style={th}>Notes</th><th style={th}>Actions</th></tr></thead>
              <tbody>
                {drills.map(d => {
                  const passed = d.checks.filter(c => c.passed).length;
                  return (
                    <tr key={d.id}>
                      <td style={td}>{d.createdAt.slice(0, 16).replace('T', ' ')}</td>
                      <td style={td}>{scenarios.find(s => s.type === d.scenarioType)?.label || d.scenarioType}</td>
                      <td style={td}><span style={badge(SEV_COLORS[d.severity] || '#64748b')}>{d.severity}</span></td>
                      <td style={td}><span style={badge(STATUS_COLORS[d.status] || '#64748b')}>{d.status}</span></td>
                      <td style={td}><span style={{ color: passed === d.checks.length ? '#22c55e' : '#f59e0b' }}>{passed}/{d.checks.length}</span></td>
                      <td style={td}>{d.initiatedBy}</td>
                      <td style={td}>{d.notes.length}</td>
                      <td style={td}><button onClick={() => setViewDrill(d)} style={btn('#6366f1')}>View</button></td>
                    </tr>
                  );
                })}
                {drills.length === 0 && <tr><td colSpan={8} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No drills</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ DRILL DETAIL MODAL ═══════ */}
      {viewDrill && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 650, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>{scenarios.find(s => s.type === viewDrill.scenarioType)?.label || viewDrill.scenarioType}</h3>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span style={badge(SEV_COLORS[viewDrill.severity] || '#64748b')}>{viewDrill.severity}</span>
                  <span style={badge(STATUS_COLORS[viewDrill.status] || '#64748b')}>{viewDrill.status}</span>
                </div>
              </div>
              <button onClick={() => setViewDrill(null)} style={btn('#334155')}>Close</button>
            </div>

            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
              Initiated: {viewDrill.initiatedBy} | {viewDrill.createdAt.slice(0, 16).replace('T', ' ')}
            </div>

            {viewDrill.expectedOutcome && (
              <div style={{ marginBottom: 8 }}>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Expected Outcome</h4>
                <div style={{ fontSize: 13 }}>{viewDrill.expectedOutcome}</div>
              </div>
            )}
            {viewDrill.observedOutcome && (
              <div style={{ marginBottom: 8 }}>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Observed Outcome</h4>
                <div style={{ fontSize: 13 }}>{viewDrill.observedOutcome}</div>
              </div>
            )}

            {/* Checks */}
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Checks</h4>
            <div style={{ marginBottom: 12 }}>
              {viewDrill.checks.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #334155' }}>
                  <span style={{ color: c.passed ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 14 }}>{c.passed ? '✓' : '✗'}</span>
                  <span style={{ fontSize: 13 }}>{c.name}</span>
                  {c.detail && <span style={{ fontSize: 11, color: '#94a3b8' }}>— {c.detail}</span>}
                </div>
              ))}
              {viewDrill.checks.length === 0 && <div style={{ color: '#64748b', fontSize: 12 }}>No checks recorded</div>}
            </div>

            {/* Linked items */}
            {(viewDrill.linkedIncidentIds.length > 0 || viewDrill.linkedNotificationIds.length > 0) && (
              <div style={{ marginBottom: 12 }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Linked Items</h4>
                {viewDrill.linkedIncidentIds.map(id => (
                  <div key={id} style={{ fontSize: 12, marginBottom: 2 }}>Incident: <a href="/admin/operations-center" style={{ color: '#93c5fd' }}>{id}</a></div>
                ))}
                {viewDrill.linkedNotificationIds.map(id => (
                  <div key={id} style={{ fontSize: 12, marginBottom: 2 }}>Notification: <a href="/admin/notifications" style={{ color: '#93c5fd' }}>{id}</a></div>
                ))}
              </div>
            )}

            {/* Notes */}
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Notes / Lessons Learned</h4>
            {viewDrill.notes.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>No notes yet</div>
            ) : (
              <div style={{ marginBottom: 8 }}>
                {viewDrill.notes.map((n, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid #334155' }}>{n}</div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add note / lesson learned..." style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => addNote(viewDrill.id)} style={btn('#6366f1')}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
