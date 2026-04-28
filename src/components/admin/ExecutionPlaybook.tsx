import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const itemStatusColor: Record<string, string> = {
  pending: '#475569', completed: '#22c55e', blocked: '#ef4444', skipped: '#f59e0b',
};
const runStatusColor: Record<string, string> = { open: '#3b82f6', completed: '#22c55e', cancelled: '#64748b' };
const modeColor: Record<string, string> = { paper: '#06b6d4', demo: '#a855f7', live: '#ef4444' };
const categoryColor: Record<string, string> = {
  signal_review: '#06b6d4', risk_review: '#a855f7', pilot_linking: '#22c55e',
  approval: '#f59e0b', execution: '#ef4444', post_trade: '#64748b',
};
const categoryLabel: Record<string, string> = {
  signal_review: 'Signal Review', risk_review: 'Risk Review', pilot_linking: 'Pilot Linking',
  approval: 'Approval', execution: 'Execution', post_trade: 'Post-Trade',
};

type Tab = 'open' | 'start' | 'completed' | 'methodology';

export default function ExecutionPlaybook() {
  const [tab, setTab] = useState<Tab>('open');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Start form state — supports URL prefill
  const [signalId, setSignalId] = useState('');
  const [mode, setMode] = useState<'paper' | 'demo' | 'live'>('paper');
  const [pilotId, setPilotId] = useState('');
  const [strategyId, setStrategyId] = useState('');
  const [startNote, setStartNote] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const sId = params.get('signalId');
      const md = params.get('mode');
      const pId = params.get('pilotId');
      const stId = params.get('strategyId');
      if (sId) setSignalId(sId);
      if (md === 'paper' || md === 'demo' || md === 'live') setMode(md);
      if (pId) setPilotId(pId);
      if (stId) setStrategyId(stId);
      if (sId || md || pId || stId) setTab('start');
    }
    reload();
  }, []);

  async function get(action: string) {
    const res = await fetch(`/api/admin/system/execution-playbook?action=${action}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/execution-playbook', {
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
    try { setData(await get('list')); } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function startNew() {
    if (!signalId.trim()) { setError('signalId is required'); return; }
    setBusy('start'); setError(null);
    try {
      const j = await post({
        action: 'start-playbook',
        signalId: signalId.trim(),
        mode,
        pilotId: pilotId.trim() || undefined,
        strategyId: strategyId.trim() || undefined,
        note: startNote.trim() || undefined,
      });
      setSelectedRunId(j.run.id);
      setTab('open');
      // Reset form
      setSignalId(''); setPilotId(''); setStrategyId(''); setStartNote('');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading playbooks…</div>;

  const enriched: any[] = data?.runs ?? [];
  const open = enriched.filter(r => r.run.status === 'open');
  const completed = enriched.filter(r => r.run.status === 'completed');
  const cancelled = enriched.filter(r => r.run.status === 'cancelled');
  const selected = selectedRunId ? enriched.find(r => r.run.id === selectedRunId) : null;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/execution-playbook" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Execution Playbook</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Manual checklist that walks the operator from signal review → risk review → pilot linking → approval → execution → post-trade.{' '}
            <strong>Checklist + workflow guidance only</strong> — no autonomous trading, no order submission, no candidate auto-creation, no approval bypass.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/admin/system/desk-queue" style={btn('#22c55e')}>Desk Queue →</a>
          <button onClick={reload} style={btn('#6366f1')} disabled={!!busy}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>Error: {error}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['open',        `Open Playbooks (${open.length})`],
          ['start',       'Start Playbook'],
          ['completed',   `Completed (${completed.length})`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'open' && (
        <OpenView
          runs={open} selectedRunId={selectedRunId} setSelectedRunId={setSelectedRunId}
          selected={selected} post={post} reload={reload} busy={busy} setError={setError}
        />
      )}
      {tab === 'start' && (
        <StartView
          signalId={signalId} setSignalId={setSignalId}
          mode={mode} setMode={setMode}
          pilotId={pilotId} setPilotId={setPilotId}
          strategyId={strategyId} setStrategyId={setStrategyId}
          startNote={startNote} setStartNote={setStartNote}
          startNew={startNew} busy={busy}
        />
      )}
      {tab === 'completed' && <CompletedView completed={completed} cancelled={cancelled} />}
      {tab === 'methodology' && <MethodologyView />}
    </div>
  );
}

// ── Open Playbooks ──────────────────────────────────────────────────────────

function OpenView({ runs, selectedRunId, setSelectedRunId, selected, post, reload, busy, setError }: any) {
  if (runs.length === 0) {
    return (
      <div style={{ ...card, color: '#94a3b8' }}>
        No open playbooks. Use <strong>Start Playbook</strong> to begin a new manual run.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Open ({runs.length})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {runs.map((r: any) => (
            <button key={r.run.id} onClick={() => setSelectedRunId(r.run.id)}
              style={{
                ...tile, textAlign: 'left', cursor: 'pointer',
                border: r.run.id === selectedRunId ? '1px solid #6366f1' : '1px solid #1e293b',
                background: r.run.id === selectedRunId ? '#312e81' : '#0f172a',
              }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={badge(modeColor[r.run.mode])}>{r.run.mode}</span>
                <span style={badge(runStatusColor[r.run.status])}>{r.run.status}</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{r.progress.completed}/{r.progress.total}</span>
                {r.blockers > 0 && <span style={badge('#ef4444')}>{r.blockers} blocked</span>}
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                {r.run.signalId}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {new Date(r.run.createdAt).toLocaleString()}
              </div>
              {r.run.pilotId && <div style={{ fontSize: 11, color: '#94a3b8' }}>pilot: {r.run.pilotId}</div>}
            </button>
          ))}
        </div>
      </div>
      <div>
        {selected ? (
          <RunDetail enriched={selected} post={post} reload={reload} busy={busy} setError={setError} />
        ) : (
          <div style={{ ...card, color: '#94a3b8' }}>Select a playbook on the left to view its checklist.</div>
        )}
      </div>
    </div>
  );
}

function RunDetail({ enriched, post, reload, busy, setError }: any) {
  const run = enriched.run;
  const [linkCandidate, setLinkCandidate] = useState('');
  const [linkOrderId, setLinkOrderId] = useState('');
  const [linkPilotId, setLinkPilotId] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  async function action(body: any, label: string) {
    setError(null);
    try { await post(body); await reload(); }
    catch (e: any) { setError(e?.message ?? `${label} failed`); }
  }

  // Group items by category
  const byCategory = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const i of run.checklist) {
      if (!m[i.category]) m[i.category] = [];
      m[i.category].push(i);
    }
    return m;
  }, [run]);

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{run.id}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={badge(runStatusColor[run.status])}>{run.status}</span>
            <span style={badge(modeColor[run.mode])}>{run.mode}</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {enriched.progress.completed}/{enriched.progress.total} ({enriched.progress.pct}%)
            </span>
          </div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <Field label="Signal" value={run.signalId} mono />
          <Field label="Strategy" value={run.strategyId ?? '—'} mono />
          <Field label="Pilot" value={run.pilotId ?? '—'} mono />
          <Field label="Candidate" value={run.candidateId ?? '—'} mono />
          <Field label="Order" value={run.orderId ?? '—'} mono />
          <Field label="Operator" value={run.operatorId} />
          <Field label="Created" value={new Date(run.createdAt).toLocaleString()} />
          <Field label="Updated" value={new Date(run.updatedAt).toLocaleString()} />
        </div>
      </div>

      {/* Linking row (only while open) */}
      {run.status === 'open' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Manual links</h3>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8' }}>
            Paste IDs from the candidate / order / pilot you created elsewhere. The playbook never creates these on your behalf.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...input, flex: 1 }} placeholder="candidateId" value={linkCandidate} onChange={e => setLinkCandidate(e.target.value)} />
              <button onClick={() => { if (linkCandidate.trim()) { action({ action: 'link-candidate', runId: run.id, candidateId: linkCandidate.trim() }, 'link candidate'); setLinkCandidate(''); } }}
                disabled={!!busy || !linkCandidate.trim()} style={btn('#6366f1')}>Link candidate</button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...input, flex: 1 }} placeholder="orderId" value={linkOrderId} onChange={e => setLinkOrderId(e.target.value)} />
              <button onClick={() => { if (linkOrderId.trim()) { action({ action: 'link-order', runId: run.id, orderId: linkOrderId.trim() }, 'link order'); setLinkOrderId(''); } }}
                disabled={!!busy || !linkOrderId.trim()} style={btn('#6366f1')}>Link order</button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...input, flex: 1 }} placeholder="pilotId" value={linkPilotId} onChange={e => setLinkPilotId(e.target.value)} />
              <button onClick={() => { if (linkPilotId.trim()) { action({ action: 'link-pilot', runId: run.id, pilotId: linkPilotId.trim() }, 'link pilot'); setLinkPilotId(''); } }}
                disabled={!!busy || !linkPilotId.trim()} style={btn('#6366f1')}>Link pilot</button>
            </div>
          </div>
        </div>
      )}

      {/* Checklist by category */}
      {(['signal_review', 'risk_review', 'pilot_linking', 'approval', 'execution', 'post_trade'] as const).map(cat => {
        const list = byCategory[cat] ?? [];
        if (list.length === 0) return null;
        return (
          <div key={cat} style={{ ...card, borderLeft: `3px solid ${categoryColor[cat]}` }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>{categoryLabel[cat]}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map((i: any) => (
                <ChecklistItem key={i.id} item={i} runId={run.id} runStatus={run.status} post={post} reload={reload} busy={busy} setError={setError} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Notes */}
      {(run.notes ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Notes ({run.notes.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
            {run.notes.map((n: string, i: number) => <li key={i} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{n}</li>)}
          </ul>
        </div>
      )}

      {/* Actions */}
      {run.status === 'open' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Run actions</h3>
          {enriched.pendingRequired > 0 && (
            <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 8 }}>
              ⚠️ {enriched.pendingRequired} required item(s) still pending — completing the playbook will fail until they're completed or skipped (with a reason).
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => action({ action: 'complete-playbook', runId: run.id }, 'complete')}
              disabled={!!busy || enriched.pendingRequired > 0} style={btn(enriched.pendingRequired > 0 ? '#475569' : '#22c55e')}>
              Complete playbook
            </button>
            {!showCancel ? (
              <button onClick={() => setShowCancel(true)} disabled={!!busy} style={btn('#ef4444')}>Cancel…</button>
            ) : (
              <>
                <input style={{ ...input, minWidth: 240 }} placeholder="Cancel reason (required)" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
                <button onClick={() => { if (cancelReason.trim()) { action({ action: 'cancel-playbook', runId: run.id, reason: cancelReason.trim() }, 'cancel'); setCancelReason(''); setShowCancel(false); } }}
                  disabled={!!busy || !cancelReason.trim()} style={btn('#ef4444')}>Confirm cancel</button>
                <button onClick={() => { setShowCancel(false); setCancelReason(''); }} style={btn('#475569')}>Back</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ChecklistItem({ item, runId, runStatus, post, reload, busy, setError }: any) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(item.notes ?? '');

  async function setStatus(status: string) {
    setError(null);
    if (item.required && status === 'skipped' && !note.trim()) {
      setShowNote(true);
      setError('Skipping a required item requires a note explaining why');
      return;
    }
    try {
      await post({ action: 'update-item', runId, itemId: item.id, status, notes: note.trim() || undefined });
      await reload();
    } catch (e: any) { setError(e?.message ?? 'update failed'); }
  }

  const canEdit = runStatus === 'open';

  return (
    <div style={{ ...tile, borderLeft: `3px solid ${itemStatusColor[item.status]}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={badge(itemStatusColor[item.status])}>{item.status}</span>
            {item.required && <span style={badge('#a855f7')}>required</span>}
            <span style={{ fontSize: 13, fontWeight: 700 }}>{item.title}</span>
          </div>
          {item.completedBy && (
            <div style={{ fontSize: 11, color: '#22c55e' }}>
              ✓ completed {item.completedAt ? new Date(item.completedAt).toLocaleString() : ''} by {item.completedBy}
            </div>
          )}
          {item.notes && (
            <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, Menlo, monospace', marginTop: 4 }}>
              note: {item.notes}
            </div>
          )}
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 4, flexDirection: 'column', minWidth: 220 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setStatus('completed')} disabled={!!busy} style={{ ...btn('#22c55e'), flex: 1 }}>Done</button>
              <button onClick={() => setStatus('blocked')} disabled={!!busy} style={{ ...btn('#ef4444'), flex: 1 }}>Block</button>
              <button onClick={() => setStatus('skipped')} disabled={!!busy} style={{ ...btn('#f59e0b'), flex: 1 }}>Skip</button>
              <button onClick={() => setStatus('pending')} disabled={!!busy} style={{ ...btn('#475569'), flex: 1 }}>Reset</button>
            </div>
            {showNote && (
              <div style={{ display: 'flex', gap: 4 }}>
                <input style={{ ...input, flex: 1 }} placeholder="Reason / note" value={note} onChange={e => setNote(e.target.value)} />
                <button onClick={() => setShowNote(false)} style={btn('#475569')}>×</button>
              </div>
            )}
            {!showNote && (
              <button onClick={() => setShowNote(true)} style={{ ...btn('#334155'), fontSize: 11 }}>+ Add note</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Start View ──────────────────────────────────────────────────────────────

function StartView({ signalId, setSignalId, mode, setMode, pilotId, setPilotId, strategyId, setStrategyId, startNote, setStartNote, startNew, busy }: any) {
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Start a new playbook</h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8' }}>
        Begin a fresh manual checklist for a signal. The default 22-item checklist covers signal review, risk review, pilot linking, approval, execution, and post-trade.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        <Labeled label="Signal ID *">
          <input style={{ ...input, width: '100%' }} placeholder="e.g. signal-2026-04-28-clt-rain" value={signalId} onChange={e => setSignalId(e.target.value)} />
        </Labeled>
        <Labeled label="Mode *">
          <select style={{ ...input, width: '100%' }} value={mode} onChange={e => setMode(e.target.value as any)}>
            <option value="paper">paper</option>
            <option value="demo">demo</option>
            <option value="live">live</option>
          </select>
        </Labeled>
        <Labeled label="Strategy ID (optional)">
          <input style={{ ...input, width: '100%' }} placeholder="strategy-id" value={strategyId} onChange={e => setStrategyId(e.target.value)} />
        </Labeled>
        <Labeled label="Pilot ID (optional)">
          <input style={{ ...input, width: '100%' }} placeholder="pilot-id" value={pilotId} onChange={e => setPilotId(e.target.value)} />
        </Labeled>
        <Labeled label="Initial note (optional)">
          <input style={{ ...input, width: '100%' }} placeholder="Why are we taking this signal?" value={startNote} onChange={e => setStartNote(e.target.value)} />
        </Labeled>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button onClick={startNew} disabled={!!busy || !signalId.trim()} style={btn(busy === 'start' ? '#475569' : '#22c55e')}>
          {busy === 'start' ? 'Starting…' : 'Generate checklist + start'}
        </button>
      </div>

      <div style={{ marginTop: 18, padding: 12, background: '#0f172a', borderRadius: 6, fontSize: 12, color: '#cbd5e1' }}>
        <strong style={{ color: '#fbbf24' }}>Reminder:</strong> the playbook is checklist guidance only. It will not place orders, create execution candidates, change pilot state, or bypass approvals. You drive every action manually in the linked admin pages.
      </div>
    </div>
  );
}

// ── Completed ───────────────────────────────────────────────────────────────

function CompletedView({ completed, cancelled }: { completed: any[]; cancelled: any[] }) {
  if (completed.length === 0 && cancelled.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No completed or cancelled playbooks yet.</div>;
  }
  return (
    <>
      {completed.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Completed ({completed.length})</h3>
          <RunsTable runs={completed} />
        </div>
      )}
      {cancelled.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Cancelled ({cancelled.length})</h3>
          <RunsTable runs={cancelled} />
        </div>
      )}
    </>
  );
}

