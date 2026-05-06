import React, { useEffect, useMemo, useState } from 'react';
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
  open: '#3b82f6', under_review: '#a855f7', awaiting_evidence: '#f59e0b',
  recommendation_made: '#06b6d4', resolved: '#22c55e', closed: '#64748b',
};
const statusLabel: Record<string, string> = {
  open: 'Open', under_review: 'Under Review', awaiting_evidence: 'Awaiting Evidence',
  recommendation_made: 'Recommendation Made', resolved: 'Resolved', closed: 'Closed',
};
const categoryColor: Record<string, string> = {
  grading_dispute: '#22c55e', weather_data_conflict: '#06b6d4',
  market_terms_dispute: '#a855f7', settlement_preview_issue: '#f59e0b',
  operator_error: '#ef4444', other: '#64748b',
};
const categoryLabel: Record<string, string> = {
  grading_dispute: 'Grading dispute', weather_data_conflict: 'Weather data conflict',
  market_terms_dispute: 'Market terms', settlement_preview_issue: 'Settlement preview',
  operator_error: 'Operator error', other: 'Other',
};
const recColor: Record<string, string> = {
  uphold_original: '#22c55e', manual_regrade_review: '#f59e0b',
  manual_void_review: '#ef4444', request_more_evidence: '#a855f7',
  operator_training_followup: '#3b82f6', no_action: '#64748b',
};
const recLabel: Record<string, string> = {
  uphold_original: 'Uphold original', manual_regrade_review: 'Manual regrade review',
  manual_void_review: 'Manual void review', request_more_evidence: 'Request more evidence',
  operator_training_followup: 'Operator training follow-up', no_action: 'No action',
};

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'under_review', 'awaiting_evidence', 'recommendation_made', 'resolved', 'closed'] as const;
const CATEGORIES = ['grading_dispute', 'weather_data_conflict', 'market_terms_dispute', 'settlement_preview_issue', 'operator_error', 'other'] as const;
const CLAIMANTS = ['user', 'operator', 'internal_review', 'other'] as const;
const RECOMMENDATIONS = ['uphold_original', 'manual_regrade_review', 'manual_void_review', 'request_more_evidence', 'operator_training_followup', 'no_action'] as const;

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'open' | 'detail' | 'evidence' | 'recommendations' | 'methodology';

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
  const sla = severity === 'critical' ? 8 : severity === 'high' ? 48 : severity === 'medium' ? 168 : 336;
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

