import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, EmptyChart } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });
const inputStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 };

const recColor: Record<string, string> = {
  continue: '#22c55e', pause: '#f59e0b', expand: '#06b6d4', stop: '#ef4444', needs_more_data: '#64748b',
};
const decColor: Record<string, string> = {
  accepted: '#22c55e', rejected: '#ef4444', deferred: '#f59e0b', modified: '#3b82f6',
};
const statusColor: Record<string, string> = {
  open: '#3b82f6', in_progress: '#f59e0b', completed: '#22c55e', cancelled: '#475569',
};

type Tab = 'open' | 'completed' | 'overdue' | 'recommendation' | 'methodology';

export default function PilotDecisions() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [completing, setCompleting] = useState<{ id: string; note: string } | null>(null);
  const [editing, setEditing] = useState<any>(null);

  // Pre-create state if URL contains ?reviewId=…
  const [createForm, setCreateForm] = useState<{ reviewId: string; decision: string; rationale: string; plannedAction: string; dueDate: string } | null>(null);

  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const reviewId = params.get('reviewId');
    if (reviewId) {
      setCreateForm({ reviewId, decision: 'accepted', rationale: '', plannedAction: '', dueDate: '' });
    }
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/system/pilot-decisions?action=summary', { credentials: 'include' });
      const j = await res.json();
      setData(j);
    } catch { setData({ error: 'Failed to load' }); }
    setLoading(false);
  }

  async function postAction(action: string, body: any = {}) {
    setBusy(action);
    try {
      const res = await fetch('/api/admin/system/pilot-decisions', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const j = await res.json();
      if (res.ok) {
        setToast(`✓ ${action.replace(/-/g, ' ')}`);
        await reload();
        return j;
      } else {
        setToast(`Error: ${j.error || 'failed'}${j.message ? ` — ${j.message}` : ''}`);
      }
    } catch (e: any) {
      setToast(`Error: ${e?.message || 'network'}`);
    }
    setBusy(null);
    setTimeout(() => setToast(null), 3500);
    return null;
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading pilot decisions…</div>;
  if (!data || data.error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {data?.error || 'unknown'}</div>;

  const decisions: any[] = data.decisions ?? [];
  const summary = data.summary;
  const open = decisions.filter(d => d.status === 'open' || d.status === 'in_progress');
  const completed = decisions.filter(d => d.status === 'completed' || d.status === 'cancelled');
  const overdue = decisions.filter(d => {
    if (d.status === 'completed' || d.status === 'cancelled' || !d.dueDate) return false;
    return new Date(d.dueDate).getTime() < Date.now();
  });

  const fmtDate = (s?: string) => s ? new Date(s).toLocaleString() : '—';

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/pilot-decisions" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Pilot Decision Tracker</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 760 }}>
            Records whether operators acted on Step 85 go/no-go recommendations. <strong>Decision tracking only</strong> —
            never auto-pauses pilots, auto-promotes strategies, submits orders, or creates candidates.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <a
            href="/admin/system/strategy-brief"
            style={{ ...btn('#6366f1'), textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap' }}
          >Daily Brief →</a>
          <a
            href="/admin/system/strategy-scorecard"
            style={{ ...btn('#0ea5e9'), textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap' }}
          >Scorecard →</a>
        </div>
      </div>

      {/* Summary cards */}
      <div style={grid4}>
        <Tile label="Total decisions" value={`${summary.total}`} color="#cbd5e1" />
        <Tile label="Open" value={`${summary.byStatus.open}`} color={statusColor.open} />
        <Tile label="In progress" value={`${summary.byStatus.in_progress}`} color={statusColor.in_progress} />
        <Tile label="Completed" value={`${summary.byStatus.completed}`} color={statusColor.completed} />
        <Tile label="Cancelled" value={`${summary.byStatus.cancelled}`} color={statusColor.cancelled} />
        <Tile label="Overdue" value={`${summary.overdueCount}`} color={summary.overdueCount > 0 ? '#ef4444' : '#22c55e'} />
        <Tile label="Acceptance rate" value={summary.acceptanceRatePct != null ? `${summary.acceptanceRatePct.toFixed(1)}%` : '—'} color="#a5b4fc" />
        <Tile label="Deferred" value={`${summary.byDecision.deferred}`} color={decColor.deferred} />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['open', `Open (${open.length})`],
          ['completed', `Completed (${completed.length})`],
          ['overdue', `Overdue (${overdue.length})`],
          ['recommendation', 'By Recommendation'],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'open' && (
        <div style={card}>
          {open.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No open decisions. Open <a href="/admin/system/pilot-review" style={{ color: '#a5b4fc' }}>Pilot Review</a> and click <strong>Record decision</strong> on a completed review to add one.
            </div>
          ) : (
            <DecisionTable
              rows={open}
              showActions
              onMarkInProgress={(id) => postAction('mark-in-progress', { id })}
              onComplete={(id) => setCompleting({ id, note: '' })}
              onCancel={(id) => postAction('cancel-decision', { id })}
              onEdit={(d) => setEditing({
                id: d.id, decision: d.decision, rationale: d.rationale,
                plannedAction: d.plannedAction ?? '', dueDate: d.dueDate ?? '',
              })}
              fmtDate={fmtDate}
            />
          )}
        </div>
      )}

      {tab === 'completed' && (
        <div style={card}>
          {completed.length === 0
            ? <div style={{ padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No completed decisions yet.</div>
            : <DecisionTable rows={completed} showActions={false} fmtDate={fmtDate} />}
        </div>
      )}

      {tab === 'overdue' && (
        <div style={card}>
          {overdue.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#22c55e', fontSize: 13 }}>
              No overdue decisions. ✓
            </div>
          ) : (
            <DecisionTable
              rows={overdue}
              highlightOverdue
              showActions
              onMarkInProgress={(id) => postAction('mark-in-progress', { id })}
              onComplete={(id) => setCompleting({ id, note: '' })}
              onCancel={(id) => postAction('cancel-decision', { id })}
              onEdit={(d) => setEditing({
                id: d.id, decision: d.decision, rationale: d.rationale,
                plannedAction: d.plannedAction ?? '', dueDate: d.dueDate ?? '',
              })}
              fmtDate={fmtDate}
            />
          )}
        </div>
      )}

      {tab === 'recommendation' && (
        <div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Decisions by recommendation</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>How many decisions exist for each Step 85 recommendation type.</p>
            <BarChart
              valueFormatter={v => `${v}`}
              data={(['continue','pause','expand','stop','needs_more_data'] as const).map(r => ({
                label: r.replace(/_/g, ' '),
                value: summary.byRecommendation[r] ?? 0,
                color: recColor[r],
              }))}
            />
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Open vs completed</h4>
            <BarChart
              valueFormatter={v => `${v}`}
              data={[
                { label: 'open',        value: summary.byStatus.open,        color: statusColor.open },
                { label: 'in progress', value: summary.byStatus.in_progress, color: statusColor.in_progress },
                { label: 'completed',   value: summary.byStatus.completed,   color: statusColor.completed },
                { label: 'cancelled',   value: summary.byStatus.cancelled,   color: statusColor.cancelled },
              ]}
            />
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Recommendation acceptance</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Operator acceptance / rejection / modification of recommendations (deferred excluded from acceptance rate).</p>
            <BarChart
              valueFormatter={v => `${v}`}
              data={(['accepted','rejected','deferred','modified'] as const).map(d => ({
                label: d,
                value: summary.byDecision[d] ?? 0,
                color: decColor[d],
              }))}
            />
            {summary.acceptanceRatePct != null && (
              <p style={{ marginTop: 10, fontSize: 12, color: '#cbd5e1' }}>
                Acceptance rate: <strong style={{ color: '#22c55e' }}>{summary.acceptanceRatePct.toFixed(1)}%</strong>{' '}
                <span style={{ color: '#64748b' }}>(accepted / [accepted + rejected + modified])</span>
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Methodology</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' }}>
            <li>A decision can only be created against a <strong>completed</strong> pilot review (server-side enforced).</li>
            <li>Operator picks one of: <strong>accepted</strong> / <strong>rejected</strong> / <strong>deferred</strong> / <strong>modified</strong>, with mandatory rationale.</li>
            <li>Status workflow: <code>open → in_progress → completed</code> (or <code>cancelled</code>). No automatic transitions.</li>
            <li>Overdue: <code>dueDate &lt; now AND status not in {'{completed, cancelled}'}</code>. Surfaced in the Overdue tab.</li>
            <li>Acceptance rate excludes <code>deferred</code> decisions: <code>accepted / (accepted + rejected + modified)</code>.</li>
            <li>Linked-actions field is purely informational — the tracker never triggers pilot transitions, registry promotions, or change requests.</li>
            <li>Storage: Redis. <code>pilot-decision:{'{id}'}</code> + sorted-set <code>pilot-decisions:all</code>. Auto-trim oldest beyond 2000.</li>
            <li>Audit events: <code>pilot_decision_recorded</code>, <code>pilot_decision_updated</code>, <code>pilot_decision_completed</code>, <code>pilot_decision_cancelled</code>, <code>pilot_decision_status_changed</code>.</li>
            <li><strong>Safety:</strong> no autonomous trading, no order submission, no candidate auto-creation, no pilot status auto-change, no strategy auto-promotion. Decision tracking only.</li>
          </ul>
        </div>
      )}

      {/* Create modal (when arrived from review) */}
      {createForm && (
        <Modal title="Record decision" onClose={() => setCreateForm(null)} actions={
          <>
            <button onClick={() => setCreateForm(null)} style={btn('#475569')}>Cancel</button>
            <button
              onClick={async () => {
                if (!createForm.rationale.trim()) { setToast('Rationale is required'); setTimeout(() => setToast(null), 2000); return; }
                const res = await postAction('create-decision', {
                  reviewId: createForm.reviewId,
                  decision: createForm.decision,
                  rationale: createForm.rationale,
                  plannedAction: createForm.plannedAction || undefined,
                  dueDate: createForm.dueDate || undefined,
                });
                if (res?.decision) setCreateForm(null);
              }}
              disabled={!!busy}
              style={btn('#22c55e')}
            >Save decision</button>
          </>
        }>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
            For pilot review <code>{createForm.reviewId}</code>. Server pulls the recommendation from the review.
          </p>
          <Field label="Decision">
            <select value={createForm.decision} onChange={e => setCreateForm({ ...createForm, decision: e.target.value })} style={{ ...inputStyle, width: '100%' }}>
              <option value="accepted">accepted</option>
              <option value="rejected">rejected</option>
              <option value="deferred">deferred</option>
              <option value="modified">modified</option>
            </select>
          </Field>
          <Field label="Rationale (required)">
            <textarea value={createForm.rationale} onChange={e => setCreateForm({ ...createForm, rationale: e.target.value })} rows={3} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
          </Field>
          <Field label="Planned action (optional)">
            <input value={createForm.plannedAction} onChange={e => setCreateForm({ ...createForm, plannedAction: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
          </Field>
          <Field label="Due date (optional)">
            <input type="date" value={createForm.dueDate} onChange={e => setCreateForm({ ...createForm, dueDate: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
          </Field>
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title="Edit decision" onClose={() => setEditing(null)} actions={
          <>
            <button onClick={() => setEditing(null)} style={btn('#475569')}>Cancel</button>
            <button
              onClick={async () => {
                await postAction('update-decision', {
                  id: editing.id,
                  decision: editing.decision,
                  rationale: editing.rationale,
                  plannedAction: editing.plannedAction || undefined,
                  dueDate: editing.dueDate || undefined,
                });
                setEditing(null);
              }}
              disabled={!!busy}
              style={btn('#22c55e')}
            >Save</button>
          </>
        }>
          <Field label="Decision">
            <select value={editing.decision} onChange={e => setEditing({ ...editing, decision: e.target.value })} style={{ ...inputStyle, width: '100%' }}>
              <option value="accepted">accepted</option>
              <option value="rejected">rejected</option>
              <option value="deferred">deferred</option>
              <option value="modified">modified</option>
            </select>
          </Field>
          <Field label="Rationale">
            <textarea value={editing.rationale} onChange={e => setEditing({ ...editing, rationale: e.target.value })} rows={3} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
          </Field>
          <Field label="Planned action">
            <input value={editing.plannedAction} onChange={e => setEditing({ ...editing, plannedAction: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
          </Field>
          <Field label="Due date">
            <input type="date" value={editing.dueDate} onChange={e => setEditing({ ...editing, dueDate: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
          </Field>
        </Modal>
      )}

      {/* Complete modal */}
      {completing && (
        <Modal title="Mark decision completed" onClose={() => setCompleting(null)} actions={
          <>
            <button onClick={() => setCompleting(null)} style={btn('#475569')}>Cancel</button>
            <button
              onClick={async () => {
                await postAction('mark-completed', { id: completing.id, note: completing.note || undefined });
                setCompleting(null);
              }}
              disabled={!!busy}
              style={btn('#22c55e')}
            >Mark completed</button>
          </>
        }>
          <Field label="Completion note (optional)">
            <textarea value={completing.note} onChange={e => setCompleting({ ...completing, note: e.target.value })} rows={4} placeholder="What was done? Link to the change request or pilot transition if relevant." style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
          </Field>
        </Modal>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '10px 16px', borderRadius: 6, fontSize: 13, maxWidth: 480 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function DecisionTable({ rows, showActions, highlightOverdue, onMarkInProgress, onComplete, onCancel, onEdit, fmtDate }: {
  rows: any[]; showActions: boolean; highlightOverdue?: boolean;
  onMarkInProgress?: (id: string) => void;
  onComplete?: (id: string) => void;
  onCancel?: (id: string) => void;
  onEdit?: (d: any) => void;
  fmtDate: (s?: string) => string;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>Created</th>
          <th style={th}>Pilot</th>
          <th style={th}>Recommendation</th>
          <th style={th}>Decision</th>
          <th style={th}>Rationale</th>
          <th style={th}>Due</th>
          <th style={th}>Status</th>
          <th style={th}>Operator</th>
          {showActions && <th style={th}>Actions</th>}
        </tr></thead>
        <tbody>
          {rows.map((d: any) => {
            const overdue = highlightOverdue || (d.dueDate && new Date(d.dueDate).getTime() < Date.now() && d.status !== 'completed' && d.status !== 'cancelled');
            return (
              <tr key={d.id} style={overdue ? { background: 'rgba(239, 68, 68, 0.08)' } : undefined}>
                <td style={td}>{fmtDate(d.createdAt)}</td>
                <td style={td}>{d.pilotName ?? d.pilotId}<div style={{ fontSize: 11, color: '#64748b' }}>review {d.reviewId}</div></td>
                <td style={td}><span style={badge(recColor[d.recommendation])}>{d.recommendation.replace(/_/g, ' ')}</span></td>
                <td style={td}><span style={badge(decColor[d.decision])}>{d.decision}</span></td>
                <td style={{ ...td, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.rationale}>{d.rationale}</td>
                <td style={td}>{d.dueDate ? <span style={overdue ? { color: '#ef4444', fontWeight: 700 } : undefined}>{d.dueDate}</span> : '—'}</td>
                <td style={td}><span style={badge(statusColor[d.status])}>{d.status.replace('_', ' ')}</span></td>
                <td style={td}>{d.operatorId}{d.completedBy && d.completedBy !== d.operatorId ? ` → ${d.completedBy}` : ''}</td>
                {showActions && (
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {d.status === 'open' && onMarkInProgress && <button onClick={() => onMarkInProgress(d.id)} style={btn('#3b82f6')}>Start</button>}
                      {(d.status === 'open' || d.status === 'in_progress') && onComplete && <button onClick={() => onComplete(d.id)} style={btn('#22c55e')}>Complete</button>}
                      {(d.status === 'open' || d.status === 'in_progress') && onEdit && <button onClick={() => onEdit(d)} style={btn('#475569')}>Edit</button>}
                      {(d.status === 'open' || d.status === 'in_progress') && onCancel && <button onClick={() => onCancel(d.id)} style={btn('#64748b')}>Cancel</button>}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, children, onClose, actions }: { title: string; children: React.ReactNode; onClose: () => void; actions: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1e293b', borderRadius: 10, padding: 22, width: 460, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>{title}</h3>
        <div>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          {actions}
        </div>
      </div>
    </div>
  );
}
