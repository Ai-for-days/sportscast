import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13, verticalAlign: 'top' };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const sevColor: Record<string, string> = { info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444' };
const statusColor: Record<string, string> = { unread: '#6366f1', read: '#64748b', acknowledged: '#22c55e', dismissed: '#475569' };

const SOURCES = [
  'operational_health', 'incident', 'dispute', 'market_integrity',
  'house_exposure', 'settlement_preview', 'operator_certification',
  'rbac_review', 'daily_runbook', 'weather_evidence', 'change_control', 'system',
] as const;

const SOURCE_LABEL: Record<string, string> = {
  operational_health: 'Operational Health',
  incident: 'Incident',
  dispute: 'Dispute',
  market_integrity: 'Market Integrity',
  house_exposure: 'House Exposure',
  settlement_preview: 'Settlement Preview',
  operator_certification: 'Certification',
  rbac_review: 'RBAC Review',
  daily_runbook: 'Daily Runbook',
  weather_evidence: 'Weather Evidence',
  change_control: 'Change Control',
  system: 'System',
};

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #1e3a8a, #3730a3)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'inbox' | 'critical' | 'by-source' | 'archive' | 'methodology';

export default function AdminNotificationInbox() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('any');
  const [severityFilter, setSeverityFilter] = useState<string>('any');
  const [sourceFilter, setSourceFilter] = useState<string>('any');
  const [drawerNote, setDrawerNote] = useState('');

  useEffect(() => { reloadAll(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/admin-notification-inbox?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/admin-notification-inbox', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }

  async function reloadAll() {
    setLoading(true); setError(null);
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'any') params.status = statusFilter;
      if (severityFilter !== 'any') params.severity = severityFilter;
      if (sourceFilter !== 'any') params.source = sourceFilter;
      const [list, sum] = await Promise.all([
        get('list', params),
        get('summary'),
      ]);
      setNotifications(list.notifications ?? []);
      setSummary(sum.summary ?? null);
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setLoading(false);
  }

  useEffect(() => { reloadAll(); }, [statusFilter, severityFilter, sourceFilter]);

  async function generateDigest() {
    setBusy('digest'); setError(null); setInfo(null);
    try {
      const j = await post({ action: 'generate-digest' });
      const r = j.result ?? {};
      setInfo(`Digest generated — ${r.created?.length ?? 0} new, ${r.skippedDuplicates ?? 0} skipped duplicate(s), ${r.errors?.length ?? 0} source error(s).`);
      await reloadAll();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function action(act: string, id: string, extra: Record<string, any> = {}) {
    setBusy(act); setError(null);
    try {
      const j = await post({ action: act, id, ...extra });
      // Refresh details + list
      if (j.notification) setSelected(j.notification);
      await reloadAll();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  const visibleByTab = useMemo(() => {
    if (tab === 'critical') return notifications.filter(n => n.severity === 'critical' && n.status !== 'dismissed');
    if (tab === 'archive') return notifications.filter(n => n.status === 'acknowledged' || n.status === 'dismissed');
    return notifications;
  }, [notifications, tab]);

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}><SystemNav activeHref="/admin/system/admin-notification-inbox" /></div>

      <div style={BANNER}>
        <span>📬 Admin Inbox is advisory only. It does not send external notifications or perform corrective actions automatically.</span>
        <a href="/admin/system/command-center" style={{ ...btn('rgba(255,255,255,0.15)'), color: '#fff' }}>Command Center →</a>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800 }}>Admin Notification Inbox</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            One internal inbox that aggregates advisory alerts from operational health, incidents, disputes, integrity, exposure,
            settlement preview, certifications, RBAC reviews, runbooks, weather evidence, and change control.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={reloadAll} disabled={loading} style={btn('#475569')}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" onClick={generateDigest} disabled={busy === 'digest'} style={btn('#22c55e')}>
            {busy === 'digest' ? 'Scanning…' : 'Generate Digest'}
          </button>
        </div>
      </div>

      {/* Counters */}
      {summary && (
        <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Counter label="Unread" value={summary.unread ?? 0} color={sevColor.info} />
          <Counter label="Critical unread" value={summary.criticalUnread ?? 0} color={sevColor.critical} />
          <Counter label="Warning unread" value={summary.warningUnread ?? 0} color={sevColor.warning} />
          <Counter label="Acknowledged" value={summary.acknowledged ?? 0} color={statusColor.acknowledged} />
          <Counter label="Dismissed" value={summary.dismissed ?? 0} color={statusColor.dismissed} />
          <Counter label="Total" value={summary.total ?? 0} />
        </div>
      )}

      {info && <div style={{ ...card, borderLeft: '3px solid #22c55e', background: '#052e16', color: '#bbf7d0' }}>{info}</div>}
      {error && <div style={{ ...card, borderLeft: '3px solid #ef4444', background: '#450a0a', color: '#fecaca' }}><strong>Error:</strong> {error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['inbox', 'critical', 'by-source', 'archive', 'methodology'] as Tab[]).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} style={btn(tab === t ? '#6366f1' : '#334155')}>
            {t === 'inbox' ? '1 · Inbox'
              : t === 'critical' ? '2 · Critical'
              : t === 'by-source' ? '3 · By Source'
              : t === 'archive' ? '4 · Acknowledged / Dismissed'
              : '5 · Methodology'}
          </button>
        ))}
      </div>

      {/* Filters (skip on methodology) */}
      {tab !== 'methodology' && (
        <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={input}>
            <option value="any">any</option>
            <option value="unread">unread</option>
            <option value="read">read</option>
            <option value="acknowledged">acknowledged</option>
            <option value="dismissed">dismissed</option>
          </select>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Severity</label>
          <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} style={input}>
            <option value="any">any</option>
            <option value="critical">critical</option>
            <option value="warning">warning</option>
            <option value="info">info</option>
          </select>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Source</label>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={input}>
            <option value="any">any</option>
            {SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </div>
      )}

      {tab === 'inbox' && <NotificationsTable rows={visibleByTab} onSelect={setSelected} />}
      {tab === 'critical' && <NotificationsTable rows={visibleByTab} onSelect={setSelected} />}
      {tab === 'by-source' && <BySourceView summary={summary} rows={notifications} onSelect={setSelected} />}
      {tab === 'archive' && <NotificationsTable rows={visibleByTab} onSelect={setSelected} />}
      {tab === 'methodology' && <MethodologyView />}

      {selected && (
        <Drawer
          n={selected}
          busy={busy}
          drawerNote={drawerNote}
          setDrawerNote={setDrawerNote}
          onClose={() => { setSelected(null); setDrawerNote(''); }}
          onMarkRead={() => action('mark-read', selected.id)}
          onAcknowledge={() => action('acknowledge', selected.id, drawerNote ? { note: drawerNote } : {})}
          onDismiss={() => action('dismiss', selected.id, drawerNote ? { note: drawerNote } : {})}
          onAddNote={() => drawerNote && action('add-note', selected.id, { note: drawerNote }).then(() => setDrawerNote(''))}
        />
      )}

      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 4 }}>
        Inbox writes only <code>admin-notification:*</code> + audit log. No external sends, no auto-resolution.
      </div>
    </div>
  );
}

