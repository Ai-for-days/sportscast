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
  open: '#3b82f6', investigating: '#a855f7', monitoring: '#f59e0b', resolved: '#22c55e', closed: '#64748b',
};
const categoryColor: Record<string, string> = {
  market_design: '#06b6d4', pricing: '#a855f7', grading: '#22c55e', settlement_preview: '#f59e0b',
  integrity: '#ef4444', operator_governance: '#3b82f6', system: '#06b6d4', other: '#64748b',
};
const categoryLabel: Record<string, string> = {
  market_design: 'Market Design', pricing: 'Pricing', grading: 'Grading',
  settlement_preview: 'Settlement Preview', integrity: 'Integrity',
  operator_governance: 'Operator Governance', system: 'System', other: 'Other',
};

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'investigating', 'monitoring', 'resolved', 'closed'] as const;
const CATEGORIES = ['market_design', 'pricing', 'grading', 'settlement_preview', 'integrity', 'operator_governance', 'system', 'other'] as const;

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'open' | 'detail' | 'severity' | 'history' | 'methodology';

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
  const ms = Date.now() - new Date(createdAt).getTime();
  const h = ms / 3_600_000;
  // SLA-style: critical 4h, high 24h, medium 72h, low 7d
  const sla = severity === 'critical' ? 4 : severity === 'high' ? 24 : severity === 'medium' ? 72 : 168;
  if (h > sla) return '#ef4444';
  if (h > sla * 0.5) return '#f59e0b';
  return '#22c55e';
}

