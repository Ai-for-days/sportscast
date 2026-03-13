import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface UserRole { userId: string; email?: string; role: string; status: string; assignedBy: string; createdAt: string; updatedAt: string; }
interface ApprovalRequest { id: string; createdAt: string; actionType: string; targetType: string; targetId?: string; requestedBy: string; status: string; approverId?: string; approvedAt?: string; rejectedAt?: string; notes?: string; }
interface SecurityEvent { id: string; createdAt: string; eventType: string; actor: string; target?: string; details?: string; }

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };
const selectStyle: React.CSSProperties = { ...inputStyle };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const STATUS_COLORS: Record<string, string> = { active: '#22c55e', disabled: '#dc2626', pending: '#eab308', approved: '#22c55e', rejected: '#dc2626', cancelled: '#64748b' };
const EVENT_COLORS: Record<string, string> = { permission_denied: '#dc2626', sensitive_action_blocked: '#dc2626', approval_approved: '#22c55e', approval_rejected: '#f97316', approval_requested: '#3b82f6', dual_control_required: '#eab308', role_assigned: '#6366f1', role_changed: '#6366f1', user_disabled: '#dc2626' };

export default function Security() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});
  const [dualActions, setDualActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'users' | 'permissions' | 'approvals' | 'activity'>('users');

  // Forms
  const [newUserId, setNewUserId] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('');
  const [aprAction, setAprAction] = useState('');
  const [aprTarget, setAprTarget] = useState('');
  const [aprRequester, setAprRequester] = useState('admin');
  const [aprNotes, setAprNotes] = useState('');
  const [approverId, setApproverId] = useState('admin');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/security');
      if (res.ok) {
        const d = await res.json();
        setUsers(d.users || []); setApprovals(d.approvals || []); setEvents(d.events || []);
        setRoles(d.roles || []); setPermissions(d.permissions || []);
        setRolePerms(d.rolePermissions || {}); setDualActions(d.dualControlActions || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/security', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return; }
      setMsg('Done');
      await fetchData();
    } catch (e: any) { setMsg(e.message); }
  };

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading security dashboard...</div>;

  const navLinks = [
    { href: '/admin/trading-desk', label: 'Trading Desk' },
    { href: '/admin/operator-dashboard', label: 'Operator' },
    { href: '/admin/alerts', label: 'Alerts' },
    { href: '/admin/security', label: 'Security', active: true },
  ];

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Security & Access Control</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Roles, permissions, approval hierarchy, dual-control</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['users', 'permissions', 'approvals', 'activity'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize' }}>{t}</button>
        ))}
        <button onClick={() => post({ action: 'initialize-defaults' })} style={btn('#065f46')}>Init Defaults</button>
      </div>

      {/* ============================================================ */}
      {/* USERS TAB                                                      */}
      {/* ============================================================ */}
      {tab === 'users' && (
        <>
          <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 120 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>User ID</label>
              <input value={newUserId} onChange={e => setNewUserId(e.target.value)} style={inputStyle} placeholder="user123" /></div>
            <div style={{ minWidth: 150 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Email</label>
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)} style={inputStyle} placeholder="Optional" /></div>
            <div style={{ minWidth: 120 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Role</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={selectStyle}>
                <option value="">Select...</option>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select></div>
            <button onClick={() => { if (newUserId && newRole) { post({ action: 'assign-role', userId: newUserId, role: newRole, email: newEmail }); setNewUserId(''); setNewEmail(''); } }} style={btn('#6366f1')}>Assign Role</button>
          </div>

          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Users ({users.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>User ID</th><th style={th}>Email</th><th style={th}>Role</th><th style={th}>Status</th><th style={th}>Assigned By</th><th style={th}>Updated</th><th style={th}>Actions</th></tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.userId}>
                      <td style={td}>{u.userId}</td>
                      <td style={td}>{u.email || '—'}</td>
                      <td style={td}><span style={badge('#6366f1')}>{u.role}</span></td>
                      <td style={td}><span style={badge(STATUS_COLORS[u.status] || '#64748b')}>{u.status.toUpperCase()}</span></td>
                      <td style={td}>{u.assignedBy}</td>
                      <td style={td}>{u.updatedAt?.slice(0, 10)}</td>
                      <td style={td}>
                        {u.status === 'active' ? (
                          <button onClick={() => post({ action: 'disable-user', userId: u.userId })} style={btn('#dc2626')}>Disable</button>
                        ) : (
                          <button onClick={() => post({ action: 'enable-user', userId: u.userId })} style={btn('#22c55e')}>Enable</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No users. Click Init Defaults or assign a role.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ============================================================ */}
      {/* PERMISSIONS TAB                                                */}
      {/* ============================================================ */}
      {tab === 'permissions' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Role × Permission Matrix</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...th, position: 'sticky', left: 0, background: '#1e293b', zIndex: 1 }}>Permission</th>
                  {roles.map(r => <th key={r} style={{ ...th, textAlign: 'center', minWidth: 70 }}>{r}</th>)}
                </tr>
              </thead>
              <tbody>
                {permissions.map(p => (
                  <tr key={p}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: '#1e293b', zIndex: 1, fontSize: 11 }}>{p}</td>
                    {roles.map(r => {
                      const has = (rolePerms[r] || []).includes(p);
                      return <td key={r} style={{ ...td, textAlign: 'center' }}>{has ? <span style={{ color: '#22c55e', fontWeight: 700 }}>&#10003;</span> : <span style={{ color: '#334155' }}>—</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <h4 style={{ fontSize: 12, fontWeight: 600, color: '#eab308', marginBottom: 4 }}>Dual-Control Actions (require two-person approval)</h4>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {dualActions.map(a => <span key={a} style={badge('#eab308')}>{a}</span>)}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* APPROVALS TAB                                                  */}
      {/* ============================================================ */}
      {tab === 'approvals' && (
        <>
          <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 140 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Action Type</label>
              <input value={aprAction} onChange={e => setAprAction(e.target.value)} style={inputStyle} placeholder="enable_live_mode" /></div>
            <div style={{ minWidth: 120 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Target Type</label>
              <input value={aprTarget} onChange={e => setAprTarget(e.target.value)} style={inputStyle} placeholder="system" /></div>
            <div style={{ minWidth: 100 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Requested By</label>
              <input value={aprRequester} onChange={e => setAprRequester(e.target.value)} style={inputStyle} /></div>
            <div style={{ minWidth: 140 }}><label style={{ fontSize: 11, color: '#94a3b8' }}>Notes</label>
              <input value={aprNotes} onChange={e => setAprNotes(e.target.value)} style={inputStyle} placeholder="Optional" /></div>
            <button onClick={() => { if (aprAction && aprTarget) { post({ action: 'create-approval-request', actionType: aprAction, targetType: aprTarget, requestedBy: aprRequester, notes: aprNotes }); setAprAction(''); setAprNotes(''); } }} style={btn('#3b82f6')}>Request Approval</button>
          </div>

          <div style={{ ...card, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 11, color: '#94a3b8' }}>Approver ID:</label>
            <input value={approverId} onChange={e => setApproverId(e.target.value)} style={{ ...inputStyle, width: 120 }} />
          </div>

          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Approval Requests ({approvals.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Created</th><th style={th}>Action</th><th style={th}>Target</th><th style={th}>Requested By</th><th style={th}>Status</th><th style={th}>Approver</th><th style={th}>Notes</th><th style={th}>Actions</th></tr></thead>
                <tbody>
                  {approvals.map(a => (
                    <tr key={a.id}>
                      <td style={td}>{a.createdAt?.slice(0, 16).replace('T', ' ')}</td>
                      <td style={td}><span style={badge(dualActions.includes(a.actionType) ? '#eab308' : '#334155')}>{a.actionType}</span></td>
                      <td style={td}>{a.targetType}{a.targetId ? ` (${a.targetId.slice(0, 10)})` : ''}</td>
                      <td style={td}>{a.requestedBy}</td>
                      <td style={td}><span style={badge(STATUS_COLORS[a.status] || '#64748b')}>{a.status.toUpperCase()}</span></td>
                      <td style={td}>{a.approverId || '—'}</td>
                      <td style={{ ...td, fontSize: 11 }}>{a.notes || '—'}</td>
                      <td style={td}>
                        {a.status === 'pending' && (
                          <>
                            <button onClick={() => post({ action: 'approve-request', id: a.id, approverId })} style={{ ...btn('#22c55e'), marginRight: 4 }}>Approve</button>
                            <button onClick={() => post({ action: 'reject-request', id: a.id, approverId })} style={btn('#dc2626')}>Reject</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {approvals.length === 0 && <tr><td colSpan={8} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No approval requests.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ============================================================ */}
      {/* ACTIVITY TAB                                                   */}
      {/* ============================================================ */}
      {tab === 'activity' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Security Activity ({events.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Time</th><th style={th}>Event</th><th style={th}>Actor</th><th style={th}>Target</th><th style={th}>Details</th></tr></thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id}>
                    <td style={td}>{e.createdAt?.slice(0, 19).replace('T', ' ')}</td>
                    <td style={td}><span style={badge(EVENT_COLORS[e.eventType] || '#334155')}>{e.eventType}</span></td>
                    <td style={td}>{e.actor}</td>
                    <td style={td}>{e.target || '—'}</td>
                    <td style={{ ...td, fontSize: 12, maxWidth: 300 }}>{e.details || '—'}</td>
                  </tr>
                ))}
                {events.length === 0 && <tr><td colSpan={5} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No security events.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
