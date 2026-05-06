import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';
import { BarChart, GaugeIndicator, EmptyChart } from './charts';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const verdictColor: Record<string, string> = { normal: '#22c55e', monitor: '#f59e0b', elevated_risk: '#ef4444' };
const verdictLabel: Record<string, string> = { normal: 'Normal', monitor: 'Monitor', elevated_risk: 'Elevated Risk' };
const sevColor: Record<string, string> = { info: '#22c55e', warning: '#f59e0b', critical: '#ef4444' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'overview' | 'reports' | 'responsible' | 'integrity' | 'methodology';

function fmtUsd(cents: number, signed = false): string {
  const sign = cents < 0 ? '-' : (signed && cents > 0 ? '+' : '');
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function isoDate(d: string): string { return new Date(d).toISOString(); }

export default function UserRiskMonitoringCenter() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Picker / period
  const [pickedUserId, setPickedUserId] = useState('');
  const [periodDays, setPeriodDays] = useState(30);

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/user-risk-monitoring?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/user-risk-monitoring', {
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
      setUsers(j.users ?? []);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function generate(userId: string) {
    if (!userId.trim()) { setError('Pick or enter a user id.'); return; }
    setBusy(`gen-${userId}`); setError(null);
    try {
      const periodEnd = new Date().toISOString();
      const periodStart = new Date(Date.now() - periodDays * 24 * 3_600_000).toISOString();
      const j = await post({ action: 'generate', userId: userId.trim(), periodStart, periodEnd });
      setActive(j.report);
      setTab('reports');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function open(id: string) {
    setBusy(`open-${id}`); setError(null);
    try {
      const j = await get('get-report', { id });
      setActive(j.report);
      setTab('reports');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading user risk monitoring…</div>;
  if (!summary) return null;

  const elevatedReports = useMemo(() => reports.filter((r: any) => r.verdict === 'elevated_risk'), [reports]);

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/user-risk-monitoring" /></div>

      <div style={BANNER}>
        <span>🛡️ User Risk Monitoring is <strong>advisory only</strong>. It does not ban, limit, freeze, notify, or restrict users automatically.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Audit-logged · Read-only signals</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>User Risk & Responsible Play</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Surfaces patterns that may indicate unhealthy user behavior or unusual activity — without restricting accounts.
            Pick a user, choose a period, and generate a read-only report. Findings route to existing manual workflows for follow-up.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/command-center" style={btn('#0ea5e9')}>Command Center →</a>
          <a href="/admin/system/market-integrity" style={btn('#0ea5e9')}>Market Integrity →</a>
          <button type="button" onClick={reload} disabled={!!busy} style={btn('#6366f1')}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Reports" value={summary.totalReports} />
          <Stat label="Elevated risk" value={summary.byVerdict.elevated_risk} color={verdictColor.elevated_risk} />
          <Stat label="Monitor" value={summary.byVerdict.monitor} color={verdictColor.monitor} />
          <Stat label="Normal" value={summary.byVerdict.normal} color={verdictColor.normal} />
          <Stat label="Critical" value={summary.bySeverity.critical} color={sevColor.critical} />
          <Stat label="Warnings" value={summary.bySeverity.warning} color={sevColor.warning} />
          <Stat label="Avg risk score" value={summary.averageRiskScore ?? '—'} color={(summary.averageRiskScore ?? 100) < 75 ? '#f59e0b' : '#22c55e'} />
          <Stat label="Unique users" value={summary.uniqueUsers} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['overview', 'Overview'],
          ['reports', `User Reports (${reports.length})`],
          ['responsible', `Responsible Play Signals`],
          ['integrity', `Integrity Signals`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewView
          summary={summary} reports={reports} users={users} elevatedReports={elevatedReports}
          pickedUserId={pickedUserId} setPickedUserId={setPickedUserId}
          periodDays={periodDays} setPeriodDays={setPeriodDays}
          generate={generate} open={open} busy={busy}
        />
      )}
      {tab === 'reports' && (
        <ReportsView reports={reports} active={active} setActive={setActive} open={open} />
      )}
      {tab === 'responsible' && (
        <ResponsibleSignalsView reports={reports} open={open} />
      )}
      {tab === 'integrity' && (
        <IntegritySignalsView reports={reports} open={open} />
      )}
      {tab === 'methodology' && <MethodologyView />}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ summary, reports, users, elevatedReports, pickedUserId, setPickedUserId, periodDays, setPeriodDays, generate, open, busy }: any) {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Generate a report</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Pick user
            <select value={pickedUserId} onChange={(e: any) => setPickedUserId(e.target.value)}
              style={{ ...input, width: '100%', marginTop: 4 }}>
              <option value="">— pick or type below —</option>
              {users.map((u: any) => (
                <option key={u.userId} value={u.userId}>
                  {u.userId} · {u.betCount} bets · ${(u.totalStakeCents / 100).toFixed(0)} stake{u.hasReport ? ' · has report' : ''}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            User id
            <input style={{ ...input, width: '100%', marginTop: 4 }} placeholder="e.g. user-..." value={pickedUserId} onChange={e => setPickedUserId(e.target.value)} />
          </label>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Lookback (days)
            <input type="number" min={1} max={365} style={{ ...input, width: '100%', marginTop: 4 }}
              value={periodDays} onChange={e => setPeriodDays(parseInt(e.target.value || '30', 10))} />
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" onClick={() => generate(pickedUserId)} disabled={!pickedUserId.trim() || !!busy}
              style={btn(busy?.startsWith('gen') ? '#475569' : '#22c55e')}
              title="Pulls bet data and computes signals. Read-only — no user notification, no balance change.">
              {busy?.startsWith('gen') ? 'Generating…' : 'Generate Report'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Verdict distribution</h3>
          {summary.totalReports === 0 ? (
            <EmptyChart title="No reports" message="Generate a report above to populate this chart." />
          ) : (
            <BarChart
              data={(['normal', 'monitor', 'elevated_risk'] as const).map(v => ({
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
            <EmptyChart title="No data" message="Severity rolls up from responsible-play and integrity signals." />
          ) : (
            <BarChart
              data={(['info', 'warning', 'critical'] as const).map(s => ({
                label: s, value: summary.bySeverity[s] ?? 0, color: sevColor[s],
              }))}
              valueFormatter={v => `${v}`}
              height={200}
            />
          )}
        </div>
      </div>

      {elevatedReports.length > 0 && (
        <div style={{ ...card, background: '#3f1d1d', borderLeft: '4px solid #dc2626' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>
            🚨 {elevatedReports.length} report(s) at elevated risk
          </h3>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {elevatedReports.slice(0, 5).map((r: any) => (
              <li key={r.id}>
                <button type="button" onClick={() => open(r.id)} style={{ background: 'none', border: 'none', color: '#fecaca', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 12 }}>
                  {r.userId}
                </button>
                <span style={{ marginLeft: 6, color: '#fca5a5' }}>· score {r.riskScore} · {r.totalBets} bets</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recent reports ({Math.min(reports.length, 12)})</h3>
        {reports.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No reports yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Generated</th><th style={th}>User</th><th style={th}>Verdict</th>
                  <th style={th}>Severity</th><th style={th}>Score</th><th style={th}>Bets</th>
                  <th style={th}>Stake</th><th style={th}>Warnings</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {reports.slice(0, 12).map((r: any) => (
                  <tr key={r.id}>
                    <td style={td}>{new Date(r.generatedAt).toLocaleString()}</td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.userId}</td>
                    <td style={td}><span style={badge(verdictColor[r.verdict])}>{verdictLabel[r.verdict]}</span></td>
                    <td style={td}><span style={badge(sevColor[r.severity])}>{r.severity}</span></td>
                    <td style={td}>{r.riskScore}</td>
                    <td style={td}>{r.totalBets}</td>
                    <td style={td}>{fmtUsd(r.totalStake)}</td>
                    <td style={td}>{(r.warnings ?? []).length}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => open(r.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
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

// ── Reports ──────────────────────────────────────────────────────────────────

function ReportsView({ reports, active, setActive, open }: any) {
  if (reports.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No reports yet. Generate one from the Overview tab.</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Reports</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reports.map((r: any) => (
            <button key={r.id} type="button" onClick={() => open(r.id)}
              style={{
                ...tile, textAlign: 'left', cursor: 'pointer',
                border: r.id === active?.id ? '1px solid #6366f1' : '1px solid #1e293b',
                background: r.id === active?.id ? '#312e81' : '#0f172a',
              }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={badge(verdictColor[r.verdict])}>{verdictLabel[r.verdict]}</span>
                <span style={badge(sevColor[r.severity])}>{r.severity}</span>
                <span style={{ fontSize: 11, fontWeight: 700 }}>score {r.riskScore}</span>
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1', fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.userId}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{new Date(r.generatedAt).toLocaleString()} · {r.totalBets} bets</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        {active ? <ReportDetail r={active} /> : (
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
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.userId}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={badge(verdictColor[r.verdict])}>{verdictLabel[r.verdict]}</span>
            <span style={badge(sevColor[r.severity])}>{r.severity}</span>
            <span style={badge('#475569')}>{r.status}</span>
          </div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <GaugeIndicator value={r.riskScore / 100} label="Risk score" sublabel={`${(r.warnings ?? []).length} warning(s)`} height={180} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <Field label="Period" value={`${r.periodStart.slice(0, 10)} → ${r.periodEnd.slice(0, 10)}`} />
            <Field label="Total bets" value={String(r.totalBets)} />
            <Field label="Total stake" value={fmtUsd(r.totalStake)} />
            <Field label="Net result (settled)" value={r.netResultEstimate == null ? '—' : fmtUsd(r.netResultEstimate, true)} />
            <Field label="Long-shot stake %" value={`${r.longshotStakePct}%`} />
            <Field label="Max bets / 60min" value={String(r.rapidBettingSignals?.maxBetsInWindow ?? 0)} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
          Report id <code>{r.id}</code> · generated {new Date(r.generatedAt).toLocaleString()} by {r.generatedBy}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <SignalCard title="Responsible play signals" signals={[
          ['High-frequency activity', r.responsiblePlaySignals?.highFrequencyActivity],
          ['Chasing pattern', r.responsiblePlaySignals?.chasingPatternWarning],
          ['Oversized stake', r.responsiblePlaySignals?.oversizedStakeWarning],
          ['Late-night activity', r.responsiblePlaySignals?.lateNightActivityWarning],
          ['Repeated long-shot exposure', r.responsiblePlaySignals?.repeatedLongshotWarning],
        ]} notes={r.responsiblePlaySignals?.notes} />
        <SignalCard title="Integrity signals" signals={[
          ['Correlated market activity', r.integritySignals?.correlatedMarketActivity],
          ['Unusual outcome concentration', r.integritySignals?.unusualOutcomeConcentration],
          ['Possible multi-account pattern (info)', r.integritySignals?.possibleMultiAccountPattern],
        ]} notes={r.integritySignals?.notes} />
      </div>

      {r.repeatedLossSignals && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Repeated-loss signal</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <Field label="Max loss streak" value={String(r.repeatedLossSignals.consecutiveLossStreak)} />
            <Field label="Avg stake post-loss" value={r.repeatedLossSignals.averageStakePostLoss == null ? '—' : fmtUsd(r.repeatedLossSignals.averageStakePostLoss)} />
            <Field label="Avg stake post-win" value={r.repeatedLossSignals.averageStakePostWin == null ? '—' : fmtUsd(r.repeatedLossSignals.averageStakePostWin)} />
            <Field label="Post-loss / post-win ratio" value={r.repeatedLossSignals.ratioPostLossToPostWin == null ? '—' : `${r.repeatedLossSignals.ratioPostLossToPostWin}×`} />
          </div>
        </div>
      )}

      {(r.concentrationByMarket ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Concentration by market (top {Math.min(r.concentrationByMarket.length, 10)})</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Wager</th><th style={th}>Bets</th><th style={th}>Stake</th><th style={th}>% of total</th></tr></thead>
            <tbody>
              {r.concentrationByMarket.map((c: any) => (
                <tr key={c.wagerId}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{c.wagerId}</td>
                  <td style={td}>{c.betCount}</td>
                  <td style={td}>{fmtUsd(c.stakeCents)}</td>
                  <td style={{ ...td, color: c.pctOfTotal >= 30 ? '#ef4444' : '#cbd5e1' }}>{c.pctOfTotal}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(r.warnings ?? []).length > 0 && (
        <div style={{ ...card, background: '#3f1d1d', borderLeft: '3px solid #ef4444' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>Warnings ({r.warnings.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {r.warnings.map((w: string, idx: number) => <li key={idx}>{w}</li>)}
          </ul>
        </div>
      )}

      {(r.recommendations ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Recommended admin follow-up (advisory)</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
            {r.recommendations.map((x: string, idx: number) => <li key={idx}>{x}</li>)}
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

// ── Responsible play tab ────────────────────────────────────────────────────

function ResponsibleSignalsView({ reports, open }: { reports: any[]; open: (id: string) => void }) {
  const flagged = reports.filter((r: any) => {
    const s = r.responsiblePlaySignals;
    return s && (s.highFrequencyActivity || s.chasingPatternWarning || s.oversizedStakeWarning || s.lateNightActivityWarning || s.repeatedLongshotWarning);
  });
  if (flagged.length === 0) {
    return <div style={{ ...card, color: '#22c55e' }}>✓ No reports flagged for responsible-play signals.</div>;
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Responsible-play flags ({flagged.length})</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>User</th><th style={th}>Verdict</th><th style={th}>HF</th>
              <th style={th}>Chasing</th><th style={th}>Oversize</th><th style={th}>Late-night</th>
              <th style={th}>Long-shots</th><th style={th}>Score</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {flagged.map((r: any) => (
              <tr key={r.id}>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.userId}</td>
                <td style={td}><span style={badge(verdictColor[r.verdict])}>{verdictLabel[r.verdict]}</span></td>
                <td style={td}>{r.responsiblePlaySignals.highFrequencyActivity ? '✗' : '—'}</td>
                <td style={td}>{r.responsiblePlaySignals.chasingPatternWarning ? '✗' : '—'}</td>
                <td style={td}>{r.responsiblePlaySignals.oversizedStakeWarning ? '✗' : '—'}</td>
                <td style={td}>{r.responsiblePlaySignals.lateNightActivityWarning ? '✗' : '—'}</td>
                <td style={td}>{r.responsiblePlaySignals.repeatedLongshotWarning ? '✗' : '—'}</td>
                <td style={td}>{r.riskScore}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => open(r.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Integrity signals tab ───────────────────────────────────────────────────

function IntegritySignalsView({ reports, open }: { reports: any[]; open: (id: string) => void }) {
  const flagged = reports.filter((r: any) => {
    const s = r.integritySignals;
    return s && (s.correlatedMarketActivity || s.unusualOutcomeConcentration || s.possibleMultiAccountPattern);
  });
  if (flagged.length === 0) {
    return <div style={{ ...card, color: '#22c55e' }}>✓ No reports flagged for integrity signals.</div>;
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Integrity flags ({flagged.length})</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>User</th><th style={th}>Verdict</th><th style={th}>Correlated</th>
              <th style={th}>Outcome conc.</th><th style={th}>Multi-account (info)</th><th style={th}>Score</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {flagged.map((r: any) => (
              <tr key={r.id}>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{r.userId}</td>
                <td style={td}><span style={badge(verdictColor[r.verdict])}>{verdictLabel[r.verdict]}</span></td>
                <td style={td}>{r.integritySignals.correlatedMarketActivity ? '✗' : '—'}</td>
                <td style={td}>{r.integritySignals.unusualOutcomeConcentration ? '✗' : '—'}</td>
                <td style={td}>{r.integritySignals.possibleMultiAccountPattern ? '✗' : '—'}</td>
                <td style={td}>{r.riskScore}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => open(r.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
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
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Responsible-play signals</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>High-frequency activity</strong> — &gt; 20 bets within any 60-minute window in the period.</li>
          <li><strong>Chasing pattern</strong> — average stake after a loss ≥ 1.3× the average after a win.</li>
          <li><strong>Oversized stake</strong> — single bet ≥ 5× the user's median stake.</li>
          <li><strong>Late-night activity</strong> — ≥ 30% of bets between 00:00 and 05:00 UTC.</li>
          <li><strong>Repeated long-shot exposure</strong> — ≥ 30% of stake on bets at odds ≥ +500.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Integrity signals</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>Correlated market activity</strong> — ≥ 4 bets on the same outcome label within a 60-second window.</li>
          <li><strong>Unusual outcome concentration</strong> — ≥ 70% of stake on a single outcome label across markets.</li>
          <li><strong>Possible multi-account pattern</strong> — informational only. We don't have cross-user data here, so this is held to a high bar and currently never auto-flagged.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Risk score / verdict</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Score starts at 100 and deducts per flagged signal (chasing -18, high-frequency -15, oversized -12, repeated long-shot -10, late-night -6, etc.).</li>
          <li>Severity escalates from <code>info</code> → <code>warning</code> → <code>critical</code>; chasing + repeated long-shot together is the primary critical-bumping combination.</li>
          <li>Verdict: <code>normal</code> if score ≥ 75 and no warnings; <code>monitor</code> if score 50–74 or any warning; <code>elevated_risk</code> if score &lt; 50 or any critical signal.</li>
          <li>No bet data → score capped at 70 with a "no data" warning.</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>The lib only imports <code>getRedis</code>, <code>logAuditEvent</code>, <code>listAllWagers</code> (read), <code>getUserBets</code> (read), <code>getWagerBets</code> (read).</li>
          <li>No account restrictions, no user notifications, no balance changes, no wager blocking, no pricing or grading mutations.</li>
          <li>Findings route to existing manual workflows for follow-up — Market Integrity, Wager Resolution, Incident Management, Dispute Workflow.</li>
          <li>Writes confined to <code>user-risk-report:&#123;id&#125;</code>, <code>user-risk-reports:all</code>, <code>user-risk-report:user:&#123;userId&#125;</code>, plus the audit log.</li>
          <li>Audit event: <code>user_risk_report_generated</code>.</li>
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
