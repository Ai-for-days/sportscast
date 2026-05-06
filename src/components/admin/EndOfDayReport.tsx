import React, { useEffect, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const tierColor: Record<string, string> = { critical: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
const runbookColor: Record<string, string> = { open: '#3b82f6', completed: '#22c55e', not_started: '#94a3b8', unavailable: '#64748b' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtUsd(cents: number, signed = false): string {
  const sign = cents < 0 ? '-' : (signed && cents > 0 ? '+' : '');
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default function EndOfDayReport() {
  const [date, setDate] = useState(todayStr());
  const [report, setReport] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initial();
  }, []);

  async function initial() {
    setLoading(true); setError(null);
    try {
      // Try to load today's report (if it exists) and history
      const [todayRes, listRes] = await Promise.all([
        get('get', { date: todayStr() }),
        get('list', { limit: '60' }),
      ]);
      if (todayRes.report) {
        setReport(todayRes.report);
        setDate(todayRes.report.date);
      }
      setHistory(listRes.reports ?? []);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/end-of-day-report?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/end-of-day-report', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }

  async function loadDate() {
    setBusy('load'); setError(null);
    try {
      const j = await get('get', { date });
      setReport(j.report ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'failed');
      setReport(null);
    }
    setBusy(null);
  }

  async function generate() {
    setBusy('generate'); setError(null);
    try {
      const j = await post({ action: 'generate', date });
      setReport(j.report);
      const list = await get('list', { limit: '60' });
      setHistory(list.reports ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'failed');
    }
    setBusy(null);
  }

  async function refreshHistory() {
    setBusy('refresh-history');
    try {
      const j = await get('list', { limit: '60' });
      setHistory(j.reports ?? []);
    } catch { /* ignore */ }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading end-of-day report…</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/end-of-day-report" /></div>

      <div style={BANNER}>
        <span>📊 This report is a <strong>snapshot only</strong>. It does not create wagers, grade outcomes, settle balances, or change permissions.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Read-only · Audit-logged</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>End-of-Day Operations Report</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Snapshots a date's market activity, resolution decisions, settlement projections, integrity reports, and operator
            governance. Pure aggregation over existing read-only sources — generation persists a snapshot to <code>eod-report:&#123;date&#125;</code>.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/command-center" style={btn('#0ea5e9')}>Command Center →</a>
          <a href="/admin/system/daily-operator-runbook" style={btn('#0ea5e9')}>Daily Runbook →</a>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      <div style={card}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Date
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...input, marginLeft: 8 }} />
          </label>
          <button type="button" onClick={loadDate} disabled={!!busy || !date} style={btn('#0ea5e9')}
            title="Load the persisted report for this date (read-only). Returns 404 if none has been generated yet.">
            {busy === 'load' ? 'Loading…' : 'Load existing report'}
          </button>
          <button type="button" onClick={generate} disabled={!!busy || !date} style={btn(busy === 'generate' ? '#475569' : '#22c55e')}
            title="Aggregates the date's data into a snapshot. Read-only across upstream sources; only writes the snapshot itself.">
            {busy === 'generate' ? 'Generating…' : 'Generate Report'}
          </button>
          {report && (
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              Loaded: {report.date} · generated {new Date(report.generatedAt).toLocaleString()} by {report.generatedBy}
            </span>
          )}
        </div>
      </div>

      {report && <ReportView report={report} />}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Historical reports ({history.length})</h3>
          <button type="button" onClick={refreshHistory} disabled={!!busy} style={btn('#475569')}>Refresh history</button>
        </div>
        {history.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No reports persisted yet — generate one to seed the history.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Date</th><th style={th}>Generated</th><th style={th}>By</th>
                  <th style={th}>Created</th><th style={th}>Locked</th><th style={th}>Graded</th><th style={th}>Voided</th>
                  <th style={th}>Integrity</th><th style={th}>Warnings</th><th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.date}</td>
                    <td style={td}>{new Date(r.generatedAt).toLocaleString()}</td>
                    <td style={td}>{r.generatedBy}</td>
                    <td style={td}>{r.marketSummary?.createdCount ?? 0}</td>
                    <td style={td}>{r.marketSummary?.lockedCount ?? 0}</td>
                    <td style={{ ...td, color: '#22c55e' }}>{r.marketSummary?.gradedCount ?? 0}</td>
                    <td style={{ ...td, color: '#64748b' }}>{r.marketSummary?.voidedCount ?? 0}</td>
                    <td style={td}>{r.integritySummary?.reportsGenerated ?? 0}</td>
                    <td style={{ ...td, color: (r.warnings ?? []).length > 0 ? '#f59e0b' : '#94a3b8' }}>{(r.warnings ?? []).length}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => { setDate(r.date); setReport(r); }} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Report body ──────────────────────────────────────────────────────────────

function ReportView({ report }: { report: any }) {
  const m = report.marketSummary ?? {};
  const r = report.resolutionSummary ?? {};
  const s = report.settlementPreviewSummary ?? {};
  const i = report.integritySummary ?? {};
  const g = report.operatorGovernanceSummary ?? {};

  return (
    <>
      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <SectionTiles title="Market activity" tiles={[
          ['Created', m.createdCount, undefined],
          ['Open', m.openCount, '#3b82f6'],
          ['Locked', m.lockedCount, '#f59e0b'],
          ['Graded', m.gradedCount, '#22c55e'],
          ['Voided', m.voidedCount, '#64748b'],
        ]} link={{ href: '/admin/wagers', label: 'All Wagers →' }} />

        <SectionTiles title="Resolution activity" tiles={[
          ['Previews', r.previewsGenerated, '#06b6d4'],
          ['Graded', r.manuallyGraded, '#22c55e'],
          ['Voided', r.manuallyVoided, '#64748b'],
        ]} link={{ href: '/admin/system/wager-resolution', label: 'Wager Resolution →' }} />

        <SectionTiles title="Settlement preview" tiles={[
          ['Previews', s.previewsGenerated, '#a855f7'],
          ['Net house result', fmtUsd(s.projectedNetHouseResult ?? 0, true), (s.projectedNetHouseResult ?? 0) >= 0 ? '#22c55e' : '#ef4444'],
          ['High-liability previews', s.highLiabilityWarnings, (s.highLiabilityWarnings ?? 0) > 0 ? '#f59e0b' : '#94a3b8'],
        ]} link={{ href: '/admin/system/wager-settlement-preview', label: 'Settlement Preview →' }} />

        <SectionTiles title="Market integrity" tiles={[
          ['Reports', i.reportsGenerated, undefined],
          ['Healthy', i.healthyCount, '#22c55e'],
          ['Monitor', i.monitorCount, '#f59e0b'],
          ['Elevated risk', i.elevatedRiskCount, '#ef4444'],
          ['Critical', i.criticalWarnings, '#ef4444'],
        ]} link={{ href: '/admin/system/market-integrity', label: 'Market Integrity →' }} />

        <SectionTiles title="Operator governance" tiles={[
          ['Runbook', `${g.runbookStatus ?? 'unavailable'}${g.runbookProgressPct != null ? ` (${g.runbookProgressPct}%)` : ''}`, runbookColor[g.runbookStatus] ?? '#94a3b8'],
          ['Cert warnings', g.certificationWarnings ?? 0, (g.certificationWarnings ?? 0) > 0 ? '#f59e0b' : '#94a3b8'],
          ['RBAC warnings', g.rbacWarnings ?? 0, (g.rbacWarnings ?? 0) > 0 ? '#f59e0b' : '#94a3b8'],
        ]} link={{ href: '/admin/system/operator-certification', label: 'Operator Certification →' }} />
      </div>

      {(report.warnings ?? []).length > 0 && (
        <div style={{ ...card, background: '#3f1d1d', borderLeft: '3px solid #ef4444' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>Warnings ({report.warnings.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {report.warnings.map((w: string, idx: number) => <li key={idx}>{w}</li>)}
          </ul>
        </div>
      )}

      {(report.recommendedNextActions ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Recommended next actions</h3>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {report.recommendedNextActions.map((a: any, idx: number) => (
              <li key={idx} style={{ ...tile, padding: 10, borderLeft: `3px solid ${tierColor[a.tier]}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#e2e8f0' }}>{a.label}</span>
                <a href={a.href} style={btn('#475569')}>Open →</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Notable events ({(report.notableEvents ?? []).length})</h3>
        {(report.notableEvents ?? []).length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No notable events on this date.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>When</th><th style={th}>Actor</th><th style={th}>Event</th>
                  <th style={th}>Summary</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {report.notableEvents.map((e: any) => (
                  <tr key={e.id}>
                    <td style={td}>{new Date(e.at).toLocaleString()}</td>
                    <td style={td}>{e.actor}</td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{e.eventType}</td>
                    <td style={td}>{e.summary}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {e.link && <a href={e.link} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(report.dataGaps ?? []).length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#fbbf24' }}>Data gaps ({report.dataGaps.length})</h3>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: '#94a3b8' }}>
            One or more upstream sources were unavailable when this report was generated. The numbers above exclude those sources;
            re-generate after the source recovers for a complete snapshot.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fbbf24' }}>
            {report.dataGaps.map((g: string, idx: number) => <li key={idx}>{g}</li>)}
          </ul>
        </div>
      )}

      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 4 }}>
        Snapshot ID <code>{report.id}</code> · status <code>{report.status}</code>
      </div>
    </>
  );
}

function SectionTiles({ title, tiles, link }: { title: string; tiles: [string, number | string, string | undefined][]; link: { href: string; label: string } }) {
  return (
    <div style={{ ...tile, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {tiles.map(([label, value, color]) => (
            <tr key={label} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: '4px 0', color: '#94a3b8' }}>{label}</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'ui-monospace, Menlo, monospace', color: color ?? '#e2e8f0', fontWeight: 700 }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <a href={link.href} style={{ ...btn('#334155'), alignSelf: 'flex-start' }}>{link.label}</a>
    </div>
  );
}
