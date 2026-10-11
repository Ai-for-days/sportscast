import { useEffect, useMemo, useState } from 'react';
import { formatEasternDMYTime } from '../../lib/date-format';

// Alert Log (2026-10-11, per Derek: "put something in the admin that logs
// everything and I can check it"). Email delivery was deferred, so this page is
// where alerts are delivered for now. Opening it marks the notices read, which
// clears the badge on the admin quick-links bar.

interface Group { key: string; title: string; severity: string; count: number; firstAt: string; lastAt: string; latestMessage: string }
interface Notice { id: string; at: string; kind: 'immediate' | 'digest'; subject: string; text: string; emailed: boolean }
interface Source { source: string; label: string; status: string; consecutiveFailures: number; lastSuccessAt?: string; lastError?: string }
interface AlertRow { id: string; createdAt: string; severity: string; type: string; title: string; message: string; status: string; metadata?: any }
interface LogData {
  emailConfigured: boolean; unread: number; sources: Source[]; notices: Notice[];
  last24h: { total: number; groups: Group[] }; last7d: { total: number; groups: Group[] };
  history: AlertRow[]; historyTruncated: boolean;
}

const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 16, marginBottom: 16 };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#94a3b8', borderBottom: '1px solid #334155', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid #1f2a3c', verticalAlign: 'top' };
const h2: React.CSSProperties = { margin: '0 0 10px', fontSize: 16, fontWeight: 700 };

const STATUS_COLOR: Record<string, string> = { ok: '#22c55e', degraded: '#f59e0b', dark: '#ef4444', unknown: '#64748b' };
const SEVERITY_COLOR: Record<string, string> = { critical: '#ef4444', warning: '#f59e0b', info: '#38bdf8' };
const et = (iso?: string) => (iso ? `${formatEasternDMYTime(iso)} ET` : '—');

function Chip({ text, color }: { text: string; color: string }) {
  return <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${color}22`, color, border: `1px solid ${color}66`, textTransform: 'uppercase' }}>{text}</span>;
}

function GroupTable({ groups }: { groups: Group[] }) {
  if (!groups.length) return <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>Nothing alerted.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Problem</th><th style={th}>Times</th><th style={th}>First</th><th style={th}>Last</th></tr></thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <td style={td}><Chip text={g.severity} color={SEVERITY_COLOR[g.severity] ?? '#94a3b8'} /> <strong>{g.title}</strong><div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{g.latestMessage}</div></td>
              <td style={{ ...td, fontWeight: 700 }}>{g.count}</td>
              <td style={td}>{et(g.firstAt)}</td>
              <td style={td}>{et(g.lastAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AlertLog() {
  const [data, setData] = useState<LogData | null>(null);
  const [error, setError] = useState('');
  const [unreadAtOpen, setUnreadAtOpen] = useState(0);
  const [openNotice, setOpenNotice] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [shown, setShown] = useState(200);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/alert-log', { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as LogData;
        setData(d);
        setUnreadAtOpen(d.unread);
        // Opening the log counts as reading it: clear the quick-links badge.
        await fetch('/api/admin/alert-log', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark-read' }) });
        const badge = document.getElementById('alert-log-badge');
        if (badge) badge.hidden = true;
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();
  }, []);

  const sourcesInHistory = useMemo(() => [...new Set((data?.history ?? []).map((a) => a.metadata?.source ?? a.type))].sort(), [data]);
  const filtered = useMemo(() => (data?.history ?? []).filter((a) => sourceFilter === 'all' || (a.metadata?.source ?? a.type) === sourceFilter), [data, sourceFilter]);

  if (error) return <div style={{ color: '#fca5a5' }}>Could not load the alert log: {error}</div>;
  if (!data) return <div style={{ color: '#94a3b8' }}>Loading alert log…</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Alert Log</h1>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>
        Everything the site has alerted on. {data.emailConfigured
          ? 'Notices below are also emailed.'
          : 'Email is not set up yet, so this page is where alerts are delivered. The 🔔 count on the quick-links bar shows notices you have not seen.'}
      </p>

      <div style={card}>
        <h2 style={h2}>Upstream sources right now</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {data.sources.map((s) => (
            <div key={s.source} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
              <div style={{ marginTop: 4 }}><Chip text={s.status === 'ok' ? 'answering' : s.status === 'unknown' ? 'no data yet' : s.status} color={STATUS_COLOR[s.status] ?? '#64748b'} />
                {s.consecutiveFailures > 0 && <span style={{ fontSize: 12, color: '#fca5a5', marginLeft: 6 }}>{s.consecutiveFailures} failures in a row</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
        <div style={card}><h2 style={h2}>Last 24 hours: {data.last24h.total} alert(s)</h2><GroupTable groups={data.last24h.groups} /></div>
        <div style={card}><h2 style={h2}>Last 7 days: {data.last7d.total} alert(s)</h2><GroupTable groups={data.last7d.groups} /></div>
      </div>

      <div style={card}>
        <h2 style={h2}>Notices ({data.notices.length}){unreadAtOpen > 0 && <span style={{ marginLeft: 8 }}><Chip text={`${unreadAtOpen} new`} color="#f59e0b" /></span>}</h2>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8' }}>
          What you would be emailed: the first alert for each problem (then 24 hours of quiet), and an 8am ET digest on any day something alerted.
        </p>
        {data.notices.length === 0 && <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>No notices yet. The first one appears the next time a critical alert fires or the 8am digest runs on a day with alerts.</p>}
        {data.notices.map((n, i) => (
          <div key={n.id} style={{ borderTop: i ? '1px solid #334155' : 'none', padding: '8px 0' }}>
            <button onClick={() => setOpenNotice(openNotice === n.id ? null : n.id)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
              {i < unreadAtOpen && <Chip text="new" color="#f59e0b" />}
              <Chip text={n.kind} color={n.kind === 'digest' ? '#38bdf8' : '#ef4444'} />
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{et(n.at)}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{n.subject.replace('[Wager on Weather] ', '')}</span>
              {n.emailed && <Chip text="emailed" color="#22c55e" />}
            </button>
            {openNotice === n.id && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, background: '#0f172a', borderRadius: 8, padding: 12, margin: '8px 0 0' }}>{n.text}</pre>}
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 style={{ ...h2, margin: 0 }}>Every alert, last 7 days ({filtered.length}{data.historyTruncated ? '+' : ''})</h2>
          <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setShown(200); }} style={{ background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '4px 8px' }}>
            <option value="all">All sources</option>
            {sourcesInHistory.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>When</th><th style={th}>Severity</th><th style={th}>Source</th><th style={th}>Alert</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {filtered.slice(0, shown).map((a) => (
                <tr key={a.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{et(a.createdAt)}</td>
                  <td style={td}><Chip text={a.severity} color={SEVERITY_COLOR[a.severity] ?? '#94a3b8'} /></td>
                  <td style={td}>{a.metadata?.source ?? a.type}</td>
                  <td style={td}><strong>{a.title}</strong><div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{a.message}</div></td>
                  <td style={td}>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > shown && (
          <button onClick={() => setShown(shown + 200)} style={{ marginTop: 10, padding: '6px 14px', borderRadius: 6, border: 'none', background: '#334155', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Show 200 more</button>
        )}
      </div>
    </div>
  );
}
