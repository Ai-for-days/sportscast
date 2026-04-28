import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, LineChart, EmptyChart } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const gradeColor: Record<string, string> = { A: '#22c55e', B: '#06b6d4', C: '#3b82f6', D: '#f59e0b', F: '#ef4444' };
const severityColor: Record<string, string> = { critical: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
const statusColor: Record<string, string> = { open: '#ef4444', acknowledged: '#f59e0b', resolved: '#22c55e' };
const priorityColor: Record<string, string> = { critical: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
const categoryColor: Record<string, string> = { edge: '#06b6d4', allocation: '#a855f7', pilot: '#22c55e', governance: '#f59e0b', ops: '#64748b' };

type Tab = 'today' | 'history' | 'alerts' | 'methodology';

export default function StrategyBrief() {
  const [tab, setTab] = useState<Tab>('today');
  const [today, setToday] = useState<any>(null);
  const [history, setHistory] = useState<any>(null);
  const [alerts, setAlerts] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBrief, setSelectedBrief] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState<string>('open');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

  useEffect(() => { reloadAll(); }, []);

  async function get(action: string) {
    const res = await fetch(`/api/admin/system/strategy-brief?action=${action}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/strategy-brief', {
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
      const [t, h, a] = await Promise.all([get('today'), get('history'), get('alerts')]);
      setToday(t); setHistory(h); setAlerts(a);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function generateBrief() {
    setBusy('generating'); setError(null);
    try {
      const j = await post({ action: 'generate-brief' });
      setSelectedBrief(j.brief);
      await reloadAll();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function ack(id: string, note?: string) {
    setBusy(`ack-${id}`); setError(null);
    try { await post({ action: 'acknowledge-alert', id, note }); await reloadAll(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function resolve(id: string, resolution: string) {
    setBusy(`resolve-${id}`); setError(null);
    try { await post({ action: 'resolve-alert', id, resolution }); await reloadAll(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading strategy brief…</div>;

  const todays = today?.todaysBriefs ?? [];
  const latestToday = todays[0] ?? null;
  const openAlertCount = today?.openAlertCount ?? 0;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/strategy-brief" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Strategy Brief</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Daily desk briefing + scorecard alerts.{' '}
            <strong>Briefing and alerts only</strong> — no autonomous trading, no order submission, no execution-candidate creation,
            no pilot state changes, no automatic strategy promotion.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href="/admin/system/desk-queue" style={btn('#22c55e')}>Open Desk Queue →</a>
          <a href="/admin/system/strategy-scorecard" style={btn('#0ea5e9')}>Scorecard →</a>
          <button onClick={reloadAll} style={btn('#6366f1')} disabled={!!busy}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>Error: {error}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['today',       `Today's Brief${latestToday ? ` · ${latestToday.grade} (${latestToday.overallScore})` : ''}`],
          ['history',     `Brief History (${history?.summary?.totalBriefs ?? 0})`],
          ['alerts',      `Scorecard Alerts (${openAlertCount} open)`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <TodayView
          today={today} latestToday={latestToday} todays={todays} selectedBrief={selectedBrief}
          setSelectedBrief={setSelectedBrief} generateBrief={generateBrief} busy={busy}
        />
      )}
      {tab === 'history' && <HistoryView history={history} />}
      {tab === 'alerts' && (
        <AlertsView
          alerts={alerts} ack={ack} resolve={resolve} busy={busy}
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          filterSeverity={filterSeverity} setFilterSeverity={setFilterSeverity}
        />
      )}
      {tab === 'methodology' && <MethodologyView />}
    </div>
  );
}

// ── Today's Brief ───────────────────────────────────────────────────────────

function TodayView({ today, latestToday, todays, selectedBrief, setSelectedBrief, generateBrief, busy }: any) {
  const brief = selectedBrief ?? latestToday;

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Generate today's brief</h3>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
              Snapshots the current scorecard, top actions, warnings, pilot status, and governance state. Briefs are immutable; alerts are reused if their rule key already has an open record.
            </p>
          </div>
          <button onClick={generateBrief} style={btn(busy === 'generating' ? '#475569' : '#22c55e')} disabled={!!busy}>
            {busy === 'generating' ? 'Generating…' : '+ Generate Daily Strategy Brief'}
          </button>
        </div>
        {todays.length > 1 && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
            {todays.length} briefs generated today. Pick one:{' '}
            {todays.map((b: any) => (
              <button key={b.id} onClick={() => setSelectedBrief(b)} style={{ ...btn(brief?.id === b.id ? '#6366f1' : '#334155'), padding: '3px 8px', fontSize: 11, marginLeft: 4 }}>
                {new Date(b.createdAt).toLocaleTimeString()}
              </button>
            ))}
          </div>
        )}
      </div>

      {!brief ? (
        <div style={{ ...card, color: '#94a3b8' }}>
          No brief generated for today yet. Click <strong>+ Generate Daily Strategy Brief</strong> to snapshot the current scorecard.
        </div>
      ) : (
        <BriefDetail brief={brief} />
      )}
    </>
  );
}