export default function DisputeWorkflowCenter() {
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
  const [filterCategory, setFilterCategory] = useState<string>('any');

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/dispute-workflow?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/dispute-workflow', {
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
      setAllList(all.disputes ?? []);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function openDispute(id: string) {
    setBusy(`open-${id}`); setError(null);
    try {
      const j = await get('get', { id });
      setActive(j.dispute);
      setTab('detail');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function createDispute(payload: any) {
    setBusy('create'); setError(null);
    try {
      const j = await post({ action: 'create', ...payload });
      setActive(j.dispute);
      setShowCreate(false);
      setTab('detail');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function changeStatus(id: string, to: string, note?: string) {
    setBusy(`status-${id}`); setError(null);
    try {
      const j = await post({ action: 'change-status', id, to, note });
      setActive(j.dispute);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function addNote(id: string, note: string) {
    if (!note.trim()) return;
    setBusy(`note-${id}`); setError(null);
    try {
      const j = await post({ action: 'add-note', id, note });
      setActive(j.dispute);
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function recommend(id: string, rec: string, rationale: string) {
    if (!rationale.trim()) return;
    setBusy(`recommend-${id}`); setError(null);
    try {
      const j = await post({ action: 'make-recommendation', id, recommendedResolution: rec, rationale });
      setActive(j.dispute);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function resolve(id: string, note?: string) {
    const ok = window.confirm('Resolve this dispute? Resolution requires a recommendation on file. Audit-logged. Does NOT regrade or void wagers, settle balances, or change outcomes.');
    if (!ok) return;
    setBusy(`resolve-${id}`); setError(null);
    try {
      const j = await post({ action: 'resolve', id, note });
      setActive(j.dispute);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function close(id: string, note?: string) {
    const ok = window.confirm('Close this dispute? Closing is reversible (you can move back to under_review).');
    if (!ok) return;
    setBusy(`close-${id}`); setError(null);
    try {
      const j = await post({ action: 'close', id, note });
      setActive(j.dispute);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading dispute workflow…</div>;
  if (!summary) return null;

  const filteredAll = useMemo(() => {
    return allList.filter(d =>
      (filterStatus === 'any' || d.status === filterStatus) &&
      (filterSeverity === 'any' || d.severity === filterSeverity) &&
      (filterCategory === 'any' || d.category === filterCategory),
    );
  }, [allList, filterStatus, filterSeverity, filterCategory]);

  const recommendations = useMemo(() => allList.filter(d => d.recommendedResolution), [allList]);
  const criticalOpen = openList.filter((d: any) => d.severity === 'critical');

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/dispute-workflow" /></div>

      <div style={BANNER}>
        <span>⚖️ Disputes document review decisions only. This page does <strong>not</strong> regrade wagers, void markets, settle balances, or change outcomes automatically.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Audit-logged · Workflow only</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Dispute & Correction Workflow</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Document, investigate, recommend, and resolve disputes across grading, weather data, market terms, settlement, and operator error. Recommendations are advisory; any actual change to a wager / balance still goes through the existing manual workflows.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/command-center" style={btn('#0ea5e9')}>Command Center →</a>
          <a href="/admin/system/incident-management" style={btn('#0ea5e9')}>Incident Management →</a>
          <button type="button" onClick={() => setShowCreate(true)} style={btn('#22c55e')}
            title="Document a new dispute. Status starts at 'open'.">+ Create Dispute</button>
          <button type="button" onClick={reload} disabled={!!busy} style={btn('#6366f1')}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      {criticalOpen.length > 0 && (
        <div style={{ ...card, background: '#3f1d1d', borderLeft: '4px solid #dc2626' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>
              ⚠️ {criticalOpen.length} unresolved critical dispute{criticalOpen.length === 1 ? '' : 's'}
            </h3>
            <span style={{ fontSize: 12, color: '#fca5a5' }}>Address before routine work.</span>
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {criticalOpen.slice(0, 5).map((d: any) => (
              <li key={d.id}>
                <button type="button" onClick={() => openDispute(d.id)}
                  style={{ background: 'none', border: 'none', color: '#fecaca', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 12 }}>
                  {d.title}
                </button>
                <span style={{ marginLeft: 6, color: '#fca5a5' }}>· {ageString(d.createdAt)} old · {statusLabel[d.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Total" value={summary.total} />
          <Stat label="Open" value={summary.openCount} color="#3b82f6" />
          <Stat label="Critical (open)" value={summary.criticalOpen} color="#ef4444" />
          <Stat label="Awaiting evidence" value={summary.awaitingEvidence} color="#f59e0b" />
          <Stat label="Resolved" value={summary.byStatus.resolved} color="#22c55e" />
          <Stat label="Closed" value={summary.byStatus.closed} color="#64748b" />
          <Stat label="Median age" value={summary.ageMs.medianActive == null ? '—' : msToHuman(summary.ageMs.medianActive)} />
          <Stat label="Max age" value={summary.ageMs.maxActive == null ? '—' : msToHuman(summary.ageMs.maxActive)} color={(summary.ageMs.maxActive ?? 0) > 48 * 3_600_000 ? '#f59e0b' : undefined} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['open', `Open (${summary.openCount})`],
          ['detail', active ? `Detail · ${active.id}` : 'Dispute Detail'],
          ['evidence', 'Evidence & Links'],
          ['recommendations', `Recommendations (${recommendations.length})`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'open' && <OpenView openList={openList} openDispute={openDispute} busy={busy} />}
      {tab === 'detail' && (
        <DetailView
          dispute={active}
          changeStatus={changeStatus}
          addNote={addNote}
          recommend={recommend}
          resolve={resolve}
          close={close}
          busy={busy}
        />
      )}
      {tab === 'evidence' && (
        <EvidenceView all={allList} filtered={filteredAll}
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          filterSeverity={filterSeverity} setFilterSeverity={setFilterSeverity}
          filterCategory={filterCategory} setFilterCategory={setFilterCategory}
          openDispute={openDispute} />
      )}
      {tab === 'recommendations' && <RecommendationsView recs={recommendations} openDispute={openDispute} />}
      {tab === 'methodology' && <MethodologyView />}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onSubmit={createDispute} busy={busy === 'create'} />
      )}
    </div>
  );
}

// ── Open ─────────────────────────────────────────────────────────────────────

function OpenView({ openList, openDispute, busy }: any) {
  if (!openList || openList.length === 0) {
    return <div style={{ ...card, color: '#22c55e' }}>✓ No open disputes.</div>;
  }
  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Category</th>
              <th style={th}>Title</th><th style={th}>Wager</th><th style={th}>Age</th><th style={th}>By</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {openList.map((d: any) => (
              <tr key={d.id}>
                <td style={td}><span style={badge(sevColor[d.severity])}>{d.severity}</span></td>
                <td style={td}><span style={badge(statusColor[d.status])}>{statusLabel[d.status]}</span></td>
                <td style={td}><span style={badge(categoryColor[d.category])}>{categoryLabel[d.category]}</span></td>
                <td style={td}>{d.title}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{d.relatedWagerId ?? '—'}</td>
                <td style={td}><span style={badge(ageBadgeColor(d.createdAt, d.severity))}>{ageString(d.createdAt)}</span></td>
                <td style={td}>{d.createdBy}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => openDispute(d.id)} disabled={!!busy}
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

function DetailView({ dispute, changeStatus, addNote, recommend, resolve, close, busy }: any) {
  const [noteDraft, setNoteDraft] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [resolveNote, setResolveNote] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [recDraft, setRecDraft] = useState<typeof RECOMMENDATIONS[number]>('uphold_original');
  const [rationaleDraft, setRationaleDraft] = useState('');

  if (!dispute) {
    return (
      <div style={{ ...card, color: '#94a3b8' }}>
        Pick a dispute from the <strong>Open</strong> tab, the <strong>Evidence & Links</strong> tab, or <strong>Recommendations</strong>.
      </div>
    );
  }

  const d = dispute;
  const isTerminal = d.status === 'closed';

  // What status transitions are allowed (must mirror lib STATUS_TRANSITIONS)
  const transitionsAllowed: Record<string, string[]> = {
    open: ['under_review', 'awaiting_evidence', 'closed'],
    under_review: ['awaiting_evidence', 'open'],
    awaiting_evidence: ['under_review', 'open'],
    recommendation_made: ['under_review', 'awaiting_evidence'],
    resolved: ['under_review'],
    closed: [],
  };
  const fromBucket = transitionsAllowed[d.status] ?? [];
  const simpleStatusButtons = fromBucket.filter(s => s !== 'recommendation_made' && s !== 'resolved' && s !== 'closed');

  return (
    <>
      <div style={{ ...card, borderLeft: `4px solid ${sevColor[d.severity]}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{d.title}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={badge(sevColor[d.severity])}>{d.severity}</span>
            <span style={badge(statusColor[d.status])}>{statusLabel[d.status]}</span>
            <span style={badge(categoryColor[d.category])}>{categoryLabel[d.category]}</span>
            <span style={badge(ageBadgeColor(d.createdAt, d.severity))}>{ageString(d.createdAt)} old</span>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{d.description}</div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          <Field label="Dispute id" value={d.id} mono />
          <Field label="Created" value={`${new Date(d.createdAt).toLocaleString()} · ${d.createdBy}`} />
          <Field label="Claimant" value={d.claimantType ? `${d.claimantType}${d.claimantReference ? ` · ${d.claimantReference}` : ''}` : '—'} />
          {d.requestedOutcome && <Field label="Requested outcome" value={d.requestedOutcome} />}
          {d.currentOutcome && <Field label="Current outcome" value={d.currentOutcome} />}
          {d.resolvedAt && <Field label="Resolved" value={`${new Date(d.resolvedAt).toLocaleString()} · ${d.resolvedBy ?? '—'}`} />}
          {d.closedAt && <Field label="Closed" value={`${new Date(d.closedAt).toLocaleString()} · ${d.closedBy ?? '—'}`} />}
        </div>
      </div>

      {/* Related links */}
      {(d.relatedWagerId || d.relatedEvidenceId || d.relatedIncidentId || d.relatedSettlementPreviewId) && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Related objects (read-only links)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {d.relatedWagerId && <RelatedLink label="Wager" id={d.relatedWagerId} href={`/admin/wagers`} />}
            {d.relatedEvidenceId && <RelatedLink label="Weather evidence" id={d.relatedEvidenceId} href={`/admin/system/weather-evidence`} />}
            {d.relatedIncidentId && <RelatedLink label="Incident" id={d.relatedIncidentId} href={`/admin/system/incident-management`} />}
            {d.relatedSettlementPreviewId && <RelatedLink label="Settlement preview" id={d.relatedSettlementPreviewId} href={`/admin/system/wager-settlement-preview`} />}
          </div>
        </div>
      )}

      {/* Recommendation panel */}
      {d.recommendedResolution && (
        <div style={{ ...card, background: '#0c4a6e', borderLeft: '3px solid #06b6d4' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#bae6fd' }}>Recommendation on file</h3>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={badge(recColor[d.recommendedResolution])}>{recLabel[d.recommendedResolution]}</span>
            {d.recommendationMadeAt && <span style={{ fontSize: 11, color: '#bae6fd' }}>{new Date(d.recommendationMadeAt).toLocaleString()} · {d.recommendationMadeBy}</span>}
          </div>
          {d.rationale && <div style={{ fontSize: 13, color: '#e0f2fe', whiteSpace: 'pre-wrap' }}>{d.rationale}</div>}
          <div style={{ fontSize: 11, color: '#bae6fd', marginTop: 6, fontStyle: 'italic' }}>
            Recommendations are advisory only. Actual wager regrades / voids still happen manually in Wager Resolution.
          </div>
        </div>
      )}

      {/* Timeline */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Timeline ({(d.timeline ?? []).length})</h3>
        {(d.timeline ?? []).length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No entries.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {d.timeline.map((e: any, idx: number) => (
              <li key={idx} style={{ ...tile, padding: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, Menlo, monospace' }}>{new Date(e.at).toLocaleString()}</span>
                  <span style={{ fontSize: 11, color: '#cbd5e1' }}>{e.actor}</span>
                  <span style={{ fontSize: 11, color: '#a855f7', fontFamily: 'ui-monospace, Menlo, monospace' }}>{e.action}</span>
                </div>
                {e.note && <div style={{ marginTop: 4, fontSize: 12, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{e.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Actions */}
      {!isTerminal && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Actions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Add note */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Add timeline note (audit-logged)" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} />
              <button type="button" onClick={() => { addNote(d.id, noteDraft); setNoteDraft(''); }} disabled={!!busy || !noteDraft.trim()} style={btn('#6366f1')}
                title="Append a note to the timeline. Does not change wagers, balances, or RBAC.">Add note</button>
            </div>

            {/* Status transitions */}
            {simpleStatusButtons.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional status-change note" value={statusNote} onChange={e => setStatusNote(e.target.value)} />
                {simpleStatusButtons.map(s => (
                  <button key={s} type="button" onClick={() => { changeStatus(d.id, s, statusNote); setStatusNote(''); }} disabled={!!busy} style={btn(statusColor[s])}
                    title={`Move dispute status to ${s}. Adds a timeline entry.`}>
                    → {statusLabel[s]}
                  </button>
                ))}
              </div>
            )}

            {/* Recommendation form (only when in under_review / awaiting_evidence / recommendation_made) */}
            {(d.status === 'under_review' || d.status === 'awaiting_evidence' || d.status === 'recommendation_made') && (
              <div style={{ ...tile, padding: 10 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
                  {d.recommendedResolution ? 'Revise recommendation' : 'Make recommendation'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 6 }}>
                  <select style={{ ...input, minWidth: 220 }} value={recDraft} onChange={(e: any) => setRecDraft(e.target.value)}>
                    {RECOMMENDATIONS.map(r => <option key={r} value={r}>{recLabel[r]}</option>)}
                  </select>
                </div>
                <textarea style={{ ...input, width: '100%', minHeight: 60, fontFamily: 'inherit', resize: 'vertical' }}
                  placeholder="Rationale (required) — explain the basis for this recommendation."
                  value={rationaleDraft} onChange={e => setRationaleDraft(e.target.value)} />
                <div style={{ marginTop: 6 }}>
                  <button type="button" onClick={() => { recommend(d.id, recDraft, rationaleDraft); setRationaleDraft(''); }}
                    disabled={!!busy || !rationaleDraft.trim()} style={btn(rationaleDraft.trim() ? '#06b6d4' : '#475569')}
                    title="Records the recommendation and rationale. Status moves to recommendation_made. Advisory only.">
                    {d.recommendedResolution ? 'Save revised recommendation' : 'Make recommendation'}
                  </button>
                </div>
              </div>
            )}

            {/* Resolve */}
            {d.status === 'recommendation_made' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional resolve note" value={resolveNote} onChange={e => setResolveNote(e.target.value)} />
                <button type="button" onClick={() => { resolve(d.id, resolveNote); setResolveNote(''); }} disabled={!!busy} style={btn('#22c55e')}
                  title="Mark resolved. Requires the recommendation to already be on file. Does not regrade or void wagers.">
                  Resolve
                </button>
              </div>
            )}

            {/* Close */}
            {d.status === 'resolved' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional close note" value={closeNote} onChange={e => setCloseNote(e.target.value)} />
                <button type="button" onClick={() => { close(d.id, closeNote); setCloseNote(''); }} disabled={!!busy} style={btn('#64748b')}
                  title="Close the dispute. Reversible — you can move back to under_review.">Close</button>
                <button type="button" onClick={() => changeStatus(d.id, 'under_review', 'reopened')} disabled={!!busy} style={btn('#3b82f6')}
                  title="Reopen the dispute (clears the resolved stamp; recommendation stays).">Reopen</button>
              </div>
            )}
          </div>
        </div>
      )}

      {isTerminal && (
        <div style={{ ...card, color: '#94a3b8', fontSize: 13 }}>
          ✓ Dispute is closed{d.closedAt ? ` (${new Date(d.closedAt).toLocaleString()})` : ''}.
        </div>
      )}

      {/* Notes */}
      {(d.notes ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Notes ({d.notes.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
            {d.notes.map((n: string, idx: number) => <li key={idx} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{n}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

// ── Evidence & Links (filterable view) ──────────────────────────────────────

function EvidenceView({ all, filtered, filterStatus, setFilterStatus, filterSeverity, setFilterSeverity, filterCategory, setFilterCategory, openDispute }: any) {
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Filter & link directory</h3>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: '#94a3b8' }}>
        Browse disputes with their related-object pointers (wager / weather evidence / incident / settlement preview).
        All links are read-only — they navigate to existing tools without modifying anything.
      </p>
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
          Category
          <select value={filterCategory} onChange={(e: any) => setFilterCategory(e.target.value)} style={{ ...input, marginLeft: 6 }}>
            <option value="any">any</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel[c]}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{filtered.length} match{filtered.length === 1 ? '' : 'es'}</span>
      </div>
      {filtered.length === 0 ? (
        <div style={{ color: '#94a3b8', fontSize: 13 }}>No disputes match the current filter.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Title</th>
                <th style={th}>Wager</th><th style={th}>Evidence</th><th style={th}>Incident</th>
                <th style={th}>Settlement</th><th style={th}>Recommendation</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d: any) => (
                <tr key={d.id}>
                  <td style={td}><span style={badge(sevColor[d.severity])}>{d.severity}</span></td>
                  <td style={td}><span style={badge(statusColor[d.status])}>{statusLabel[d.status]}</span></td>
                  <td style={td}>{d.title}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{d.relatedWagerId ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{d.relatedEvidenceId ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{d.relatedIncidentId ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{d.relatedSettlementPreviewId ?? '—'}</td>
                  <td style={td}>{d.recommendedResolution ? <span style={badge(recColor[d.recommendedResolution])}>{recLabel[d.recommendedResolution]}</span> : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => openDispute(d.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
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

// ── Recommendations ─────────────────────────────────────────────────────────

function RecommendationsView({ recs, openDispute }: any) {
  if (!recs || recs.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No recommendations on file yet.</div>;
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Disputes with recommendations ({recs.length})</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Status</th><th style={th}>Recommendation</th><th style={th}>Title</th>
              <th style={th}>Wager</th><th style={th}>Made</th><th style={th}>By</th><th style={th}>Rationale</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {recs.map((d: any) => (
              <tr key={d.id}>
                <td style={td}><span style={badge(statusColor[d.status])}>{statusLabel[d.status]}</span></td>
                <td style={td}><span style={badge(recColor[d.recommendedResolution])}>{recLabel[d.recommendedResolution]}</span></td>
                <td style={td}>{d.title}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{d.relatedWagerId ?? '—'}</td>
                <td style={td}>{d.recommendationMadeAt ? new Date(d.recommendationMadeAt).toLocaleString() : '—'}</td>
                <td style={td}>{d.recommendationMadeBy ?? '—'}</td>
                <td style={{ ...td, fontSize: 11, color: '#cbd5e1', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.rationale ?? '—'}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => openDispute(d.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
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
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Status workflow</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>open</strong> → under_review, awaiting_evidence, or closed (no-action close).</li>
          <li><strong>under_review</strong> → awaiting_evidence, recommendation_made (via Make recommendation), or back to open.</li>
          <li><strong>awaiting_evidence</strong> → under_review, recommendation_made, or back to open.</li>
          <li><strong>recommendation_made</strong> → under_review (revise), awaiting_evidence, or resolved (gates on recommendation present).</li>
          <li><strong>resolved</strong> → closed, or under_review (reopen, clears resolved stamps).</li>
          <li><strong>closed</strong> — terminal. Reopen via Resolution History → under_review.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recommendation values</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          {RECOMMENDATIONS.map(r => (
            <li key={r}><span style={badge(recColor[r])}>{recLabel[r]}</span></li>
          ))}
        </ul>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#94a3b8' }}>
          Recommendations are advisory. Even a "manual_regrade_review" recommendation is just a record — actual regrades still happen
          manually in <a href="/admin/system/wager-resolution" style={{ color: '#0ea5e9' }}>Wager Resolution</a>.
        </p>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>SLA aging colors</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>critical</strong> 8h SLA · <strong>high</strong> 48h · <strong>medium</strong> 7 days · <strong>low</strong> 14 days.</li>
          <li>Green within 50% of SLA, amber up to SLA, red past SLA.</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>The lib only imports <code>getRedis</code> + <code>logAuditEvent</code>. No wager-store / wallet-store / pricing-engine imports.</li>
          <li>No wager regrade, no wager void, no settlement, no balance reversal, no pricing change.</li>
          <li>Related-object fields are pointers only — the underlying wager / evidence / incident / settlement records are never modified.</li>
          <li>Writes confined to <code>dispute:&#123;id&#125;</code>, <code>disputes:all</code>, <code>disputes:open</code>, <code>disputes:by-severity:&#123;sev&#125;</code>, <code>disputes:wager:&#123;wagerId&#125;</code>, plus the audit log.</li>
          <li>Audit events: <code>dispute_created</code>, <code>dispute_note_added</code>, <code>dispute_status_changed</code>, <code>dispute_recommendation_made</code>, <code>dispute_resolved</code>, <code>dispute_closed</code>.</li>
        </ul>
      </div>
    </>
  );
}

// ── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (payload: any) => void; busy: boolean }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('grading_dispute');
  const [severity, setSeverity] = useState<typeof SEVERITIES[number]>('medium');
  const [claimantType, setClaimantType] = useState<typeof CLAIMANTS[number] | ''>('');
  const [claimantReference, setClaimantReference] = useState('');
  const [requestedOutcome, setRequestedOutcome] = useState('');
  const [currentOutcome, setCurrentOutcome] = useState('');
  const [relatedWagerId, setRelatedWagerId] = useState('');
  const [relatedEvidenceId, setRelatedEvidenceId] = useState('');
  const [relatedIncidentId, setRelatedIncidentId] = useState('');
  const [relatedSettlementPreviewId, setRelatedSettlementPreviewId] = useState('');

  const canSubmit = !!title.trim() && !!description.trim() && !busy;

  function submit() {
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      category,
      severity,
      claimantType: claimantType || undefined,
      claimantReference: claimantReference.trim() || undefined,
      requestedOutcome: requestedOutcome.trim() || undefined,
      currentOutcome: currentOutcome.trim() || undefined,
      relatedWagerId: relatedWagerId.trim() || undefined,
      relatedEvidenceId: relatedEvidenceId.trim() || undefined,
      relatedIncidentId: relatedIncidentId.trim() || undefined,
      relatedSettlementPreviewId: relatedSettlementPreviewId.trim() || undefined,
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: 20 }}
      onClick={onClose}>
      <div onClick={(e: any) => e.stopPropagation()}
        style={{ background: '#1e293b', borderRadius: 8, maxWidth: 800, width: '100%', padding: 20, color: '#e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Create dispute</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8' }}>
          Documentation only. Creates a dispute record with status <code>open</code>. Recommendation comes later, after review.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 8 }}>
          <Lbl label="Title *">
            <input style={{ ...input, width: '100%' }} value={title} onChange={e => setTitle(e.target.value)} />
          </Lbl>
          <Lbl label="Category">
            <select style={{ ...input, width: '100%' }} value={category} onChange={(e: any) => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel[c]}</option>)}
            </select>
          </Lbl>
          <Lbl label="Severity">
            <select style={{ ...input, width: '100%' }} value={severity} onChange={(e: any) => setSeverity(e.target.value)}>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Lbl>
        </div>

        <Lbl label="Description *" style={{ display: 'block', marginBottom: 8 }}>
          <textarea rows={4} style={{ ...input, width: '100%', fontFamily: 'inherit', resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} />
        </Lbl>

        <div style={{ marginTop: 6, marginBottom: 6, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Claimant</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <Lbl label="Claimant type">
            <select style={{ ...input, width: '100%' }} value={claimantType} onChange={(e: any) => setClaimantType(e.target.value)}>
              <option value="">—</option>
              {CLAIMANTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Lbl>
          <Lbl label="Claimant reference">
            <input style={{ ...input, width: '100%' }} value={claimantReference} onChange={e => setClaimantReference(e.target.value)} placeholder="e.g. user id, operator id, ticket id" />
          </Lbl>
          <Lbl label="Current outcome (what was decided)">
            <input style={{ ...input, width: '100%' }} value={currentOutcome} onChange={e => setCurrentOutcome(e.target.value)} />
          </Lbl>
          <Lbl label="Requested outcome (what the claimant wants)">
            <input style={{ ...input, width: '100%' }} value={requestedOutcome} onChange={e => setRequestedOutcome(e.target.value)} />
          </Lbl>
        </div>

        <div style={{ marginTop: 8, marginBottom: 6, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Related (optional)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <Lbl label="Wager id"><input style={{ ...input, width: '100%' }} value={relatedWagerId} onChange={e => setRelatedWagerId(e.target.value)} /></Lbl>
          <Lbl label="Weather evidence id"><input style={{ ...input, width: '100%' }} value={relatedEvidenceId} onChange={e => setRelatedEvidenceId(e.target.value)} /></Lbl>
          <Lbl label="Incident id"><input style={{ ...input, width: '100%' }} value={relatedIncidentId} onChange={e => setRelatedIncidentId(e.target.value)} /></Lbl>
          <Lbl label="Settlement preview id"><input style={{ ...input, width: '100%' }} value={relatedSettlementPreviewId} onChange={e => setRelatedSettlementPreviewId(e.target.value)} /></Lbl>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={btn('#475569')}>Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit} style={btn(canSubmit ? '#22c55e' : '#475569')}
            title="Create the dispute. Audit-logged. Documentation only.">Create</button>
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