export default function IncidentManagementCenter() {
  const [tab, setTab] = useState<Tab>('open');
  const [summary, setSummary] = useState<any>(null);
  const [openList, setOpenList] = useState<any[]>([]);
  const [allList, setAllList] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Filters for severity dashboard
  const [filterStatus, setFilterStatus] = useState<string>('any');
  const [filterSeverity, setFilterSeverity] = useState<string>('any');
  const [filterCategory, setFilterCategory] = useState<string>('any');

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/incident-management?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/incident-management', {
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
      const [summaryRes, allRes] = await Promise.all([get('summary'), get('list', { limit: '500' })]);
      setSummary(summaryRes.summary);
      setOpenList(summaryRes.open ?? []);
      const all = allRes.incidents ?? [];
      setAllList(all);
      setHistory(all.filter((i: any) => i.status === 'resolved' || i.status === 'closed'));
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function openIncident(id: string) {
    setBusy(`open-${id}`); setError(null);
    try {
      const j = await get('get', { id });
      setActive(j.incident);
      setTab('detail');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function createIncident(payload: any) {
    setBusy('create'); setError(null);
    try {
      const j = await post({ action: 'create', ...payload });
      setActive(j.incident);
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
      setActive(j.incident);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function addNote(id: string, note: string) {
    if (!note.trim()) return;
    setBusy(`note-${id}`); setError(null);
    try {
      const j = await post({ action: 'add-timeline-entry', id, note });
      setActive(j.incident);
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function resolve(id: string, resolutionSummary: string) {
    if (!resolutionSummary.trim()) return;
    const ok = window.confirm('Resolve this incident? Resolution requires a written summary and is audit-logged. Does not change wagers, balances, or RBAC.');
    if (!ok) return;
    setBusy(`resolve-${id}`); setError(null);
    try {
      const j = await post({ action: 'resolve', id, resolutionSummary });
      setActive(j.incident);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function close(id: string, note?: string) {
    const ok = window.confirm('Close this incident? Closing is reversible (you can reopen → open) but typically signals the case is done.');
    if (!ok) return;
    setBusy(`close-${id}`); setError(null);
    try {
      const j = await post({ action: 'close', id, note });
      setActive(j.incident);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading incident management…</div>;
  if (!summary) return null;

  const filteredAll = useMemo(() => {
    return allList.filter(i =>
      (filterStatus === 'any' || i.status === filterStatus) &&
      (filterSeverity === 'any' || i.severity === filterSeverity) &&
      (filterCategory === 'any' || i.category === filterCategory),
    );
  }, [allList, filterStatus, filterSeverity, filterCategory]);

  const criticalOpen = openList.filter((i: any) => i.severity === 'critical');

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/incident-management" /></div>

      <div style={BANNER}>
        <span>📋 Incident Management records and tracks operational issues only. It does <strong>not</strong> automatically change wagers, balances, pricing, or permissions.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Audit-logged · Workflow only</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Incident & Exception Management</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Record, triage, investigate, and resolve operational incidents — across market design, pricing, grading, settlement, integrity, and governance. Documentation only.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/command-center" style={btn('#0ea5e9')}>Command Center →</a>
          <a href="/admin/system/dispute-workflow" style={btn('#0ea5e9')}
             title="Open the dispute workflow. Recommendations are advisory only.">Disputes →</a>
          <button type="button" onClick={() => setShowCreate(true)} style={btn('#22c55e')}
            title="Create a new incident record. Status starts as 'open'.">+ Create Incident</button>
          <button type="button" onClick={reload} disabled={!!busy} style={btn('#6366f1')}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      {criticalOpen.length > 0 && (
        <div style={{ ...card, background: '#3f1d1d', borderLeft: '4px solid #dc2626' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>
              🚨 {criticalOpen.length} unresolved critical incident{criticalOpen.length === 1 ? '' : 's'}
            </h3>
            <span style={{ fontSize: 12, color: '#fca5a5' }}>Address before routine work.</span>
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {criticalOpen.slice(0, 5).map((i: any) => (
              <li key={i.id}>
                <button type="button" onClick={() => openIncident(i.id)}
                  style={{ background: 'none', border: 'none', color: '#fecaca', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 12 }}>
                  {i.title}
                </button>
                <span style={{ marginLeft: 6, color: '#fca5a5' }}>· {ageString(i.createdAt)} old · {i.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Total"          value={summary.total} />
          <Stat label="Open"           value={summary.openCount}     color="#3b82f6" />
          <Stat label="Critical (open)" value={summary.criticalOpen} color="#ef4444" />
          <Stat label="Resolved"       value={summary.byStatus.resolved} color="#22c55e" />
          <Stat label="Closed"         value={summary.byStatus.closed}   color="#64748b" />
          <Stat label="Median age"     value={summary.ageMs.medianActive == null ? '—' : msToHuman(summary.ageMs.medianActive)} />
          <Stat label="Max age"        value={summary.ageMs.maxActive == null ? '—' : msToHuman(summary.ageMs.maxActive)} color={(summary.ageMs.maxActive ?? 0) > 24 * 3_600_000 ? '#f59e0b' : undefined} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['open',        `Open (${summary.openCount})`],
          ['detail',      active ? `Detail · ${active.id}` : 'Incident Detail'],
          ['severity',    'Severity Dashboard'],
          ['history',     `Resolution History (${history.length})`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'open' && <OpenView openList={openList} openIncident={openIncident} busy={busy} />}
      {tab === 'detail' && (
        <DetailView
          incident={active}
          changeStatus={changeStatus}
          addNote={addNote}
          resolve={resolve}
          close={close}
          busy={busy}
        />
      )}
      {tab === 'severity' && (
        <SeverityView
          summary={summary} all={allList} filtered={filteredAll}
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          filterSeverity={filterSeverity} setFilterSeverity={setFilterSeverity}
          filterCategory={filterCategory} setFilterCategory={setFilterCategory}
          openIncident={openIncident}
        />
      )}
      {tab === 'history' && <HistoryView history={history} openIncident={openIncident} />}
      {tab === 'methodology' && <MethodologyView />}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onSubmit={createIncident}
          busy={busy === 'create'}
        />
      )}
    </div>
  );
}

// ── Open Incidents ───────────────────────────────────────────────────────────

function OpenView({ openList, openIncident, busy }: any) {
  if (!openList || openList.length === 0) {
    return (
      <div style={{ ...card, color: '#22c55e' }}>
        ✓ No open incidents. Create one with <strong>+ Create Incident</strong> if a problem needs tracking.
      </div>
    );
  }
  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Category</th>
              <th style={th}>Title</th><th style={th}>Age</th><th style={th}>Created by</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {openList.map((i: any) => (
              <tr key={i.id}>
                <td style={td}><span style={badge(sevColor[i.severity])}>{i.severity}</span></td>
                <td style={td}><span style={badge(statusColor[i.status])}>{i.status}</span></td>
                <td style={td}><span style={badge(categoryColor[i.category])}>{categoryLabel[i.category]}</span></td>
                <td style={td}>{i.title}</td>
                <td style={td}><span style={badge(ageBadgeColor(i.createdAt, i.severity))}>{ageString(i.createdAt)}</span></td>
                <td style={td}>{i.createdBy}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => openIncident(i.id)} disabled={!!busy}
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

function DetailView({ incident, changeStatus, addNote, resolve, close, busy }: any) {
  const [noteDraft, setNoteDraft] = useState('');
  const [resolutionDraft, setResolutionDraft] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [statusNote, setStatusNote] = useState('');

  if (!incident) {
    return (
      <div style={{ ...card, color: '#94a3b8' }}>
        Pick an incident from the <strong>Open</strong> tab, the <strong>Severity Dashboard</strong>, or <strong>Resolution History</strong>.
      </div>
    );
  }

  const i = incident;
  const isTerminal = i.status === 'closed';

  return (
    <>
      <div style={{ ...card, borderLeft: `4px solid ${sevColor[i.severity]}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{i.title}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={badge(sevColor[i.severity])}>{i.severity}</span>
            <span style={badge(statusColor[i.status])}>{i.status}</span>
            <span style={badge(categoryColor[i.category])}>{categoryLabel[i.category]}</span>
            <span style={badge(ageBadgeColor(i.createdAt, i.severity))}>{ageString(i.createdAt)} old</span>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{i.description}</div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          <Field label="Incident id" value={i.id} mono />
          <Field label="Created" value={`${new Date(i.createdAt).toLocaleString()} · ${i.createdBy}`} />
          {i.resolutionConfirmedAt && <Field label="Resolved" value={`${new Date(i.resolutionConfirmedAt).toLocaleString()} · ${i.resolutionConfirmedBy ?? '—'}`} />}
          {i.closedAt && <Field label="Closed" value={`${new Date(i.closedAt).toLocaleString()} · ${i.closedBy ?? '—'}`} />}
        </div>
      </div>

      {/* Related links */}
      {(i.relatedWagerId || i.relatedOperatorId || i.relatedIntegrityReportId
        || i.relatedSettlementPreviewId || i.relatedCertificationId
        || i.relatedRbacReviewId || i.relatedRunbookDate || i.relatedEodReportDate) && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Related objects (read-only links)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {i.relatedWagerId && <RelatedLink label="Wager" id={i.relatedWagerId} href={`/admin/wagers`} />}
            {i.relatedOperatorId && <RelatedLink label="Operator" id={i.relatedOperatorId} href={`/admin/system/operator-certification`} />}
            {i.relatedIntegrityReportId && <RelatedLink label="Integrity report" id={i.relatedIntegrityReportId} href={`/admin/system/market-integrity`} />}
            {i.relatedSettlementPreviewId && <RelatedLink label="Settlement preview" id={i.relatedSettlementPreviewId} href={`/admin/system/wager-settlement-preview`} />}
            {i.relatedCertificationId && <RelatedLink label="Certification" id={i.relatedCertificationId} href={`/admin/system/operator-certification`} />}
            {i.relatedRbacReviewId && <RelatedLink label="RBAC review" id={i.relatedRbacReviewId} href={`/admin/system/operator-rbac-review`} />}
            {i.relatedRunbookDate && <RelatedLink label="Runbook" id={i.relatedRunbookDate} href={`/admin/system/daily-operator-runbook`} />}
            {i.relatedEodReportDate && <RelatedLink label="EOD report" id={i.relatedEodReportDate} href={`/admin/system/end-of-day-report`} />}
          </div>
        </div>
      )}

      {/* Tags */}
      {(i.tags ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Tags</h3>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {i.tags.map((t: string) => <span key={t} style={{ ...badge('#334155') }}>{t}</span>)}
          </div>
        </div>
      )}

      {/* Follow-up + warnings */}
      {((i.followUpActions ?? []).length > 0 || (i.warnings ?? []).length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {(i.followUpActions ?? []).length > 0 && (
            <div style={card}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Follow-up actions</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
                {i.followUpActions.map((a: string, idx: number) => <li key={idx}>{a}</li>)}
              </ul>
            </div>
          )}
          {(i.warnings ?? []).length > 0 && (
            <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#fbbf24' }}>Warnings</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fbbf24' }}>
                {i.warnings.map((w: string, idx: number) => <li key={idx}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Resolution summary */}
      {i.resolutionSummary && (
        <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#86efac' }}>Resolution summary</h3>
          <div style={{ fontSize: 13, color: '#dcfce7', whiteSpace: 'pre-wrap' }}>{i.resolutionSummary}</div>
        </div>
      )}

      {/* Timeline */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Timeline ({(i.timeline ?? []).length})</h3>
        {(i.timeline ?? []).length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No entries.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {i.timeline.map((e: any, idx: number) => (
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
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Add timeline note (audit-logged)" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} />
              <button type="button" onClick={() => { addNote(i.id, noteDraft); setNoteDraft(''); }} disabled={!!busy || !noteDraft.trim()} style={btn('#6366f1')}
                title="Append a note to the timeline. Does not change wagers, balances, or RBAC.">Add note</button>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional status-change note" value={statusNote} onChange={e => setStatusNote(e.target.value)} />
              {(['open', 'investigating', 'monitoring'] as const).filter(s => s !== i.status).map(s => (
                <button key={s} type="button" onClick={() => { changeStatus(i.id, s, statusNote); setStatusNote(''); }} disabled={!!busy} style={btn(statusColor[s])}
                  title={`Move incident status to ${s}. Adds a timeline entry.`}>
                  → {s}
                </button>
              ))}
            </div>

            {i.status !== 'resolved' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Resolution summary (required to resolve)" value={resolutionDraft} onChange={e => setResolutionDraft(e.target.value)} />
                <button type="button" onClick={() => { resolve(i.id, resolutionDraft); setResolutionDraft(''); }} disabled={!!busy || !resolutionDraft.trim()} style={btn('#22c55e')}
                  title="Mark resolved. Requires a written summary. Does not change wagers, balances, or RBAC.">Resolve</button>
              </div>
            )}

            {i.status === 'resolved' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional close note" value={closeNote} onChange={e => setCloseNote(e.target.value)} />
                <button type="button" onClick={() => { close(i.id, closeNote); setCloseNote(''); }} disabled={!!busy} style={btn('#64748b')}
                  title="Close the incident. Reversible — you can reopen → open if needed.">Close</button>
                <button type="button" onClick={() => changeStatus(i.id, 'open', 'reopened')} disabled={!!busy} style={btn('#3b82f6')}
                  title="Reopen the incident. Clears the resolution summary.">Reopen</button>
              </div>
            )}
          </div>
        </div>
      )}

      {isTerminal && (
        <div style={{ ...card, color: '#94a3b8', fontSize: 13 }}>
          ✓ Incident is closed{i.closedAt ? ` (${new Date(i.closedAt).toLocaleString()})` : ''}. Reopen via Resolution History if needed.
        </div>
      )}
    </>
  );
}

// ── Severity Dashboard ───────────────────────────────────────────────────────

function SeverityView({ summary, filtered, filterStatus, setFilterStatus, filterSeverity, setFilterSeverity, filterCategory, setFilterCategory, openIncident }: any) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>By severity</h3>
          {SEVERITIES.map(s => (
            <div key={s} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
              <span><span style={badge(sevColor[s])}>{s}</span></span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{summary.bySeverity[s] ?? 0}</span>
            </div>
          ))}
        </div>
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>By status</h3>
          {STATUSES.map(s => (
            <div key={s} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
              <span><span style={badge(statusColor[s])}>{s}</span></span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{summary.byStatus[s] ?? 0}</span>
            </div>
          ))}
        </div>
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>By category</h3>
          {CATEGORIES.map(c => (
            <div key={c} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
              <span><span style={badge(categoryColor[c])}>{categoryLabel[c]}</span></span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{summary.byCategory[c] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Status
            <select value={filterStatus} onChange={(e: any) => setFilterStatus(e.target.value)} style={{ ...input, marginLeft: 6 }}>
              <option value="any">any</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No incidents match the current filter.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Category</th>
                  <th style={th}>Title</th><th style={th}>Age</th><th style={th}>Created by</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i: any) => (
                  <tr key={i.id}>
                    <td style={td}><span style={badge(sevColor[i.severity])}>{i.severity}</span></td>
                    <td style={td}><span style={badge(statusColor[i.status])}>{i.status}</span></td>
                    <td style={td}><span style={badge(categoryColor[i.category])}>{categoryLabel[i.category]}</span></td>
                    <td style={td}>{i.title}</td>
                    <td style={td}><span style={badge(ageBadgeColor(i.createdAt, i.severity))}>{ageString(i.createdAt)}</span></td>
                    <td style={td}>{i.createdBy}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => openIncident(i.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Resolution History ───────────────────────────────────────────────────────

function HistoryView({ history, openIncident }: any) {
  if (!history || history.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No resolved or closed incidents yet.</div>;
  }
  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Status</th><th style={th}>Severity</th><th style={th}>Title</th>
              <th style={th}>Resolved</th><th style={th}>By</th><th style={th}>Resolution</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {history.map((i: any) => (
              <tr key={i.id}>
                <td style={td}><span style={badge(statusColor[i.status])}>{i.status}</span></td>
                <td style={td}><span style={badge(sevColor[i.severity])}>{i.severity}</span></td>
                <td style={td}>{i.title}</td>
                <td style={td}>{i.resolutionConfirmedAt ? new Date(i.resolutionConfirmedAt).toLocaleString() : '—'}</td>
                <td style={td}>{i.resolutionConfirmedBy ?? '—'}</td>
                <td style={{ ...td, fontSize: 11, color: '#cbd5e1', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i.resolutionSummary ?? '—'}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => openIncident(i.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
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
          <li><strong>open</strong> → investigating, monitoring, or resolved (with summary).</li>
          <li><strong>investigating</strong> → monitoring, resolved (with summary), or back to open.</li>
          <li><strong>monitoring</strong> → resolved (with summary), back to investigating, or back to open.</li>
          <li><strong>resolved</strong> → closed, or reopen → open (clears resolution summary).</li>
          <li><strong>closed</strong> → terminal. To act on a closed incident, reopen it from Resolution History.</li>
        </ul>
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
          <li>No wager mutation. The lib only imports <code>getRedis</code> and <code>logAuditEvent</code>.</li>
          <li>No settlement / balance / payout logic.</li>
          <li>No RBAC mutation.</li>
          <li>No pricing mutation.</li>
          <li>No auto-enforcement. Status transitions, resolutions, and closures are all explicit operator clicks.</li>
          <li>Writes confined to <code>incident:&#123;id&#125;</code>, <code>incidents:all</code>, <code>incidents:open</code>, <code>incidents:by-severity:&#123;severity&#125;</code>, plus the audit log.</li>
          <li>Audit events: <code>incident_created</code>, <code>incident_status_changed</code>, <code>incident_resolved</code>, <code>incident_closed</code>, <code>incident_timeline_entry_added</code>.</li>
        </ul>
      </div>
    </>
  );
}

// ── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (payload: any) => void; busy: boolean }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('other');
  const [severity, setSeverity] = useState<typeof SEVERITIES[number]>('medium');
  const [tags, setTags] = useState('');
  const [relatedWagerId, setRelatedWagerId] = useState('');
  const [relatedIntegrityReportId, setRelatedIntegrityReportId] = useState('');
  const [relatedSettlementPreviewId, setRelatedSettlementPreviewId] = useState('');
  const [relatedRbacReviewId, setRelatedRbacReviewId] = useState('');
  const [relatedCertificationId, setRelatedCertificationId] = useState('');
  const [relatedOperatorId, setRelatedOperatorId] = useState('');
  const [relatedRunbookDate, setRelatedRunbookDate] = useState('');
  const [relatedEodReportDate, setRelatedEodReportDate] = useState('');
  const [followUp, setFollowUp] = useState('');

  const canSubmit = !!title.trim() && !!description.trim() && !busy;

  function submit() {
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      category, severity,
      tags: tags.split(',').map(s => s.trim()).filter(Boolean),
      relatedWagerId: relatedWagerId.trim() || undefined,
      relatedIntegrityReportId: relatedIntegrityReportId.trim() || undefined,
      relatedSettlementPreviewId: relatedSettlementPreviewId.trim() || undefined,
      relatedRbacReviewId: relatedRbacReviewId.trim() || undefined,
      relatedCertificationId: relatedCertificationId.trim() || undefined,
      relatedOperatorId: relatedOperatorId.trim() || undefined,
      relatedRunbookDate: relatedRunbookDate.trim() || undefined,
      relatedEodReportDate: relatedEodReportDate.trim() || undefined,
      followUpActions: followUp.split('\n').map(s => s.trim()).filter(Boolean),
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: 20 }}
      onClick={onClose}>
      <div onClick={(e: any) => e.stopPropagation()}
        style={{ background: '#1e293b', borderRadius: 8, maxWidth: 800, width: '100%', padding: 20, color: '#e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Create incident</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8' }}>
          Documentation only. Creates an incident record with status <code>open</code>. Does not change wagers, balances, or RBAC.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Title *
            <input style={{ ...input, width: '100%', marginTop: 4 }} value={title} onChange={e => setTitle(e.target.value)} />
          </label>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Category
            <select value={category} onChange={(e: any) => setCategory(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }}>
              {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel[c]}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Severity
            <select value={severity} onChange={(e: any) => setSeverity(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }}>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 8 }}>
          Description *
          <textarea rows={4} style={{ ...input, width: '100%', marginTop: 4, fontFamily: 'inherit', resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} />
        </label>
        <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 8 }}>
          Tags (comma-separated)
          <input style={{ ...input, width: '100%', marginTop: 4 }} value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. clt, snowfall, rebate" />
        </label>

        <div style={{ marginTop: 8, marginBottom: 6, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Related (optional)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <RelInput label="Wager id" value={relatedWagerId} onChange={setRelatedWagerId} />
          <RelInput label="Integrity report id" value={relatedIntegrityReportId} onChange={setRelatedIntegrityReportId} />
          <RelInput label="Settlement preview id" value={relatedSettlementPreviewId} onChange={setRelatedSettlementPreviewId} />
          <RelInput label="RBAC review id" value={relatedRbacReviewId} onChange={setRelatedRbacReviewId} />
          <RelInput label="Certification id" value={relatedCertificationId} onChange={setRelatedCertificationId} />
          <RelInput label="Operator id" value={relatedOperatorId} onChange={setRelatedOperatorId} />
          <RelInput label="Runbook date (YYYY-MM-DD)" value={relatedRunbookDate} onChange={setRelatedRunbookDate} />
          <RelInput label="EOD report date (YYYY-MM-DD)" value={relatedEodReportDate} onChange={setRelatedEodReportDate} />
        </div>

        <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginTop: 8 }}>
          Follow-up actions (one per line)
          <textarea rows={3} style={{ ...input, width: '100%', marginTop: 4, fontFamily: 'inherit', resize: 'vertical' }} value={followUp} onChange={e => setFollowUp(e.target.value)} />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={btn('#475569')}>Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit} style={btn(canSubmit ? '#22c55e' : '#475569')}
            title="Create the incident with status open. Audit-logged.">Create</button>
        </div>
      </div>
    </div>
  );
}

function RelInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ fontSize: 11, color: '#94a3b8' }}>
      {label}
      <input style={{ ...input, width: '100%', marginTop: 4 }} value={value} onChange={e => onChange(e.target.value)} />
    </label>
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

function RelatedLink({ label, id, href }: { label: string; id: string; href: string }) {
  return (
    <a href={href} style={{ ...tile, textDecoration: 'none', color: '#e2e8f0', display: 'block' }}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all' }}>{id}</div>
      <div style={{ fontSize: 11, color: '#0ea5e9', marginTop: 4 }}>{href} →</div>
    </a>
  );
}

function msToHuman(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}
