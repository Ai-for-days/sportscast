import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';
import { BarChart, GaugeIndicator, HeatmapGrid, LineChart, EmptyChart } from './charts';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const verdictColor: Record<string, string> = {
  not_ready: '#ef4444', needs_practice: '#f59e0b', certification_ready: '#3b82f6',
  certified: '#22c55e', expired: '#64748b',
};
const verdictLabel: Record<string, string> = {
  not_ready: 'Not Ready', needs_practice: 'Needs Practice', certification_ready: 'Certification Ready',
  certified: 'Certified', expired: 'Expired',
};
const certStatusColor: Record<string, string> = {
  not_started: '#475569', in_training: '#3b82f6', certification_ready: '#06b6d4',
  certified: '#22c55e', expired: '#64748b', revoked: '#ef4444',
};
const typeColor: Record<string, string> = {
  signal_review: '#06b6d4', risk_review: '#a855f7', pilot_review: '#22c55e',
  execution_playbook: '#f59e0b', incident_response: '#ef4444',
};
const typeLabel: Record<string, string> = {
  signal_review: 'Signal Review', risk_review: 'Risk Review', pilot_review: 'Pilot Review',
  execution_playbook: 'Execution Playbook', incident_response: 'Incident Response',
};

const ADVISORY_BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'operators' | 'detail' | 'records' | 'expiring' | 'methodology';

