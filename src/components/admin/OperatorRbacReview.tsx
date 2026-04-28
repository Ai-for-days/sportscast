import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';
import { BarChart, EmptyChart } from './charts';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const severityColor: Record<string, string> = { info: '#22c55e', warning: '#f59e0b', critical: '#dc2626' };
const recColor: Record<string, string> = {
  no_action: '#22c55e',
  review_recommended: '#f59e0b',
  access_review_due: '#f59e0b',
  certification_missing: '#ef4444',
  certification_expired: '#f59e0b',
  certification_revoked: '#dc2626',
  excessive_access_warning: '#f59e0b',
};
const recLabel: Record<string, string> = {
  no_action: 'No Action',
  review_recommended: 'Review Recommended',
  access_review_due: 'Access Review Due',
  certification_missing: 'Certification Missing',
  certification_expired: 'Certification Expired',
  certification_revoked: 'Certification Revoked',
  excessive_access_warning: 'Excessive Access',
};

const ADVISORY_BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'overview' | 'reviews' | 'cert-vs-access' | 'acks' | 'methodology';

function Banner() {
  return (
    <div style={ADVISORY_BANNER}>
      <span>🛡️ Certification/RBAC review is <strong>advisory only</strong>. This page does not grant, revoke, or modify permissions.</span>
      <span style={{ fontSize: 11, opacity: 0.85 }}>Manual · Audit-logged</span>
    </div>
  );
}

