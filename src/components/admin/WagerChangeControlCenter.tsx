import React, { useEffect, useMemo, useState } from 'react';
import { formatDMYTime } from '../../lib/date-format';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const sevColor: Record<string, string> = { low: '#22c55e', medium: '#3b82f6', high: '#f59e0b', critical: '#dc2626' };
const statusColor: Record<string, string> = {
  draft: '#475569', submitted: '#3b82f6', under_review: '#a855f7',
  approved: '#06b6d4', implemented_manually: '#22c55e',
  rejected: '#ef4444', withdrawn: '#64748b', closed: '#1f2937',
};
const statusLabel: Record<string, string> = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review',
  approved: 'Approved', implemented_manually: 'Implemented Manually',
  rejected: 'Rejected', withdrawn: 'Withdrawn', closed: 'Closed',
};
const typeColor: Record<string, string> = {
  odds_change: '#a855f7', line_change: '#06b6d4', description_change: '#3b82f6',
  lock_time_change: '#f59e0b', market_terms_change: '#06b6d4',
  manual_void_request: '#ef4444', manual_regrade_request: '#dc2626',
  settlement_review_request: '#f59e0b', other: '#64748b',
};
const typeLabel: Record<string, string> = {
  odds_change: 'Odds change', line_change: 'Line change', description_change: 'Description change',
  lock_time_change: 'Lock time change', market_terms_change: 'Market terms change',
  manual_void_request: 'Manual void', manual_regrade_request: 'Manual regrade',
  settlement_review_request: 'Settlement review', other: 'Other',
};

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'implemented_manually', 'rejected', 'withdrawn', 'closed'] as const;
const TYPES = ['odds_change', 'line_change', 'description_change', 'lock_time_change', 'market_terms_change', 'manual_void_request', 'manual_regrade_request', 'settlement_review_request', 'other'] as const;

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'open' | 'detail' | 'ledger' | 'approvals' | 'methodology';