function BriefDetail({ brief }: { brief: any }) {
  return (
    <>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: 16, alignItems: 'center' }}>
          <div style={tile}>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Overall</div>
            <div style={{ fontSize: 48, fontWeight: 800, color: gradeColor[brief.grade] }}>{brief.overallScore}</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Grade {brief.grade}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
              {new Date(brief.createdAt).toLocaleString()} · by {brief.generatedBy}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <SectionTile label="Edge" section={brief.edgeSummary} />
            <SectionTile label="Allocation" section={brief.allocationSummary} />
            <SectionTile label="Pilot" section={brief.pilotSummary} />
            <SectionTile label="Governance" section={brief.governanceSummary} />
          </div>
        </div>
      </div>

      {(brief.operationalWarnings ?? []).length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>System Warnings ({brief.operationalWarnings.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#fbbf24' }}>
            {brief.operationalWarnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top Actions ({(brief.topActions ?? []).length})</h3>
        {(brief.topActions ?? []).length === 0 ? (
          <div style={{ color: '#22c55e', fontSize: 13 }}>✓ No urgent actions. Strategy program is in good standing.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {brief.topActions.slice(0, 8).map((a: any) => (
              <a key={a.id} href={a.link} style={{ textDecoration: 'none', color: '#e2e8f0' }}>
                <div style={{ ...tile, borderLeft: `3px solid ${priorityColor[a.priority]}` }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={badge(priorityColor[a.priority])}>{a.priority}</span>
                    <span style={badge(categoryColor[a.category])}>{a.category}</span>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{a.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#cbd5e1' }}>{a.description}</div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {(brief.firedAlertKeys ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Alerts fired during this brief ({brief.firedAlertKeys.length})</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {brief.firedAlertKeys.map((k: string) => (
              <span key={k} style={{ ...badge('#475569'), fontSize: 11 }}>{k}</span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
            See the <strong>Scorecard Alerts</strong> tab to acknowledge or resolve them.
          </div>
        </div>
      )}

      {(brief.notes ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Notes</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
            {brief.notes.map((n: string, i: number) => <li key={i} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{n}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

function SectionTile({ label, section }: { label: string; section: any }) {
  if (!section) return <div style={tile}><div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div></div>;
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: gradeColor[section.grade] }}>{section.score}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>grade {section.grade}</div>
      <div style={{ fontSize: 11, color: '#cbd5e1' }}>
        {(section.highlights ?? []).slice(0, 3).map((h: any) => (
          <div key={h.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
            <span style={{ color: '#94a3b8' }}>{h.label}</span>
            <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{h.value == null ? '—' : String(h.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── History View ────────────────────────────────────────────────────────────

function HistoryView({ history }: { history: any }) {
  if (!history || history.summary.totalBriefs === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No briefs generated yet.</div>;
  }
  const sum = history.summary;
  const briefs = history.briefs ?? [];

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Score Trend ({sum.scoreTrend.length} brief{sum.scoreTrend.length === 1 ? '' : 's'})</h3>
        {sum.scoreTrend.length === 0 ? <EmptyChart title="No data" message="No briefs to chart yet." /> : (
          <LineChart
            data={sum.scoreTrend.map((p: any, i: number) => ({ x: `${i + 1}`, y: p.score }))}
            yLabel="Overall score"
            yRange={[0, 100]}
            valueFormatter={v => v == null ? '—' : `${v}`}
            height={220}
          />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Grade History</h3>
          <BarChart
            data={['A', 'B', 'C', 'D', 'F'].map(g => ({ label: g, value: sum.gradeCounts[g] ?? 0, color: gradeColor[g] }))}
            valueFormatter={v => `${v}`}
            height={180}
          />
        </div>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top Recurring Warnings</h3>
          {sum.recurringWarnings.length === 0 ? <EmptyChart title="None" message="No recurring warnings yet." /> : (
            <BarChart
              data={sum.recurringWarnings.slice(0, 8).map((w: any) => ({ label: w.warning.length > 38 ? w.warning.slice(0, 35) + '…' : w.warning, value: w.count, color: '#f59e0b' }))}
              valueFormatter={v => `${v}`}
              height={220}
            />
          )}
        </div>
      </div>

      {sum.recurringFiredRules.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top Recurring Fired Rules</h3>
          <BarChart
            data={sum.recurringFiredRules.slice(0, 8).map((r: any) => ({ label: r.ruleKey, value: r.count, color: '#a855f7' }))}
            valueFormatter={v => `${v}`}
            height={180}
          />
        </div>
      )}

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Previous Briefs</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Date</th><th style={th}>Created</th><th style={th}>Score</th><th style={th}>Grade</th>
              <th style={th}>Actions</th><th style={th}>Warnings</th><th style={th}>Alerts fired</th><th style={th}>By</th>
            </tr>
          </thead>
          <tbody>
            {briefs.map((b: any) => (
              <tr key={b.id}>
                <td style={td}>{b.date}</td>
                <td style={td}>{new Date(b.createdAt).toLocaleString()}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{b.overallScore}</td>
                <td style={td}><span style={{ ...badge(gradeColor[b.grade]) }}>{b.grade}</span></td>
                <td style={td}>{(b.topActions ?? []).length}</td>
                <td style={td}>{(b.operationalWarnings ?? []).length}</td>
                <td style={td}>{(b.firedAlertKeys ?? []).length}</td>
                <td style={td}>{b.generatedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Alerts View ─────────────────────────────────────────────────────────────

function AlertsView({ alerts, ack, resolve, busy, filterStatus, setFilterStatus, filterSeverity, setFilterSeverity }: any) {
  if (!alerts) return <div style={{ ...card, color: '#94a3b8' }}>Loading alerts…</div>;
  const list: any[] = alerts.alerts ?? [];
  const counts = alerts.counts ?? { open: 0, acknowledged: 0, resolved: 0, total: 0 };

  const filtered = list.filter(a =>
    (filterStatus === 'all' || a.status === filterStatus) &&
    (filterSeverity === 'all' || a.severity === filterSeverity),
  );

  return (
    <>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <Stat label="Open" value={counts.open} color="#ef4444" />
          <Stat label="Acknowledged" value={counts.acknowledged} color="#f59e0b" />
          <Stat label="Resolved" value={counts.resolved} color="#22c55e" />
          <Stat label="Total" value={counts.total} color="#94a3b8" />
        </div>
      </div>

      <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Status:</span>
        {['all', 'open', 'acknowledged', 'resolved'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={btn(filterStatus === s ? '#6366f1' : '#334155')}>{s}</button>
        ))}
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 12 }}>Severity:</span>
        {['all', 'critical', 'high', 'medium', 'low'].map(s => (
          <button key={s} onClick={() => setFilterSeverity(s)} style={btn(filterSeverity === s ? '#6366f1' : '#334155')}>{s}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ ...card, color: '#22c55e' }}>✓ No alerts match the current filter.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((a: any) => <AlertCard key={a.id} alert={a} ack={ack} resolve={resolve} busy={busy} />)}
        </div>
      )}
    </>
  );
}

function AlertCard({ alert, ack, resolve, busy }: { alert: any; ack: (id: string, note?: string) => void; resolve: (id: string, resolution: string) => void; busy: string | null }) {
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [showResolve, setShowResolve] = useState(false);

  return (
    <div style={{ ...card, borderLeft: `3px solid ${severityColor[alert.severity]}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={badge(severityColor[alert.severity])}>{alert.severity}</span>
            <span style={badge(statusColor[alert.status])}>{alert.status}</span>
            <span style={badge(categoryColor[alert.category])}>{alert.category}</span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{alert.title}</span>
          </div>
          <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>{alert.description}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Rule <code>{alert.ruleKey}</code> · fired {alert.fireCount}× · first {new Date(alert.firstFiredAt).toLocaleString()} · last {new Date(alert.lastFiredAt).toLocaleString()}
          </div>
          {alert.acknowledgedAt && (
            <div style={{ fontSize: 11, color: '#fbbf24' }}>
              Acknowledged {new Date(alert.acknowledgedAt).toLocaleString()} by {alert.acknowledgedBy}
            </div>
          )}
          {alert.resolvedAt && (
            <div style={{ fontSize: 11, color: '#22c55e' }}>
              Resolved {new Date(alert.resolvedAt).toLocaleString()} by {alert.resolvedBy} — {alert.resolution}
            </div>
          )}
          {(alert.notes ?? []).length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 11, color: '#94a3b8', cursor: 'pointer' }}>Notes ({alert.notes.length})</summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 11, color: '#cbd5e1' }}>
                {alert.notes.map((n: string, i: number) => <li key={i} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{n}</li>)}
              </ul>
            </details>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
          <a href={alert.link} style={btn('#0ea5e9')}>Open source →</a>
          {alert.status !== 'resolved' && alert.status !== 'acknowledged' && (
            <>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Acknowledge note (optional)"
                     style={{ background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 }} />
              <button onClick={() => { ack(alert.id, note || undefined); setNote(''); }} disabled={!!busy} style={btn('#f59e0b')}>Acknowledge</button>
            </>
          )}
          {alert.status !== 'resolved' && (
            <>
              {!showResolve ? (
                <button onClick={() => setShowResolve(true)} disabled={!!busy} style={btn('#22c55e')}>Resolve…</button>
              ) : (
                <>
                  <input value={resolution} onChange={e => setResolution(e.target.value)} placeholder="Resolution (required)"
                         style={{ background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 }} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { if (resolution.trim()) { resolve(alert.id, resolution); setResolution(''); setShowResolve(false); } }}
                            disabled={!!busy || !resolution.trim()} style={btn('#22c55e')}>Confirm</button>
                    <button onClick={() => { setShowResolve(false); setResolution(''); }} style={btn('#475569')}>Cancel</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Methodology ─────────────────────────────────────────────────────────────

function MethodologyView() {
  const rules: { ruleId: string; trigger: string; severity: string }[] = [
    { ruleId: 'overall-low',          trigger: 'overall.score < 60',                                                             severity: 'high (critical if < 40)' },
    { ruleId: 'component-low',        trigger: 'edge / allocation / pilot / governance / operational score < 50',                severity: 'high (critical if < 30)' },
    { ruleId: 'overdue-decisions',    trigger: 'decisionSummary.overdueCount > 0',                                                severity: 'high (critical if ≥ 3)' },
    { ruleId: 'pilot-breach',         trigger: 'any active pilot with warningStatus === "breach"',                                severity: 'critical' },
    { ruleId: 'stress-verdict',       trigger: 'allocation stress verdict ∈ { Critical, Caution }',                               severity: 'high (critical if Critical)' },
    { ruleId: 'paper-stale',          trigger: 'paperCaptured > 20 AND open / captured > 80%',                                    severity: 'medium' },
    { ruleId: 'eligible-no-capture',  trigger: 'allocation.totalEligible > 0 AND no paper records captured',                     severity: 'medium' },
    { ruleId: 'pilot-ready-no-pilot', trigger: 'strategy with status pilot_ready and no PilotPlan referencing it',                severity: 'medium' },
  ];

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>How daily briefs work</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Operator clicks <strong>Generate Daily Strategy Brief</strong>. The lib snapshots the current scorecard, top actions, operational warnings, and per-section health.</li>
          <li>Briefs are immutable — only <code>add-note</code> may append to a brief; nothing else mutates one once written.</li>
          <li>Each brief is stored at <code>strategy-brief:&#123;id&#125;</code> with an index in <code>strategy-briefs:all</code>; trimmed to 365 most recent.</li>
          <li>During generation, all 8 alert rules are evaluated. Each fired rule has a stable <code>ruleKey</code>: existing open/acknowledged alerts are reused (fireCount++); new keys create a fresh open alert.</li>
          <li>Resolved alerts are not reused — if their rule fires again later, a new open alert is created with a new id.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Alert rules</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Rule ID</th><th style={th}>Trigger</th><th style={th}>Severity</th></tr></thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.ruleId}>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.ruleId}</td>
                <td style={td}>{r.trigger}</td>
                <td style={td}>{r.severity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Acknowledge vs Resolve</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>Acknowledge</strong> — operator has seen the alert. Status moves to <code>acknowledged</code> but the alert remains open in the dedupe index, so re-fires bump <code>fireCount</code>.</li>
          <li><strong>Resolve</strong> — operator has fixed the underlying condition (or chosen to dismiss). Requires a written resolution. The dedupe pointer is removed so future fires create a fresh alert.</li>
          <li>Alerts never auto-resolve. They never auto-pause pilots, auto-promote strategies, submit orders, or change live-execution behavior.</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>No autonomous trading, no order submission, no execution-candidate creation.</li>
          <li>No pilot state changes, no auto-pause, no auto-resume.</li>
          <li>No automatic strategy promotion or status transitions.</li>
          <li>No live-execution behavior changes.</li>
          <li>Briefing and alerts only.</li>
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
