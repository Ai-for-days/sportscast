import React, { useEffect, useState } from 'react';
import { BarChart, EmptyChart, GaugeIndicator } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 700, background: bg, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 });
const inputStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 };

const recColor: Record<string, string> = {
  continue: '#22c55e', pause: '#f59e0b', expand: '#06b6d4', stop: '#ef4444', needs_more_data: '#64748b',
};
const recValue: Record<string, number> = {
  needs_more_data: 0.10, pause: 0.30, stop: 0.05, continue: 0.65, expand: 0.95,
};
const confColor: Record<string, string> = {
  low: '#64748b', medium: '#3b82f6', high: '#22c55e',
};
const statusColor: Record<string, string> = {
  draft: '#f59e0b', completed: '#22c55e',
};

type Tab = 'reviews' | 'new' | 'attribution' | 'gono' | 'methodology';

export default function PilotReview() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [pilots, setPilots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('reviews');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [draftPilotId, setDraftPilotId] = useState<string>('');
  const [draftReviewType, setDraftReviewType] = useState<string>('ad_hoc');
  const [draftNotes, setDraftNotes] = useState<string>('');

  useEffect(() => { reload(); }, []);

  async function reload() {
    setLoading(true);
    try {
      const [revs, pls] = await Promise.all([
        fetch('/api/admin/system/pilot-review?action=list', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/admin/system/strategy-pilot?action=list', { credentials: 'include' }).then(r => r.json()),
      ]);
      setReviews(revs.reviews ?? []);
      setPilots(pls.pilots ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function postAction(action: string, body: any = {}) {
    setBusy(action);
    try {
      const res = await fetch('/api/admin/system/pilot-review', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const j = await res.json();
      if (res.ok) {
        setToast(`✓ ${action.replace(/-/g, ' ')}`);
        await reload();
        return j;
      } else {
        setToast(`Error: ${j.error || 'failed'}${j.message ? ` — ${j.message}` : ''}`);
      }
    } catch (e: any) {
      setToast(`Error: ${e?.message || 'network'}`);
    }
    setBusy(null);
    setTimeout(() => setToast(null), 3500);
    return null;
  }

  async function loadDraft() {
    if (!draftPilotId) {
      setToast('Select a pilot first.');
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setBusy('draft');
    try {
      const res = await fetch(`/api/admin/system/pilot-review?action=generate-draft&pilotId=${draftPilotId}`, { credentials: 'include' });
      const j = await res.json();
      if (res.ok) setDraft(j.draft);
      else setToast(`Error: ${j.error || 'failed'}${j.message ? ` — ${j.message}` : ''}`);
    } catch (e: any) {
      setToast(`Error: ${e?.message || 'network'}`);
    }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading pilot reviews…</div>;
  const fmtCents = (v: number | null | undefined) => v == null ? '—' : `$${(v / 100).toFixed(2)}`;
  const fmtSignedCents = (v: number | null | undefined) => v == null ? '—' : `${v >= 0 ? '+' : ''}$${(v / 100).toFixed(2)}`;
  const fmtPct = (v: number | null | undefined) => v == null ? '—' : `${v.toFixed(1)}%`;

  const selectedReview = reviews.find(r => r.id === selectedReviewId);

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/pilot-review" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Pilot Review — Go / No-Go</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 760 }}>
            Formal pilot review with attribution + recommendation. Recommendations are <strong>operator-facing</strong> only —
            no autonomous trading, no automatic pilot state change, no automatic strategy promotion.
          </p>
        </div>
        <a
          href="/admin/system/pilot-decisions"
          style={{ ...btn('#0ea5e9'), textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap' }}
        >View Decision Tracker →</a>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['reviews', `Reviews (${reviews.length})`],
          ['new', 'New Review'],
          ['attribution', selectedReview ? `Attribution · ${selectedReview.pilotName}` : 'Attribution'],
          ['gono', selectedReview ? 'Go / No-Go' : 'Go / No-Go'],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }} disabled={(t === 'attribution' || t === 'gono') && !selectedReview && !draft}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'reviews' && (
        <div style={card}>
          {reviews.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No reviews yet. Switch to <strong>New Review</strong> to create one.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>When</th><th style={th}>Pilot</th><th style={th}>Type</th><th style={th}>Status</th>
                <th style={th}>Recommendation</th><th style={th}>Confidence</th><th style={th}>Reviewer</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {reviews.map(r => (
                  <tr key={r.id}>
                    <td style={td}>{new Date(r.createdAt).toLocaleString()}</td>
                    <td style={td}>{r.pilotName}<div style={{ fontSize: 11, color: '#64748b' }}>{r.id}</div></td>
                    <td style={td}>{r.reviewType.replace(/_/g, ' ')}</td>
                    <td style={td}><span style={badge(statusColor[r.status])}>{r.status}</span></td>
                    <td style={td}><span style={badge(recColor[r.recommendation])}>{r.recommendation.replace(/_/g, ' ')}</span></td>
                    <td style={td}><span style={badge(confColor[r.confidence])}>{r.confidence}</span></td>
                    <td style={td}>{r.reviewer}{r.completedBy && r.completedBy !== r.reviewer ? ` → ${r.completedBy}` : ''}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => { setSelectedReviewId(r.id); setTab('attribution'); }} style={btn('#6366f1')}>Open</button>
                        {r.status === 'draft' && (
                          <button
                            onClick={() => postAction('complete-review', { id: r.id, recommendation: r.recommendation, confidence: r.confidence })}
                            disabled={!!busy}
                            style={btn('#22c55e')}
                          >Complete</button>
                        )}
                        {r.status === 'completed' && (
                          <a
                            href={`/admin/system/pilot-decisions?reviewId=${encodeURIComponent(r.id)}`}
                            style={{ ...btn('#0ea5e9'), textDecoration: 'none', display: 'inline-block' }}
                          >Record Decision</a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'new' && (
        <div>
          <div style={card}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Generate draft review</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <select value={draftPilotId} onChange={e => setDraftPilotId(e.target.value)} style={inputStyle}>
                <option value="">Select pilot…</option>
                {pilots.map((p: any) => <option key={p.id} value={p.id}>{p.strategyName} · {p.status} · {p.mode}</option>)}
              </select>
              <select value={draftReviewType} onChange={e => setDraftReviewType(e.target.value)} style={inputStyle}>
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="end_of_pilot">end_of_pilot</option>
                <option value="ad_hoc">ad_hoc</option>
              </select>
              <button onClick={loadDraft} disabled={!!busy || !draftPilotId} style={btn('#3b82f6')}>{busy === 'draft' ? 'Generating…' : 'Generate draft'}</button>
              {draft && (
                <button
                  onClick={async () => {
                    const res = await postAction('create-review', { pilotId: draftPilotId, reviewType: draftReviewType, notes: draftNotes });
                    if (res?.review) {
                      setSelectedReviewId(res.review.id);
                      setDraft(null);
                      setDraftNotes('');
                      setTab('reviews');
                    }
                  }}
                  disabled={!!busy}
                  style={btn('#22c55e')}
                >Save as draft</button>
              )}
            </div>
            <textarea
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
              rows={3}
              placeholder="Reviewer notes (optional) — saved with the review"
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>

          {draft && (
            <>
              <div style={{ ...card, borderLeft: `4px solid ${recColor[draft.recommendation]}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Draft recommendation</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={badge(recColor[draft.recommendation])}>{draft.recommendation.replace(/_/g, ' ')}</span>
                      <span style={badge(confColor[draft.confidence])}>{draft.confidence}</span>
                    </div>
                  </div>
                  <a href="/admin/system/strategy-pilot" style={{ ...btn('#475569'), textDecoration: 'none' }}>Open pilot</a>
                </div>
                <div style={{ marginTop: 12 }}>
                  <strong style={{ fontSize: 12, color: '#94a3b8' }}>Reasons</strong>
                  <ul style={{ margin: '4px 0 8px 18px', fontSize: 13, color: '#cbd5e1' }}>
                    {draft.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                  </ul>
                  {draft.warnings.length > 0 && (
                    <>
                      <strong style={{ fontSize: 12, color: '#fbbf24' }}>Warnings</strong>
                      <ul style={{ margin: '4px 0 8px 18px', fontSize: 13, color: '#fed7aa' }}>
                        {draft.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                      </ul>
                    </>
                  )}
                  {draft.followUpActions.length > 0 && (
                    <>
                      <strong style={{ fontSize: 12, color: '#94a3b8' }}>Follow-up actions</strong>
                      <ul style={{ margin: '4px 0 0 18px', fontSize: 13, color: '#cbd5e1' }}>
                        {draft.followUpActions.map((a: string, i: number) => <li key={i}>{a}</li>)}
                      </ul>
                    </>
                  )}
                </div>
              </div>

              {/* Mini summary cards from the draft monitoring */}
              <div style={grid4}>
                <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Linked records</div><div style={{ fontSize: 22, fontWeight: 700 }}>{draft.attribution.performance.totalLinkedRecords}</div></div>
                <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Linked settlements</div><div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>{draft.attribution.performance.linkedSettlements}</div></div>
                <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Total P&L</div><div style={{ fontSize: 22, fontWeight: 700, color: draft.attribution.performance.totalPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSignedCents(draft.attribution.performance.totalPnlCents)}</div></div>
                <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>ROI</div><div style={{ fontSize: 22, fontWeight: 700 }}>{draft.attribution.performance.roiPct != null ? `${draft.attribution.performance.roiPct >= 0 ? '+' : ''}${draft.attribution.performance.roiPct.toFixed(1)}%` : '—'}</div></div>
                <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Win rate</div><div style={{ fontSize: 22, fontWeight: 700 }}>{fmtPct(draft.attribution.performance.winRatePct)}</div></div>
                <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Max drawdown</div><div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{fmtCents(draft.attribution.performance.maxDrawdownCents)}</div></div>
                <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Planned vs actual gap</div><div style={{ fontSize: 22, fontWeight: 700 }}>{fmtSignedCents(draft.attribution.execution.plannedVsActualGapCents)}</div></div>
                <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Avg settlement lag</div><div style={{ fontSize: 22, fontWeight: 700 }}>{draft.attribution.execution.settlementLagDays != null ? `${draft.attribution.execution.settlementLagDays} d` : '—'}</div></div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'attribution' && (selectedReview || draft) && (() => {
        const src = selectedReview ?? draft;
        const a = src.attribution ?? draft?.attribution;
        if (!a) return <div style={{ ...card, color: '#64748b', fontSize: 13 }}>No attribution data.</div>;
        return (
          <div>
            <div style={card}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Execution attribution</h4>
              <BarChart
                signColored
                valueFormatter={v => fmtSignedCents(v)}
                data={[
                  { label: 'Planned stake (paper)', value: a.execution.plannedStakeCents, color: '#94a3b8' },
                  { label: 'Actual stake (orders)', value: a.execution.actualStakeCents, color: '#3b82f6' },
                  { label: 'Gap (planned − actual)', value: a.execution.plannedVsActualGapCents },
                ]}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#cbd5e1' }}>
                Paper without matching orders: <strong>{a.execution.paperWithoutOrders}</strong>{' · '}
                Orders without matching paper: <strong>{a.execution.ordersWithoutPaper}</strong>{' · '}
                Avg slippage: <strong>{a.execution.avgSlippageCents != null ? fmtCents(a.execution.avgSlippageCents) : '—'}</strong>
                <span style={{ color: '#64748b' }}> ({a.execution.slippageSampleSize} samples)</span>{' · '}
                Avg settlement lag: <strong>{a.execution.settlementLagDays != null ? `${a.execution.settlementLagDays} d` : '—'}</strong>
                <span style={{ color: '#64748b' }}> ({a.execution.settlementLagSampleSize} samples)</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
              {[
                { title: 'Exposure by source',   rows: a.risk.exposureBySource },
                { title: 'Exposure by metric',   rows: a.risk.exposureByMetric },
                { title: 'Exposure by date',     rows: a.risk.exposureByDate },
                { title: 'Exposure by location', rows: a.risk.exposureByLocation },
              ].map(g => (
                <div key={g.title} style={card}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>{g.title}</h4>
                  {g.rows.length === 0 ? <div style={{ color: '#64748b', fontSize: 12 }}>No data.</div> : g.rows.slice(0, 8).map((r: any) => (
                    <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
                      <span style={{ color: '#cbd5e1', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.key}>{r.key}</span>
                      <span style={{ color: r.pct > 0.4 ? '#fbbf24' : '#e2e8f0' }}>{fmtCents(r.cents)} <span style={{ color: '#64748b' }}>({(r.pct * 100).toFixed(0)}%)</span></span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div style={card}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Quality by reliability bucket</h4>
              {a.quality.byReliabilityBucket.every((b: any) => b.count === 0)
                ? <EmptyChart title="By reliability" message="No linked paper records yet to bucket." />
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th}>Bucket</th><th style={th}>n</th><th style={th}>Settled</th><th style={th}>Win rate</th><th style={th}>Total P&L</th></tr></thead>
                    <tbody>
                      {a.quality.byReliabilityBucket.map((b: any) => (
                        <tr key={b.bucket}>
                          <td style={td}><strong>{b.bucket}</strong></td>
                          <td style={td}>{b.count}</td>
                          <td style={td}>{b.settled}</td>
                          <td style={td}>{fmtPct(b.hitRatePct)}</td>
                          <td style={{ ...td, color: b.totalPnlCents >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{fmtSignedCents(b.totalPnlCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          </div>
        );
      })()}

      {tab === 'gono' && (selectedReview || draft) && (() => {
        const src = selectedReview ?? draft;
        const rec = src.recommendation;
        const conf = src.confidence;
        const reasons = src.reasons ?? [];
        const warnings = src.warnings ?? [];
        const followUps = src.followUpActions ?? [];
        return (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
              <div style={{ ...card, borderLeft: `4px solid ${recColor[rec]}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={badge(recColor[rec])}>{rec.replace(/_/g, ' ')}</span>
                  <span style={badge(confColor[conf])}>{conf}</span>
                </div>
                <h3 style={{ margin: '8px 0 6px', fontSize: 16, fontWeight: 700 }}>Recommendation</h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#cbd5e1' }}>
                  {reasons.map((r: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
                </ul>
              </div>
              <div style={card}>
                <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Recommendation gauge</h4>
                <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>0 = stop, 0.30 = pause, 0.65 = continue, 0.95 = expand. needs_more_data sits left.</p>
                <GaugeIndicator value={recValue[rec] ?? 0.5} label={rec.replace(/_/g, ' ')} sublabel={`confidence: ${conf}`} />
              </div>
            </div>
            {warnings.length > 0 && (
              <div style={{ ...card, background: '#3b1d1d', borderLeft: '4px solid #ef4444' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#fca5a5' }}>Warnings</h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#fed7aa' }}>
                  {warnings.map((w: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
                </ul>
              </div>
            )}
            {followUps.length > 0 && (
              <div style={card}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Required follow-up actions</h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#cbd5e1' }}>
                  {followUps.map((a: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{a}</li>)}
                </ul>
              </div>
            )}
            {selectedReview && selectedReview.notes && (
              <div style={card}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Reviewer notes</h4>
                <pre style={{ margin: 0, fontSize: 12, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{selectedReview.notes}</pre>
              </div>
            )}
          </div>
        );
      })()}

      {tab === 'methodology' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Methodology</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' }}>
            <li>Reviews are <strong>manually requested</strong> from the New Review tab. The draft is generated server-side via <code>generateDraftReview(pilotId)</code> and persisted as <code>status=draft</code>; an explicit Complete action moves it to <code>status=completed</code>.</li>
            <li>Attribution combines: the Step 84 linked-record set (authoritative), the Step 80 paper portfolio (planned allocation), the Step 83 monitoring (limits / drawdown), and order/settlement records (slippage / lag).</li>
            <li>Recommendation rules: <strong>continue</strong> = no breaches, ROI not materially negative, drawdown contained; <strong>pause</strong> = limit breach, drawdown &gt; 20% of capital, or operational warning; <strong>expand</strong> = ≥100 settled, positive ROI, drawdown &lt; 15% of capital, no warnings; <strong>stop</strong> = drawdown &gt; 40% of capital, or ≥30 settled with ROI &lt; -2%; <strong>needs_more_data</strong> = &lt;5 settled records.</li>
            <li>Confidence rule: <code>&lt;30 = low, 30–99 = medium, ≥100 = high</code>.</li>
            <li>Storage: Redis. <code>pilot-review:{'{id}'}</code> with sorted-set <code>pilot-reviews:all</code>. Auto-trim oldest beyond 1000 reviews.</li>
            <li>Audit events: <code>pilot_review_created</code>, <code>pilot_review_completed</code>.</li>
            <li><strong>Safety:</strong> recommendations are <strong>never applied automatically</strong>. No autonomous trading, no order submission, no candidate auto-creation, no pilot state auto-change, no strategy auto-promotion. Operator must take any subsequent action explicitly via Strategy Pilot or Strategy Registry.</li>
          </ul>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '10px 16px', borderRadius: 6, fontSize: 13, maxWidth: 480 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
