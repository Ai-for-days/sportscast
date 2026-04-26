import React, { useEffect, useState } from 'react';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });
const inputStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 };

const decisionColor: Record<string, string> = {
  take: '#22c55e', skip: '#94a3b8', watch: '#3b82f6', reject: '#ef4444',
};
const outcomeColor: Record<string, string> = {
  pending: '#64748b', won: '#22c55e', lost: '#ef4444', push: '#f59e0b', missed_opportunity: '#a855f7',
};

type Tab = 'log' | 'analysis' | 'missed' | 'review' | 'methodology';

export default function DeskDecisions() {
  const [decisions, setDecisions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [missed, setMissed] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('log');

  // Review modal state
  const [reviewing, setReviewing] = useState<any | null>(null);
  const [revOutcome, setRevOutcome] = useState<string>('pending');
  const [revPnl, setRevPnl] = useState<string>('');
  const [revNotes, setRevNotes] = useState<string>('');

  useEffect(() => { reload(); }, []);

  async function reload() {
    setLoading(true);
    try {
      const [listRes, sumRes] = await Promise.all([
        fetch('/api/admin/system/desk-decisions?action=list-decisions&limit=500', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/admin/system/desk-decisions?action=summarize-decisions', { credentials: 'include' }).then(r => r.json()),
      ]);
      setDecisions(listRes.decisions ?? []);
      setSummary(sumRes.summary);
      setMissed(sumRes.missed ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function submitReview() {
    if (!reviewing) return;
    const body: any = { action: 'review-decision', id: reviewing.id, outcomeStatus: revOutcome, reviewNotes: revNotes };
    if (revPnl !== '') body.pnlCents = Math.round(parseFloat(revPnl) * 100);
    await fetch('/api/admin/system/desk-decisions', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setReviewing(null);
    setRevOutcome('pending'); setRevPnl(''); setRevNotes('');
    reload();
  }

  function openReview(d: any) {
    setReviewing(d);
    setRevOutcome(d.outcomeStatus ?? 'pending');
    setRevPnl(d.pnlCents != null ? (d.pnlCents / 100).toString() : '');
    setRevNotes(d.reviewNotes ?? '');
  }

  const navLinks = [
    { href: '/admin/signals', label: 'Signals' },
    { href: '/admin/system/calibration-lab', label: 'Calibration Lab' },
    { href: '/admin/system/calibration-backtest', label: 'Calibration Backtest' },
    { href: '/admin/system/outcome-evaluation', label: 'Outcome Evaluation' },
    { href: '/admin/system/desk-decisions', label: 'Desk Decisions', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading desk decisions…</div>;
  const s = summary;
  const fmtCents = (v: number | null | undefined) => v == null ? '—' : `$${(v / 100).toFixed(2)}`;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>
            {l.label}
          </a>
        ))}
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Desk Decision Journal</h1>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: '#94a3b8', maxWidth: 760 }}>
        Manual log of operator decisions on each signal — take / skip / watch / reject — with reason categories and later outcome review. Read-only journal; nothing here drives execution.
      </p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['log', `Decision Log (${s?.totals.all ?? 0})`],
          ['analysis', 'Take / Skip Analysis'],
          ['missed', `Missed Opportunities (${s?.missedOpportunities ?? 0})`],
          ['review', `Operator Review (${s?.pending ?? 0} pending)`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'log' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700 }}>Decision Log</h3>
          {decisions.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No decisions recorded yet. Go to <a href="/admin/signals" style={{ color: '#3b82f6' }}>/admin/signals</a> and click Take / Skip / Watch / Reject on any signal to log a decision.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Decision</th>
                    <th style={th}>Title</th>
                    <th style={th}>Reason</th>
                    <th style={th}>Raw / Cal edge</th>
                    <th style={th}>Score / Tier</th>
                    <th style={th}>Outcome</th>
                    <th style={th}>P&L</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map(d => (
                    <tr key={d.id}>
                      <td style={td}>{new Date(d.createdAt).toLocaleString()}</td>
                      <td style={td}><span style={badge(decisionColor[d.decision])}>{d.decision}</span></td>
                      <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.title}>{d.title}</td>
                      <td style={td}>{d.reasonCategory.replace(/_/g, ' ')}</td>
                      <td style={td}>
                        {d.rawEdge != null ? `${(d.rawEdge * 100).toFixed(1)}%` : '—'}
                        {d.calibratedEdge != null ? ` / ${(d.calibratedEdge * 100).toFixed(1)}%` : ''}
                      </td>
                      <td style={td}>{d.signalScore ?? '—'} / {d.sizingTier ?? '—'}</td>
                      <td style={td}><span style={badge(outcomeColor[d.outcomeStatus ?? 'pending'])}>{d.outcomeStatus ?? 'pending'}</span></td>
                      <td style={td}>{fmtCents(d.pnlCents)}</td>
                      <td style={td}><button onClick={() => openReview(d)} style={btn('#6366f1')}>Review</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'analysis' && s && (
        <div>
          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Take</div><div style={{ fontSize: 24, fontWeight: 700, color: decisionColor.take }}>{s.totals.take}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Skip</div><div style={{ fontSize: 24, fontWeight: 700, color: decisionColor.skip }}>{s.totals.skip}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Watch</div><div style={{ fontSize: 24, fontWeight: 700, color: decisionColor.watch }}>{s.totals.watch}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Reject</div><div style={{ fontSize: 24, fontWeight: 700, color: decisionColor.reject }}>{s.totals.reject}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Take win rate</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.taken.winRatePct != null ? `${s.taken.winRatePct}%` : '—'}</div><div style={{ fontSize: 10, color: '#64748b' }}>{s.taken.withPnl} settled</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Take total P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: s.taken.totalPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtCents(s.taken.totalPnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Take avg P&L</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCents(s.taken.avgPnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Manual overrides</div><div style={{ fontSize: 24, fontWeight: 700 }}>{s.manualOverrides}</div></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={card}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>By reason category</h4>
              <table style={{ width: '100%' }}>
                <tbody>
                  {Object.entries(s.byReason).map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ ...td, color: '#94a3b8', textTransform: 'capitalize' }}>{(k as string).replace(/_/g, ' ')}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{v as number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={card}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Cross-tabs</h4>
              <table style={{ width: '100%' }}>
                <tbody>
                  <tr><td style={{ ...td, color: '#94a3b8' }}>Skipped that won (or marked missed)</td><td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#a855f7' }}>{s.skippedThatWon}</td></tr>
                  <tr><td style={{ ...td, color: '#94a3b8' }}>Rejected that won</td><td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#a855f7' }}>{s.rejectedThatWon}</td></tr>
                  <tr><td style={{ ...td, color: '#94a3b8' }}>Taken that lost</td><td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>{s.takenThatLost}</td></tr>
                  <tr><td style={{ ...td, color: '#94a3b8' }}>Pending review</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{s.pending}</td></tr>
                  <tr><td style={{ ...td, color: '#94a3b8' }}>Reviewed</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{s.reviewed}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'missed' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Missed Opportunities</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Skipped or rejected signals that the operator later marked as <strong>won</strong> or <strong>missed_opportunity</strong> during review. Automatic detection (looking up Kalshi market resolution by ticker) is future work — for now, this list reflects manually flagged misses only.
          </p>
          {missed.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No missed opportunities flagged yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Decision</th>
                  <th style={th}>Title</th>
                  <th style={th}>Reason</th>
                  <th style={th}>Outcome</th>
                  <th style={th}>Review notes</th>
                </tr>
              </thead>
              <tbody>
                {missed.map((d: any) => (
                  <tr key={d.id}>
                    <td style={td}>{new Date(d.createdAt).toLocaleString()}</td>
                    <td style={td}><span style={badge(decisionColor[d.decision])}>{d.decision}</span></td>
                    <td style={td}>{d.title}</td>
                    <td style={td}>{d.reasonCategory.replace(/_/g, ' ')}</td>
                    <td style={td}><span style={badge(outcomeColor[d.outcomeStatus ?? 'pending'])}>{d.outcomeStatus}</span></td>
                    <td style={{ ...td, fontSize: 12, color: '#cbd5e1' }}>{d.reviewNotes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'review' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Operator Review — pending</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Decisions that have not yet been reviewed. Click Review to assign an outcome and P&L.</p>
          {(() => {
            const pending = decisions.filter(d => d.outcomeStatus === 'pending' || d.outcomeStatus == null);
            if (pending.length === 0) return <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No pending reviews.</div>;
            return (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Decision</th>
                    <th style={th}>Title</th>
                    <th style={th}>Notes</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(d => (
                    <tr key={d.id}>
                      <td style={td}>{new Date(d.createdAt).toLocaleString()}</td>
                      <td style={td}><span style={badge(decisionColor[d.decision])}>{d.decision}</span></td>
                      <td style={{ ...td, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.title}>{d.title}</td>
                      <td style={{ ...td, fontSize: 12, color: '#cbd5e1' }}>{d.notes ?? ''}</td>
                      <td style={td}><button onClick={() => openReview(d)} style={btn('#6366f1')}>Review</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Methodology</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' }}>
            <li>Decisions are logged manually from <a href="/admin/signals" style={{ color: '#3b82f6' }}>/admin/signals</a> via Take / Skip / Watch / Reject buttons.</li>
            <li>Each record snapshots the signal-time context: rawEdge, calibratedEdge, reliabilityFactor, signalScore, sizingTier — so decisions can be reviewed against the model state at the time of the call, not the current state.</li>
            <li>Review pass is manual: operator sets outcomeStatus (won / lost / push / missed_opportunity) and optional pnlCents.</li>
            <li>Missed opportunities are detected only when the operator manually flags a skipped or rejected decision as won or missed_opportunity. Automatic detection by looking up the resolved Kalshi market by ticker is intentionally not implemented yet.</li>
            <li>The journal does NOT create execution candidates, place orders, or modify scoring. It is purely a manual record + review surface.</li>
            <li>All actions are audit-logged with operatorId.</li>
            <li>Storage: Redis. Each record at <code>desk-decision:{'{id}'}</code>; sorted-set index at <code>desk-decisions:all</code>. Auto-trims oldest beyond 5000 entries.</li>
          </ul>
        </div>
      )}

      {/* Review modal */}
      {reviewing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 10, padding: 22, width: 420, maxWidth: '95vw', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Review decision</h3>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 12px' }}>{reviewing.title}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 12, color: '#94a3b8' }}>Outcome</label>
              <select value={revOutcome} onChange={e => setRevOutcome(e.target.value)} style={inputStyle}>
                <option value="pending">pending</option>
                <option value="won">won</option>
                <option value="lost">lost</option>
                <option value="push">push</option>
                <option value="missed_opportunity">missed_opportunity</option>
              </select>
              <label style={{ fontSize: 12, color: '#94a3b8' }}>Realized P&L (USD, optional)</label>
              <input type="number" step="0.01" value={revPnl} onChange={e => setRevPnl(e.target.value)} placeholder="e.g. 1.25 or -0.50" style={inputStyle} />
              <label style={{ fontSize: 12, color: '#94a3b8' }}>Review notes</label>
              <textarea value={revNotes} onChange={e => setRevNotes(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setReviewing(null)} style={btn('#475569')}>Cancel</button>
              <button onClick={submitReview} style={btn('#6366f1')}>Save review</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
