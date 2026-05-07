// ── Step 119B Part B: Manual Hedge Review Center (admin-only) ───────────────
//
// Advisory ledger UI. No execution surface anywhere. Lets the operator
// create a review from a wager + optional comparison, then walk it
// through draft → under_review → (recommended/no_hedge/hedged-elsewhere)
// → closed with decision notes.

import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const label: React.CSSProperties = { fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'block' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13, color: '#e2e8f0' };
const sectionHeader: React.CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' };
const muted: React.CSSProperties = { fontSize: 12, color: '#94a3b8' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #7c2d12, #c2410c)',
  color: '#fff',
  padding: '10px 14px',
  borderRadius: 8,
  marginBottom: 16,
  fontSize: 13,
  fontWeight: 600,
};

const STATUS_COLOR: Record<string, string> = {
  draft: '#64748b',
  under_review: '#0ea5e9',
  hedge_recommended: '#f97316',
  no_hedge_recommended: '#22c55e',
  manually_hedged_elsewhere: '#a855f7',
  closed: '#94a3b8',
};

const ACTION_COLOR: Record<string, string> = {
  watch: '#64748b',
  reduce_exposure: '#f59e0b',
  manual_external_hedge_review: '#f97316',
  do_not_hedge: '#22c55e',
};

type Tab = 'watchlist' | 'create' | 'detail' | 'log' | 'methodology';

interface SlimWager {
  id: string;
  ticketNumber?: string;
  title: string;
  kind: string;
  status: string;
  metric: string;
  targetDate: string;
}

interface Review {
  id: string;
  createdAt: string;
  createdBy: string;
  relatedWagerId: string;
  wagerTitle: string;
  relatedHouseExposureSnapshotId?: string;
  relatedKalshiComparisonId?: string;
  status: keyof typeof STATUS_COLOR;
  exposureSummary: {
    hasSnapshot: boolean;
    snapshotId?: string;
    totalStakeCents?: number;
    potentialPayoutCents?: number;
    worstCaseHouseLossCents?: number;
    realizedHouseResultCents?: number;
    topUserPctOfMarket?: number;
    concentrationWarning?: boolean;
  };
  externalMarketSummary: {
    hasComparison: boolean;
    comparisonId?: string;
    comparisonVerdict?: string;
    matchedMarketCount: number;
    highestConfidence: 'low' | 'medium' | 'high' | null;
    pricingGapCount: number;
  };
  hedgeRationale: string;
  recommendedAction: keyof typeof ACTION_COLOR;
  suggestedManualHedgeNotes: string[];
  risks: string[];
  decisionNotes: string[];
  history: { at: string; actor: string; action: string; details?: any }[];
  closedAt?: string;
  closedBy?: string;
}

interface Summary {
  total: number;
  byStatus: Record<string, number>;
  byRecommendation: Record<string, number>;
  latest: Review | null;
}

interface WatchlistCandidate {
  wagerId: string;
  wagerTitle: string;
  status: string;
  worstCaseHouseLossCents: number;
  totalStakeCents: number;
  concentrationWarning: boolean;
  hasExistingReview: boolean;
  latestReviewId?: string;
  latestReviewStatus?: string;
  hasKalshiComparison: boolean;
  latestComparisonId?: string;
  comparisonVerdict?: string;
  recommendedAction: keyof typeof ACTION_COLOR;
  notes: string[];
}

interface Watchlist {
  generatedAt: string;
  exposureSnapshotId?: string;
  thresholdCents: number;
  candidates: WatchlistCandidate[];
  warnings: string[];
}

const API = '/api/admin/system/manual-hedge-review';
const WAGERS_API = '/api/admin/system/kalshi-market-comparison?action=list-wagers';