function RunsTable({ runs }: { runs: any[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>ID</th><th style={th}>Signal</th><th style={th}>Mode</th>
            <th style={th}>Pilot</th><th style={th}>Candidate</th><th style={th}>Order</th>
            <th style={th}>Progress</th><th style={th}>Updated</th><th style={th}>By</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.run.id}>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.run.id}</td>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.run.signalId}</td>
              <td style={td}><span style={badge(modeColor[r.run.mode])}>{r.run.mode}</span></td>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.run.pilotId ?? '—'}</td>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.run.candidateId ?? '—'}</td>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.run.orderId ?? '—'}</td>
              <td style={td}>{r.progress.completed}/{r.progress.total}</td>
              <td style={td}>{new Date(r.run.updatedAt).toLocaleString()}</td>
              <td style={td}>{r.run.operatorId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Methodology ─────────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>How playbook runs work</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Each playbook is a fresh, mutable checklist generated from the default 22-item template.</li>
          <li>Items can be marked <code>completed</code>, <code>blocked</code>, <code>skipped</code>, or reset to <code>pending</code>. Required items can only be skipped with a written reason.</li>
          <li>Operators paste candidate / order / pilot IDs manually — the playbook never creates these on its own.</li>
          <li>A run can be <code>completed</code> only when every required item is <code>completed</code> or <code>skipped</code>.</li>
          <li>Cancellation requires a written reason; cancellation does not retroactively change linked candidates or orders.</li>
          <li>Audit-logged events: <code>execution_playbook_started / item_updated / candidate_linked / order_linked / pilot_linked / completed / cancelled</code>.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Default checklist categories</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Category</th><th style={th}>What the operator verifies</th></tr></thead>
          <tbody>
            <tr><td style={td}><span style={badge(categoryColor.signal_review)}>Signal Review</span></td><td style={td}>Calibrated edge, reliability, systematic eligibility, sample size, indoor/venue warning</td></tr>
            <tr><td style={td}><span style={badge(categoryColor.risk_review)}>Risk Review</span></td><td style={td}>Allocation recommendation, stress verdict, concentration, pilot limits</td></tr>
            <tr><td style={td}><span style={badge(categoryColor.pilot_linking)}>Pilot Linking</span></td><td style={td}>Pilot selection, mode match, pilot status</td></tr>
            <tr><td style={td}><span style={badge(categoryColor.approval)}>Approval</span></td><td style={td}>RBAC / dual-control, strategy status, live readiness</td></tr>
            <tr><td style={td}><span style={badge(categoryColor.execution)}>Execution</span></td><td style={td}>Manual candidate creation, dry-run review, manual order submission</td></tr>
            <tr><td style={td}><span style={badge(categoryColor.post_trade)}>Post-Trade</span></td><td style={td}>Order linking, decision journal, reconciliation refresh, review note</td></tr>
          </tbody>
        </table>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>No autonomous trading, no order submission.</li>
          <li>No automatic execution-candidate creation.</li>
          <li>No approval bypass — RBAC and live-readiness checks remain authoritative wherever they're enforced.</li>
          <li>No pilot state changes, no auto-pause, no auto-resume.</li>
          <li>Checklist + workflow guidance only.</li>
        </ul>
      </div>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: mono ? 'ui-monospace, Menlo, monospace' : undefined, wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}
