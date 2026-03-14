import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ReadinessCheck {
  key: string; label: string; category: string; severity: string;
  passed: boolean; message: string; checkedAt: string;
}
interface ReadinessSummary {
  total: number; passed: number; failed: number; critical: number;
  warnings: number; ready: boolean; checkedAt: string;
}
interface ChecklistItem {
  id: string; createdAt: string; itemKey: string; label: string;
  completed: boolean; completedBy?: string; completedAt?: string; notes?: string;
}
interface ChecklistProgress { total: number; completed: number; percent: number; }
interface LaunchSignoff {
  id: string; createdAt: string; status: string; requestedBy: string;
  approvedBy?: string; rejectedBy?: string; notes?: string;
}
type LaunchState = 'prelaunch' | 'ready' | 'locked_for_launch' | 'launched' | 'launch_blocked';

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };

const SEV_COLORS: Record<string, string> = { critical: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
const STATE_COLORS: Record<string, string> = { prelaunch: '#64748b', ready: '#3b82f6', locked_for_launch: '#f59e0b', launched: '#22c55e', launch_blocked: '#ef4444' };
const SIGNOFF_COLORS: Record<string, string> = { pending: '#f59e0b', approved: '#22c55e', rejected: '#ef4444' };

const TABS = ['overview', 'checks', 'checklist', 'signoff', 'state'] as const;
type Tab = typeof TABS[number];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function LaunchReadiness() {
  const [summary, setSummary] = useState<ReadinessSummary | null>(null);
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [progress, setProgress] = useState<ChecklistProgress | null>(null);
  const [signoffs, setSignoffs] = useState<LaunchSignoff[]>([]);
  const [state, setState] = useState<LaunchState>('prelaunch');
  const [allowed, setAllowed] = useState<LaunchState[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  // Form state
  const [signoffRequester, setSignoffRequester] = useState('');
  const [signoffNotes, setSignoffNotes] = useState('');
  const [approver, setApprover] = useState('');
  const [approveNotes, setApproveNotes] = useState('');

  const fetchAll = async () => {
    try {
      const r = await fetch('/api/admin/launch-readiness');
      const d = await r.json();
      setSummary(d.readinessSummary || null);
      setChecks(d.checks || []);
      setChecklist(d.checklist || []);
      setProgress(d.progress || null);
      setSignoffs(d.signoffs || []);
      setState(d.state || 'prelaunch');
      setAllowed(d.allowedTransitions || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { (async () => { setLoading(true); await fetchAll(); setLoading(false); })(); }, []);

  const post = async (action: string, extra: any = {}) => {
    const r = await fetch('/api/admin/launch-readiness', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
    return r.json();
  };

  const seedChecklist = async () => { const d = await post('seed-default-checklist'); setMsg(d.ok ? d.message : d.error); fetchAll(); };
  const completeItem = async (itemKey: string) => { const d = await post('complete-checklist-item', { itemKey, actor: 'admin' }); setMsg(d.ok ? `Completed: ${d.item.label}` : d.error); fetchAll(); };
  const requestSignoff = async () => {
    if (!signoffRequester) { setMsg('Requester name required'); return; }
    const d = await post('request-launch-signoff', { requestedBy: signoffRequester, notes: signoffNotes });
    setMsg(d.ok ? 'Signoff requested' : d.error);
    setSignoffRequester(''); setSignoffNotes('');
    fetchAll();
  };
  const approveSignoff = async (id: string) => {
    if (!approver) { setMsg('Approver name required'); return; }
    const d = await post('approve-launch-signoff', { id, approvedBy: approver, notes: approveNotes });
    setMsg(d.ok ? 'Signoff approved' : d.error || 'Self-approval blocked or not found');
    setApprover(''); setApproveNotes('');
    fetchAll();
  };
  const rejectSignoff = async (id: string) => {
    const d = await post('reject-launch-signoff', { id, rejectedBy: approver || 'admin' });
    setMsg(d.ok ? 'Signoff rejected' : d.error);
    fetchAll();
  };
  const changeState = async (newState: LaunchState) => {
    const d = await post('update-launch-state', { state: newState, actor: 'admin' });
    setMsg(d.ok ? `State changed to ${d.state}` : d.error);
    fetchAll();
  };

  if (loading) return <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>Loading launch readiness…</div>;

  return (
    <div style={{ color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Production Readiness &amp; Launch</h1>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0' }}>Readiness checks, launch checklist, signoff workflow, and state machine governance.</p>
        </div>
        <span style={badge(STATE_COLORS[state] || '#64748b')}>{state.replace(/_/g, ' ').toUpperCase()}</span>
        <button style={btn('#334155')} onClick={() => { fetchAll(); setMsg(''); }}>Refresh</button>
      </div>

      {msg && <div style={{ ...card, background: '#164e63', fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t} style={{ ...btn(tab === t ? '#3b82f6' : '#334155'), textTransform: 'capitalize' }} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* ---- Overview ---- */}
      {tab === 'overview' && (
        <>
          <div style={grid4}>
            {summary && <>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Overall</div><div style={{ fontSize: 22, fontWeight: 700, color: summary.ready ? '#22c55e' : '#ef4444' }}>{summary.ready ? 'READY' : 'NOT READY'}</div></div>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Critical Failures</div><div style={{ fontSize: 22, fontWeight: 700, color: summary.critical > 0 ? '#ef4444' : '#22c55e' }}>{summary.critical}</div></div>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Warnings</div><div style={{ fontSize: 22, fontWeight: 700, color: summary.warnings > 0 ? '#f59e0b' : '#22c55e' }}>{summary.warnings}</div></div>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Checks Passed</div><div style={{ fontSize: 22, fontWeight: 700 }}>{summary.passed}/{summary.total}</div></div>
            </>}
            {progress && (
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Checklist</div><div style={{ fontSize: 22, fontWeight: 700 }}>{progress.percent}%</div>
                <div style={{ background: '#334155', borderRadius: 4, height: 6, marginTop: 6 }}><div style={{ background: '#3b82f6', borderRadius: 4, height: 6, width: `${progress.percent}%` }} /></div>
              </div>
            )}
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Launch State</div><div style={{ fontSize: 18, fontWeight: 700 }}><span style={badge(STATE_COLORS[state] || '#64748b')}>{state.replace(/_/g, ' ')}</span></div></div>
          </div>

          {/* Failed checks */}
          {checks.filter(c => !c.passed).length > 0 && (
            <div style={card}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Failed Checks</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>Category</th><th style={th}>Check</th><th style={th}>Severity</th><th style={th}>Message</th></tr></thead>
                  <tbody>
                    {checks.filter(c => !c.passed).map(c => (
                      <tr key={c.key}>
                        <td style={td}><span style={badge('#334155')}>{c.category}</span></td>
                        <td style={td}>{c.label}</td>
                        <td style={td}><span style={badge(SEV_COLORS[c.severity] || '#64748b')}>{c.severity}</span></td>
                        <td style={{ ...td, color: '#94a3b8' }}>{c.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent signoffs */}
          {signoffs.length > 0 && (
            <div style={card}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Recent Signoffs</h3>
              {signoffs.slice(0, 3).map(s => (
                <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                  <span style={badge(SIGNOFF_COLORS[s.status] || '#64748b')}>{s.status}</span>
                  <span>by {s.requestedBy}</span>
                  {s.approvedBy && <span style={{ color: '#22c55e' }}>approved by {s.approvedBy}</span>}
                  <span style={{ color: '#64748b', fontSize: 11 }}>{new Date(s.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---- Checks ---- */}
      {tab === 'checks' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>All Readiness Checks</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Category</th><th style={th}>Check</th><th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Message</th></tr></thead>
              <tbody>
                {checks.map(c => (
                  <tr key={c.key}>
                    <td style={td}><span style={badge('#334155')}>{c.category}</span></td>
                    <td style={td}>{c.label}</td>
                    <td style={td}><span style={badge(SEV_COLORS[c.severity] || '#64748b')}>{c.severity}</span></td>
                    <td style={td}>{c.passed ? <span style={badge('#22c55e')}>PASS</span> : <span style={badge('#ef4444')}>FAIL</span>}</td>
                    <td style={{ ...td, color: '#94a3b8', fontSize: 12 }}>{c.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Checklist ---- */}
      {tab === 'checklist' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>Go-Live Checklist {progress && `(${progress.percent}%)`}</h3>
            <button style={btn('#6366f1')} onClick={seedChecklist}>Seed Default Checklist</button>
          </div>
          {progress && (
            <div style={{ background: '#334155', borderRadius: 4, height: 8, marginBottom: 16 }}>
              <div style={{ background: progress.percent === 100 ? '#22c55e' : '#3b82f6', borderRadius: 4, height: 8, width: `${progress.percent}%`, transition: 'width 0.3s' }} />
            </div>
          )}
          {checklist.length === 0 && <div style={{ color: '#64748b', fontSize: 13 }}>No checklist items. Click "Seed Default Checklist" to create the standard go-live checklist.</div>}
          {checklist.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #1e293b' }}>
              <div style={{ width: 20, height: 20, borderRadius: 4, border: '2px solid', borderColor: item.completed ? '#22c55e' : '#475569', background: item.completed ? '#22c55e' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff', flexShrink: 0 }}>
                {item.completed && '✓'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, textDecoration: item.completed ? 'line-through' : 'none', color: item.completed ? '#64748b' : '#e2e8f0' }}>{item.label}</div>
                {item.completedBy && <div style={{ fontSize: 11, color: '#64748b' }}>Completed by {item.completedBy} — {item.completedAt && new Date(item.completedAt).toLocaleString()}</div>}
              </div>
              {!item.completed && <button style={btn('#22c55e')} onClick={() => completeItem(item.itemKey)}>Complete</button>}
            </div>
          ))}
        </div>
      )}

      {/* ---- Signoff ---- */}
      {tab === 'signoff' && (
        <>
          <div style={card}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Request Launch Signoff</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, alignItems: 'end' }}>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Requester</label><input style={inputStyle} value={signoffRequester} onChange={e => setSignoffRequester(e.target.value)} placeholder="Your name" /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Notes</label><input style={inputStyle} value={signoffNotes} onChange={e => setSignoffNotes(e.target.value)} placeholder="Optional notes" /></div>
              <button style={btn('#3b82f6')} onClick={requestSignoff}>Request Signoff</button>
            </div>
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 8 }}>Dual-control: the requester cannot self-approve. A different admin must approve the signoff.</div>
          </div>

          <div style={card}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Approve / Reject</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginBottom: 12 }}>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Approver Name</label><input style={inputStyle} value={approver} onChange={e => setApprover(e.target.value)} placeholder="Approver name" /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Notes</label><input style={inputStyle} value={approveNotes} onChange={e => setApproveNotes(e.target.value)} placeholder="Optional" /></div>
            </div>

            {signoffs.length === 0 && <div style={{ color: '#64748b', fontSize: 13 }}>No signoff requests yet.</div>}
            {signoffs.map(s => (
              <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={badge(SIGNOFF_COLORS[s.status] || '#64748b')}>{s.status}</span>
                <div style={{ flex: 1, fontSize: 13 }}>
                  <div>Requested by <strong>{s.requestedBy}</strong> — {new Date(s.createdAt).toLocaleString()}</div>
                  {s.approvedBy && <div style={{ color: '#22c55e', fontSize: 12 }}>Approved by {s.approvedBy}</div>}
                  {s.rejectedBy && <div style={{ color: '#ef4444', fontSize: 12 }}>Rejected by {s.rejectedBy}</div>}
                  {s.notes && <div style={{ color: '#94a3b8', fontSize: 11 }}>{s.notes}</div>}
                </div>
                {s.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={btn('#22c55e')} onClick={() => approveSignoff(s.id)}>Approve</button>
                    <button style={btn('#ef4444')} onClick={() => rejectSignoff(s.id)}>Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---- State ---- */}
      {tab === 'state' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Launch State Control</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>Current State:</span>
            <span style={{ ...badge(STATE_COLORS[state] || '#64748b'), fontSize: 14, padding: '4px 12px' }}>{state.replace(/_/g, ' ').toUpperCase()}</span>
          </div>

          <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 16, border: '1px solid #334155' }}>
            <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 6 }}>State Transitions</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              prelaunch → ready → locked_for_launch → launched<br />
              Any state → launch_blocked (emergency)<br />
              launch_blocked → prelaunch / ready (recovery)
            </div>
          </div>

          {state === 'locked_for_launch' || state === 'launched' ? (
            <div style={{ background: '#7f1d1d', borderRadius: 6, padding: 12, marginBottom: 16, border: '1px solid #ef4444' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fca5a5' }}>WARNING: Changing launch state affects production readiness. Ensure all stakeholders are notified before state changes.</div>
            </div>
          ) : null}

          <div style={{ fontSize: 13, marginBottom: 12 }}>Allowed transitions from <strong>{state}</strong>:</div>
          {allowed.length === 0 && <div style={{ color: '#64748b', fontSize: 13 }}>No transitions available from current state.</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {allowed.map(s => (
              <button key={s} style={btn(STATE_COLORS[s] || '#334155')} onClick={() => changeState(s)}>
                → {s.replace(/_/g, ' ').toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div style={{ ...card, background: '#0f172a', border: '1px solid #334155', marginTop: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Production Readiness Notes</h3>
        <ul style={{ fontSize: 13, color: '#94a3b8', margin: 0, paddingLeft: 20 }}>
          <li>Readiness checks validate environment, secrets, execution config, security roles, ops tooling, compliance, and resilience.</li>
          <li>Secrets are never exposed — only configured/not-configured status is shown.</li>
          <li>Go-live checklist must be completed before launch signoff is meaningful.</li>
          <li>Launch signoff uses dual-control: the requester cannot self-approve.</li>
          <li>No automatic launch trigger — all state transitions are manual and audit logged.</li>
          <li>Launch state is informational and governance-focused; it does not automatically enable/disable trading.</li>
        </ul>
      </div>
    </div>
  );
}
