import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const statusColor: Record<string, string> = { open: '#3b82f6', locked: '#f59e0b', graded: '#22c55e', void: '#64748b' };
const kindColor: Record<string, string> = { odds: '#06b6d4', 'over-under': '#a855f7', pointspread: '#22c55e' };
const confColor: Record<string, string> = { high: '#22c55e', medium: '#f59e0b', low: '#ef4444' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)',
  color: '#fff',
  padding: '10px 14px',
  borderRadius: 8,
  marginBottom: 16,
  fontSize: 13,
  fontWeight: 600,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

type Tab = 'resolvable' | 'preview' | 'ledger' | 'void' | 'methodology';

export default function WagerResolutionCenter() {
  const [tab, setTab] = useState<Tab>('resolvable');
  const [resolvable, setResolvable] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Preview workflow state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWager, setSelectedWager] = useState<any>(null);
  const [observedValue, setObservedValue] = useState<string>('');
  const [observedValueA, setObservedValueA] = useState<string>('');
  const [observedValueB, setObservedValueB] = useState<string>('');
  const [preview, setPreview] = useState<any>(null);
  const [gradeNote, setGradeNote] = useState('');
  const [voidReason, setVoidReason] = useState('');

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/wager-resolution?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/wager-resolution', {
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
      const [r, l] = await Promise.all([get('list-resolvable'), get('recent-activity')]);
      setResolvable(r.wagers ?? []);
      setLedger(l.events ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'network');
    }
    setLoading(false);
  }

  async function selectWager(id: string) {
    setBusy(`select-${id}`); setError(null);
    try {
      const j = await get('get-wager', { id });
      setSelectedId(id);
      setSelectedWager(j.wager);
      setPreview(null);
      // Reset observed inputs for the new wager
      setObservedValue(''); setObservedValueA(''); setObservedValueB('');
      setGradeNote(''); setVoidReason('');
      setTab('preview');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  function buildObservedInput(): any | null {
    if (!selectedWager) return null;
    if (selectedWager.kind === 'pointspread') {
      const a = Number(observedValueA);
      const b = Number(observedValueB);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      return { observedValueA: a, observedValueB: b };
    }
    const v = Number(observedValue);
    if (!Number.isFinite(v)) return null;
    return { observedValue: v };
  }

  async function generatePreview() {
    if (!selectedId) return;
    const obs = buildObservedInput();
    setBusy('preview'); setError(null);
    try {
      const j = await post({ action: 'preview', wagerId: selectedId, observedInput: obs });
      setPreview(j.preview);
    } catch (e: any) { setError(e?.message ?? 'preview failed'); }
    setBusy(null);
  }

  async function commitGrade() {
    if (!selectedId) return;
    const obs = buildObservedInput();
    if (!obs) { setError('Observed values are required to grade.'); return; }
    if (!preview || preview.wouldChangeStatusTo !== 'graded') { setError('Generate a successful preview before grading.'); return; }
    const ok = window.confirm(
      `Confirm grading wager ${selectedWager?.ticketNumber ?? selectedId} as winner "${preview.computedWinner}"?\n\n`
      + `This persists the grade and is not reversible. It does not move money or settle balances.`,
    );
    if (!ok) return;

    setBusy('grade'); setError(null);
    try {
      const j = await post({ action: 'grade', wagerId: selectedId, observedInput: obs, note: gradeNote || undefined });
      setSelectedWager(j.wager);
      setPreview(null);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'grade failed'); }
    setBusy(null);
  }

  async function commitVoid() {
    if (!selectedId) return;
    if (!voidReason.trim()) { setError('Void reason is required.'); return; }
    const ok = window.confirm(
      `Confirm voiding wager ${selectedWager?.ticketNumber ?? selectedId}?\n\n`
      + `Reason: ${voidReason.trim()}\n\n`
      + `This sets status to void and is not reversible. It does not move money or settle balances.`,
    );
    if (!ok) return;

    setBusy('void'); setError(null);
    try {
      const j = await post({ action: 'void', wagerId: selectedId, reason: voidReason.trim() });
      setSelectedWager(j.wager);
      setPreview(null);
      setVoidReason('');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'void failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading wager resolution…</div>;

  const stats = useMemo(() => {
    const byStatus: Record<string, number> = { open: 0, locked: 0, pastLock: 0 };
    for (const w of resolvable) {
      if (w.status === 'locked') byStatus.locked++;
      else if (w.status === 'open') {
        if (w.pastLockTime) byStatus.pastLock++;
        else byStatus.open++;
      }
    }
    return { total: resolvable.length, ...byStatus };
  }, [resolvable]);

  const gradedCount = ledger.filter(e => e.eventType === 'wager_manually_graded').length;
  const voidedCount = ledger.filter(e => e.eventType === 'wager_manually_voided').length;
  const previewCount = ledger.filter(e => e.eventType === 'wager_resolution_preview_generated').length;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/wager-resolution" /></div>

      <div style={BANNER}>
        <span>🛡️ Resolution is <strong>manual</strong>. This page grades wager outcomes only and does not settle balances, move money, or pay users.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Audit-logged · Preview-then-grade</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Wager Resolution Center</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Manually grade wagers using observed weather data. Generate a preview first; the Grade button stays disabled until the preview proves a winner can be determined.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/wagers" style={btn('#0ea5e9')}>All Wagers →</a>
          <button type="button" onClick={reload} disabled={!!busy} style={btn('#6366f1')} title="Refresh resolvable wagers and grading ledger">Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Resolvable" value={stats.total} />
          <Stat label="Locked"     value={stats.locked}    color={statusColor.locked} />
          <Stat label="Open · past lock" value={stats.pastLock} color="#ef4444" />
          <Stat label="Open · pre-lock"  value={stats.open} color={statusColor.open} />
          <Stat label="Graded (recent)"  value={gradedCount}   color={statusColor.graded} />
          <Stat label="Voided (recent)"  value={voidedCount}   color={statusColor.void} />
          <Stat label="Previews (recent)" value={previewCount} color="#a855f7" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['resolvable',  `Resolvable Wagers (${stats.total})`],
          ['preview',     selectedWager ? `Preview · ${selectedWager.ticketNumber}` : 'Resolution Preview'],
          ['ledger',      `Grading Ledger (${gradedCount})`],
          ['void',        `Void / Exceptions (${voidedCount})`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'resolvable' && (
        <ResolvableView wagers={resolvable} selectWager={selectWager} busy={busy} />
      )}
      {tab === 'preview' && (
        <PreviewView
          selectedWager={selectedWager}
          observedValue={observedValue} setObservedValue={setObservedValue}
          observedValueA={observedValueA} setObservedValueA={setObservedValueA}
          observedValueB={observedValueB} setObservedValueB={setObservedValueB}
          preview={preview}
          generatePreview={generatePreview}
          gradeNote={gradeNote} setGradeNote={setGradeNote}
          commitGrade={commitGrade}
          voidReason={voidReason} setVoidReason={setVoidReason}
          commitVoid={commitVoid}
          busy={busy}
        />
      )}
      {tab === 'ledger' && (
        <LedgerView events={ledger.filter(e => e.eventType === 'wager_manually_graded')} title="Manually Graded" emptyMsg="No grades recorded yet." />
      )}
      {tab === 'void' && (
        <LedgerView events={ledger.filter(e => e.eventType === 'wager_manually_voided')} title="Voided" emptyMsg="No voids recorded yet." />
      )}
      {tab === 'methodology' && <MethodologyView />}
    </div>
  );
}

// ── Resolvable wagers list ───────────────────────────────────────────────────

function ResolvableView({ wagers, selectWager, busy }: any) {
  if (!wagers || wagers.length === 0) {
    return (
      <div style={{ ...card, color: '#94a3b8' }}>
        No wagers available for resolution. Wagers appear here once they're <code>locked</code>, or once an open wager has passed its lock time.
      </div>
    );
  }
  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Ticket</th><th style={th}>Title</th><th style={th}>Kind</th>
              <th style={th}>Metric</th><th style={th}>Target Date</th><th style={th}>Lock Time</th>
              <th style={th}>Status</th><th style={th}>Location</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {wagers.map((w: any) => (
              <tr key={w.id} style={{ borderLeft: w.pastLockTime ? '3px solid #ef4444' : undefined }}>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{w.ticketNumber}</td>
                <td style={td}>{w.title}</td>
                <td style={td}><span style={badge(kindColor[w.kind] ?? '#64748b')}>{w.kind}</span></td>
                <td style={td}>{w.metric}</td>
                <td style={td}>{w.targetDate}{w.targetTime ? ` ${w.targetTime}` : ''}</td>
                <td style={{ ...td, fontSize: 11, color: w.pastLockTime ? '#ef4444' : '#94a3b8' }}>{new Date(w.lockTime).toLocaleString()}</td>
                <td style={td}>
                  <span style={badge(statusColor[w.status] ?? '#64748b')}>{w.status}</span>
                  {w.pastLockTime && <span style={{ ...badge('#ef4444'), marginLeft: 4 }}>past lock</span>}
                </td>
                <td style={td}>{w.locationSummary}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => selectWager(w.id)} disabled={!!busy}
                    style={{ ...btn('#22c55e'), padding: '4px 10px' }}
                    title="Open this wager in the Resolution Preview tab. No data is changed."
                  >Resolve →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Preview / grade / void workflow ──────────────────────────────────────────

function PreviewView({
  selectedWager, observedValue, setObservedValue, observedValueA, setObservedValueA, observedValueB, setObservedValueB,
  preview, generatePreview, gradeNote, setGradeNote, commitGrade, voidReason, setVoidReason, commitVoid, busy,
}: any) {
  if (!selectedWager) {
    return (
      <div style={{ ...card, color: '#94a3b8' }}>
        Pick a wager from the <strong>Resolvable Wagers</strong> tab. The preview computes a winner from observed values; nothing persists until you click <strong>Grade</strong> or <strong>Void</strong>.
      </div>
    );
  }

  const w = selectedWager;
  const isPointspread = w.kind === 'pointspread';
  const isTerminal = w.status === 'graded' || w.status === 'void';

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{w.title}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={badge(kindColor[w.kind] ?? '#64748b')}>{w.kind}</span>
            <span style={badge(statusColor[w.status] ?? '#64748b')}>{w.status}</span>
            <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'ui-monospace, Menlo, monospace' }}>{w.ticketNumber}</span>
          </div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          <Field label="Wager id" value={w.id} mono />
          <Field label="Metric" value={w.metric} />
          <Field label="Target date" value={`${w.targetDate}${w.targetTime ? ' ' + w.targetTime : ''}`} />
          <Field label="Lock time" value={new Date(w.lockTime).toLocaleString()} />
          {w.observedValue != null && <Field label="Stored observedValue" value={String(w.observedValue)} />}
          {w.winningOutcome && <Field label="Winning outcome" value={w.winningOutcome} />}
          {w.voidReason && <Field label="Void reason" value={w.voidReason} />}
        </div>
      </div>

      {/* Wager-specific rules / shape */}
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Wager shape</h3>
        {w.kind === 'odds' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Outcome</th><th style={th}>Range (min … max)</th><th style={th}>Odds</th></tr></thead>
            <tbody>
              {(w.outcomes ?? []).map((o: any, i: number) => (
                <tr key={i}><td style={td}>{o.label}</td><td style={td}>{o.minValue} … {o.maxValue}</td><td style={td}>{o.odds > 0 ? `+${o.odds}` : o.odds}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {w.kind === 'over-under' && (
          <div style={{ fontSize: 13, color: '#cbd5e1' }}>
            Line: <strong>{w.line}</strong>{' '}({w.metric}); over odds {w.over?.odds}, under odds {w.under?.odds}.
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
              Rule: observed &gt; line ⇒ over wins. observed &lt; line ⇒ under wins. observed = line ⇒ push (consider voiding).
            </div>
          </div>
        )}
        {w.kind === 'pointspread' && (
          <div style={{ fontSize: 13, color: '#cbd5e1' }}>
            Spread (A − B): <strong>{w.spread}</strong>; {w.locationA?.name ?? 'A'} odds {w.locationAOdds}, {w.locationB?.name ?? 'B'} odds {w.locationBOdds}.
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
              Rule: (observedA − observedB) &gt; spread ⇒ locationA wins. &lt; spread ⇒ locationB wins. = spread ⇒ push (consider voiding).
            </div>
          </div>
        )}
      </div>

      {/* Observed-value inputs */}
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Observed values</h3>
        {!isPointspread && (
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Observed {w.metric}
            <input style={{ ...input, width: 200, marginLeft: 8 }} inputMode="decimal" value={observedValue}
              onChange={e => setObservedValue(e.target.value)} placeholder="e.g. 64.2" />
          </label>
        )}
        {isPointspread && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: '#94a3b8' }}>
              {w.locationA?.name ?? 'A'} observed
              <input style={{ ...input, width: 160, marginLeft: 8 }} inputMode="decimal" value={observedValueA}
                onChange={e => setObservedValueA(e.target.value)} />
            </label>
            <label style={{ fontSize: 12, color: '#94a3b8' }}>
              {w.locationB?.name ?? 'B'} observed
              <input style={{ ...input, width: 160, marginLeft: 8 }} inputMode="decimal" value={observedValueB}
                onChange={e => setObservedValueB(e.target.value)} />
            </label>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={generatePreview} disabled={!!busy || isTerminal} style={btn(busy === 'preview' ? '#475569' : '#6366f1')}
            title="Computes the winner from your observed values. Does NOT save anything.">
            {busy === 'preview' ? 'Computing…' : 'Generate Resolution Preview'}
          </button>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            Preview is required before the Grade button enables.
          </span>
        </div>
      </div>

      {/* Preview output */}
      {preview && (
        <div style={{ ...card, borderLeft: `3px solid ${preview.computedWinner ? confColor[preview.confidence] : '#ef4444'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Preview</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={badge(preview.computedWinner ? '#22c55e' : '#ef4444')}>
                {preview.computedWinner ? `Computed winner: ${preview.computedWinner}` : 'No winner determined'}
              </span>
              <span style={badge(confColor[preview.confidence] ?? '#64748b')}>confidence: {preview.confidence}</span>
              <span style={badge(preview.wouldChangeStatusTo === 'graded' ? '#22c55e' : '#475569')}>
                {preview.wouldChangeStatusTo === 'graded' ? 'would set status → graded' : 'will not grade'}
              </span>
            </div>
          </div>
          {preview.explanation?.length > 0 && (
            <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
              {preview.explanation.map((x: string, i: number) => <li key={i}>{x}</li>)}
            </ul>
          )}
          {preview.warnings?.length > 0 && (
            <div style={{ marginTop: 6, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: 8, color: '#92400e' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 }}>Warnings ({preview.warnings.length})</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>
                {preview.warnings.map((x: string, i: number) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Grade action */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Grade</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8' }}>
          Grading sets <code>status='graded'</code>, stores <code>observedValue</code> + <code>winningOutcome</code>, and audit-logs <code>wager_manually_graded</code>.
          It does NOT settle balances, move money, or pay users. Re-grading a graded wager is blocked.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional note (e.g. data source)" value={gradeNote} onChange={e => setGradeNote(e.target.value)} />
          <button type="button" onClick={commitGrade}
            disabled={!!busy || !preview || preview.wouldChangeStatusTo !== 'graded' || isTerminal}
            style={btn(preview?.wouldChangeStatusTo === 'graded' && !isTerminal ? '#22c55e' : '#475569')}
            title="Persists the grade. Disabled until a successful preview proves a winner can be determined.">
            {busy === 'grade' ? 'Grading…' : 'Confirm Grade'}
          </button>
        </div>
      </div>

      {/* Void action */}
      <div style={{ ...card, borderLeft: '3px solid #ef4444' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Void</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8' }}>
          Voiding sets <code>status='void'</code> and stores <code>voidReason</code>. Use for ties / pushes, missing data, or incorrect setup. Reason is required.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Void reason (required)" value={voidReason} onChange={e => setVoidReason(e.target.value)} />
          <button type="button" onClick={commitVoid}
            disabled={!!busy || !voidReason.trim() || isTerminal}
            style={btn(voidReason.trim() && !isTerminal ? '#ef4444' : '#475569')}
            title="Voids the wager and audit-logs the action. Does NOT move money.">
            {busy === 'void' ? 'Voiding…' : 'Confirm Void'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Ledger / void list view ──────────────────────────────────────────────────

function LedgerView({ events, title, emptyMsg }: { events: any[]; title: string; emptyMsg: string }) {
  if (!events || events.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>{emptyMsg}</div>;
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>{title} ({events.length})</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>When</th><th style={th}>Actor</th><th style={th}>Wager</th>
              <th style={th}>Summary</th><th style={th}>Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map(e => (
              <tr key={e.id}>
                <td style={td}>{new Date(e.createdAt).toLocaleString()}</td>
                <td style={td}>{e.actor}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{e.details?.wagerId ?? '—'}</td>
                <td style={td}>{e.summary}</td>
                <td style={{ ...td, fontSize: 11, color: '#94a3b8' }}>
                  {e.details?.winner && <>winner: <strong>{e.details.winner}</strong>{' '}</>}
                  {e.details?.confidence && <>· conf {e.details.confidence}{' '}</>}
                  {e.details?.reason && <>· reason: {e.details.reason}{' '}</>}
                  {e.details?.note && <>· note: {e.details.note}</>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Methodology ──────────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Per-kind grading rules</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>Odds</strong> — winning outcome is the range whose <code>[minValue, maxValue]</code> contains the observed value (inclusive). Overlapping ranges or no match block grading.</li>
          <li><strong>Over/Under</strong> — observed &gt; line ⇒ over; observed &lt; line ⇒ under; observed = line ⇒ push (block, consider voiding).</li>
          <li><strong>Pointspread</strong> — (observedA − observedB) &gt; spread ⇒ locationA; &lt; spread ⇒ locationB; = spread ⇒ push (block, consider voiding).</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Confidence</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>High</strong> — winner is unambiguous; comfortable margin from the boundary or push line.</li>
          <li><strong>Medium</strong> — small margin (within ~5–15% of an outcome boundary or 1–3 units of a spread). Verify the data source.</li>
          <li><strong>Low</strong> — push, missing data, overlapping outcome ranges, or grading otherwise blocked.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Workflow</h3>
        <ol style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 20, marginTop: 0 }}>
          <li>Pick a wager from the <strong>Resolvable Wagers</strong> tab.</li>
          <li>Enter observed value(s) in the <strong>Resolution Preview</strong> tab.</li>
          <li>Click <strong>Generate Resolution Preview</strong> — this audit-logs <code>wager_resolution_preview_generated</code> and computes the winner / confidence / warnings without persisting.</li>
          <li>If the preview shows a winner with status "would set status → graded", the <strong>Confirm Grade</strong> button enables. Otherwise, fix the input or void the wager.</li>
          <li>Grading audit-logs <code>wager_manually_graded</code>; voiding audit-logs <code>wager_manually_voided</code>. Re-grading a graded wager is blocked by the wager store.</li>
        </ol>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>No automatic settlement — every grade and void requires an explicit operator click after a preview.</li>
          <li>No balance updates, no payouts, no money movement. Wager status only.</li>
          <li>No trading automation, no order or candidate creation.</li>
          <li>No auto-close beyond the existing <code>lockExpiredWagers</code> behavior.</li>
          <li>Re-grading a graded wager is blocked by <code>gradeWager</code> in the wager store.</li>
          <li>Voiding requires a written reason, persisted as <code>voidReason</code>.</li>
        </ul>
      </div>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#e2e8f0', fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</div>
    </div>
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