function dollars(cents?: number): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toLocaleString()}`;
}

export default function ManualHedgeReviewCenter() {
  const [tab, setTab] = useState<Tab>('watchlist');
  const [wagers, setWagers] = useState<SlimWager[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [watchlist, setWatchlist] = useState<Watchlist | null>(null);
  const [active, setActive] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedWagerId, setSelectedWagerId] = useState('');
  const [comparisonIdHint, setComparisonIdHint] = useState('');
  const [noteText, setNoteText] = useState('');
  const [statusReason, setStatusReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [listR, sumR, wagersR, wlR] = await Promise.all([
          fetch(`${API}?action=list&limit=50`),
          fetch(`${API}?action=summary`),
          fetch(WAGERS_API),
          fetch(`${API}?action=watchlist`),
        ]);
        const [listJ, sumJ, wagersJ, wlJ] = await Promise.all([
          listR.json(),
          sumR.json(),
          wagersR.json(),
          wlR.json(),
        ]);
        if (cancelled) return;
        if (!listR.ok) throw new Error(listJ.message ?? 'list failed');
        setReviews(listJ.reviews ?? []);
        setSummary(sumJ.summary ?? null);
        setWagers(wagersJ.wagers ?? []);
        setWatchlist(wlJ.watchlist ?? null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    const [listR, sumR, wlR] = await Promise.all([
      fetch(`${API}?action=list&limit=50`),
      fetch(`${API}?action=summary`),
      fetch(`${API}?action=watchlist`),
    ]);
    if (listR.ok) setReviews((await listR.json()).reviews ?? []);
    if (sumR.ok) setSummary((await sumR.json()).summary ?? null);
    if (wlR.ok) setWatchlist((await wlR.json()).watchlist ?? null);
  }

  async function onCreateForCandidate(wagerId: string) {
    setBusy('create');
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', wagerId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'create failed');
      setActive(j.review ?? null);
      await refresh();
      setTab('detail');
    } catch (e: any) {
      setError(e?.message ?? 'Create failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onCreate() {
    if (!selectedWagerId) {
      setError('Pick a wager first.');
      return;
    }
    setBusy('create');
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          wagerId: selectedWagerId,
          comparisonId: comparisonIdHint.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'create failed');
      setActive(j.review ?? null);
      await refresh();
      setTab('detail');
    } catch (e: any) {
      setError(e?.message ?? 'Create failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onAddNote() {
    if (!active || !noteText.trim()) return;
    setBusy('note');
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-decision-note', id: active.id, note: noteText.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'add-note failed');
      setActive(j.review ?? null);
      setNoteText('');
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Note failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onChangeStatus(to: string) {
    if (!active) return;
    setBusy(`status-${to}`);
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change-status',
          id: active.id,
          to,
          reason: statusReason.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'change-status failed');
      setActive(j.review ?? null);
      setStatusReason('');
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Status change failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onOpen(id: string) {
    setBusy('open');
    setError(null);
    try {
      const r = await fetch(`${API}?action=get&id=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'get failed');
      setActive(j.review ?? null);
      setTab('detail');
    } catch (e: any) {
      setError(e?.message ?? 'Open failed.');
    } finally {
      setBusy(null);
    }
  }

  const wagerOptions = useMemo(
    () =>
      wagers.map((w) => (
        <option key={w.id} value={w.id}>
          {w.ticketNumber ? `${w.ticketNumber} · ` : ''}
          {w.title} ({w.kind}, {w.status}, {w.targetDate})
        </option>
      )),
    [wagers],
  );

  const validNextStatuses: Record<string, string[]> = {
    draft: ['under_review', 'closed'],
    under_review: [
      'hedge_recommended',
      'no_hedge_recommended',
      'manually_hedged_elsewhere',
      'closed',
    ],
    hedge_recommended: ['manually_hedged_elsewhere', 'no_hedge_recommended', 'closed'],
    no_hedge_recommended: ['hedge_recommended', 'closed'],
    manually_hedged_elsewhere: ['closed'],
    closed: [],
  };

  return (
    <div style={{ background: '#0f172a', minHeight: '100vh', padding: 16, color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Manual Hedge Review</h1>
      <p style={{ ...muted, marginBottom: 12 }}>
        Kalshi is treated as an external competitor venue used for admin intelligence. If users build
        too much one-sided exposure on WagerOnWeather, admins may review whether to manually hedge
        elsewhere. The system can recommend review; the admin makes all decisions outside the
        platform.
      </p>

      <div style={BANNER}>
        Manual Hedge Review is advisory only. It does not place Kalshi trades, submit orders, or hedge automatically.
      </div>

      <div style={{ ...muted, marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        See also:
        <a href="/admin/system/house-exposure" style={{ color: '#60a5fa' }}>House Exposure</a>
        <a href="/admin/system/kalshi-market-data" style={{ color: '#60a5fa' }}>Kalshi Market Data</a>
        <a href="/admin/system/kalshi-market-comparison" style={{ color: '#60a5fa' }}>Kalshi Comparison</a>
        <a href="/admin/system/market-integrity" style={{ color: '#60a5fa' }}>Market Integrity</a>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(
          [
            ['watchlist', 'Exposure Watchlist'],
            ['create', 'Create Review'],
            ['detail', 'Review Detail'],
            ['log', 'Hedge Decision Log'],
            ['methodology', 'Methodology'],
          ] as [Tab, string][]
        ).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{ ...btn(tab === k ? '#3b82f6' : '#334155'), opacity: tab === k ? 1 : 0.85 }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ ...card, background: '#7f1d1d', color: '#fef2f2' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {tab === 'watchlist' && (
        <div style={card}>
          <h2 style={sectionHeader}>Exposure Watchlist</h2>
          <p style={muted}>
            Auto-populated from the latest House Exposure snapshot. Markets at or above the $1,000 worst-case-loss
            threshold are surfaced as hedge-review candidates. Kalshi is treated as an external competitor venue —
            hedge review is advisory and manual; this tool never places external trades.
          </p>

          {watchlist && watchlist.warnings.length > 0 && (
            <div style={{ ...tile, marginTop: 12, borderColor: '#854d0e', background: '#1f1500' }}>
              <strong style={{ color: '#fbbf24' }}>Notes</strong>
              <ul style={{ marginTop: 6 }}>
                {watchlist.warnings.map((w, i) => (
                  <li key={i} style={muted}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {watchlist && watchlist.candidates.length > 0 && (
            <>
              <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 16 }}>
                Watchlist candidates ({watchlist.candidates.length}) — snapshot {watchlist.exposureSnapshotId}
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Wager</th>
                      <th style={th}>Status</th>
                      <th style={th}>Worst-case loss</th>
                      <th style={th}>Stake</th>
                      <th style={th}>Concentration</th>
                      <th style={th}>Comparison</th>
                      <th style={th}>Existing review</th>
                      <th style={th}>Recommended</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchlist.candidates.map((c) => (
                      <tr key={c.wagerId}>
                        <td style={td}>{c.wagerTitle}</td>
                        <td style={td}>{c.status}</td>
                        <td style={td}>{dollars(c.worstCaseHouseLossCents)}</td>
                        <td style={td}>{dollars(c.totalStakeCents)}</td>
                        <td style={td}>
                          {c.concentrationWarning ? (
                            <span style={{ color: '#f59e0b', fontWeight: 600 }}>warning</span>
                          ) : (
                            <span style={muted}>—</span>
                          )}
                        </td>
                        <td style={td}>
                          {c.hasKalshiComparison ? (
                            <a
                              href={`/admin/system/kalshi-market-comparison`}
                              style={{ color: '#60a5fa' }}
                            >
                              {c.comparisonVerdict ?? 'view'}
                            </a>
                          ) : (
                            <a href="/admin/system/kalshi-market-comparison" style={{ color: '#fbbf24' }}>
                              generate first →
                            </a>
                          )}
                        </td>
                        <td style={td}>
                          {c.hasExistingReview && c.latestReviewId ? (
                            <a href="#" style={{ color: '#60a5fa' }} onClick={(e) => { e.preventDefault(); onOpen(c.latestReviewId!); }}>
                              {c.latestReviewStatus} · open
                            </a>
                          ) : (
                            <span style={muted}>none</span>
                          )}
                        </td>
                        <td style={td}>
                          <span style={{ color: ACTION_COLOR[c.recommendedAction], fontWeight: 600 }}>
                            {c.recommendedAction.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td style={td}>
                          <button
                            style={{ ...btn('#3b82f6'), opacity: busy ? 0.6 : 1 }}
                            disabled={!!busy}
                            onClick={() => onCreateForCandidate(c.wagerId)}
                          >
                            Create Hedge Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
              <div style={tile}><div style={muted}>Total reviews</div><div style={{ fontSize: 22, fontWeight: 700 }}>{summary.total}</div></div>
              {Object.entries(summary.byStatus).map(([k, v]) => (
                <div key={k} style={tile}>
                  <div style={muted}>{k.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: STATUS_COLOR[k] ?? '#e2e8f0' }}>{v}</div>
                </div>
              ))}
            </div>
          )}
          <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 16 }}>Recent reviews</h3>
          {reviews.length === 0 ? (
            <div style={muted}>No hedge reviews yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Wager</th>
                    <th style={th}>Status</th>
                    <th style={th}>Recommended</th>
                    <th style={th}>Worst-case loss</th>
                    <th style={th}>Comparison</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>{new Date(r.createdAt).toLocaleString()}</td>
                      <td style={td}>{r.wagerTitle}</td>
                      <td style={td}>
                        <span style={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>{r.status.replace(/_/g, ' ')}</span>
                      </td>
                      <td style={td}>
                        <span style={{ color: ACTION_COLOR[r.recommendedAction], fontWeight: 600 }}>
                          {r.recommendedAction.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={td}>{dollars(r.exposureSummary.worstCaseHouseLossCents)}</td>
                      <td style={td}>{r.externalMarketSummary.hasComparison ? r.externalMarketSummary.comparisonVerdict : '—'}</td>
                      <td style={td}><button style={btn('#475569')} onClick={() => onOpen(r.id)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'create' && (
        <div style={card}>
          <h2 style={sectionHeader}>Create Review</h2>
          <p style={muted}>
            Pick a wager. The review pulls from the latest house-exposure snapshot and the most-recent Kalshi
            comparison for that wager. If either is missing, the review records that as a risk and recommends
            generating one before deciding.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 12 }}>
            <div>
              <span style={label}>Wager</span>
              <select
                style={{ ...input, width: '100%' }}
                value={selectedWagerId}
                onChange={(e) => setSelectedWagerId(e.target.value)}
              >
                <option value="">— pick a wager —</option>
                {wagerOptions}
              </select>
            </div>
            <div>
              <span style={label}>Specific comparison id (optional)</span>
              <input
                style={{ ...input, width: '100%' }}
                value={comparisonIdHint}
                onChange={(e) => setComparisonIdHint(e.target.value)}
                placeholder="defaults to most recent for this wager"
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              style={{ ...btn('#3b82f6'), opacity: !selectedWagerId || busy ? 0.6 : 1 }}
              disabled={!selectedWagerId || !!busy}
              onClick={onCreate}
            >
              {busy === 'create' ? 'Creating…' : 'Create review'}
            </button>
          </div>
        </div>
      )}

      {tab === 'detail' && (
        <div style={card}>
          <h2 style={sectionHeader}>Review Detail</h2>
          {!active ? (
            <div style={muted}>Open a review from the Watchlist or create a new one.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div style={tile}>
                  <div style={muted}>Wager</div>
                  <div style={{ fontWeight: 700 }}>{active.wagerTitle}</div>
                  <div style={muted}>{active.relatedWagerId}</div>
                </div>
                <div style={tile}>
                  <div style={muted}>Status</div>
                  <div style={{ fontWeight: 700, color: STATUS_COLOR[active.status] }}>{active.status.replace(/_/g, ' ')}</div>
                </div>
                <div style={tile}>
                  <div style={muted}>Recommended action</div>
                  <div style={{ fontWeight: 700, color: ACTION_COLOR[active.recommendedAction] }}>
                    {active.recommendedAction.replace(/_/g, ' ')}
                  </div>
                </div>
                <div style={tile}>
                  <div style={muted}>Worst-case loss</div>
                  <div style={{ fontWeight: 700 }}>{dollars(active.exposureSummary.worstCaseHouseLossCents)}</div>
                </div>
              </div>

              <div style={{ ...tile, marginTop: 12 }}>
                <strong>Hedge rationale</strong>
                <div style={{ ...muted, marginTop: 4 }}>{active.hedgeRationale}</div>
              </div>

              {active.suggestedManualHedgeNotes.length > 0 && (
                <div style={{ ...tile, marginTop: 12 }}>
                  <strong>Suggested manual hedge notes</strong>
                  <ul style={{ marginTop: 6 }}>
                    {active.suggestedManualHedgeNotes.map((n, i) => (
                      <li key={i} style={muted}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {active.risks.length > 0 && (
                <div style={{ ...tile, marginTop: 12, borderColor: '#854d0e', background: '#1f1500' }}>
                  <strong style={{ color: '#fbbf24' }}>Risks</strong>
                  <ul style={{ marginTop: 6 }}>
                    {active.risks.map((r, i) => (
                      <li key={i} style={muted}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 16 }}>Decision notes</h3>
              {active.status !== 'closed' && (
                <div style={{ marginBottom: 12 }}>
                  <textarea
                    style={{ ...input, width: '100%', minHeight: 80 }}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add a decision note…"
                  />
                  <button
                    style={{ ...btn('#3b82f6'), marginTop: 8, opacity: busy || !noteText.trim() ? 0.6 : 1 }}
                    disabled={!!busy || !noteText.trim()}
                    onClick={onAddNote}
                  >
                    {busy === 'note' ? 'Adding…' : 'Add note'}
                  </button>
                </div>
              )}
              {active.decisionNotes.length === 0 ? (
                <div style={muted}>No decision notes yet.</div>
              ) : (
                <ul style={{ lineHeight: 1.7 }}>
                  {active.decisionNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}

              {active.status !== 'closed' && validNextStatuses[active.status]?.length > 0 && (
                <>
                  <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 16 }}>Change status</h3>
                  <input
                    style={{ ...input, width: '100%', maxWidth: 480 }}
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    placeholder="Reason / context (optional)"
                  />
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {validNextStatuses[active.status].map((s) => (
                      <button
                        key={s}
                        style={{ ...btn(STATUS_COLOR[s] ?? '#475569'), opacity: busy ? 0.6 : 1 }}
                        disabled={!!busy}
                        onClick={() => onChangeStatus(s)}
                      >
                        {busy === `status-${s}` ? 'Updating…' : `→ ${s.replace(/_/g, ' ')}`}
                      </button>
                    ))}
                  </div>
                  <p style={{ ...muted, marginTop: 8 }}>
                    "manually_hedged_elsewhere" is documentation only. It does not place or verify any external trade.
                  </p>
                </>
              )}

              <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 16 }}>History</h3>
              <ul style={{ ...muted, lineHeight: 1.7 }}>
                {active.history.map((h, i) => (
                  <li key={i}>
                    <code style={{ fontSize: 11 }}>{new Date(h.at).toLocaleString()}</code> · {h.action} · by {h.actor}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'log' && (
        <div style={card}>
          <h2 style={sectionHeader}>Hedge Decision Log</h2>
          <p style={muted}>Recent reviews across all wagers. Use Watchlist for filtering by status.</p>
          {loading ? (
            <div style={muted}>Loading…</div>
          ) : reviews.length === 0 ? (
            <div style={muted}>No reviews logged.</div>
          ) : (
            <ul style={{ lineHeight: 1.7 }}>
              {reviews.map((r) => (
                <li key={r.id}>
                  <code style={{ fontSize: 11 }}>{new Date(r.createdAt).toLocaleString()}</code> ·{' '}
                  <span style={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>{r.status.replace(/_/g, ' ')}</span> · {r.wagerTitle} → recommended{' '}
                  <span style={{ color: ACTION_COLOR[r.recommendedAction], fontWeight: 600 }}>{r.recommendedAction.replace(/_/g, ' ')}</span> ·{' '}
                  <a href="#" style={{ color: '#60a5fa' }} onClick={(e) => { e.preventDefault(); onOpen(r.id); }}>open</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h2 style={sectionHeader}>Methodology</h2>
          <ul style={{ marginTop: 8, lineHeight: 1.7 }}>
            <li>Reviews are seeded from the latest <a href="/admin/system/house-exposure" style={{ color: '#60a5fa' }}>House Exposure</a> snapshot and the most recent <a href="/admin/system/kalshi-market-comparison" style={{ color: '#60a5fa' }}>Kalshi Comparison</a> for the wager.</li>
            <li>Recommended action is derived: high projected loss + non-low external match → <code>manual_external_hedge_review</code>; high loss with no usable match → <code>reduce_exposure</code>; comparison gap below threshold → <code>watch</code>; otherwise <code>do_not_hedge</code>.</li>
            <li>Status flow: <code>draft → under_review → (hedge_recommended | no_hedge_recommended | manually_hedged_elsewhere) → closed</code>. Transitions are validated server-side.</li>
            <li>"manually_hedged_elsewhere" is a documentation-only status. The platform does not place external trades, stage tickets, or verify external execution.</li>
            <li>Storage: <code>hedge-review:&lt;id&gt;</code>, <code>hedge-reviews:all</code>, <code>hedge-review:wager:&lt;wagerId&gt;</code>. Capped at 200.</li>
            <li>Audit events: <code>manual_hedge_review_created</code>, <code>manual_hedge_review_note_added</code>, <code>manual_hedge_review_status_changed</code>, <code>manual_hedge_review_closed</code>.</li>
          </ul>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SystemNav activeHref="/admin/system/manual-hedge-review" />
      </div>
    </div>
  );
}
