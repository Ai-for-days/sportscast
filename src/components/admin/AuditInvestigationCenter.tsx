import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';
import { formatDMYTime } from '../../lib/date-format';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const sevColor: Record<string, string> = { info: '#22c55e', warning: '#f59e0b', critical: '#ef4444' };
const subsystemColor: Record<string, string> = {
  wagers: '#3b82f6', resolution: '#22c55e', settlement: '#a855f7',
  integrity: '#f59e0b', incidents: '#ef4444', disputes: '#06b6d4',
  change_control: '#a855f7', evidence: '#06b6d4', certification: '#22c55e',
  rbac_review: '#0ea5e9', runbook: '#94a3b8', training: '#a855f7',
  playbook: '#22c55e', reporting: '#3b82f6', user_risk: '#f59e0b',
  exposure: '#06b6d4', security: '#ef4444', other: '#64748b',
};

const SUBSYSTEMS = [
  'wagers', 'resolution', 'settlement', 'integrity', 'incidents', 'disputes',
  'change_control', 'evidence', 'certification', 'rbac_review', 'runbook',
  'training', 'playbook', 'reporting', 'user_risk', 'exposure', 'other',
] as const;

const OBJECT_KINDS = [
  'wager', 'incident', 'dispute', 'integrity', 'settlement_preview',
  'certification', 'rbac_review', 'runbook', 'evidence', 'change_request', 'user',
] as const;

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'global' | 'object' | 'saved' | 'cross' | 'methodology';