function Counter({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ ...tile, padding: '8px 12px', minWidth: 110, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? '#e2e8f0' }}>{value}</div>
    </div>
  );
}

function NotificationsTable({ rows, onSelect }: { rows: any[]; onSelect: (n: any) => void }) {
  if (!rows.length) {
    return <div style={card}><div style={{ color: '#94a3b8', fontSize: 13 }}>No notifications matching the current filter.</div></div>;
  }
  return (
    <div style={card}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>When</th>
            <th style={th}>Severity</th>
            <th style={th}>Status</th>
            <th style={th}>Source</th>
            <th style={th}>Title</th>
            <th style={th}>Related</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n: any) => (
            <tr key={n.id}>
              <td style={td}>{new Date(n.createdAt).toLocaleString()}</td>
              <td style={td}><span style={badge(sevColor[n.severity] ?? '#64748b')}>{n.severity}</span></td>
              <td style={td}><span style={badge(statusColor[n.status] ?? '#64748b')}>{n.status}</span></td>
              <td style={td}>{SOURCE_LABEL[n.source] ?? n.source}</td>
              <td style={td}>
                <div style={{ fontWeight: 600 }}>{n.title}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{(n.message ?? '').slice(0, 140)}</div>
              </td>
              <td style={td}>
                {n.relatedObjectId ? <code style={{ fontSize: 11 }}>{n.relatedObjectType}:{n.relatedObjectId}</code> : '—'}
              </td>
              <td style={td}>
                <button type="button" onClick={() => onSelect(n)} style={btn('#6366f1')}>View</button>
                {n.link && <a href={n.link} style={{ ...btn('#475569'), marginLeft: 6 }}>Open →</a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BySourceView({ summary, rows, onSelect }: { summary: any | null; rows: any[]; onSelect: (n: any) => void }) {
  return (
    <>
      {summary && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Counts by source</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {SOURCES.map(s => (
              <div key={s} style={tile}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{SOURCE_LABEL[s]}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: (summary.bySource?.[s] ?? 0) > 0 ? '#f59e0b' : '#22c55e' }}>
                  {summary.bySource?.[s] ?? 0}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <NotificationsTable rows={rows} onSelect={onSelect} />
    </>
  );
}

function MethodologyView() {
  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>How the inbox works</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>
        <li><strong>Digest is manual.</strong> The Generate Digest button reads existing read-only summaries and creates one notification per finding. It does <em>not</em> auto-fix anything.</li>
        <li><strong>Sources scanned:</strong> operational_health (latest snapshot), incidents (open critical), disputes (open high/critical), market_integrity (elevated_risk reports), house_exposure (latest snapshot warnings), settlement_preview (graded markets without preview), operator_certification (expiring/expired), rbac_review (warning/critical), daily_runbook (missing/incomplete today), weather_evidence (conflicts), change_control (approved but not implemented).</li>
        <li><strong>Dedupe:</strong> if an active (non-dismissed) notification with the same source + relatedObjectId + title already exists, the digest skips creating a new one.</li>
        <li><strong>Mark read</strong> removes from the unread index but does <em>not</em> count as acknowledged.</li>
        <li><strong>Acknowledge</strong> records the actor + timestamp and is the operational closure marker. <strong>Dismiss</strong> records actor + timestamp + optional note and removes the entry from active queues.</li>
        <li><strong>Audit:</strong> every digest, mark-read, acknowledge, dismiss, and add-note writes an audit event.</li>
        <li><strong>Storage:</strong> <code>admin-notification:&#123;id&#125;</code> + indices in <code>admin-notifications:all</code>, <code>admin-notifications:unread</code>, <code>admin-notifications:by-source:*</code>, <code>admin-notifications:by-severity:*</code>. Cap: 1000.</li>
      </ul>
      <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
        The inbox never sends email, SMS, push, or any external notification. It never grades, voids, settles, mutates RBAC, or auto-resolves the underlying record.
      </div>
    </div>
  );
}

function Drawer(props: {
  n: any;
  busy: string | null;
  drawerNote: string;
  setDrawerNote: (s: string) => void;
  onClose: () => void;
  onMarkRead: () => void;
  onAcknowledge: () => void;
  onDismiss: () => void;
  onAddNote: () => void;
}) {
  const { n, busy, drawerNote, setDrawerNote, onClose, onMarkRead, onAcknowledge, onDismiss, onAddNote } = props;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
      justifyContent: 'flex-end', zIndex: 50,
    }} onClick={onClose}>
      <div style={{
        width: 'min(560px, 100%)', height: '100%', background: '#0f172a',
        padding: 18, overflow: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800 }}>{n.title}</h2>
          <button type="button" onClick={onClose} style={btn('#475569')}>Close</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={badge(sevColor[n.severity] ?? '#64748b')}>{n.severity}</span>
          <span style={badge(statusColor[n.status] ?? '#64748b')}>{n.status}</span>
          <span style={badge('#475569')}>{SOURCE_LABEL[n.source] ?? n.source}</span>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
          Created {new Date(n.createdAt).toLocaleString()} {n.createdBySystem ? '(system)' : ''}
        </div>
        <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap', marginBottom: 12 }}>{n.message}</div>
        {n.relatedObjectId && (
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
            Related: <code>{n.relatedObjectType}:{n.relatedObjectId}</code>
          </div>
        )}
        {n.link && (
          <a href={n.link} style={{ ...btn('#6366f1'), marginBottom: 12 }}>Open source page →</a>
        )}

        <div style={{ borderTop: '1px solid #334155', margin: '14px 0' }} />

        {n.acknowledgedAt && (
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
            Acknowledged {new Date(n.acknowledgedAt).toLocaleString()} by <code>{n.acknowledgedBy}</code>
          </div>
        )}
        {n.dismissedAt && (
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
            Dismissed {new Date(n.dismissedAt).toLocaleString()} by <code>{n.dismissedBy}</code>
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Notes</div>
          {(n.notes ?? []).length === 0 ? (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>(no notes)</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
              {n.notes.map((nt: any, i: number) => (
                <li key={i}>
                  <span style={{ color: '#94a3b8' }}>[{new Date(nt.at).toLocaleString()}]</span> <code>{nt.actor}</code>: {nt.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={drawerNote}
            onChange={e => setDrawerNote(e.target.value)}
            placeholder="Optional note (used for acknowledge / dismiss / add-note)"
            style={{ ...input, minHeight: 60, fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={onMarkRead} disabled={busy === 'mark-read' || n.status === 'dismissed' || n.status !== 'unread'} style={btn('#475569')}>
              {busy === 'mark-read' ? 'Marking…' : 'Mark read'}
            </button>
            <button type="button" onClick={onAcknowledge} disabled={busy === 'acknowledge' || n.status === 'dismissed' || n.status === 'acknowledged'} style={btn('#22c55e')}>
              {busy === 'acknowledge' ? 'Acknowledging…' : 'Acknowledge'}
            </button>
            <button type="button" onClick={onDismiss} disabled={busy === 'dismiss' || n.status === 'dismissed'} style={btn('#ef4444')}>
              {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
            </button>
            <button type="button" onClick={onAddNote} disabled={busy === 'add-note' || !drawerNote.trim()} style={btn('#6366f1')}>
              {busy === 'add-note' ? 'Adding…' : 'Add note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