export default function OperatorCertification() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('operators');
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/operator-certification?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/operator-certification', {
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
    try { setData(await get('summary')); } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function certify(operatorId: string, validityDays: number, note: string) {
    setBusy(`certify-${operatorId}`); setError(null);
    try { await post({ action: 'certify-operator', operatorId, validityDays, note }); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function revoke(certId: string, reason: string) {
    setBusy(`revoke-${certId}`); setError(null);
    try { await post({ action: 'revoke-certification', certId, reason }); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }
  async function expire(certId: string) {
    setBusy(`expire-${certId}`); setError(null);
    try { await post({ action: 'expire-certification', certId }); await reload(); }
    catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading certification…</div>;
  if (error && !data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {error}</div>;
  if (!data) return null;

  const operators: any[] = data.operators ?? [];
  const certifications: any[] = data.certifications ?? [];
  const summary = data.summary;
  const selected = selectedOpId ? operators.find(o => o.operatorId === selectedOpId) ?? null : operators[0] ?? null;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/operator-certification" /></div>

      <div style={ADVISORY_BANNER}>
        <span>🛡️ ADVISORY ONLY — certification is a governance recommendation. It does not grant RBAC roles, enable live execution, or change permissions automatically.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Manual · Audit-logged</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Operator Certification</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Readiness tracking from training sessions + manual certification ledger.{' '}
            <strong>No real trading, no order submission, no RBAC changes</strong> — certifying an operator records governance approval only.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/operator-training" style={btn('#a855f7')}>Training →</a>
          <a href="/admin/security" style={btn('#0ea5e9')}>Security / RBAC →</a>
          <button onClick={reload} style={btn('#6366f1')} disabled={!!busy}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>Error: {error}</div>}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Operators" value={summary.totalOperators} />
          <Stat label="Certified"          value={summary.byVerdict.certified}          color={verdictColor.certified} />
          <Stat label="Cert ready"         value={summary.byVerdict.certification_ready} color={verdictColor.certification_ready} />
          <Stat label="Needs practice"     value={summary.byVerdict.needs_practice}     color={verdictColor.needs_practice} />
          <Stat label="Not ready"          value={summary.byVerdict.not_ready}          color={verdictColor.not_ready} />
          <Stat label="Expired / revoked" value={`${summary.byCertStatus.expired ?? 0}/${summary.byCertStatus.revoked ?? 0}`} color={verdictColor.expired} />
          <Stat label="Expiring ≤30d"      value={summary.expiringSoonCount}            color="#f59e0b" />
          <Stat label="Avg score"          value={summary.averageScoreAcrossAll ?? '—'} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['operators',   `Operators (${operators.length})`],
          ['detail',      'Readiness Detail'],
          ['records',     `Certification Records (${certifications.length})`],
          ['expiring',    `Expiring / Expired`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'operators' && (
        <OperatorsView
          operators={operators} summary={summary}
          selected={selected} setSelectedOpId={setSelectedOpId}
          certify={certify} revoke={revoke} busy={busy} setTab={setTab}
        />
      )}
      {tab === 'detail' && (
        <DetailView operators={operators} selected={selected} setSelectedOpId={setSelectedOpId} certify={certify} revoke={revoke} expire={expire} busy={busy} />
      )}
      {tab === 'records' && <RecordsView certifications={certifications} revoke={revoke} expire={expire} busy={busy} />}
      {tab === 'expiring' && <ExpiringView certifications={certifications} />}
      {tab === 'methodology' && <MethodologyView />}
    </div>
  );
}

// ── Operators tab ───────────────────────────────────────────────────────────

function OperatorsView({ operators, summary, selected, setSelectedOpId, certify, revoke, busy, setTab }: any) {
  if (operators.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No operators have completed any training sessions yet.</div>;
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Verdict distribution</h3>
          <BarChart
            data={(['not_ready', 'needs_practice', 'certification_ready', 'certified', 'expired'] as const).map(v => ({
              label: verdictLabel[v], value: summary.byVerdict[v] ?? 0, color: verdictColor[v],
            }))}
            valueFormatter={v => `${v}`}
            height={180}
          />
        </div>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Cert status distribution</h3>
          <BarChart
            data={(['not_started', 'in_training', 'certification_ready', 'certified', 'expired', 'revoked'] as const).map(s => ({
              label: s, value: summary.byCertStatus[s] ?? 0, color: certStatusColor[s],
            }))}
            valueFormatter={v => `${v}`}
            height={180}
          />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Operator readiness</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Operator</th><th style={th}>Verdict</th><th style={th}>Sessions</th>
                <th style={th}>Avg score</th><th style={th}>Coverage</th><th style={th}>Last training</th>
                <th style={th}>Active cert</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {operators.map((o: any) => (
                <tr key={o.operatorId} style={{ background: o.operatorId === selected?.operatorId ? '#312e81' : undefined }}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{o.operatorId}</td>
                  <td style={td}><span style={badge(verdictColor[o.verdict])}>{verdictLabel[o.verdict]}</span></td>
                  <td style={td}>{o.completedSessions}</td>
                  <td style={{ ...td, fontWeight: 700, color: o.averageScore == null ? '#94a3b8' : o.averageScore >= 80 ? '#22c55e' : '#f59e0b' }}>
                    {o.averageScore ?? '—'}
                  </td>
                  <td style={td}>{o.coverageCount}/5</td>
                  <td style={td}>{o.lastCompletedAt ? new Date(o.lastCompletedAt).toLocaleDateString() : '—'}{o.daysSinceLast != null && ` (${o.daysSinceLast}d)`}</td>
                  <td style={td}>{o.activeCertification ? (
                    <span style={badge(verdictColor.certified)}>certified · expires {o.activeCertification.expiresAt?.slice(0, 10) ?? '?'}</span>
                  ) : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => { setSelectedOpId(o.operatorId); setTab('detail'); }} style={{ ...btn('#475569'), padding: '4px 10px' }}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── Detail tab ──────────────────────────────────────────────────────────────

function DetailView({ operators, selected, setSelectedOpId, certify, revoke, expire, busy }: any) {
  const [validityDays, setValidityDays] = useState(90);
  const [certNote, setCertNote] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [showRevoke, setShowRevoke] = useState(false);

  if (!selected) {
    return <div style={{ ...card, color: '#94a3b8' }}>Pick an operator from the Operators tab.</div>;
  }

  const o = selected;
  const cov = o.scenarioCoverage ?? [];

  // Score trend → LineChart
  const trend = (o.scoreTrend ?? []).map((p: any, i: number) => ({ x: `${i + 1}`, y: p.score }));

  // Coverage heatmap (single-row "best" + "completed")
  const types = ['signal_review', 'risk_review', 'pilot_review', 'execution_playbook', 'incident_response'] as const;
  const heatCells = [
    ...types.map(t => {
      const c = cov.find((x: any) => x.scenarioType === t);
      return { row: 'Best score', col: typeLabel[t], value: c?.bestScore ?? null };
    }),
    ...types.map(t => {
      const c = cov.find((x: any) => x.scenarioType === t);
      return { row: 'Completed', col: typeLabel[t], value: c?.completedCount ?? 0 };
    }),
  ];

  const canCertify = o.verdict === 'certification_ready' || o.verdict === 'expired' || o.verdict === 'needs_practice';

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, fontFamily: 'ui-monospace, Menlo, monospace' }}>{o.operatorId}</h2>
          <span style={badge(verdictColor[o.verdict])}>{verdictLabel[o.verdict]}</span>
        </div>
        <select value={o.operatorId} onChange={e => setSelectedOpId(e.target.value)}
          style={{ ...input, marginTop: 8, minWidth: 260 }}>
          {operators.map((x: any) => <option key={x.operatorId} value={x.operatorId}>{x.operatorId} — {verdictLabel[x.verdict]}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Readiness gauge</h3>
          <GaugeIndicator value={(o.averageScore ?? 0) / 100} label="Average score" sublabel={o.averageScore == null ? 'No data' : `${o.completedSessions} sessions`} height={200} />
        </div>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Score trend</h3>
          {trend.length === 0 ? <EmptyChart title="No data" message="No completed sessions yet." /> : (
            <LineChart data={trend} yLabel="score" valueFormatter={v => v == null ? '—' : `${v}`} yRange={[0, 100]} height={220} />
          )}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Scenario coverage heatmap</h3>
        <HeatmapGrid
          cells={heatCells}
          rowLabels={['Best score', 'Completed']}
          colLabels={types.map(t => typeLabel[t])}
          valueFormatter={v => v == null ? '—' : `${v}`}
        />
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Verdict reasons</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          {(o.reasons ?? []).map((r: string, i: number) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Certification action</h3>
        {o.activeCertification ? (
          <>
            <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 10 }}>
              Active certification <code>{o.activeCertification.id}</code> — issued {o.activeCertification.certifiedAt?.slice(0, 10)} by {o.activeCertification.certifiedBy ?? 'unknown'}, expires {o.activeCertification.expiresAt?.slice(0, 10)}.
            </div>
            {!showRevoke ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setShowRevoke(true)} style={btn('#ef4444')}>Revoke certification…</button>
                <button onClick={() => expire(o.activeCertification.id)} disabled={!!busy} style={btn('#f59e0b')}>Mark expired now</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input style={{ ...input, minWidth: 280 }} placeholder="Revoke reason (required)" value={revokeReason} onChange={e => setRevokeReason(e.target.value)} />
                <button onClick={() => { if (revokeReason.trim()) { revoke(o.activeCertification.id, revokeReason.trim()); setRevokeReason(''); setShowRevoke(false); } }}
                  disabled={!!busy || !revokeReason.trim()} style={btn('#ef4444')}>Confirm revoke</button>
                <button onClick={() => { setShowRevoke(false); setRevokeReason(''); }} style={btn('#475569')}>Back</button>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            <label style={{ fontSize: 12, color: '#94a3b8' }}>
              Validity days
              <input type="number" min={1} max={365} value={validityDays} onChange={e => setValidityDays(parseInt(e.target.value || '90', 10))} style={{ ...input, width: '100%', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12, color: '#94a3b8' }}>
              Note (optional)
              <input value={certNote} onChange={e => setCertNote(e.target.value)} placeholder="Why certifying now?" style={{ ...input, width: '100%', marginTop: 4 }} />
            </label>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button onClick={() => certify(o.operatorId, validityDays, certNote)} disabled={!!busy} style={btn(canCertify ? '#22c55e' : '#475569')}>
                {canCertify ? 'Certify operator' : 'Override-certify (below threshold)'}
              </button>
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
          ⚠ You cannot certify yourself. Certification is governance only — RBAC and live-execution gating remain authoritative.
        </div>
      </div>
    </>
  );
}

// ── Records tab ─────────────────────────────────────────────────────────────

function RecordsView({ certifications, revoke, expire, busy }: any) {
  if (certifications.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No certification records yet.</div>;
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>All certification records</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Cert id</th><th style={th}>Operator</th><th style={th}>Status</th>
              <th style={th}>Certified</th><th style={th}>Expires</th><th style={th}>Certified by</th>
              <th style={th}>Reason</th><th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {certifications.map((c: any) => (
              <tr key={c.id}>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{c.id}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{c.operatorId}</td>
                <td style={td}><span style={badge(certStatusColor[c.status])}>{c.status}</span></td>
                <td style={td}>{c.certifiedAt?.slice(0, 10) ?? '—'}</td>
                <td style={td}>{c.expiresAt?.slice(0, 10) ?? '—'}</td>
                <td style={td}>{c.certifiedBy ?? '—'}</td>
                <td style={{ ...td, fontSize: 11, color: c.reason ? '#fbbf24' : '#94a3b8' }}>{c.reason ?? '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {c.status === 'certified' && (
                    <>
                      <button onClick={() => { const r = window.prompt('Revoke reason'); if (r?.trim()) revoke(c.id, r.trim()); }}
                        disabled={!!busy} style={{ ...btn('#ef4444'), padding: '4px 8px' }}>Revoke</button>{' '}
                      <button onClick={() => expire(c.id)} disabled={!!busy} style={{ ...btn('#f59e0b'), padding: '4px 8px' }}>Expire</button>
                    </>
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

// ── Expiring tab ────────────────────────────────────────────────────────────

function ExpiringView({ certifications }: { certifications: any[] }) {
  const now = Date.now();
  const expiringSoon = certifications.filter(c => {
    if (c.status !== 'certified' || !c.expiresAt) return false;
    const exp = new Date(c.expiresAt).getTime();
    return Number.isFinite(exp) && exp - now > 0 && exp - now <= 30 * 24 * 60 * 60 * 1000;
  }).sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!));

  const expired = certifications.filter(c => c.status === 'expired' || (c.status === 'certified' && c.expiresAt && new Date(c.expiresAt).getTime() < now));
  const revoked = certifications.filter(c => c.status === 'revoked');

  return (
    <>
      <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Expiring within 30 days ({expiringSoon.length})</h3>
        {expiringSoon.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>No certifications expiring soon.</div> : (
          <CertSimpleTable rows={expiringSoon} highlight="expiresAt" />
        )}
      </div>

      {expired.length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #64748b' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Expired ({expired.length})</h3>
          <CertSimpleTable rows={expired} highlight="expiresAt" />
        </div>
      )}

      {revoked.length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #ef4444' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Revoked ({revoked.length})</h3>
          <CertSimpleTable rows={revoked} highlight="revokedAt" />
        </div>
      )}
    </>
  );
}

function CertSimpleTable({ rows, highlight }: { rows: any[]; highlight: 'expiresAt' | 'revokedAt' }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Cert id</th><th style={th}>Operator</th><th style={th}>Status</th>
            <th style={th}>{highlight === 'expiresAt' ? 'Expires' : 'Revoked'}</th><th style={th}>Reason / by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.id}>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{c.id}</td>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{c.operatorId}</td>
              <td style={td}><span style={badge(certStatusColor[c.status])}>{c.status}</span></td>
              <td style={td}>{(highlight === 'expiresAt' ? c.expiresAt : c.revokedAt)?.slice(0, 10) ?? '—'}</td>
              <td style={td}>{c.reason ?? c.revokedBy ?? c.certifiedBy ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Methodology ─────────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>How readiness is computed</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>≥ 5 completed training sessions</strong></li>
          <li><strong>Average score ≥ 80</strong> across all completed sessions</li>
          <li><strong>All 5 required scenario types covered</strong>: signal_review, risk_review, pilot_review, execution_playbook, incident_response</li>
          <li><strong>Best score per covered type ≥ 70</strong></li>
          <li><strong>At least one completed session in the last 30 days</strong></li>
        </ul>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '8px 0 0' }}>
          Verdicts: <code>not_ready</code> / <code>needs_practice</code> / <code>certification_ready</code> / <code>certified</code> / <code>expired</code>.
          When an active certification exists, it overrides the metrics-based verdict (you'll see <code>certified</code>); when a cert has expired or been revoked, you'll see <code>expired</code> until a new cert is issued.
        </p>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Certification rules</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Certification is <strong>always manual</strong>. No automation issues, expires, or revokes.</li>
          <li>Operators <strong>cannot self-certify</strong> (the API rejects it).</li>
          <li>Default validity is <strong>90 days</strong>; you may set 1–365 days at issuance.</li>
          <li>Issuing a new cert <strong>supersedes</strong> the operator's prior active cert (the prior one is auto-revoked with reason "superseded by new certification").</li>
          <li>Revocation requires a written reason.</li>
          <li>The cert record stamps a <strong>metricsSnapshot</strong> at issuance (completed sessions, avg score, coverage, validityDays).</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>No autonomous trading, no real order submission, no real candidate creation, no execution-behavior changes.</li>
          <li>No automatic RBAC changes — certifying does not assign roles or grant permissions.</li>
          <li>No automatic live-execution enablement — the live-readiness and dual-control workflows remain authoritative.</li>
          <li>Certification is advisory governance: it records that an operator passed training; it does not grant production access.</li>
          <li>Storage is isolated to <code>cert:*</code> and <code>certs:all</code> keys.</li>
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
