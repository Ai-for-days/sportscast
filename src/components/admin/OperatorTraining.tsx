import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';
import { BarChart, EmptyChart } from './charts';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const statusColor: Record<string, string> = { open: '#3b82f6', completed: '#22c55e', cancelled: '#64748b' };
const typeColor: Record<string, string> = {
  signal_review: '#06b6d4', risk_review: '#a855f7', pilot_review: '#22c55e',
  execution_playbook: '#f59e0b', incident_response: '#ef4444',
};
const typeLabel: Record<string, string> = {
  signal_review: 'Signal Review', risk_review: 'Risk Review', pilot_review: 'Pilot Review',
  execution_playbook: 'Execution Playbook', incident_response: 'Incident Response',
};

const SANDBOX_BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #312e81, #4338ca)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'scenarios' | 'active' | 'completed' | 'feedback' | 'methodology';

export default function OperatorTraining() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('scenarios');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeScenario, setActiveScenario] = useState<any>(null);

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/operator-training?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/operator-training', {
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
    try { setData(await get('list-sessions')); } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function startScenario(scenarioId: string) {
    setBusy(`start-${scenarioId}`); setError(null);
    try {
      const j = await post({ action: 'start-session', scenarioId });
      setActiveSessionId(j.session.id);
      setActiveScenario(j.scenario);
      setTab('active');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading training simulator…</div>;
  if (!data) return null;

  const sessions: any[] = data.sessions ?? [];
  const scenarios: any[] = data.scenarios ?? [];
  const summary = data.summary;
  const open = sessions.filter(s => s.status === 'open');
  const completed = sessions.filter(s => s.status === 'completed');
  const cancelled = sessions.filter(s => s.status === 'cancelled');
  const activeSession = activeSessionId ? sessions.find(s => s.id === activeSessionId) ?? open[0] ?? null : open[0] ?? null;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/operator-training" /></div>

      <div style={SANDBOX_BANNER}>
        <span>🛡️ TRAINING SANDBOX — every record below is mock data. Nothing here trades, submits orders, or touches production state. Sessions live under <code>training:*</code>.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Read-only for production · Audit-logged</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Operator Training</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Practice the full workflow with mock data and an instructional rubric.{' '}
            <strong>No real trading, no real orders, no real candidates, no production mutation.</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/execution-playbook" style={btn('#22c55e')}>Real Playbook →</a>
          <button onClick={reload} style={btn('#6366f1')} disabled={!!busy}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>Error: {error}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['scenarios',   `Scenarios (${scenarios.length})`],
          ['active',      `Active Training (${open.length})`],
          ['completed',   `Completed (${completed.length})`],
          ['feedback',    `Score / Feedback${summary?.averageScore != null ? ` · avg ${summary.averageScore}` : ''}`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'scenarios' && <ScenariosView scenarios={scenarios} startScenario={startScenario} busy={busy} />}
      {tab === 'active' && (
        <ActiveView
          open={open} activeSession={activeSession} setActiveSessionId={setActiveSessionId}
          activeScenario={activeScenario} setActiveScenario={setActiveScenario}
          scenarios={scenarios} get={get} post={post} reload={reload} busy={busy} setBusy={setBusy} setError={setError}
        />
      )}
      {tab === 'completed' && <CompletedView completed={completed} cancelled={cancelled} scenarios={scenarios} />}
      {tab === 'feedback' && <FeedbackView completed={completed} summary={summary} scenarios={scenarios} />}
      {tab === 'methodology' && <MethodologyView />}
    </div>
  );
}

// ── Scenarios View ──────────────────────────────────────────────────────────

