import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ChangeRequest {
  id: string; createdAt: string; updatedAt: string; title: string;
  category: string; severity: string; status: string; requestedBy: string;
  approvedBy?: string; implementedBy?: string; description: string;
  changeSummary?: string; rollbackPlan?: string; notes: string[];
  linkedReleaseId?: string;
}
interface Release {
  id: string; createdAt: string; versionLabel: string; status: string;
  title: string; summary: string; relatedChangeIds: string[];
  notes?: string; deployedBy?: string; rolledBackBy?: string;
}
interface StructuredChange {
  id: string; createdAt: string; changeType: string; targetType: string;
  targetId?: string; before?: any; after?: any; actor: string;
  relatedChangeRequestId?: string;
}
interface CRSummary {
  total: number; draft: number; pendingApproval: number; approved: number;
  implemented: number; rejected: number; rolledBack: number;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };
const selectStyle: React.CSSProperties = { ...inputStyle };
const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 60, resize: 'vertical' as const };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const SEV_COLORS: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#64748b' };
const STATUS_COLORS: Record<string, string> = {
  draft: '#64748b', pending_approval: '#f59e0b', approved: '#3b82f6',
  rejected: '#ef4444', implemented: '#22c55e', rolled_back: '#dc2626',
  planned: '#3b82f6', deployed: '#22c55e',
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ChangeControl() {
  const [summary, setSummary] = useState<CRSummary | null>(null);
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [structured, setStructured] = useState<StructuredChange[]>([]);
  const [changesToday, setChangesToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'overview' | 'changes' | 'releases' | 'history'>('overview');

  // Modals
  const [showNewCR, setShowNewCR] = useState(false);
  const [showNewRelease, setShowNewRelease] = useState(false);
  const [viewCR, setViewCR] = useState<ChangeRequest | null>(null);
  const [noteText, setNoteText] = useState('');

  // New CR form
  const [crTitle, setCrTitle] = useState('');
  const [crCategory, setCrCategory] = useState('config');
  const [crSeverity, setCrSeverity] = useState('medium');
  const [crDescription, setCrDescription] = useState('');
  const [crChangeSummary, setCrChangeSummary] = useState('');
  const [crRollback, setCrRollback] = useState('');

  // New release form
  const [relVersion, setRelVersion] = useState('');
  const [relTitle, setRelTitle] = useState('');
  const [relSummary, setRelSummary] = useState('');

  const fetchAll = async () => {
    try {
      const res = await fetch('/api/admin/change-control');
      if (res.ok) {
        const d = await res.json();
        setSummary(d.summary || null);
        setChanges(d.changes || []);
        setReleases(d.releases || []);
        setStructured(d.structured || []);
        setChangesToday(d.changesToday || 0);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/change-control', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return null; }
      setMsg('Done');
      await fetchAll();
      return j;
    } catch (e: any) { setMsg(e.message); return null; }
  };

  const createCR = async () => {
    if (!crTitle || !crDescription) { setMsg('Title and description required'); return; }
    await post({
      action: 'create-change-request', title: crTitle, category: crCategory,
      severity: crSeverity, description: crDescription,
      changeSummary: crChangeSummary || undefined, rollbackPlan: crRollback || undefined,
    });
    setShowNewCR(false);
    setCrTitle(''); setCrDescription(''); setCrChangeSummary(''); setCrRollback('');
  };

  const createRel = async () => {
    if (!relVersion || !relTitle) { setMsg('Version and title required'); return; }
    await post({ action: 'create-release', versionLabel: relVersion, title: relTitle, summary: relSummary });
    setShowNewRelease(false);
    setRelVersion(''); setRelTitle(''); setRelSummary('');
  };

  const updateCRStatus = async (id: string, status: string) => {
    await post({ action: 'update-change-request-status', id, status });
    setViewCR(null);
  };

  const addNote = async (id: string) => {
    if (!noteText) return;
    await post({ action: 'add-change-request-note', id, note: noteText });
    setNoteText('');
    const res = await fetch('/api/admin/change-control?action=changes');
    if (res.ok) {
      const d = await res.json();
      const updated = (d.changes || []).find((c: ChangeRequest) => c.id === id);
      if (updated) setViewCR(updated);
    }
  };

  const updateRelStatus = async (id: string, status: string) => {
    await post({ action: 'update-release-status', id, status });
  };

  const navLinks = [
    { href: '/admin/operations-center', label: 'Ops Center' },
    { href: '/admin/model-governance', label: 'Governance' },
    { href: '/admin/security', label: 'Security' },
    { href: '/admin/change-control', label: 'Change Control', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading change control...</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Change Management + Release Control</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Track, approve, and deploy platform changes with rollback readiness</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['overview', 'changes', 'releases', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {/* ═══════ OVERVIEW ═══════ */}
      {tab === 'overview' && summary && (
        <>
          <div style={grid4}>
            <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.draft + summary.pendingApproval + summary.approved}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Open CRs</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.pendingApproval}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Pending Approval</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.implemented}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Implemented</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #3b82f6' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{releases.filter(r => r.status === 'deployed').length}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Releases Deployed</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #ef4444' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.rolledBack + releases.filter(r => r.status === 'rolled_back').length}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Rollbacks</div>
            </div>
            <div style={{ ...card, borderLeft: '3px solid #8b5cf6' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{changesToday}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Changes Today</div>
            </div>
          </div>

          {/* Recent changes */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>Recent Change Requests</h3>
              <button onClick={() => setShowNewCR(true)} style={btn('#6366f1')}>New CR</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Title</th><th style={th}>Category</th><th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Requested</th><th style={th}>Created</th><th style={th}>Actions</th></tr></thead>
                <tbody>
                  {changes.slice(0, 10).map(c => (
                    <tr key={c.id}>
                      <td style={td}>{c.title}</td>
                      <td style={td}><span style={badge('#334155')}>{c.category}</span></td>
                      <td style={td}><span style={badge(SEV_COLORS[c.severity] || '#64748b')}>{c.severity}</span></td>
                      <td style={td}><span style={badge(STATUS_COLORS[c.status] || '#64748b')}>{c.status.replace(/_/g, ' ')}</span></td>
                      <td style={td}>{c.requestedBy}</td>
                      <td style={td}>{c.createdAt.slice(0, 10)}</td>
                      <td style={td}><button onClick={() => setViewCR(c)} style={btn('#6366f1')}>View</button></td>
                    </tr>
                  ))}
                  {changes.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No change requests</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══════ CHANGES TAB ═══════ */}
      {tab === 'changes' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>All Change Requests ({changes.length})</h3>
            <button onClick={() => setShowNewCR(true)} style={btn('#6366f1')}>New CR</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Title</th><th style={th}>Category</th><th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Requested</th><th style={th}>Approved</th><th style={th}>Implemented</th><th style={th}>Created</th><th style={th}>Actions</th></tr></thead>
              <tbody>
                {changes.map(c => (
                  <tr key={c.id}>
                    <td style={td}>{c.title}</td>
                    <td style={td}><span style={badge('#334155')}>{c.category}</span></td>
                    <td style={td}><span style={badge(SEV_COLORS[c.severity] || '#64748b')}>{c.severity}</span></td>
                    <td style={td}><span style={badge(STATUS_COLORS[c.status] || '#64748b')}>{c.status.replace(/_/g, ' ')}</span></td>
                    <td style={td}>{c.requestedBy}</td>
                    <td style={td}>{c.approvedBy || '—'}</td>
                    <td style={td}>{c.implementedBy || '—'}</td>
                    <td style={td}>{c.createdAt.slice(0, 10)}</td>
                    <td style={td}><button onClick={() => setViewCR(c)} style={btn('#6366f1')}>View</button></td>
                  </tr>
                ))}
                {changes.length === 0 && <tr><td colSpan={9} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No change requests</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ RELEASES TAB ═══════ */}
      {tab === 'releases' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Release Log ({releases.length})</h3>
            <button onClick={() => setShowNewRelease(true)} style={btn('#22c55e')}>New Release</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Version</th><th style={th}>Title</th><th style={th}>Status</th><th style={th}>Changes</th><th style={th}>Deployed By</th><th style={th}>Created</th><th style={th}>Actions</th></tr></thead>
              <tbody>
                {releases.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 600, fontFamily: 'monospace' }}>{r.versionLabel}</td>
                    <td style={td}>{r.title}</td>
                    <td style={td}><span style={badge(STATUS_COLORS[r.status] || '#64748b')}>{r.status.replace(/_/g, ' ')}</span></td>
                    <td style={td}>{r.relatedChangeIds.length}</td>
                    <td style={td}>{r.deployedBy || '—'}</td>
                    <td style={td}>{r.createdAt.slice(0, 10)}</td>
                    <td style={td}>
                      {r.status === 'planned' && <button onClick={() => updateRelStatus(r.id, 'deployed')} style={{ ...btn('#22c55e'), marginRight: 4 }}>Deploy</button>}
                      {r.status === 'deployed' && <button onClick={() => updateRelStatus(r.id, 'rolled_back')} style={btn('#ef4444')}>Rollback</button>}
                    </td>
                  </tr>
                ))}
                {releases.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No releases</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ HISTORY TAB ═══════ */}
      {tab === 'history' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Structured Change History ({structured.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Time</th><th style={th}>Type</th><th style={th}>Target</th><th style={th}>Actor</th><th style={th}>Before</th><th style={th}>After</th><th style={th}>CR</th></tr></thead>
              <tbody>
                {structured.map(s => (
                  <tr key={s.id}>
                    <td style={td}>{s.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td style={{ ...td, fontSize: 12, fontFamily: 'monospace' }}>{s.changeType}</td>
                    <td style={td}>{s.targetType}{s.targetId ? `:${s.targetId}` : ''}</td>
                    <td style={td}>{s.actor}</td>
                    <td style={{ ...td, fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.before ? JSON.stringify(s.before).slice(0, 40) : '—'}</td>
                    <td style={{ ...td, fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.after ? JSON.stringify(s.after).slice(0, 40) : '—'}</td>
                    <td style={td}>{s.relatedChangeRequestId?.slice(0, 12) || '—'}</td>
                  </tr>
                ))}
                {structured.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No structured changes recorded</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ NEW CR MODAL ═══════ */}
      {showNewCR && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 550, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>New Change Request</h3>
              <button onClick={() => setShowNewCR(false)} style={btn('#334155')}>Close</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Title</label><input value={crTitle} onChange={e => setCrTitle(e.target.value)} style={inputStyle} /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Category</label>
                  <select value={crCategory} onChange={e => setCrCategory(e.target.value)} style={selectStyle}>
                    <option value="config">Config</option><option value="model">Model</option>
                    <option value="permissions">Permissions</option><option value="execution">Execution</option>
                    <option value="pricing">Pricing</option><option value="ops">Ops</option><option value="release">Release</option>
                  </select></div>
                <div style={{ flex: 1 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Severity</label>
                  <select value={crSeverity} onChange={e => setCrSeverity(e.target.value)} style={selectStyle}>
                    <option value="low">Low</option><option value="medium">Medium</option>
                    <option value="high">High</option><option value="critical">Critical</option>
                  </select></div>
              </div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Description</label><textarea value={crDescription} onChange={e => setCrDescription(e.target.value)} style={textareaStyle} /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Change Summary</label><textarea value={crChangeSummary} onChange={e => setCrChangeSummary(e.target.value)} placeholder="What will change?" style={textareaStyle} /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Rollback Plan</label><textarea value={crRollback} onChange={e => setCrRollback(e.target.value)} placeholder="How to revert?" style={textareaStyle} /></div>
              <button onClick={createCR} style={btn('#6366f1')}>Create Change Request</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ VIEW CR MODAL ═══════ */}
      {viewCR && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 600, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>{viewCR.title}</h3>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span style={badge(SEV_COLORS[viewCR.severity] || '#64748b')}>{viewCR.severity}</span>
                  <span style={badge(STATUS_COLORS[viewCR.status] || '#64748b')}>{viewCR.status.replace(/_/g, ' ')}</span>
                  <span style={badge('#334155')}>{viewCR.category}</span>
                </div>
              </div>
              <button onClick={() => setViewCR(null)} style={btn('#334155')}>Close</button>
            </div>

            <div style={{ fontSize: 13, marginBottom: 8 }}>{viewCR.description}</div>

            {viewCR.changeSummary && (
              <div style={{ marginBottom: 8 }}>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Change Summary</h4>
                <div style={{ fontSize: 13 }}>{viewCR.changeSummary}</div>
              </div>
            )}

            {viewCR.rollbackPlan && (
              <div style={{ marginBottom: 8 }}>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Rollback Plan</h4>
                <div style={{ fontSize: 13 }}>{viewCR.rollbackPlan}</div>
              </div>
            )}

            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              Requested: {viewCR.requestedBy} | Approved: {viewCR.approvedBy || '—'} | Implemented: {viewCR.implementedBy || '—'}
            </div>

            {/* Status transitions */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
              {viewCR.status === 'draft' && <button onClick={() => updateCRStatus(viewCR.id, 'pending_approval')} style={btn('#f59e0b')}>Submit for Approval</button>}
              {viewCR.status === 'pending_approval' && (
                <>
                  <button onClick={() => updateCRStatus(viewCR.id, 'approved')} style={btn('#22c55e')}>Approve</button>
                  <button onClick={() => updateCRStatus(viewCR.id, 'rejected')} style={btn('#ef4444')}>Reject</button>
                </>
              )}
              {viewCR.status === 'approved' && <button onClick={() => updateCRStatus(viewCR.id, 'implemented')} style={btn('#22c55e')}>Mark Implemented</button>}
              {viewCR.status === 'implemented' && <button onClick={() => updateCRStatus(viewCR.id, 'rolled_back')} style={btn('#ef4444')}>Mark Rolled Back</button>}
            </div>

            {/* Notes */}
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Notes</h4>
            {viewCR.notes.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>No notes yet</div>
            ) : (
              <div style={{ marginBottom: 8 }}>
                {viewCR.notes.map((n, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid #334155' }}>{n}</div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add note..." style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => addNote(viewCR.id)} style={btn('#6366f1')}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ NEW RELEASE MODAL ═══════ */}
      {showNewRelease && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 500, width: '95%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>New Release</h3>
              <button onClick={() => setShowNewRelease(false)} style={btn('#334155')}>Close</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Version Label</label><input value={relVersion} onChange={e => setRelVersion(e.target.value)} placeholder="e.g. v1.46.0" style={inputStyle} /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Title</label><input value={relTitle} onChange={e => setRelTitle(e.target.value)} style={inputStyle} /></div>
              <div><label style={{ fontSize: 11, color: '#94a3b8' }}>Summary</label><textarea value={relSummary} onChange={e => setRelSummary(e.target.value)} style={textareaStyle} /></div>
              <button onClick={createRel} style={btn('#22c55e')}>Create Release</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