function ageString(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return '—';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
function ageBadgeColor(createdAt: string, severity: string): string {
  const h = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  const sla = severity === 'critical' ? 4 : severity === 'high' ? 24 : severity === 'medium' ? 72 : 168;
  if (h > sla) return '#ef4444';
  if (h > sla * 0.5) return '#f59e0b';
  return '#22c55e';
}
function msToHuman(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

export default function WagerChangeControlCenter() {
  const [tab, setTab] = useState<Tab>('open');
  const [summary, setSummary] = useState<any>(null);
  const [openList, setOpenList] = useState<any[]>([]);
  const [allList, setAllList] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('any');
  const [filterSeverity, setFilterSeverity] = useState<string>('any');
  const [filterType, setFilterType] = useState<string>('any');

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/wager-change-control?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/wager-change-control', {
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
      const [s, all] = await Promise.all([get('summary'), get('list', { limit: '500' })]);
      setSummary(s.summary);
      setOpenList(s.open ?? []);
      setAllList(all.requests ?? []);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function openRequest(id: string) {
    setBusy(`open-${id}`); setError(null);
    try {
      const j = await get('get', { id });
      setActive(j.request);
      setTab('detail');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function createReq(payload: any) {
    setBusy('create'); setError(null);
    try {
      const j = await post({ action: 'create', ...payload });
      setActive(j.request);
      setShowCreate(false);
      setTab('detail');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function submit(id: string, note?: string) {
    setBusy('submit'); setError(null);
    try { const j = await post({ action: 'submit', id, note }); setActive(j.request); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function moveToReview(id: string, note?: string) {
    setBusy('move'); setError(null);
    try { const j = await post({ action: 'move-to-under-review', id, note }); setActive(j.request); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function addNote(id: string, note: string) {
    if (!note.trim()) return;
    setBusy('note'); setError(null);
    try { const j = await post({ action: 'add-note', id, note }); setActive(j.request); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function approve(id: string, note?: string, isSelfApproval?: boolean) {
    if (isSelfApproval) {
      const ok = window.confirm('Approve your own change request? This is recorded as a self-approval and audit-logged. Use a second reviewer for high/critical severity when possible.');
      if (!ok) return;
    } else {
      const ok = window.confirm('Approve this change request? Approval is advisory — the actual change still happens manually in the appropriate tool. Audit-logged.');
      if (!ok) return;
    }
    setBusy('approve'); setError(null);
    try { const j = await post({ action: 'approve', id, note }); setActive(j.request); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function reject(id: string, note: string) {
    if (!note.trim()) return;
    setBusy('reject'); setError(null);
    try { const j = await post({ action: 'reject', id, note }); setActive(j.request); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function withdraw(id: string, note?: string) {
    const ok = window.confirm('Withdraw this change request? Use this when you no longer want the proposed change reviewed. Audit-logged.');
    if (!ok) return;
    setBusy('withdraw'); setError(null);
    try { const j = await post({ action: 'withdraw', id, note }); setActive(j.request); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function markImplemented(id: string, implementationNote: string) {
    if (!implementationNote.trim()) { setError('Implementation note is required.'); return; }
    const ok = window.confirm(
      'Mark this change as implemented manually?\n\nThis records that you applied the approved change in the appropriate tool (Wager Resolution / wager edit form / etc).\n\nThis page does NOT make the change for you.',
    );
    if (!ok) return;
    setBusy('impl'); setError(null);
    try { const j = await post({ action: 'mark-implemented-manually', id, implementationNote }); setActive(j.request); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function close(id: string, note?: string) {
    setBusy('close'); setError(null);
    try { const j = await post({ action: 'close', id, note }); setActive(j.request); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading change control…</div>;
  if (!summary) return null;

  const filteredAll = useMemo(() => {
    return allList.filter(r =>
      (filterStatus === 'any' || r.status === filterStatus) &&
      (filterSeverity === 'any' || r.severity === filterSeverity) &&
      (filterType === 'any' || r.changeType === filterType),
    );
  }, [allList, filterStatus, filterSeverity, filterType]);

  const awaitingApproval = openList.filter((r: any) => r.status === 'submitted' || r.status === 'under_review');

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/wager-change-control" /></div>

      <div style={BANNER}>
        <span>📝 Change Control approves and documents proposed changes only. It does <strong>not</strong> modify wagers, odds, outcomes, balances, or permissions automatically.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Audit-logged · Approval workflow</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Wager Change Control & Approval</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Document proposed changes (odds / line / description / lock time / market terms / manual void / manual regrade / settlement review). Approval is advisory — the operator still applies the change manually in the appropriate tool, then marks it implemented here for the audit trail.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/command-center" style={btn('#0ea5e9')}>Command Center →</a>
          <a href="/admin/system/wager-resolution" style={btn('#0ea5e9')}>Wager Resolution →</a>
          <button type="button" onClick={() => setShowCreate(true)} style={btn('#22c55e')}
            title="Document a proposed change. Status starts at 'draft'.">+ Create Change Request</button>
          <button type="button" onClick={reload} disabled={!!busy} style={btn('#6366f1')}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      {awaitingApproval.length > 0 && (
        <div style={{ ...card, background: '#1e3a5f', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#bfdbfe' }}>
              ⏳ {awaitingApproval.length} change request{awaitingApproval.length === 1 ? '' : 's'} awaiting approval
            </h3>
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#dbeafe' }}>
            {awaitingApproval.slice(0, 5).map((r: any) => (
              <li key={r.id}>
                <button type="button" onClick={() => openRequest(r.id)}
                  style={{ background: 'none', border: 'none', color: '#dbeafe', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 12 }}>
                  [{r.severity}] {r.requestedChangeSummary}
                </button>
                <span style={{ marginLeft: 6, color: '#bfdbfe' }}>· {ageString(r.createdAt)} old · {statusLabel[r.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Total" value={summary.total} />
          <Stat label="Open" value={summary.openCount} color="#3b82f6" />
          <Stat label="Awaiting approval" value={summary.awaitingApproval} color="#a855f7" />
          <Stat label="Approved (not impl)" value={summary.approvedNotImplemented} color="#06b6d4" />
          <Stat label="Implemented" value={summary.byStatus.implemented_manually} color="#22c55e" />
          <Stat label="Rejected / withdrawn" value={`${summary.byStatus.rejected ?? 0}/${summary.byStatus.withdrawn ?? 0}`} color="#ef4444" />
          <Stat label="Median age" value={summary.ageMs.medianActive == null ? '—' : msToHuman(summary.ageMs.medianActive)} />
          <Stat label="Max age" value={summary.ageMs.maxActive == null ? '—' : msToHuman(summary.ageMs.maxActive)} color={(summary.ageMs.maxActive ?? 0) > 24 * 3_600_000 ? '#f59e0b' : undefined} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['open', `Open (${summary.openCount})`],
          ['detail', active ? `Detail · ${active.id}` : 'Request Detail'],
          ['ledger', `Wager Change Ledger (${allList.length})`],
          ['approvals', 'Approvals'],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'open' && <OpenView openList={openList} openRequest={openRequest} busy={busy} />}
      {tab === 'detail' && (
        <DetailView
          request={active}
          submit={submit} moveToReview={moveToReview} addNote={addNote}
          approve={approve} reject={reject} withdraw={withdraw}
          markImplemented={markImplemented} close={close}
          busy={busy}
        />
      )}
      {tab === 'ledger' && (
        <LedgerView all={allList} filtered={filteredAll}
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          filterSeverity={filterSeverity} setFilterSeverity={setFilterSeverity}
          filterType={filterType} setFilterType={setFilterType}
          openRequest={openRequest} />
      )}
      {tab === 'approvals' && <ApprovalsView all={allList} openRequest={openRequest} />}
      {tab === 'methodology' && <MethodologyView />}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onSubmit={createReq} busy={busy === 'create'} />
      )}
    </div>
  );
}

// ── Open ─────────────────────────────────────────────────────────────────────

function OpenView({ openList, openRequest, busy }: any) {
  if (!openList || openList.length === 0) {
    return <div style={{ ...card, color: '#22c55e' }}>✓ No open change requests.</div>;
  }
  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Type</th>
              <th style={th}>Wager</th><th style={th}>Summary</th><th style={th}>Age</th><th style={th}>By</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {openList.map((r: any) => (
              <tr key={r.id}>
                <td style={td}><span style={badge(sevColor[r.severity])}>{r.severity}</span></td>
                <td style={td}><span style={badge(statusColor[r.status])}>{statusLabel[r.status]}</span></td>
                <td style={td}><span style={badge(typeColor[r.changeType])}>{typeLabel[r.changeType]}</span></td>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.relatedWagerId}</td>
                <td style={td}>{r.requestedChangeSummary}</td>
                <td style={td}><span style={badge(ageBadgeColor(r.createdAt, r.severity))}>{ageString(r.createdAt)}</span></td>
                <td style={td}>{r.createdBy}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => openRequest(r.id)} disabled={!!busy}
                    style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function DetailView({ request, submit, moveToReview, addNote, approve, reject, withdraw, markImplemented, close, busy }: any) {
  const [noteDraft, setNoteDraft] = useState('');
  const [submitNote, setSubmitNote] = useState('');
  const [moveNote, setMoveNote] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('');
  const [implNote, setImplNote] = useState('');
  const [closeNote, setCloseNote] = useState('');

  if (!request) {
    return (
      <div style={{ ...card, color: '#94a3b8' }}>
        Pick a change request from <strong>Open</strong>, the <strong>Wager Change Ledger</strong>, or <strong>Approvals</strong>.
      </div>
    );
  }

  const r = request;
  const isSelfApproval = (actor: string | null | undefined) => !!actor && actor === r.createdBy;
  const isTerminal = r.status === 'closed';

  return (
    <>
      <div style={{ ...card, borderLeft: `4px solid ${sevColor[r.severity]}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{r.requestedChangeSummary}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={badge(sevColor[r.severity])}>{r.severity}</span>
            <span style={badge(statusColor[r.status])}>{statusLabel[r.status]}</span>
            <span style={badge(typeColor[r.changeType])}>{typeLabel[r.changeType]}</span>
            <span style={badge(ageBadgeColor(r.createdAt, r.severity))}>{ageString(r.createdAt)} old</span>
          </div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          <Field label="Request id" value={r.id} mono />
          <Field label="Wager id" value={r.relatedWagerId} mono />
          <Field label="Created" value={`${formatDMYTime(r.createdAt)} · ${r.createdBy}`} />
          {r.submittedAt && <Field label="Submitted" value={`${formatDMYTime(r.submittedAt)} · ${r.submittedBy ?? '—'}`} />}
          {r.implementedAt && <Field label="Implemented" value={`${formatDMYTime(r.implementedAt)} · ${r.implementedBy ?? '—'}`} />}
          {r.closedAt && <Field label="Closed" value={`${formatDMYTime(r.closedAt)} · ${r.closedBy ?? '—'}`} />}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Rationale</h3>
        <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{r.rationale}</div>
        {r.riskAssessment && (
          <>
            <h3 style={{ margin: '12px 0 8px', fontSize: 14, fontWeight: 700 }}>Risk assessment</h3>
            <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{r.riskAssessment}</div>
          </>
        )}
      </div>

      {(r.currentStateSnapshot || r.proposedStateSnapshot) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {r.currentStateSnapshot && (
            <div style={card}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Current state</h3>
              <pre style={{ margin: 0, padding: 8, background: '#0f172a', borderRadius: 6, fontSize: 11, color: '#cbd5e1', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{r.currentStateSnapshot}</pre>
            </div>
          )}
          {r.proposedStateSnapshot && (
            <div style={{ ...card, borderLeft: '3px solid #06b6d4' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Proposed state</h3>
              <pre style={{ margin: 0, padding: 8, background: '#0f172a', borderRadius: 6, fontSize: 11, color: '#bae6fd', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{r.proposedStateSnapshot}</pre>
            </div>
          )}
        </div>
      )}

      {(r.relatedIncidentId || r.relatedDisputeId || r.relatedEvidenceId) && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Related objects (read-only links)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            <RelatedLink label="Wager" id={r.relatedWagerId} href={`/admin/wagers`} />
            {r.relatedIncidentId && <RelatedLink label="Incident" id={r.relatedIncidentId} href={`/admin/system/incident-management`} />}
            {r.relatedDisputeId && <RelatedLink label="Dispute" id={r.relatedDisputeId} href={`/admin/system/dispute-workflow`} />}
            {r.relatedEvidenceId && <RelatedLink label="Weather evidence" id={r.relatedEvidenceId} href={`/admin/system/weather-evidence`} />}
          </div>
        </div>
      )}

      {/* Approvals list */}
      {(r.approvals ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Approval entries ({r.approvals.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {r.approvals.map((a: any, idx: number) => (
              <li key={idx} style={{ ...tile, padding: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={badge(a.decision === 'approved' ? '#22c55e' : '#ef4444')}>{a.decision}</span>
                  <span style={{ fontSize: 11, color: '#cbd5e1' }}>{a.actor}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, Menlo, monospace' }}>{formatDMYTime(a.at)}</span>
                  {a.actor === r.createdBy && <span style={badge('#f59e0b')}>self-approval</span>}
                </div>
                {a.note && <div style={{ marginTop: 4, fontSize: 12, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{a.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Implementation note */}
      {r.implementationNote && (
        <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#86efac' }}>Implementation note</h3>
          <div style={{ fontSize: 13, color: '#dcfce7', whiteSpace: 'pre-wrap' }}>{r.implementationNote}</div>
        </div>
      )}

      {/* Timeline */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Timeline ({(r.timeline ?? []).length})</h3>
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(r.timeline ?? []).map((e: any, idx: number) => (
            <li key={idx} style={{ ...tile, padding: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, Menlo, monospace' }}>{formatDMYTime(e.at)}</span>
                <span style={{ fontSize: 11, color: '#cbd5e1' }}>{e.actor}</span>
                <span style={{ fontSize: 11, color: '#a855f7', fontFamily: 'ui-monospace, Menlo, monospace' }}>{e.action}</span>
              </div>
              {e.note && <div style={{ marginTop: 4, fontSize: 12, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{e.note}</div>}
            </li>
          ))}
        </ul>
      </div>

      {/* Actions */}
      {!isTerminal && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Actions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Add note */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Add timeline note (audit-logged)" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} />
              <button type="button" onClick={() => { addNote(r.id, noteDraft); setNoteDraft(''); }} disabled={!!busy || !noteDraft.trim()} style={btn('#6366f1')}>Add note</button>
            </div>

            {/* draft → submit */}
            {r.status === 'draft' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional submit note" value={submitNote} onChange={e => setSubmitNote(e.target.value)} />
                <button type="button" onClick={() => { submit(r.id, submitNote); setSubmitNote(''); }} disabled={!!busy} style={btn('#3b82f6')}
                  title="Move from draft to submitted. Audit-logged.">Submit for review</button>
                <button type="button" onClick={() => withdraw(r.id, withdrawNote)} disabled={!!busy} style={btn('#64748b')}
                  title="Withdraw the change request. Audit-logged.">Withdraw</button>
              </div>
            )}

            {/* submitted → under_review */}
            {r.status === 'submitted' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional review note" value={moveNote} onChange={e => setMoveNote(e.target.value)} />
                <button type="button" onClick={() => { moveToReview(r.id, moveNote); setMoveNote(''); }} disabled={!!busy} style={btn('#a855f7')}
                  title="Move to under_review. Audit-logged.">Move to under_review</button>
              </div>
            )}

            {/* submitted/under_review → approve / reject */}
            {(r.status === 'submitted' || r.status === 'under_review') && (
              <>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional approval note" value={approveNote} onChange={e => setApproveNote(e.target.value)} />
                  <button type="button" onClick={() => { approve(r.id, approveNote); setApproveNote(''); }} disabled={!!busy} style={btn('#22c55e')}
                    title="Approve this change. The change still needs to be applied manually in the appropriate tool. Audit-logged.">Approve</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Rejection reason (required)" value={rejectNote} onChange={e => setRejectNote(e.target.value)} />
                  <button type="button" onClick={() => { reject(r.id, rejectNote); setRejectNote(''); }} disabled={!!busy || !rejectNote.trim()} style={btn(rejectNote.trim() ? '#ef4444' : '#475569')}
                    title="Reject the change. Requires a written reason. Audit-logged.">Reject</button>
                </div>
              </>
            )}

            {/* draft / submitted / under_review can withdraw */}
            {(r.status === 'draft' || r.status === 'submitted' || r.status === 'under_review') && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional withdraw note" value={withdrawNote} onChange={e => setWithdrawNote(e.target.value)} />
                <button type="button" onClick={() => { withdraw(r.id, withdrawNote); setWithdrawNote(''); }} disabled={!!busy} style={btn('#64748b')}>Withdraw</button>
              </div>
            )}

            {/* approved → mark implemented manually */}
            {r.status === 'approved' && (
              <div style={{ ...tile, padding: 10 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Mark implemented manually</div>
                <p style={{ margin: '0 0 8px', fontSize: 12, color: '#94a3b8' }}>
                  Apply the change in the appropriate tool first (Wager Resolution / wager edit form / Settlement Preview review). Then record HOW you applied it here for the audit trail.
                </p>
                <textarea style={{ ...input, width: '100%', minHeight: 60, fontFamily: 'inherit', resize: 'vertical' }}
                  placeholder="Implementation note (required) — e.g. 'Voided via Wager Resolution at 14:32 with reason X'."
                  value={implNote} onChange={e => setImplNote(e.target.value)} />
                <div style={{ marginTop: 6 }}>
                  <button type="button" onClick={() => { markImplemented(r.id, implNote); setImplNote(''); }}
                    disabled={!!busy || !implNote.trim()} style={btn(implNote.trim() ? '#22c55e' : '#475569')}>
                    Mark implemented manually
                  </button>
                </div>
              </div>
            )}

            {/* rejected/withdrawn/implemented_manually → close */}
            {(r.status === 'rejected' || r.status === 'withdrawn' || r.status === 'implemented_manually') && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional close note" value={closeNote} onChange={e => setCloseNote(e.target.value)} />
                <button type="button" onClick={() => { close(r.id, closeNote); setCloseNote(''); }} disabled={!!busy} style={btn('#64748b')}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {isTerminal && (
        <div style={{ ...card, color: '#94a3b8', fontSize: 13 }}>
          ✓ Change request is closed{r.closedAt ? ` (${formatDMYTime(r.closedAt)})` : ''}.
        </div>
      )}
    </>
  );
}

// ── Ledger (filterable view) ────────────────────────────────────────────────

function LedgerView({ filtered, filterStatus, setFilterStatus, filterSeverity, setFilterSeverity, filterType, setFilterType, openRequest }: any) {
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Wager change ledger</h3>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>
          Status
          <select value={filterStatus} onChange={(e: any) => setFilterStatus(e.target.value)} style={{ ...input, marginLeft: 6 }}>
            <option value="any">any</option>
            {STATUSES.map(s => <option key={s} value={s}>{statusLabel[s]}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>
          Severity
          <select value={filterSeverity} onChange={(e: any) => setFilterSeverity(e.target.value)} style={{ ...input, marginLeft: 6 }}>
            <option value="any">any</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>
          Type
          <select value={filterType} onChange={(e: any) => setFilterType(e.target.value)} style={{ ...input, marginLeft: 6 }}>
            <option value="any">any</option>
            {TYPES.map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{filtered.length} match{filtered.length === 1 ? '' : 'es'}</span>
      </div>
      {filtered.length === 0 ? (
        <div style={{ color: '#94a3b8', fontSize: 13 }}>No requests match the current filter.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Type</th>
                <th style={th}>Wager</th><th style={th}>Summary</th><th style={th}>Approvals</th>
                <th style={th}>Created</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r: any) => (
                <tr key={r.id}>
                  <td style={td}><span style={badge(sevColor[r.severity])}>{r.severity}</span></td>
                  <td style={td}><span style={badge(statusColor[r.status])}>{statusLabel[r.status]}</span></td>
                  <td style={td}><span style={badge(typeColor[r.changeType])}>{typeLabel[r.changeType]}</span></td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.relatedWagerId}</td>
                  <td style={td}>{r.requestedChangeSummary}</td>
                  <td style={td}>{(r.approvals ?? []).length}</td>
                  <td style={td}>{formatDMYTime(r.createdAt)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => openRequest(r.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Approvals view ──────────────────────────────────────────────────────────

function ApprovalsView({ all, openRequest }: any) {
  const withApprovals = (all ?? []).filter((r: any) => (r.approvals ?? []).length > 0);
  if (withApprovals.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No approval entries on file yet.</div>;
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Requests with approval entries ({withApprovals.length})</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Type</th>
              <th style={th}>Summary</th><th style={th}>Approvals</th><th style={th}>Self-approved</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {withApprovals.map((r: any) => {
              const approvedCount = r.approvals.filter((a: any) => a.decision === 'approved').length;
              const rejectedCount = r.approvals.filter((a: any) => a.decision === 'rejected').length;
              const selfApproved = r.approvals.some((a: any) => a.decision === 'approved' && a.actor === r.createdBy);
              return (
                <tr key={r.id}>
                  <td style={td}><span style={badge(sevColor[r.severity])}>{r.severity}</span></td>
                  <td style={td}><span style={badge(statusColor[r.status])}>{statusLabel[r.status]}</span></td>
                  <td style={td}><span style={badge(typeColor[r.changeType])}>{typeLabel[r.changeType]}</span></td>
                  <td style={td}>{r.requestedChangeSummary}</td>
                  <td style={td}>
                    <span style={{ color: '#22c55e' }}>{approvedCount}</span>
                    {rejectedCount > 0 && <span style={{ color: '#ef4444' }}> / {rejectedCount} rejected</span>}
                  </td>
                  <td style={td}>{selfApproved ? <span style={badge('#f59e0b')}>self</span> : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => openRequest(r.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
                  </td>
                </tr>
              );
            })}
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
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Status workflow</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>draft</strong> → submitted (via Submit), withdrawn.</li>
          <li><strong>submitted</strong> → under_review, approved, rejected, withdrawn.</li>
          <li><strong>under_review</strong> → approved, rejected, withdrawn, back to submitted.</li>
          <li><strong>approved</strong> → implemented_manually (via Mark implemented manually), closed.</li>
          <li><strong>rejected</strong> → closed.</li>
          <li><strong>withdrawn</strong> → closed.</li>
          <li><strong>implemented_manually</strong> → closed.</li>
          <li><strong>closed</strong> — terminal.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Approval gates</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>Approve / Reject</strong> only from <code>submitted</code> or <code>under_review</code>.</li>
          <li><strong>Reject</strong> requires a written note.</li>
          <li><strong>Mark implemented manually</strong> only from <code>approved</code> with at least one approval entry on file. Requires a written implementation note.</li>
          <li><strong>Close</strong> only from <code>rejected</code>, <code>withdrawn</code>, or <code>implemented_manually</code>.</li>
          <li>Self-approvals (the requester also approves) are flagged on the audit log and in the UI. For high/critical requests, prefer a second reviewer.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Manual implementation</h3>
        <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1' }}>
          This page <strong>never</strong> applies the change for you. After approval, take the action in the appropriate tool:
        </p>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 8 }}>
          <li>Odds / line / description / lock-time / market-terms changes → wager edit form.</li>
          <li>Manual void or manual regrade → <a href="/admin/system/wager-resolution" style={{ color: '#0ea5e9' }}>Wager Resolution</a>.</li>
          <li>Settlement review → <a href="/admin/system/wager-settlement-preview" style={{ color: '#0ea5e9' }}>Settlement Preview</a> (still read-only — settlement remains manual outside the platform).</li>
        </ul>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#cbd5e1' }}>
          Then come back here and click <strong>Mark implemented manually</strong> with a note explaining how you applied it.
        </p>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>SLA aging colors</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>critical</strong> 4h SLA · <strong>high</strong> 24h · <strong>medium</strong> 72h · <strong>low</strong> 7 days.</li>
          <li>Green within 50% of SLA, amber up to SLA, red past SLA.</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>The lib only imports <code>getRedis</code> + <code>logAuditEvent</code>. No wager-store / wallet-store / pricing-engine / security-store mutation imports.</li>
          <li>No wager mutation, no odds/line update, no grading, no voiding, no balance change, no RBAC change.</li>
          <li>"Implemented manually" is a stamp — the actual change must already have happened in the appropriate tool.</li>
          <li>Writes confined to <code>wager-change:&#123;id&#125;</code>, <code>wager-changes:all</code>, <code>wager-changes:open</code>, <code>wager-changes:wager:&#123;wagerId&#125;</code>, plus the audit log.</li>
          <li>Audit events: <code>wager_change_created / submitted / note_added / approved / rejected / withdrawn / marked_implemented_manually / closed</code>.</li>
        </ul>
      </div>
    </>
  );
}

// ── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (payload: any) => void; busy: boolean }) {
  const [relatedWagerId, setRelatedWagerId] = useState('');
  const [changeType, setChangeType] = useState<typeof TYPES[number]>('description_change');
  const [severity, setSeverity] = useState<typeof SEVERITIES[number]>('medium');
  const [requestedChangeSummary, setRequestedChangeSummary] = useState('');
  const [rationale, setRationale] = useState('');
  const [riskAssessment, setRiskAssessment] = useState('');
  const [currentStateSnapshot, setCurrentStateSnapshot] = useState('');
  const [proposedStateSnapshot, setProposedStateSnapshot] = useState('');
  const [relatedIncidentId, setRelatedIncidentId] = useState('');
  const [relatedDisputeId, setRelatedDisputeId] = useState('');
  const [relatedEvidenceId, setRelatedEvidenceId] = useState('');

  const canSubmit = !!relatedWagerId.trim() && !!requestedChangeSummary.trim() && !!rationale.trim() && !busy;

  function submit() {
    onSubmit({
      relatedWagerId: relatedWagerId.trim(),
      changeType,
      severity,
      requestedChangeSummary: requestedChangeSummary.trim(),
      rationale: rationale.trim(),
      riskAssessment: riskAssessment.trim() || undefined,
      currentStateSnapshot: currentStateSnapshot.trim() || undefined,
      proposedStateSnapshot: proposedStateSnapshot.trim() || undefined,
      relatedIncidentId: relatedIncidentId.trim() || undefined,
      relatedDisputeId: relatedDisputeId.trim() || undefined,
      relatedEvidenceId: relatedEvidenceId.trim() || undefined,
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: 20 }}
      onClick={onClose}>
      <div onClick={(e: any) => e.stopPropagation()}
        style={{ background: '#1e293b', borderRadius: 8, maxWidth: 800, width: '100%', padding: 20, color: '#e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Create change request</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8' }}>
          Documentation only. Creates a change request with status <code>draft</code>. Submit it for review when you're ready.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 8 }}>
          <Lbl label="Wager id *">
            <input style={{ ...input, width: '100%' }} value={relatedWagerId} onChange={e => setRelatedWagerId(e.target.value)} />
          </Lbl>
          <Lbl label="Change type">
            <select style={{ ...input, width: '100%' }} value={changeType} onChange={(e: any) => setChangeType(e.target.value)}>
              {TYPES.map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}
            </select>
          </Lbl>
          <Lbl label="Severity">
            <select style={{ ...input, width: '100%' }} value={severity} onChange={(e: any) => setSeverity(e.target.value)}>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Lbl>
        </div>

        <Lbl label="Requested change summary *" style={{ display: 'block', marginBottom: 8 }}>
          <input style={{ ...input, width: '100%' }} value={requestedChangeSummary} onChange={e => setRequestedChangeSummary(e.target.value)} placeholder="e.g. Adjust over odds from -110 to -105" />
        </Lbl>

        <Lbl label="Rationale *" style={{ display: 'block', marginBottom: 8 }}>
          <textarea rows={3} style={{ ...input, width: '100%', fontFamily: 'inherit', resize: 'vertical' }} value={rationale} onChange={e => setRationale(e.target.value)} />
        </Lbl>

        <Lbl label="Risk assessment (optional)" style={{ display: 'block', marginBottom: 8 }}>
          <textarea rows={2} style={{ ...input, width: '100%', fontFamily: 'inherit', resize: 'vertical' }} value={riskAssessment} onChange={e => setRiskAssessment(e.target.value)} />
        </Lbl>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8, marginBottom: 8 }}>
          <Lbl label="Current state snapshot (optional, JSON / freeform)">
            <textarea rows={3} style={{ ...input, width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', resize: 'vertical' }} value={currentStateSnapshot} onChange={e => setCurrentStateSnapshot(e.target.value)} />
          </Lbl>
          <Lbl label="Proposed state snapshot (optional)">
            <textarea rows={3} style={{ ...input, width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', resize: 'vertical' }} value={proposedStateSnapshot} onChange={e => setProposedStateSnapshot(e.target.value)} />
          </Lbl>
        </div>

        <div style={{ marginTop: 6, marginBottom: 6, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Related (optional)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <Lbl label="Incident id"><input style={{ ...input, width: '100%' }} value={relatedIncidentId} onChange={e => setRelatedIncidentId(e.target.value)} /></Lbl>
          <Lbl label="Dispute id"><input style={{ ...input, width: '100%' }} value={relatedDisputeId} onChange={e => setRelatedDisputeId(e.target.value)} /></Lbl>
          <Lbl label="Evidence id"><input style={{ ...input, width: '100%' }} value={relatedEvidenceId} onChange={e => setRelatedEvidenceId(e.target.value)} /></Lbl>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={btn('#475569')}>Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit} style={btn(canSubmit ? '#22c55e' : '#475569')}
            title="Create the change request as draft. Audit-logged.">Create draft</button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Lbl({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ fontSize: 11, color: '#94a3b8', ...style }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

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

function RelatedLink({ label, id, href }: { label: string; id: string; href: string }) {
  return (
    <a href={href} style={{ ...tile, textDecoration: 'none', color: '#e2e8f0', display: 'block' }}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all' }}>{id}</div>
      <div style={{ fontSize: 11, color: '#0ea5e9', marginTop: 4 }}>{href} →</div>
    </a>
  );
}