function ScenariosView({ scenarios, startScenario, busy }: any) {
  return (
    <>
      <div style={{ ...card, color: '#cbd5e1', fontSize: 13 }}>
        Pick a scenario below to start a sandboxed training run. Each scenario has fake data, an objective, a list of expected
        actions, and distractor actions used to score you. Your real candidates, orders, pilots, and playbooks are not touched.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        {scenarios.map((s: any) => (
          <div key={s.id} style={{ ...card, marginBottom: 0, borderLeft: `3px solid ${typeColor[s.scenarioType]}` }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={badge(typeColor[s.scenarioType])}>{typeLabel[s.scenarioType]}</span>
              <span style={{ fontSize: 14, fontWeight: 800 }}>{s.title}</span>
            </div>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#cbd5e1' }}>{s.objective}</p>
            <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8' }}>{s.briefing}</p>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
              {s.expectedActions.length} expected actions ({s.expectedActions.filter((a: any) => a.required).length} required) · {s.distractors.length} distractors
            </div>
            <button onClick={() => startScenario(s.id)} disabled={!!busy} style={btn(busy === `start-${s.id}` ? '#475569' : '#22c55e')}>
              {busy === `start-${s.id}` ? 'Starting…' : 'Start training run'}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Active Training ─────────────────────────────────────────────────────────

function ActiveView({ open, activeSession, setActiveSessionId, activeScenario, setActiveScenario, scenarios, get, post, reload, busy, setBusy, setError }: any) {
  // If we have an active session but no scenario object yet, fetch it
  useEffect(() => {
    let cancelled = false;
    async function fetchScenario() {
      if (activeSession && (!activeScenario || activeScenario.id !== activeSession.scenarioId)) {
        try {
          const local = scenarios.find((s: any) => s.id === activeSession.scenarioId);
          if (local) {
            if (!cancelled) setActiveScenario(local);
            return;
          }
          const j = await get('get-scenario', { id: activeSession.scenarioId });
          if (!cancelled) setActiveScenario(j.scenario);
        } catch { /* ignore */ }
      }
    }
    fetchScenario();
    return () => { cancelled = true; };
  }, [activeSession?.id, activeScenario?.id, scenarios]);

  if (open.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No active training sessions. Pick a scenario from the Scenarios tab to start one.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Open ({open.length})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {open.map((s: any) => (
            <button key={s.id} onClick={() => setActiveSessionId(s.id)}
              style={{
                ...tile, textAlign: 'left', cursor: 'pointer',
                border: s.id === activeSession?.id ? '1px solid #6366f1' : '1px solid #1e293b',
                background: s.id === activeSession?.id ? '#312e81' : '#0f172a',
              }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={badge(typeColor[s.scenarioType])}>{typeLabel[s.scenarioType]}</span>
                <span style={badge(statusColor[s.status])}>{s.status}</span>
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1' }}>{s.scenarioId}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{new Date(s.createdAt).toLocaleString()}</div>
              {s.score && <div style={{ fontSize: 11, color: '#22c55e' }}>Live score: {s.score.score}</div>}
            </button>
          ))}
        </div>
      </div>
      <div>
        {activeSession && activeScenario ? (
          <ActiveSession session={activeSession} scenario={activeScenario} post={post} reload={reload} busy={busy} setBusy={setBusy} setError={setError} />
        ) : (
          <div style={{ ...card, color: '#94a3b8' }}>Select a session on the left.</div>
        )}
      </div>
    </div>
  );
}

function ActiveSession({ session, scenario, post, reload, busy, setBusy, setError }: any) {
  const [note, setNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  async function record(actionId: string | null, optNote?: string) {
    setBusy('record'); setError(null);
    try { await post({ action: 'record-action', sessionId: session.id, actionId, note: optNote }); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function complete() {
    setBusy('complete'); setError(null);
    try { await post({ action: 'complete-session', sessionId: session.id }); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function cancel() {
    if (!cancelReason.trim()) return;
    setBusy('cancel'); setError(null);
    try {
      await post({ action: 'cancel-session', sessionId: session.id, reason: cancelReason.trim() });
      setShowCancel(false); setCancelReason('');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  const recordedIds = new Set<string>();
  for (const a of session.actions ?? []) if (a.actionId) recordedIds.add(a.actionId);

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{scenario.title}</h2>
          <span style={badge(typeColor[scenario.scenarioType])}>{typeLabel[scenario.scenarioType]}</span>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#cbd5e1' }}>{scenario.briefing}</p>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#94a3b8' }}><strong>Objective:</strong> {scenario.objective}</p>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Mock data</h3>
        <pre style={{ margin: 0, padding: 10, background: '#0f172a', borderRadius: 6, fontSize: 11, color: '#cbd5e1', overflow: 'auto' }}>{JSON.stringify(scenario.mockData, null, 2)}</pre>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Actions you can take</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8' }}>
          Click an action to record it. Completed actions stay marked. The live score updates as you go.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {scenario.expectedActions.map((a: any) => (
            <ActionButton key={a.id} label={a.label} required={a.required} weight={a.scoreWeight}
              recorded={recordedIds.has(a.id)} kind="good" onClick={() => record(a.id)} disabled={!!busy || session.status !== 'open'} />
          ))}
          {scenario.distractors.map((d: any) => (
            <ActionButton key={d.id} label={d.label} weight={d.penaltyWeight}
              recorded={recordedIds.has(d.id)} kind="wrong" onClick={() => record(d.id)} disabled={!!busy || session.status !== 'open'} />
          ))}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Free-form note</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...input, flex: 1 }} placeholder="What are you observing? Why this action?" value={note} onChange={e => setNote(e.target.value)} />
          <button onClick={() => { if (note.trim()) { record(null, note.trim()); setNote(''); } }}
            disabled={!!busy || !note.trim() || session.status !== 'open'} style={btn('#6366f1')}>Add note</button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Recorded actions ({(session.actions ?? []).length})</h3>
        {(session.actions ?? []).length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No actions recorded yet.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
            {session.actions.map((a: any) => (
              <li key={a.id} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                <span style={{ color: a.kind === 'good' ? '#22c55e' : a.kind === 'wrong' ? '#ef4444' : '#94a3b8' }}>
                  [{a.kind}]
                </span>{' '}
                {a.actionId ?? 'note'}
                {a.note && <span style={{ color: '#94a3b8' }}> — {a.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {session.score && (
        <div style={{ ...card, borderLeft: `3px solid ${session.score.score >= 70 ? '#22c55e' : session.score.score >= 40 ? '#f59e0b' : '#ef4444'}` }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Live score</h3>
          <div style={{ fontSize: 32, fontWeight: 800, color: session.score.score >= 70 ? '#22c55e' : '#f59e0b' }}>{session.score.score}</div>
          <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6 }}>
            +{session.score.goodActionPoints} good · {session.score.missedRequiredPenalty} missed-required · {session.score.wrongActionPenalty} wrong
          </div>
        </div>
      )}

      {session.status === 'open' && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={complete} disabled={!!busy} style={btn('#22c55e')}>Complete session</button>
            {!showCancel ? (
              <button onClick={() => setShowCancel(true)} disabled={!!busy} style={btn('#ef4444')}>Cancel…</button>
            ) : (
              <>
                <input style={{ ...input, minWidth: 240 }} placeholder="Cancel reason" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
                <button onClick={cancel} disabled={!!busy || !cancelReason.trim()} style={btn('#ef4444')}>Confirm cancel</button>
                <button onClick={() => { setShowCancel(false); setCancelReason(''); }} style={btn('#475569')}>Back</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ActionButton({ label, required, weight, recorded, kind, onClick, disabled }: { label: string; required?: boolean; weight: number; recorded: boolean; kind: 'good' | 'wrong'; onClick: () => void; disabled?: boolean }) {
  const color = recorded ? (kind === 'good' ? '#22c55e' : '#ef4444') : '#475569';
  return (
    <button onClick={onClick} disabled={disabled || recorded} style={{
      ...tile, textAlign: 'left', cursor: disabled || recorded ? 'default' : 'pointer',
      borderLeft: `3px solid ${color}`,
      opacity: recorded ? 0.85 : 1,
      display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {recorded && <span style={{ color }}>{kind === 'good' ? '✓ ' : '✗ '}</span>}
          {label}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          {kind === 'good' ? `+${weight}` : `-${weight}`}
          {required && kind === 'good' && <span style={{ color: '#a855f7', marginLeft: 8 }}>required</span>}
        </div>
      </div>
    </button>
  );
}

// ── Completed View ──────────────────────────────────────────────────────────

function CompletedView({ completed, cancelled, scenarios }: any) {
  const scenarioById = useMemo(() => new Map(scenarios.map((s: any) => [s.id, s])), [scenarios]);
  if (completed.length === 0 && cancelled.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No completed or cancelled sessions yet.</div>;
  }
  return (
    <>
      {completed.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Completed ({completed.length})</h3>
          <SessionsTable sessions={completed} scenarioById={scenarioById} />
        </div>
      )}
      {cancelled.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Cancelled ({cancelled.length})</h3>
          <SessionsTable sessions={cancelled} scenarioById={scenarioById} />
        </div>
      )}
    </>
  );
}

function SessionsTable({ sessions, scenarioById }: { sessions: any[]; scenarioById: Map<string, any> }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Session</th><th style={th}>Scenario</th><th style={th}>Type</th>
            <th style={th}>Operator</th><th style={th}>Score</th><th style={th}>Duration</th><th style={th}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s: any) => {
            const scenario = scenarioById.get(s.scenarioId) as any;
            const score = s.score?.score ?? null;
            return (
              <tr key={s.id}>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{s.id}</td>
                <td style={td}>{scenario?.title ?? s.scenarioId}</td>
                <td style={td}><span style={badge(typeColor[s.scenarioType])}>{typeLabel[s.scenarioType]}</span></td>
                <td style={td}>{s.operatorId}</td>
                <td style={{ ...td, fontWeight: 700, color: score == null ? '#94a3b8' : score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444' }}>{score ?? '—'}</td>
                <td style={td}>{s.score?.durationMs == null ? '—' : `${(s.score.durationMs / 60_000).toFixed(1)}m`}</td>
                <td style={td}>{new Date(s.updatedAt).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Feedback / Score View ───────────────────────────────────────────────────

function FeedbackView({ completed, summary, scenarios }: any) {
  const scenarioById = useMemo(() => new Map(scenarios.map((s: any) => [s.id, s])), [scenarios]);
  if (completed.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>Complete a training session to see scoring feedback.</div>;
  }

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Aggregate</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <Stat label="Total completed" value={summary.byStatus.completed} />
          <Stat label="Avg score" value={summary.averageScore ?? '—'} color={summary.averageScore == null ? undefined : summary.averageScore >= 70 ? '#22c55e' : '#f59e0b'} />
          <Stat label="Pass rate (≥70)" value={summary.passingPct == null ? '—' : `${summary.passingPct}%`} />
          <Stat label="Avg duration" value={summary.averageDurationMs == null ? '—' : `${(summary.averageDurationMs / 60_000).toFixed(1)}m`} />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Sessions by scenario type</h3>
        {Object.values(summary.byScenarioType ?? {}).every((v: any) => v === 0) ? (
          <EmptyChart title="No sessions" message="No sessions yet." />
        ) : (
          <BarChart
            data={(['signal_review', 'risk_review', 'pilot_review', 'execution_playbook', 'incident_response'] as const).map(t => ({
              label: typeLabel[t], value: summary.byScenarioType[t] ?? 0, color: typeColor[t],
            }))}
            valueFormatter={v => `${v}`}
            height={180}
          />
        )}
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Per-session feedback</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {completed.map((s: any) => {
            const scenario = scenarioById.get(s.scenarioId) as any;
            const sc = s.score ?? null;
            return (
              <div key={s.id} style={{ ...tile, borderLeft: `3px solid ${sc && sc.score >= 70 ? '#22c55e' : sc && sc.score >= 40 ? '#f59e0b' : '#ef4444'}` }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={badge(typeColor[s.scenarioType])}>{typeLabel[s.scenarioType]}</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{scenario?.title ?? s.scenarioId}</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>by {s.operatorId} · {new Date(s.updatedAt).toLocaleString()}</span>
                  {sc && <span style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 800, color: sc.score >= 70 ? '#22c55e' : sc.score >= 40 ? '#f59e0b' : '#ef4444' }}>{sc.score}</span>}
                </div>
                {sc && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
                    {(sc.feedback ?? []).map((f: string, i: number) => <li key={i}>{f}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Methodology ─────────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>How training works</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Pick a scenario from the catalog. Each scenario has a stable id, fake mock data, expected actions, and distractors.</li>
          <li>Click expected actions to earn points; clicking distractors costs points. Free-form notes are recorded as <code>note</code> kind and don't affect the score.</li>
          <li>The score is recomputed on every read: most-recent action per id wins, missed required items cost -10 each, distractors apply their declared penalty.</li>
          <li>Final clamp is [0, 100]. Pass threshold is 70 for the aggregate pass-rate metric.</li>
          <li>Completion stamps <code>completedAt</code>, time-to-complete, and a feedback narrative onto the session.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Where training data lives</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Sessions: <code>training:session:&#123;id&#125;</code></li>
          <li>Index: <code>training:sessions:all</code></li>
          <li>Scenarios are static (in-code) and not persisted.</li>
          <li>Audit events are still written (for the operator's own behavior log) but never to production candidate / order / pilot / strategy / playbook / settlement / ledger keys.</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>No autonomous trading, no real order submission.</li>
          <li>No real execution-candidate creation.</li>
          <li>No live or demo execution behavior changes.</li>
          <li>Training writes are confined to the <code>training:*</code> keyspace.</li>
          <li>The mock data shown in scenarios is hard-coded; nothing is sourced from production records.</li>
        </ul>
      </div>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#e2e8f0', fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</div>
    </div>
  );
}