export default function AuditInvestigationCenter() {
  const [tab, setTab] = useState<Tab>('global');
  const [timeline, setTimeline] = useState<any[]>([]);
  const [related, setRelated] = useState<any | null>(null);
  const [investigations, setInvestigations] = useState<any[]>([]);
  const [history, setHistory] = useState<any | null>(null);
  const [activeView, setActiveView] = useState<any | null>(null);
  const [eventDetail, setEventDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [wagerIdFilter, setWagerIdFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('any');
  const [subsystemFilter, setSubsystemFilter] = useState<string>('any');
  const [eventTypeFilter, setEventTypeFilter] = useState('');

  // Object history
  const [objKind, setObjKind] = useState<typeof OBJECT_KINDS[number]>('wager');
  const [objId, setObjId] = useState('');

  // Save investigation
  const [saveTitle, setSaveTitle] = useState('');
  const [saveNote, setSaveNote] = useState('');

  useEffect(() => {
    runSearch();
    listSaved();
  }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/audit-investigation?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/audit-investigation', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }

  function buildFilters(): Record<string, string> {
    const f: Record<string, string> = {};
    if (from) f.from = new Date(from).toISOString();
    if (to) f.to = new Date(to).toISOString();
    if (actorFilter.trim()) f.actor = actorFilter.trim();
    if (wagerIdFilter.trim()) f.wagerId = wagerIdFilter.trim();
    if (userIdFilter.trim()) f.userId = userIdFilter.trim();
    if (severityFilter !== 'any') f.severity = severityFilter;
    if (subsystemFilter !== 'any') f.subsystem = subsystemFilter;
    if (eventTypeFilter.trim()) f.eventType = eventTypeFilter.trim();
    return f;
  }

  async function runSearch() {
    setLoading(true); setError(null);
    try {
      const j = await get('search', { ...buildFilters(), limit: '500' });
      setTimeline(j.timeline ?? []);
      setRelated(j.relatedObjects ?? null);
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setLoading(false);
  }

  async function loadObjectHistory() {
    if (!objId.trim()) { setError('Enter an id.'); return; }
    setBusy('object'); setError(null);
    try {
      const j = await get('object-history', { kind: objKind, id: objId.trim() });
      setHistory(j.history ?? null);
      setTab('object');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function listSaved() {
    try {
      const j = await get('list-investigations');
      setInvestigations(j.investigations ?? []);
    } catch { /* ignore */ }
  }

  async function openSaved(id: string) {
    setBusy(`open-${id}`); setError(null);
    try {
      const j = await get('get-investigation', { id });
      setActiveView(j.investigation);
      setTab('saved');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function saveCurrent() {
    if (!saveTitle.trim()) { setError('Enter a title for the saved investigation.'); return; }
    setBusy('save'); setError(null);
    try {
      const filters: any = {};
      if (from) filters.from = new Date(from).toISOString();
      if (to) filters.to = new Date(to).toISOString();
      if (actorFilter.trim()) filters.actor = actorFilter.trim();
      if (wagerIdFilter.trim()) filters.wagerId = wagerIdFilter.trim();
      if (userIdFilter.trim()) filters.userId = userIdFilter.trim();
      if (severityFilter !== 'any') filters.severity = severityFilter;
      if (subsystemFilter !== 'any') filters.subsystem = subsystemFilter;
      if (eventTypeFilter.trim()) filters.eventType = eventTypeFilter.trim();

      const j = await post({
        action: 'save-investigation',
        title: saveTitle.trim(),
        filters,
        timeline,
        notes: saveNote.trim() ? [saveNote.trim()] : [],
      });
      setActiveView(j.investigation);
      setSaveTitle('');
      setSaveNote('');
      await listSaved();
      setTab('saved');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function addNoteToActive(note: string) {
    if (!activeView || !note.trim()) return;
    setBusy('note'); setError(null);
    try {
      const j = await post({ action: 'add-note', id: activeView.id, note });
      setActiveView(j.investigation);
      await listSaved();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  function clearFilters() {
    setFrom(''); setTo(''); setActorFilter(''); setWagerIdFilter(''); setUserIdFilter('');
    setSeverityFilter('any'); setSubsystemFilter('any'); setEventTypeFilter('');
  }

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/audit-investigation" /></div>

      <div style={BANNER}>
        <span>🔍 Audit Investigation is <strong>read-only</strong>. It reconstructs operational history but does not modify wagers, balances, pricing, permissions, or settlements.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Read-only · Optional saved views</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Unified Audit Investigation</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Search the platform-wide audit log, reconstruct object histories, and save investigation views with notes. Each timeline entry links to the related admin tool. Read-only across upstream sources.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/command-center" style={btn('#0ea5e9')}>Command Center →</a>
          <button type="button" onClick={runSearch} disabled={!!busy} style={btn('#6366f1')}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['global', `Global Timeline (${timeline.length})`],
          ['object', history ? `Object · ${history.kind}:${history.id.slice(0, 8)}` : 'Object History'],
          ['saved', `Saved Investigations (${investigations.length})`],
          ['cross', 'Cross-System Events'],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'global' && (
        <GlobalTimelineView
          timeline={timeline} loading={loading}
          from={from} setFrom={setFrom} to={to} setTo={setTo}
          actor={actorFilter} setActor={setActorFilter}
          wagerId={wagerIdFilter} setWagerId={setWagerIdFilter}
          userId={userIdFilter} setUserId={setUserIdFilter}
          severity={severityFilter} setSeverity={setSeverityFilter}
          subsystem={subsystemFilter} setSubsystem={setSubsystemFilter}
          eventType={eventTypeFilter} setEventType={setEventTypeFilter}
          runSearch={runSearch} clearFilters={clearFilters}
          saveTitle={saveTitle} setSaveTitle={setSaveTitle}
          saveNote={saveNote} setSaveNote={setSaveNote}
          saveCurrent={saveCurrent} busy={busy}
          openEvent={setEventDetail}
        />
      )}
      {tab === 'object' && (
        <ObjectHistoryView
          objKind={objKind} setObjKind={setObjKind}
          objId={objId} setObjId={setObjId}
          loadObjectHistory={loadObjectHistory}
          history={history} busy={busy}
          openEvent={setEventDetail}
        />
      )}
      {tab === 'saved' && (
        <SavedView
          investigations={investigations} active={activeView} setActive={setActiveView}
          openSaved={openSaved} addNote={addNoteToActive} busy={busy}
        />
      )}
      {tab === 'cross' && (
        <CrossSystemView related={related} />
      )}
      {tab === 'methodology' && <MethodologyView />}

      {eventDetail && (
        <EventDrawer event={eventDetail} onClose={() => setEventDetail(null)} />
      )}
    </div>
  );
}

// ── Global Timeline ──────────────────────────────────────────────────────────

function GlobalTimelineView(props: any) {
  const {
    timeline, loading, from, setFrom, to, setTo, actor, setActor,
    wagerId, setWagerId, userId, setUserId, severity, setSeverity,
    subsystem, setSubsystem, eventType, setEventType,
    runSearch, clearFilters, saveTitle, setSaveTitle, saveNote, setSaveNote, saveCurrent, busy,
    openEvent,
  } = props;

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Filters</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <Lbl label="From"><input type="datetime-local" style={input} value={from} onChange={e => setFrom(e.target.value)} /></Lbl>
          <Lbl label="To"><input type="datetime-local" style={input} value={to} onChange={e => setTo(e.target.value)} /></Lbl>
          <Lbl label="Actor"><input style={input} value={actor} onChange={e => setActor(e.target.value)} placeholder="actor id" /></Lbl>
          <Lbl label="Wager id"><input style={input} value={wagerId} onChange={e => setWagerId(e.target.value)} placeholder="wgr-..." /></Lbl>
          <Lbl label="User id"><input style={input} value={userId} onChange={e => setUserId(e.target.value)} placeholder="user-..." /></Lbl>
          <Lbl label="Severity">
            <select style={input} value={severity} onChange={(e: any) => setSeverity(e.target.value)}>
              <option value="any">any</option>
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>
          </Lbl>
          <Lbl label="Subsystem">
            <select style={input} value={subsystem} onChange={(e: any) => setSubsystem(e.target.value)}>
              <option value="any">any</option>
              {SUBSYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Lbl>
          <Lbl label="Event type contains"><input style={input} value={eventType} onChange={e => setEventType(e.target.value)} placeholder="e.g. wager_manually" /></Lbl>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={runSearch} disabled={!!busy} style={btn('#22c55e')}>Search</button>
          <button type="button" onClick={clearFilters} style={btn('#475569')}>Clear filters</button>
        </div>
      </div>

      {/* Save current filters as investigation */}
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Save current view</h3>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#94a3b8' }}>
          Captures the current filters + timeline + a related-objects bundle as a saved investigation. Audit-logged.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, alignItems: 'flex-end' }}>
          <Lbl label="Title"><input style={input} value={saveTitle} onChange={e => setSaveTitle(e.target.value)} placeholder="e.g. Wager wgr-xyz timeline review" /></Lbl>
          <Lbl label="Initial note (optional)"><input style={input} value={saveNote} onChange={e => setSaveNote(e.target.value)} /></Lbl>
          <div>
            <button type="button" onClick={saveCurrent} disabled={!!busy || !saveTitle.trim()} style={btn(saveTitle.trim() ? '#0ea5e9' : '#475569')}>
              {busy === 'save' ? 'Saving…' : 'Save investigation'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ ...card, color: '#94a3b8' }}>Loading timeline…</div>
      ) : timeline.length === 0 ? (
        <div style={{ ...card, color: '#94a3b8' }}>No events match the current filters.</div>
      ) : (
        <TimelineTable timeline={timeline} openEvent={openEvent} />
      )}
    </>
  );
}

// ── Object History ──────────────────────────────────────────────────────────

function ObjectHistoryView({ objKind, setObjKind, objId, setObjId, loadObjectHistory, history, busy, openEvent }: any) {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Reconstruct object history</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, alignItems: 'flex-end' }}>
          <Lbl label="Object kind">
            <select style={input} value={objKind} onChange={(e: any) => setObjKind(e.target.value)}>
              {OBJECT_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </Lbl>
          <Lbl label="Object id"><input style={input} value={objId} onChange={e => setObjId(e.target.value)} placeholder="paste id (date YYYY-MM-DD for runbook)" /></Lbl>
          <div>
            <button type="button" onClick={loadObjectHistory} disabled={!!busy || !objId.trim()} style={btn('#22c55e')}>
              {busy === 'object' ? 'Loading…' : 'Load history'}
            </button>
          </div>
        </div>
      </div>

      {!history ? (
        <div style={{ ...card, color: '#94a3b8' }}>Pick an object kind, enter its id, and click Load history.</div>
      ) : (
        <>
          <div style={card}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={badge('#0ea5e9')}>{history.kind}</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>{history.id}</span>
            </div>
            {history.object ? (
              <pre style={{ margin: 0, padding: 10, background: '#0f172a', borderRadius: 6, fontSize: 11, color: '#cbd5e1', maxHeight: 300, overflow: 'auto' }}>
                {JSON.stringify(history.object, null, 2)}
              </pre>
            ) : (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>Object not found in the relevant store. Timeline entries below come from the audit log only.</div>
            )}
          </div>

          {history.timeline.length === 0 ? (
            <div style={{ ...card, color: '#94a3b8' }}>No audit events for this object.</div>
          ) : (
            <TimelineTable timeline={history.timeline} openEvent={openEvent} />
          )}
        </>
      )}
    </>
  );
}

// ── Saved Investigations ────────────────────────────────────────────────────

function SavedView({ investigations, active, setActive, openSaved, addNote, busy }: any) {
  const [noteDraft, setNoteDraft] = useState('');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Saved ({investigations.length})</h3>
        {investigations.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No saved investigations yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {investigations.map((v: any) => (
              <button key={v.id} type="button" onClick={() => openSaved(v.id)}
                style={{
                  ...tile, textAlign: 'left', cursor: 'pointer',
                  border: v.id === active?.id ? '1px solid #6366f1' : '1px solid #1e293b',
                  background: v.id === active?.id ? '#312e81' : '#0f172a',
                }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{v.title}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{(v.timeline ?? []).length} entries · {(v.savedNotes ?? []).length} notes</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{formatDMYTime(v.createdAt)} · {v.createdBy}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        {!active ? (
          <div style={{ ...card, color: '#94a3b8' }}>Pick a saved investigation on the left.</div>
        ) : (
          <>
            <div style={card}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>{active.title}</h2>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Created {formatDMYTime(active.createdAt)} by {active.createdBy} · id <code>{active.id}</code>
              </div>
              {active.filters && Object.keys(active.filters).length > 0 && (
                <pre style={{ margin: '8px 0 0', padding: 8, background: '#0f172a', borderRadius: 6, fontSize: 11, color: '#cbd5e1' }}>
                  {JSON.stringify(active.filters, null, 2)}
                </pre>
              )}
            </div>

            {(active.savedNotes ?? []).length > 0 && (
              <div style={card}>
                <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Notes ({active.savedNotes.length})</h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
                  {active.savedNotes.map((n: string, idx: number) => <li key={idx} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{n}</li>)}
                </ul>
              </div>
            )}

            <div style={card}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Add note</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Append a timestamped note (audit-logged)" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} />
                <button type="button" onClick={() => { addNote(noteDraft); setNoteDraft(''); }} disabled={!!busy || !noteDraft.trim()} style={btn('#6366f1')}>Add note</button>
              </div>
            </div>

            {(active.timeline ?? []).length === 0 ? (
              <div style={{ ...card, color: '#94a3b8' }}>No timeline entries captured.</div>
            ) : (
              <TimelineTable timeline={active.timeline} openEvent={() => {}} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Cross-system view ───────────────────────────────────────────────────────

function CrossSystemView({ related }: { related: any }) {
  if (!related) return <div style={{ ...card, color: '#94a3b8' }}>Run a search on the Global Timeline tab to populate cross-system data.</div>;
  const sections: { key: keyof typeof related; label: string; href: string }[] = [
    { key: 'wagers', label: 'Wagers', href: '/admin/wagers' },
    { key: 'incidents', label: 'Incidents', href: '/admin/system/incident-management' },
    { key: 'disputes', label: 'Disputes', href: '/admin/system/dispute-workflow' },
    { key: 'integrityReports', label: 'Integrity reports', href: '/admin/system/market-integrity' },
    { key: 'settlementPreviews', label: 'Settlement previews', href: '/admin/system/wager-settlement-preview' },
    { key: 'certifications', label: 'Certifications', href: '/admin/system/operator-certification' },
    { key: 'rbacReviews', label: 'RBAC reviews', href: '/admin/system/operator-rbac-review' },
    { key: 'runbooks', label: 'Runbooks', href: '/admin/system/daily-operator-runbook' },
    { key: 'evidence', label: 'Weather evidence', href: '/admin/system/weather-evidence' },
    { key: 'changeRequests', label: 'Change requests', href: '/admin/system/wager-change-control' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
      {sections.map(s => (
        <div key={s.key as string} style={{ ...tile, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{s.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>{(related[s.key] ?? []).length}</div>
          <a href={s.href} style={{ ...btn('#475569'), alignSelf: 'flex-start' }}>Open {s.label} →</a>
        </div>
      ))}
    </div>
  );
}

// ── Timeline table ──────────────────────────────────────────────────────────

function TimelineTable({ timeline, openEvent }: { timeline: any[]; openEvent: (e: any) => void }) {
  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>When</th><th style={th}>Subsystem</th><th style={th}>Severity</th>
              <th style={th}>Event</th><th style={th}>Actor</th><th style={th}>Target</th>
              <th style={th}>Summary</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((e: any) => (
              <tr key={e.id}>
                <td style={td}>{formatDMYTime(e.at)}</td>
                <td style={td}><span style={badge(subsystemColor[e.subsystem] ?? '#64748b')}>{e.category}</span></td>
                <td style={td}><span style={badge(sevColor[e.severity])}>{e.severity}</span></td>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{e.eventType}</td>
                <td style={td}>{e.actor ?? '—'}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>
                  {e.relatedObjectType ? `${e.relatedObjectType}:${(e.relatedObjectId ?? '').slice(0, 12)}` : '—'}
                </td>
                <td style={{ ...td, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.summary}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => openEvent(e)} style={{ ...btn('#475569'), padding: '4px 10px' }}>View</button>
                  {linkForTarget(e) && (
                    <a href={linkForTarget(e)!} style={{ ...btn('#0ea5e9'), padding: '4px 10px', marginLeft: 4 }}>Open →</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function linkForTarget(e: any): string | null {
  const subsystemRouteMap: Record<string, string> = {
    wagers: '/admin/wagers',
    resolution: '/admin/system/wager-resolution',
    settlement: '/admin/system/wager-settlement-preview',
    integrity: '/admin/system/market-integrity',
    incidents: '/admin/system/incident-management',
    disputes: '/admin/system/dispute-workflow',
    change_control: '/admin/system/wager-change-control',
    evidence: '/admin/system/weather-evidence',
    certification: '/admin/system/operator-certification',
    rbac_review: '/admin/system/operator-rbac-review',
    runbook: '/admin/system/daily-operator-runbook',
    training: '/admin/system/operator-training',
    playbook: '/admin/system/execution-playbook',
    reporting: '/admin/system/strategy-brief',
    user_risk: '/admin/system/user-risk-monitoring',
    exposure: '/admin/system/house-exposure',
  };
  return subsystemRouteMap[e.subsystem] ?? null;
}

// ── Event drawer ────────────────────────────────────────────────────────────

function EventDrawer({ event, onClose }: { event: any; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: 20 }}
      onClick={onClose}>
      <div onClick={(e: any) => e.stopPropagation()}
        style={{ background: '#1e293b', borderRadius: 8, maxWidth: 800, width: '100%', padding: 20, color: '#e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, fontFamily: 'ui-monospace, Menlo, monospace' }}>{event.eventType}</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={badge(subsystemColor[event.subsystem] ?? '#64748b')}>{event.category}</span>
          <span style={badge(sevColor[event.severity])}>{event.severity}</span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{formatDMYTime(event.at)}</span>
          {event.actor && <span style={{ fontSize: 11, color: '#94a3b8' }}>by {event.actor}</span>}
        </div>
        <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 10 }}>{event.summary}</div>
        {event.relatedObjectType && (
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
            Target: <code>{event.relatedObjectType}:{event.relatedObjectId}</code>
          </div>
        )}
        <pre style={{ margin: 0, padding: 10, background: '#0f172a', borderRadius: 6, fontSize: 11, color: '#cbd5e1', maxHeight: 400, overflow: 'auto' }}>
          {JSON.stringify(event.rawEventReference ?? event, null, 2)}
        </pre>
        {linkForTarget(event) && (
          <div style={{ marginTop: 10 }}>
            <a href={linkForTarget(event)!} style={btn('#0ea5e9')}>Open in {event.category} →</a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Methodology ──────────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>How the timeline works</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Events come from the platform-wide audit log (capped at 500 entries). Each event is enriched with an inferred subsystem and severity.</li>
          <li>Subsystem inference uses event-type prefix (<code>wager_</code>, <code>incident_</code>, <code>dispute_</code>, etc.) — see the lib for the full table.</li>
          <li>Severity inference: explicit revoke / breach / void / critical event types → <strong>critical</strong>. Reject / expired / warning / cancelled / alert → <strong>warning</strong>. Otherwise <strong>info</strong>.</li>
          <li>Filters: date range, actor, wager id, user id, severity, subsystem, event-type substring.</li>
          <li>Object history loads the underlying record (wager, incident, dispute, integrity report, settlement preview, certification, RBAC review, runbook, evidence, change request) plus all events that reference it.</li>
          <li>Saved investigations capture the filters + timeline + a related-objects bundle so the snapshot is reproducible. Notes can be appended any time and are audit-logged.</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Read-only across upstream sources. The lib only imports <code>getRedis</code>, <code>logAuditEvent</code>, <code>listAuditEvents</code>, and read-only lookups (<code>getWager</code>, <code>getIncident</code>, etc.).</li>
          <li>No wager mutation, no settlement, no balance change, no RBAC mutation, no pricing change, no grading or voiding.</li>
          <li>Saved investigations only persist filters / timeline snapshots / notes — they don't reference upstream objects mutably.</li>
          <li>Writes confined to <code>audit-investigation:&#123;id&#125;</code> + <code>audit-investigations:all</code> plus the audit log.</li>
          <li>Audit events: <code>audit_investigation_saved</code>, <code>audit_investigation_note_added</code>.</li>
        </ul>
      </div>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Lbl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 11, color: '#94a3b8' }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}