export default function OperatorRbacReview() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const [pickedOperator, setPickedOperator] = useState('');
  const [latestReview, setLatestReview] = useState<any>(null);
  const [ackNote, setAckNote] = useState('');
  const [extraNote, setExtraNote] = useState('');

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/operator-rbac-review?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/operator-rbac-review', {
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

  async function generateReview(operatorId: string) {
    if (!operatorId.trim()) { setError('operatorId is required'); return; }
    setBusy('generate'); setError(null);
    try {
      const j = await post({ action: 'generate-review', operatorId: operatorId.trim() });
      setLatestReview(j.review);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function loadLatest(operatorId: string) {
    if (!operatorId.trim()) return;
    setBusy('load-latest'); setError(null);
    try {
      const j = await get('latest-for-operator', { operatorId: operatorId.trim() });
      setLatestReview(j.review);
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function ackReview(reviewId: string, note?: string) {
    setBusy(`ack-${reviewId}`); setError(null);
    try {
      const j = await post({ action: 'acknowledge-review', reviewId, note });
      setLatestReview(j.review);
      setAckNote('');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function addNote(reviewId: string, note: string) {
    if (!note.trim()) return;
    setBusy(`note-${reviewId}`); setError(null);
    try {
      const j = await post({ action: 'add-note', reviewId, note: note.trim() });
      setLatestReview(j.review);
      setExtraNote('');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading RBAC review…</div>;
  if (error && !data) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {error}</div>;
  if (!data) return null;

  const summary = data.summary;
  const reviews: any[] = data.reviews ?? [];
  const operators: any[] = data.operators ?? [];

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/operator-rbac-review" /></div>
      <Banner />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Operator RBAC Review</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Generates governance reviews comparing each operator's certification status to their current RBAC roles + permissions.
            Reviews capture a recommendation; <strong>actual RBAC changes happen manually in the existing Security workflow</strong>.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/operator-certification" style={btn('#0ea5e9')}>Certification →</a>
          <a href="/admin/security" style={btn('#22c55e')}>Security / RBAC →</a>
          <button onClick={reload} style={btn('#6366f1')} disabled={!!busy}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>Error: {error}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['overview',       `Overview (${summary.totalReviews})`],
          ['reviews',        `Operator Reviews`],
          ['cert-vs-access', 'Certification vs Access'],
          ['acks',           `Acknowledgements (${summary.acknowledged})`],
          ['methodology',    'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewView summary={summary} reviews={reviews} />}
      {tab === 'reviews' && (
        <ReviewsView
          summary={summary} operators={operators}
          pickedOperator={pickedOperator} setPickedOperator={setPickedOperator}
          latestReview={latestReview} loadLatest={loadLatest} generateReview={generateReview}
          ackNote={ackNote} setAckNote={setAckNote} ackReview={ackReview}
          extraNote={extraNote} setExtraNote={setExtraNote} addNote={addNote}
          busy={busy}
        />
      )}
      {tab === 'cert-vs-access' && <CertVsAccessView summary={summary} />}
      {tab === 'acks' && (
        <AcksView reviews={reviews} addNote={addNote} extraNote={extraNote} setExtraNote={setExtraNote} busy={busy} />
      )}
      {tab === 'methodology' && <MethodologyView />}

      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 4 }}>
        {summary.totalReviews} review records across {summary.perOperator.length} operator(s)
      </div>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewView({ summary, reviews }: { summary: any; reviews: any[] }) {
  return (
    <>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Total reviews" value={summary.totalReviews} />
          <Stat label="Critical"      value={summary.bySeverity.critical}     color={severityColor.critical} />
          <Stat label="Warnings"      value={summary.bySeverity.warning}      color={severityColor.warning} />
          <Stat label="Info"          value={summary.bySeverity.info}         color={severityColor.info} />
          <Stat label="Acknowledged"  value={summary.acknowledged}            color="#22c55e" />
          <Stat label="Unacknowledged" value={summary.unacknowledged}         color="#ef4444" />
          <Stat label="Access data unavailable" value={summary.accessDataUnavailable} color="#94a3b8" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recommendation distribution</h3>
          {summary.totalReviews === 0 ? <EmptyChart title="No data" message="Generate a review to populate this chart." /> : (
            <BarChart
              data={Object.keys(recLabel).map(k => ({ label: recLabel[k], value: summary.byRecommendation[k] ?? 0, color: recColor[k] }))}
              valueFormatter={v => `${v}`}
              height={220}
            />
          )}
        </div>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Severity distribution</h3>
          {summary.totalReviews === 0 ? <EmptyChart title="No data" message="No review records yet." /> : (
            <BarChart
              data={(['info', 'warning', 'critical'] as const).map(s => ({ label: s, value: summary.bySeverity[s] ?? 0, color: severityColor[s] }))}
              valueFormatter={v => `${v}`}
              height={220}
            />
          )}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Most recent reviews ({Math.min(reviews.length, 12)})</h3>
        {reviews.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>No reviews generated yet.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Generated</th><th style={th}>Operator</th><th style={th}>Recommendation</th>
                  <th style={th}>Severity</th><th style={th}>Cert status</th><th style={th}>Elevated</th><th style={th}>Acknowledged</th>
                </tr>
              </thead>
              <tbody>
                {reviews.slice(0, 12).map((r: any) => (
                  <tr key={r.id}>
                    <td style={td}>{new Date(r.generatedAt).toLocaleString()}</td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.operatorId}</td>
                    <td style={td}><span style={badge(recColor[r.recommendation])}>{recLabel[r.recommendation]}</span></td>
                    <td style={td}><span style={badge(severityColor[r.severity])}>{r.severity}</span></td>
                    <td style={td}>{r.certificationStatus}</td>
                    <td style={td}>{r.currentAccessSummary.accessDataAvailable ? (r.currentAccessSummary.elevatedAccess ? 'yes' : 'no') : '—'}</td>
                    <td style={td}>{r.acknowledgedAt ? new Date(r.acknowledgedAt).toLocaleString() : <span style={{ color: '#ef4444' }}>—</span>}</td>
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

// ── Operator Reviews ────────────────────────────────────────────────────────

function ReviewsView({
  summary, operators, pickedOperator, setPickedOperator,
  latestReview, loadLatest, generateReview,
  ackNote, setAckNote, ackReview, extraNote, setExtraNote, addNote, busy,
}: any) {
  const opList: any[] = operators ?? [];

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Pick an operator</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Known operators
            <select style={{ ...input, width: '100%', marginTop: 4 }} value={pickedOperator} onChange={e => setPickedOperator(e.target.value)}>
              <option value="">— pick or type below —</option>
              {opList.map(o => <option key={o.operatorId} value={o.operatorId}>{o.operatorId} ({o.source.join(', ')})</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Operator id
            <input style={{ ...input, width: '100%', marginTop: 4 }} placeholder="e.g. primary-admin" value={pickedOperator} onChange={e => setPickedOperator(e.target.value)} />
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => loadLatest(pickedOperator)} disabled={!!busy || !pickedOperator.trim()} style={btn('#0ea5e9')}>Load latest</button>
            <button onClick={() => generateReview(pickedOperator)} disabled={!!busy || !pickedOperator.trim()} style={btn(busy === 'generate' ? '#475569' : '#22c55e')}>
              {busy === 'generate' ? 'Generating…' : 'Generate Review'}
            </button>
          </div>
        </div>
      </div>

      {!latestReview ? (
        <div style={{ ...card, color: '#94a3b8' }}>No review loaded. Pick an operator above and either load the latest review or generate a fresh one.</div>
      ) : (
        <ReviewCard review={latestReview} ackNote={ackNote} setAckNote={setAckNote} ackReview={ackReview}
          extraNote={extraNote} setExtraNote={setExtraNote} addNote={addNote} busy={busy} />
      )}
    </>
  );
}

function ReviewCard({ review, ackNote, setAckNote, ackReview, extraNote, setExtraNote, addNote, busy }: any) {
  const r = review;
  return (
    <>
      <div style={{ ...card, borderLeft: `3px solid ${severityColor[r.severity]}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.operatorId}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={badge(recColor[r.recommendation])}>{recLabel[r.recommendation]}</span>
            <span style={badge(severityColor[r.severity])}>{r.severity}</span>
          </div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <Field label="Cert status" value={r.certificationStatus} />
          <Field label="Cert expires" value={r.certificationExpiresAt?.slice(0, 10) ?? '—'} />
          <Field label="Active cert id" value={r.activeCertificationId ?? '—'} mono />
          <Field label="Generated" value={`${new Date(r.generatedAt).toLocaleString()} · ${r.generatedBy}`} />
          <Field label="Acknowledged" value={r.acknowledgedAt ? `${new Date(r.acknowledgedAt).toLocaleString()} · ${r.acknowledgedBy}` : '—'} />
          <Field label="Review id" value={r.id} mono />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Reasons</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          {(r.reasons ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Current access summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          <Field label="Available" value={r.currentAccessSummary.accessDataAvailable ? 'yes' : 'no'} />
          <Field label="Source" value={r.currentAccessSummary.source} mono />
          <Field label="Elevated" value={r.currentAccessSummary.elevatedAccess ? 'yes' : 'no'} />
          <Field label="Roles" value={(r.currentAccessSummary.roles ?? []).join(', ') || '—'} />
        </div>
        {(r.currentAccessSummary.permissions ?? []).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Permissions ({r.currentAccessSummary.permissions.length})</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {r.currentAccessSummary.permissions.map((p: string) => (
                <span key={p} style={{ ...badge('#334155'), fontSize: 10 }}>{p}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {!r.acknowledgedAt ? (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Acknowledge review</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Optional ack note" value={ackNote} onChange={e => setAckNote(e.target.value)} />
            <button onClick={() => ackReview(r.id, ackNote || undefined)} disabled={!!busy} style={btn('#22c55e')}>Acknowledge</button>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
            Acknowledging records that the review has been seen. It does not change RBAC.
          </div>
        </div>
      ) : (
        <div style={{ ...card, borderLeft: '3px solid #22c55e', color: '#22c55e', fontSize: 13 }}>
          ✓ Acknowledged {new Date(r.acknowledgedAt).toLocaleString()} by {r.acknowledgedBy}.
        </div>
      )}

      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Notes</h3>
        {(r.notes ?? []).length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No notes yet.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
            {r.notes.map((n: string, i: number) => <li key={i} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{n}</li>)}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: 1, minWidth: 240 }} placeholder="Add a note (required)" value={extraNote} onChange={e => setExtraNote(e.target.value)} />
          <button onClick={() => addNote(r.id, extraNote)} disabled={!!busy || !extraNote.trim()} style={btn('#6366f1')}>Add note</button>
        </div>
      </div>
    </>
  );
}

// ── Certification vs Access ─────────────────────────────────────────────────

function CertVsAccessView({ summary }: { summary: any }) {
  const rows = summary.perOperator ?? [];
  if (rows.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No reviews generated yet. Use the Operator Reviews tab to start.</div>;
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Latest per operator</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Operator</th><th style={th}>Cert status</th><th style={th}>Expires</th>
              <th style={th}>Roles</th><th style={th}>Elevated</th><th style={th}>Recommendation</th>
              <th style={th}>Severity</th><th style={th}>Acknowledged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any) => {
              const r = row.review;
              return (
                <tr key={row.operatorId}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{row.operatorId}</td>
                  <td style={td}>{r.certificationStatus}</td>
                  <td style={td}>{r.certificationExpiresAt?.slice(0, 10) ?? '—'}</td>
                  <td style={td}>{(r.currentAccessSummary.roles ?? []).join(', ') || '—'}</td>
                  <td style={td}>{r.currentAccessSummary.accessDataAvailable ? (r.currentAccessSummary.elevatedAccess ? 'yes' : 'no') : '—'}</td>
                  <td style={td}><span style={badge(recColor[r.recommendation])}>{recLabel[r.recommendation]}</span></td>
                  <td style={td}><span style={badge(severityColor[r.severity])}>{r.severity}</span></td>
                  <td style={td}>{r.acknowledgedAt ? new Date(r.acknowledgedAt).toLocaleString() : <span style={{ color: '#ef4444' }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
        Each row is the most recent review per operator. To regenerate, use the Operator Reviews tab.
      </div>
    </div>
  );
}

// ── Acknowledgements ────────────────────────────────────────────────────────

function AcksView({ reviews, addNote, extraNote, setExtraNote, busy }: any) {
  const acked = (reviews ?? []).filter((r: any) => r.acknowledgedAt);
  if (acked.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No acknowledged reviews yet.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {acked.map((r: any) => (
        <div key={r.id} style={{ ...card, borderLeft: `3px solid ${severityColor[r.severity]}`, marginBottom: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={badge(recColor[r.recommendation])}>{recLabel[r.recommendation]}</span>
            <span style={badge(severityColor[r.severity])}>{r.severity}</span>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.operatorId}</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>· acked {new Date(r.acknowledgedAt).toLocaleString()} by {r.acknowledgedBy}</span>
          </div>
          {(r.notes ?? []).length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
              {r.notes.map((n: string, i: number) => <li key={i} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{n}</li>)}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <input style={{ ...input, flex: 1, minWidth: 200 }} placeholder="Add follow-up note" value={extraNote} onChange={e => setExtraNote(e.target.value)} />
            <button onClick={() => addNote(r.id, extraNote)} disabled={!!busy || !extraNote.trim()} style={btn('#6366f1')}>Add note</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Methodology ─────────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Conservative rule engine</h3>
        <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1' }}>
          Rules are evaluated top-down; the first match returns its recommendation.
          The engine is intentionally conservative — it prefers <em>review_recommended</em> over silence whenever access data is missing.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
          <thead><tr><th style={th}>#</th><th style={th}>Condition</th><th style={th}>Recommendation</th><th style={th}>Severity</th></tr></thead>
          <tbody>
            <tr><td style={td}>1</td><td style={td}>Last cert is revoked</td><td style={td}>certification_revoked</td><td style={td}>critical</td></tr>
            <tr><td style={td}>2</td><td style={td}>Cert expired (status or past expiresAt)</td><td style={td}>certification_expired</td><td style={td}>warning</td></tr>
            <tr><td style={td}>3</td><td style={td}>No active cert + elevated access</td><td style={td}>certification_missing</td><td style={td}>warning</td></tr>
            <tr><td style={td}>4</td><td style={td}>Access data unavailable</td><td style={td}>review_recommended</td><td style={td}>warning</td></tr>
            <tr><td style={td}>5</td><td style={td}>Cert expiring within 30d + elevated access</td><td style={td}>access_review_due</td><td style={td}>warning</td></tr>
            <tr><td style={td}>6</td><td style={td}>Certified + super_admin or ≥16 perms</td><td style={td}>excessive_access_warning</td><td style={td}>warning</td></tr>
            <tr><td style={td}>7</td><td style={td}>Certified + normal access (default)</td><td style={td}>no_action</td><td style={td}>info</td></tr>
          </tbody>
        </table>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>What "elevated access" means</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Role is <code>admin</code> or <code>super_admin</code>, OR</li>
          <li>The role grants any of: <code>submit_live_orders</code>, <code>enable_live_mode</code>, <code>manage_users_and_roles</code>, <code>approve_requests</code>, <code>cancel_live_orders</code>, <code>toggle_kill_switch</code>, <code>manage_settlement</code>.</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety / advisory-only design</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>This page never grants, revokes, or modifies RBAC roles or permissions.</li>
          <li>Actual RBAC changes happen manually in the existing Security workflow at <a href="/admin/security" style={{ color: '#0ea5e9' }}>/admin/security</a>.</li>
          <li>No execution path is changed; no trading automation, order submission, or candidate creation is added.</li>
          <li>Writes are confined to <code>rbac-review:*</code> Redis keys and the audit log.</li>
          <li>Generating, acknowledging, and adding notes are all audit-logged with operator id and review id.</li>
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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: mono ? 'ui-monospace, Menlo, monospace' : undefined, wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}
