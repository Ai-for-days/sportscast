import React, { useEffect, useMemo, useState } from 'react';
import { formatDMYTime } from '../../lib/date-format';
import SystemNav from './SystemNav';
import { BarChart, GaugeIndicator, HeatmapGrid, EmptyChart } from './charts';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const verdictColor: Record<string, string> = { healthy: '#22c55e', monitor: '#f59e0b', elevated_risk: '#ef4444' };
const verdictLabel: Record<string, string> = { healthy: 'Healthy', monitor: 'Monitor', elevated_risk: 'Elevated Risk' };
const severityColor: Record<string, string> = { info: '#22c55e', warning: '#f59e0b', critical: '#ef4444' };
const kindColor: Record<string, string> = { odds: '#06b6d4', 'over-under': '#a855f7', pointspread: '#22c55e' };
const statusColor: Record<string, string> = { open: '#3b82f6', locked: '#f59e0b', graded: '#22c55e', void: '#64748b' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)',
  color: '#fff', padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

function fmtUsd(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }

type Tab = 'overview' | 'reports' | 'concentration' | 'operational' | 'methodology';

export default function MarketIntegrityCenter() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [targets, setTargets] = useState<any[]>([]);
  const [activeReport, setActiveReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedWagerId, setPickedWagerId] = useState<string>('');

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/market-integrity?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/market-integrity', {
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
      const j = await get('summary');
      setSummary(j.summary);
      setReports(j.reports ?? []);
      setTargets(j.targets ?? []);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function analyze(wagerId: string) {
    if (!wagerId) return;
    setBusy(`analyze-${wagerId}`); setError(null);
    try {
      const j = await post({ action: 'analyze', wagerId });
      setActiveReport(j.report);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'analyze failed'); }
    setBusy(null);
  }

  async function openReport(id: string) {
    setBusy(`open-${id}`); setError(null);
    try {
      const j = await get('get-report', { id });
      setActiveReport(j.report);
      setTab('reports');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function loadLatestForWager(wagerId: string) {
    if (!wagerId) return;
    setBusy(`load-${wagerId}`); setError(null);
    try {
      const j = await get('get-by-wager', { wagerId });
      if (j.report) setActiveReport(j.report);
      setTab('reports');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  const heatmapCells = useMemo(() => {
    if (!summary) return [];
    const cells: any[] = [];
    const v: any[] = ['healthy', 'monitor', 'elevated_risk'];
    const s: any[] = ['info', 'warning', 'critical'];
    const counts: Record<string, number> = {};
    for (const r of reports) {
      const key = `${r.verdict}|${r.severity}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    for (const verdict of v) {
      for (const sev of s) {
        cells.push({ row: verdictLabel[verdict], col: sev, value: counts[`${verdict}|${sev}`] ?? 0 });
      }
    }
    return cells;
  }, [summary, reports]);

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading market integrity…</div>;
  if (!summary) return null;

  const unresolvedTargets = targets.filter(t => t.status === 'open' || t.status === 'locked');

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/market-integrity" /></div>

      <div style={BANNER}>
        <span>🛡️ Market Integrity is <strong>advisory only</strong>. This system does not freeze accounts, void wagers, or take enforcement actions automatically.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Read-only · Audit-logged</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Market Integrity & Abuse Monitoring</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Detects suspicious market behaviour, operator mistakes, market-quality problems, and concentration risk. Generate
            reports per wager, then route findings to Wager Resolution / Settlement Preview / Pricing Engine for human follow-up.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/wager-resolution" style={btn('#0ea5e9')}>Wager Resolution →</a>
          <a href="/admin/system/wager-settlement-preview" style={btn('#0ea5e9')}>Settlement Preview →</a>
          <a href="/admin/system/user-risk-monitoring" style={btn('#0ea5e9')}
             title="Per-user responsible-play and integrity signals. Advisory only — never restricts users.">User Risk →</a>
          <a href="/admin/system/house-exposure" style={btn('#0ea5e9')}
             title="Read-only financial exposure & PnL. Snapshot only — does not settle.">House Exposure →</a>
          <button type="button" onClick={reload} disabled={!!busy} style={btn('#6366f1')}
            title="Refresh integrity summary, target list, and recent reports">Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Reports on file"     value={summary.totalReports} />
          <Stat label="Healthy"             value={summary.byVerdict.healthy}        color={verdictColor.healthy} />
          <Stat label="Monitor"             value={summary.byVerdict.monitor}        color={verdictColor.monitor} />
          <Stat label="Elevated risk"       value={summary.byVerdict.elevated_risk}  color={verdictColor.elevated_risk} />
          <Stat label="Avg integrity score" value={summary.averageScore ?? '—'}      color={summary.averageScore != null && summary.averageScore >= 75 ? '#22c55e' : '#f59e0b'} />
          <Stat label="Total warnings"      value={summary.warningCount}             color="#f59e0b" />
          <Stat label="Unresolved markets"  value={summary.unresolvedAfterEventCount} color="#ef4444" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['overview',      `Overview`],
          ['reports',       `Market Reports (${reports.length})`],
          ['concentration', 'Concentration Risk'],
          ['operational',   `Operational Warnings (${unresolvedTargets.length})`],
          ['methodology',   'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewView
          summary={summary} reports={reports} targets={targets}
          heatmapCells={heatmapCells} pickedWagerId={pickedWagerId} setPickedWagerId={setPickedWagerId}
          analyze={analyze} loadLatestForWager={loadLatestForWager} busy={busy}
          openReport={openReport}
        />
      )}
      {tab === 'reports' && (
        <ReportsView reports={reports} activeReport={activeReport} openReport={openReport} setActiveReport={setActiveReport} />
      )}
      {tab === 'concentration' && (
        <ConcentrationView reports={reports} openReport={openReport} />
      )}
      {tab === 'operational' && (
        <OperationalView reports={reports} unresolvedTargets={unresolvedTargets} analyze={analyze} busy={busy} openReport={openReport} />
      )}
      {tab === 'methodology' && <MethodologyView />}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ summary, reports, targets, heatmapCells, pickedWagerId, setPickedWagerId, analyze, loadLatestForWager, busy, openReport }: any) {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Analyze a wager</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Pick a wager
            <select value={pickedWagerId} onChange={(e: any) => setPickedWagerId(e.target.value)}
              style={{ ...tile, padding: '6px 8px', width: '100%', marginTop: 4, color: '#e2e8f0' }}>
              <option value="">— pick —</option>
              {targets.map((t: any) => <option key={t.id} value={t.id}>
                {t.ticketNumber} · {t.title} ({t.status}) {t.hasReport ? '· report' : ''}
              </option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => analyze(pickedWagerId)} disabled={!pickedWagerId || !!busy}
              style={btn(busy?.startsWith('analyze') ? '#475569' : '#22c55e')}
              title="Generates a fresh integrity report. Read-only — does not freeze, void, or change pricing.">
              {busy?.startsWith('analyze') ? 'Analyzing…' : 'Analyze Market Integrity'}
            </button>
            <button type="button" onClick={() => loadLatestForWager(pickedWagerId)} disabled={!pickedWagerId || !!busy}
              style={btn('#475569')}
              title="Open the most recent report for this wager (no new compute).">
              View latest
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Verdict distribution</h3>
          {summary.totalReports === 0 ? (
            <EmptyChart title="No reports yet" message="Pick a wager above and generate a report." />
          ) : (
            <BarChart
              data={(['healthy', 'monitor', 'elevated_risk'] as const).map(v => ({
                label: verdictLabel[v], value: summary.byVerdict[v] ?? 0, color: verdictColor[v],
              }))}
              valueFormatter={v => `${v}`}
              height={200}
            />
          )}
        </div>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Severity distribution</h3>
          {summary.totalReports === 0 ? (
            <EmptyChart title="No reports yet" message="Severity rolls up from concentration / pricing / participant / operational signals." />
          ) : (
            <BarChart
              data={(['info', 'warning', 'critical'] as const).map(s => ({
                label: s, value: summary.bySeverity[s] ?? 0, color: severityColor[s],
              }))}
              valueFormatter={v => `${v}`}
              height={200}
            />
          )}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Verdict × severity heatmap</h3>
        {reports.length === 0 ? (
          <EmptyChart title="No data" message="Generate at least one report to populate the heatmap." />
        ) : (
          <HeatmapGrid
            cells={heatmapCells}
            rowLabels={[verdictLabel.healthy, verdictLabel.monitor, verdictLabel.elevated_risk]}
            colLabels={['info', 'warning', 'critical']}
            valueFormatter={v => v == null ? '—' : `${v}`}
          />
        )}
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recent reports ({Math.min(reports.length, 12)})</h3>
        {reports.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No reports yet.</div>
        ) : (
          <RecentTable reports={reports.slice(0, 12)} openReport={openReport} />
        )}
      </div>
    </>
  );
}

function RecentTable({ reports, openReport }: any) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Generated</th><th style={th}>Wager</th><th style={th}>Kind</th>
            <th style={th}>Verdict</th><th style={th}>Severity</th><th style={th}>Score</th>
            <th style={th}>Warnings</th><th style={th}>Top user %</th><th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r: any) => (
            <tr key={r.id}>
              <td style={td}>{formatDMYTime(r.generatedAt)}</td>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.wagerTicketNumber ?? r.wagerId.slice(0, 12)}</td>
              <td style={td}><span style={badge(kindColor[r.wagerKind] ?? '#64748b')}>{r.wagerKind}</span></td>
              <td style={td}><span style={badge(verdictColor[r.verdict])}>{verdictLabel[r.verdict]}</span></td>
              <td style={td}><span style={badge(severityColor[r.severity])}>{r.severity}</span></td>
              <td style={td}>{r.integrityScore}</td>
              <td style={td}>{(r.warnings ?? []).length}</td>
              <td style={td}>{r.concentrationMetrics?.topUserPct ?? 0}%</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <button type="button" onClick={() => openReport(r.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Reports ──────────────────────────────────────────────────────────────────

function ReportsView({ reports, activeReport, openReport, setActiveReport }: any) {
  if (reports.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No integrity reports yet.</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Reports ({reports.length})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reports.map((r: any) => (
            <button key={r.id} type="button" onClick={() => openReport(r.id)}
              style={{
                ...tile, textAlign: 'left', cursor: 'pointer',
                border: r.id === activeReport?.id ? '1px solid #6366f1' : '1px solid #1e293b',
                background: r.id === activeReport?.id ? '#312e81' : '#0f172a',
              }}
              title="Open this report">
              <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={badge(verdictColor[r.verdict])}>{verdictLabel[r.verdict]}</span>
                <span style={badge(severityColor[r.severity])}>{r.severity}</span>
                <span style={{ fontSize: 11, fontWeight: 700 }}>score {r.integrityScore}</span>
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1', fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.wagerTicketNumber ?? r.wagerId.slice(0, 12)}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{formatDMYTime(r.generatedAt)}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        {activeReport ? <ReportDetail r={activeReport} /> : (
          <div style={{ ...card, color: '#94a3b8' }}>Pick a report on the left.</div>
        )}
      </div>
    </div>
  );
}

function ReportDetail({ r }: { r: any }) {
  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{r.context?.title ?? r.wagerTicketNumber}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={badge(verdictColor[r.verdict])}>{verdictLabel[r.verdict]}</span>
            <span style={badge(severityColor[r.severity])}>{r.severity}</span>
            <span style={badge(kindColor[r.wagerKind] ?? '#64748b')}>{r.wagerKind}</span>
            <span style={badge(statusColor[r.marketStatus] ?? '#64748b')}>{r.marketStatus}</span>
          </div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <GaugeIndicator value={r.integrityScore / 100} label="Integrity score" sublabel={`${r.warnings.length} warning(s)`} height={180} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <Field label="Participants" value={`${r.participantCount}`} />
            <Field label="Total stake" value={fmtUsd(r.totalStake)} />
            <Field label="Top user %" value={`${r.concentrationMetrics?.topUserPct ?? 0}%`} />
            <Field label="Top 5 %" value={`${r.concentrationMetrics?.top5Pct ?? 0}%`} />
            <Field label="HHI" value={r.concentrationMetrics?.herfindahlIndex == null ? '—' : `${r.concentrationMetrics.herfindahlIndex}`} />
            <Field label="Implied hold" value={r.pricingSignals?.impliedHoldPct == null ? '—' : `${r.pricingSignals.impliedHoldPct}%`} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
          Wager id <code>{r.wagerId}</code> · generated {formatDMYTime(r.generatedAt)} by {r.generatedBy}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <SignalCard title="Pricing signals" signals={[
          ['Negative hold', r.pricingSignals?.negativeHoldWarning],
          ['Unusual odds movement', r.pricingSignals?.unusualOddsMovement],
          ['Stale pricing', r.pricingSignals?.stalePricingWarning],
        ]} notes={r.pricingSignals?.notes} />
        <SignalCard title="Participant signals" signals={[
          ['One-sided action', r.participantSignals?.repeatedOneSidedAction],
          ['Excessive long-shot exposure', r.participantSignals?.excessiveLongshotExposure],
          ['Rapid betting spike', r.participantSignals?.rapidBettingSpike],
          ['Possible correlated accounts (info)', r.participantSignals?.correlatedAccountsWarning],
        ]} notes={r.participantSignals?.notes} />
        <SignalCard title="Operational signals" signals={[
          ['Unresolved after event', r.operationalSignals?.unresolvedAfterEvent],
          ['Grading delay', r.operationalSignals?.gradingDelayWarning],
          ['Excessive void history', r.operationalSignals?.excessiveVoidHistory],
          ['Low liquidity', r.operationalSignals?.lowLiquidity],
        ]} notes={r.operationalSignals?.notes} />
      </div>

      {(r.warnings ?? []).length > 0 && (
        <div style={{ ...card, background: '#3f1d1d', borderLeft: '3px solid #ef4444' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>Warnings ({r.warnings.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {r.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {(r.recommendations ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Recommendations</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
            {r.recommendations.map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

function SignalCard({ title, signals, notes }: { title: string; signals: [string, boolean][]; notes?: string[] }) {
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: 12 }}>
        {signals.map(([label, on]) => (
          <li key={label} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1e293b', padding: '4px 0', color: '#cbd5e1' }}>
            <span>{label}</span>
            <span style={badge(on ? '#ef4444' : '#22c55e')}>{on ? 'flagged' : 'ok'}</span>
          </li>
        ))}
      </ul>
      {(notes ?? []).length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
          <div style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>notes</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {(notes ?? []).map((n: string, i: number) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Concentration ────────────────────────────────────────────────────────────

function ConcentrationView({ reports, openReport }: { reports: any[]; openReport: (id: string) => void }) {
  if (reports.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No reports yet — concentration metrics show up here once you've analyzed at least one wager.</div>;
  }
  const flagged = reports.filter(r => r.concentrationMetrics?.topUserPct >= 25 || r.concentrationMetrics?.top5Pct >= 60);
  const sorted = reports.slice().sort((a, b) => (b.concentrationMetrics?.topUserPct ?? 0) - (a.concentrationMetrics?.topUserPct ?? 0));

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top single-user exposure</h3>
        <BarChart
          data={sorted.slice(0, 10).map(r => ({
            label: r.wagerTicketNumber ?? r.wagerId.slice(0, 8),
            value: r.concentrationMetrics?.topUserPct ?? 0,
            color: (r.concentrationMetrics?.topUserPct ?? 0) >= 25 ? '#ef4444' : '#22c55e',
          }))}
          valueFormatter={v => `${v}%`}
          height={220}
        />
      </div>

      {flagged.length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Flagged for concentration ({flagged.length})</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Wager</th><th style={th}>Top user %</th><th style={th}>Top 5 %</th><th style={th}>HHI</th><th style={th}>Participants</th><th style={th}></th></tr></thead>
            <tbody>
              {flagged.map(r => (
                <tr key={r.id}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.wagerTicketNumber ?? r.wagerId.slice(0, 12)}</td>
                  <td style={{ ...td, color: r.concentrationMetrics.topUserPct >= 25 ? '#ef4444' : '#22c55e' }}>{r.concentrationMetrics.topUserPct}%</td>
                  <td style={{ ...td, color: r.concentrationMetrics.top5Pct >= 60 ? '#ef4444' : '#22c55e' }}>{r.concentrationMetrics.top5Pct}%</td>
                  <td style={td}>{r.concentrationMetrics.herfindahlIndex ?? '—'}</td>
                  <td style={td}>{r.participantCount}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => openReport(r.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Operational ──────────────────────────────────────────────────────────────

function OperationalView({ reports, unresolvedTargets, analyze, busy, openReport }: any) {
  const opFlagged = reports.filter((r: any) =>
    r.operationalSignals?.unresolvedAfterEvent
    || r.operationalSignals?.gradingDelayWarning
    || r.operationalSignals?.excessiveVoidHistory
    || r.operationalSignals?.lowLiquidity,
  );

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Unresolved markets ({unresolvedTargets.length})</h3>
        {unresolvedTargets.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No open or locked wagers awaiting resolution.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Ticket</th><th style={th}>Title</th><th style={th}>Kind</th><th style={th}>Status</th><th style={th}>Target date</th><th style={th}></th></tr></thead>
            <tbody>
              {unresolvedTargets.map((t: any) => (
                <tr key={t.id}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{t.ticketNumber}</td>
                  <td style={td}>{t.title}</td>
                  <td style={td}><span style={badge(kindColor[t.kind] ?? '#64748b')}>{t.kind}</span></td>
                  <td style={td}><span style={badge(statusColor[t.status] ?? '#64748b')}>{t.status}</span></td>
                  <td style={td}>{t.targetDate}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => analyze(t.id)} disabled={!!busy}
                      style={{ ...btn('#22c55e'), padding: '4px 10px', marginRight: 6 }}
                      title="Generate an integrity report. Read-only — does not change wager status.">
                      {busy === `analyze-${t.id}` ? 'Analyzing…' : 'Analyze'}
                    </button>
                    <a href="/admin/system/wager-resolution" style={{ ...btn('#0ea5e9'), padding: '4px 10px' }}>Go to Resolution →</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Reports with operational warnings ({opFlagged.length})</h3>
        {opFlagged.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No operational warnings on file.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Wager</th><th style={th}>Unresolved</th><th style={th}>Grading delay</th><th style={th}>Void history</th><th style={th}>Low liquidity</th><th style={th}></th></tr></thead>
            <tbody>
              {opFlagged.map((r: any) => (
                <tr key={r.id}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.wagerTicketNumber ?? r.wagerId.slice(0, 12)}</td>
                  <td style={td}>{r.operationalSignals?.unresolvedAfterEvent ? '✗' : '—'}</td>
                  <td style={td}>{r.operationalSignals?.gradingDelayWarning ? '✗' : '—'}</td>
                  <td style={td}>{r.operationalSignals?.excessiveVoidHistory ? '✗' : '—'}</td>
                  <td style={td}>{r.operationalSignals?.lowLiquidity ? '✗' : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => openReport(r.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── Methodology ──────────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Signal categories</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>Concentration</strong> — top user %, top 5 %, Herfindahl-Hirschman index across non-void bets.</li>
          <li><strong>Pricing</strong> — implied hold from current odds; line-history / opening-vs-closing snapshot diffs; stale opening pricing snapshot (&gt;24h before lock); negative hold flag.</li>
          <li><strong>Participant</strong> — one-sided action (≥75% on a single outcome), excessive long-shot exposure (≥30% on bets ≥+500), rapid spike (≥5 bets in 60s), possible correlated accounts (informational only).</li>
          <li><strong>Operational</strong> — unresolved &gt;1d after target date; locked but ungraded &gt;48h; excessive void history (≥5 voids in last 30d); low liquidity (&lt;3 users or &lt;$50 total stake on a settled-stage market).</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Score & verdict</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Score starts at 100 and deducts per flagged signal (e.g. -15 for negative hold, -12 for unresolved, -12 for top-user concentration, etc.).</li>
          <li>Severity escalates from <code>info</code> → <code>warning</code> → <code>critical</code>; <code>unresolvedAfterEvent</code> is the primary critical-bumping signal.</li>
          <li>Verdict: <code>healthy</code> if score ≥ 75 and no warnings; <code>monitor</code> if score 50–74 or any warning; <code>elevated_risk</code> if score &lt; 50 or any critical signal.</li>
          <li>Score is clamped to [0, 100].</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>No account bans or suspensions. The lib has no <code>security-store</code> mutation imports.</li>
          <li>No automatic enforcement actions. Every "fix" routes the operator to the appropriate manual workflow (Wager Resolution, Settlement Preview, Pricing Engine).</li>
          <li>No wager mutation. Reports are pure observation — wager status, outcomes, and pricing are never changed by this page.</li>
          <li>No balance or payout logic.</li>
          <li>No pricing mutation.</li>
          <li>Writes confined to <code>integrity-report:*</code>, <code>integrity-reports:all</code>, <code>integrity-report:wager:&#123;wagerId&#125;</code>, plus the audit log.</li>
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</div>
    </div>
  );
}
