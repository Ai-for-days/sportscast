import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';
import { formatDMYTime } from '../../lib/date-format';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const itemStatusColor: Record<string, string> = { pending: '#475569', done: '#22c55e', skipped: '#f59e0b' };
const runbookStatusColor: Record<string, string> = { open: '#3b82f6', completed: '#22c55e' };

const sectionLabels: Record<string, string> = {
  market_creation_review: 'Market Creation Review',
  active_market_monitoring: 'Active Market Monitoring',
  resolution_and_liability: 'Resolution & Liability',
  operator_governance: 'Operator Governance',
  safety_confirmation: 'Safety Confirmation',
};
const sectionAccent: Record<string, string> = {
  market_creation_review: '#06b6d4',
  active_market_monitoring: '#a855f7',
  resolution_and_liability: '#22c55e',
  operator_governance: '#f59e0b',
  safety_confirmation: '#ef4444',
};

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)',
  color: '#fff', padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

export default function DailyOperatorRunbook() {
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [globalNote, setGlobalNote] = useState('');
  const [skipDrafts, setSkipDrafts] = useState<Record<string, string>>({});
  const [skipShowing, setSkipShowing] = useState<Record<string, boolean>>({});

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/daily-operator-runbook?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/daily-operator-runbook', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }

  async function reload() {
    setLoading(true); setError(null);
    try {
      const [todayRes, listRes] = await Promise.all([
        get('today'),
        get('list', { limit: '30' }),
      ]);
      setData(todayRes);
      setHistory(listRes.runbooks ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'network');
    }
    setLoading(false);
  }

  async function startToday() {
    setBusy('start'); setError(null);
    try {
      await post({ action: 'create-or-load-today' });
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function setItem(itemId: string, status: 'pending' | 'done' | 'skipped', note?: string) {
    if (!data?.runbook) return;
    setBusy(`item-${itemId}`); setError(null);
    try {
      await post({ action: 'update-item', date: data.runbook.date, itemId, status, note });
      // Clear skip draft after a successful skip
      if (status === 'skipped') {
        setSkipDrafts(prev => ({ ...prev, [itemId]: '' }));
        setSkipShowing(prev => ({ ...prev, [itemId]: false }));
      }
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'update failed');
      // If skip was rejected for missing note, surface the input
      if (status === 'skipped') setSkipShowing(prev => ({ ...prev, [itemId]: true }));
    }
    setBusy(null);
  }

  async function addRunbookNote() {
    if (!data?.runbook) return;
    if (!globalNote.trim()) return;
    setBusy('note'); setError(null);
    try {
      await post({ action: 'add-note', date: data.runbook.date, note: globalNote.trim() });
      setGlobalNote('');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function complete() {
    if (!data?.runbook) return;
    const ok = window.confirm(
      `Complete the daily runbook for ${data.runbook.date}?\n\nThis records that you worked through every checklist item. It does not modify wagers, balances, or RBAC.`,
    );
    if (!ok) return;
    setBusy('complete'); setError(null);
    try {
      await post({ action: 'complete-runbook', date: data.runbook.date });
      await reload();
    } catch (e: any) { setError(e?.message ?? 'complete failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading daily runbook…</div>;

  const today = data?.date ?? new Date().toISOString().slice(0, 10);
  const runbook = data?.runbook;
  const progress = data?.progress;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/daily-operator-runbook" /></div>

      <div style={BANNER}>
        <span>📋 The runbook records human checks only. It does <strong>not</strong> create wagers, settle balances, or change permissions.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Audit-logged · Recordkeeping</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Daily Operator Runbook</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Walk this checklist once per day. Each item links to the relevant tool. Skipping any item requires a written note. Completion is recordkeeping — it never mutates a wager, balance, or RBAC entry.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/command-center" style={btn('#0ea5e9')}>Command Center →</a>
          <button type="button" onClick={reload} disabled={!!busy} style={btn('#6366f1')}
            title="Refresh today's runbook + recent history">Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      {/* No runbook yet for today */}
      {!runbook && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>No runbook for today ({today}) yet</h3>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#cbd5e1' }}>
            Click <strong>Start today's runbook</strong> to generate the default checklist. Once started, the runbook
            persists for the day and audit-logs every status change.
          </p>
          <button type="button" onClick={startToday} disabled={!!busy} style={btn(busy === 'start' ? '#475569' : '#22c55e')}
            title="Creates today's runbook with the default checklist. Idempotent — clicking again returns the same runbook.">
            {busy === 'start' ? 'Starting…' : "Start today's runbook"}
          </button>
        </div>
      )}

      {/* Runbook present */}
      {runbook && (
        <>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
                  Runbook for {runbook.date}{' '}
                  <span style={badge(runbookStatusColor[runbook.status])}>{runbook.status}</span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  Created {formatDMYTime(runbook.createdAt)} by {runbook.createdBy}
                  {runbook.completedAt && (
                    <> · completed {formatDMYTime(runbook.completedAt)} by {runbook.completedBy}</>
                  )}
                </div>
              </div>
              <div style={{ minWidth: 220 }}>
                <ProgressBar progress={progress} />
              </div>
            </div>
          </div>

          {/* Sectioned checklist */}
          {(['market_creation_review', 'active_market_monitoring', 'resolution_and_liability', 'operator_governance', 'safety_confirmation'] as const).map(section => {
            const items = runbook.checklistItems.filter((i: any) => i.section === section);
            if (items.length === 0) return null;
            const doneCount = items.filter((i: any) => i.status === 'done').length;
            const skippedCount = items.filter((i: any) => i.status === 'skipped').length;
            return (
              <div key={section} style={{ ...card, borderLeft: `3px solid ${sectionAccent[section]}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{sectionLabels[section]}</h3>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>
                    {doneCount} done · {skippedCount} skipped · {items.length - doneCount - skippedCount} pending
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {items.map((item: any) => (
                    <ChecklistRow
                      key={item.id}
                      item={item}
                      runbookStatus={runbook.status}
                      busy={busy}
                      setItem={setItem}
                      skipDraft={skipDrafts[item.id] ?? ''}
                      onSkipDraftChange={(v: string) => setSkipDrafts(prev => ({ ...prev, [item.id]: v }))}
                      skipShowing={!!skipShowing[item.id]}
                      onSkipShowing={(v: boolean) => setSkipShowing(prev => ({ ...prev, [item.id]: v }))}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Notes */}
          <div style={card}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Notes ({(runbook.notes ?? []).length})</h3>
            {(runbook.notes ?? []).length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>No notes yet.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
                {runbook.notes.map((n: string, i: number) => <li key={i} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{n}</li>)}
              </ul>
            )}
            {runbook.status === 'open' && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Add a note (e.g. unusual observation, follow-up)" value={globalNote} onChange={e => setGlobalNote(e.target.value)} />
                <button type="button" onClick={addRunbookNote} disabled={!!busy || !globalNote.trim()} style={btn('#6366f1')}
                  title="Append a timestamped note. Audit-logged.">Add note</button>
              </div>
            )}
          </div>

          {/* Complete */}
          {runbook.status === 'open' && (
            <div style={card}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Complete runbook</h3>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8' }}>
                Available once every item is marked <code>done</code> or <code>skipped</code>. Completion stamps this runbook as
                done and audit-logs <code>daily_runbook_completed</code>. It does not modify any wager, balance, or RBAC entry.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={complete} disabled={!!busy || !progress?.canComplete}
                  style={btn(progress?.canComplete ? '#22c55e' : '#475569')}
                  title="Marks the runbook complete. Recordkeeping only.">
                  {busy === 'complete' ? 'Completing…' : 'Complete Runbook'}
                </button>
                {!progress?.canComplete && (
                  <span style={{ fontSize: 12, color: '#fbbf24' }}>
                    {progress?.pending ?? 0} item(s) still pending. Mark each as done or skipped first.
                  </span>
                )}
              </div>
            </div>
          )}

          {runbook.status === 'completed' && (
            <div style={{ ...card, borderLeft: '3px solid #22c55e', color: '#22c55e', fontSize: 13 }}>
              ✓ Runbook completed {formatDMYTime(runbook.completedAt)} by {runbook.completedBy}.
            </div>
          )}
        </>
      )}

      {/* History */}
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recent runbooks ({history.length})</h3>
        {history.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No prior runbooks.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Done</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Skipped</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Pending</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Created by</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Completed by</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.runbook.id}>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13, fontWeight: 600 }}>{h.runbook.date}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b' }}>
                      <span style={badge(runbookStatusColor[h.runbook.status])}>{h.runbook.status}</span>
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13, color: '#22c55e' }}>{h.progress.done}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13, color: '#f59e0b' }}>{h.progress.skipped}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13, color: '#94a3b8' }}>{h.progress.pending}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 }}>{h.runbook.createdBy}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13, color: '#94a3b8' }}>{h.runbook.completedBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ progress }: { progress: any }) {
  if (!progress) return null;
  const pct = progress.percentComplete;
  return (
    <div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>Progress</span>
        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: pct === 100 ? '#22c55e' : '#cbd5e1' }}>
          {pct}% · {progress.done} done / {progress.skipped} skip / {progress.pending} pending
        </span>
      </div>
      <div style={{ background: '#0f172a', borderRadius: 4, overflow: 'hidden', height: 10 }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: pct === 100 ? '#22c55e' : 'linear-gradient(90deg, #6366f1, #06b6d4)',
          transition: 'width 0.3s',
        }} />
      </div>
    </div>
  );
}

// ── Checklist row ────────────────────────────────────────────────────────────

interface RowProps {
  item: any;
  runbookStatus: 'open' | 'completed';
  busy: string | null;
  setItem: (id: string, status: 'pending' | 'done' | 'skipped', note?: string) => void;
  skipDraft: string;
  onSkipDraftChange: (v: string) => void;
  skipShowing: boolean;
  onSkipShowing: (v: boolean) => void;
}

function ChecklistRow({ item, runbookStatus, busy, setItem, skipDraft, onSkipDraftChange, skipShowing, onSkipShowing }: RowProps) {
  const editable = runbookStatus === 'open';
  const itemBusy = busy === `item-${item.id}`;

  return (
    <div style={{ ...tile, borderLeft: `3px solid ${itemStatusColor[item.status]}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={badge(itemStatusColor[item.status])}>{item.status}</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</span>
          </div>
          {item.helper && <div style={{ fontSize: 12, color: '#cbd5e1' }}>{item.helper}</div>}
          {item.link && (
            <div style={{ marginTop: 4 }}>
              <a href={item.link} style={{ fontSize: 11, color: '#0ea5e9', textDecoration: 'none' }} title={`Open ${item.link}`}>{item.link} →</a>
            </div>
          )}
          {item.updatedBy && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              Last updated {item.updatedAt ? formatDMYTime(item.updatedAt) : ''} by {item.updatedBy}
            </div>
          )}
          {item.note && (
            <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 4, fontStyle: 'italic' }}>
              note: {item.note}
            </div>
          )}
        </div>
        {editable && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" onClick={() => setItem(item.id, 'done')} disabled={!!busy} style={{ ...btn('#22c55e'), flex: 1 }}>Done</button>
              <button type="button" onClick={() => onSkipShowing(true)} disabled={!!busy} style={{ ...btn('#f59e0b'), flex: 1 }}>Skip…</button>
              <button type="button" onClick={() => setItem(item.id, 'pending')} disabled={!!busy} style={{ ...btn('#475569'), flex: 1 }}>Reset</button>
            </div>
            {skipShowing && (
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  style={{ ...input, flex: 1 }}
                  placeholder="Skip reason (required)"
                  value={skipDraft}
                  onChange={e => onSkipDraftChange(e.target.value)}
                />
                <button type="button" disabled={!!busy || !skipDraft.trim()}
                  onClick={() => setItem(item.id, 'skipped', skipDraft)}
                  style={btn(skipDraft.trim() ? '#f59e0b' : '#475569')}
                  title="Persists the skip with the written reason. Audit-logged.">
                  {itemBusy ? '…' : 'Confirm skip'}
                </button>
                <button type="button" onClick={() => { onSkipShowing(false); onSkipDraftChange(''); }} style={btn('#475569')}>×</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
