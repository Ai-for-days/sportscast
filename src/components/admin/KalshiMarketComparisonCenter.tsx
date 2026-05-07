// ── Step 119: Kalshi vs WagerOnWeather Comparison Center (admin-only) ───────
//
// Advisory-only UI. Lets the operator pick an internal wager and an
// optional Kalshi snapshot, then renders the matched external markets,
// pricing-gap notes, and hedge-review notes alongside warnings and
// recommendations. No execution surface anywhere.

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
  background: 'linear-gradient(90deg, #1e3a8a, #1d4ed8)',
  color: '#fff',
  padding: '10px 14px',
  borderRadius: 8,
  marginBottom: 16,
  fontSize: 13,
  fontWeight: 600,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

const VERDICT_COLOR: Record<string, string> = {
  no_match: '#475569',
  watch: '#64748b',
  possible_pricing_gap: '#f59e0b',
  hedge_review_recommended: '#f97316',
  manual_review_required: '#0ea5e9',
};

const CONF_COLOR: Record<string, string> = {
  low: '#475569',
  medium: '#0ea5e9',
  high: '#22c55e',
};

type Tab = 'overview' | 'generate' | 'detail' | 'hedge' | 'methodology';

interface SlimWager {
  id: string;
  ticketNumber?: string;
  title: string;
  kind: string;
  status: string;
  metric: string;
  targetDate: string;
}

interface KalshiSnapshotSummary {
  id: string;
  createdAt: string;
  kalshiEnv: 'demo' | 'live';
  marketCount: number;
}

interface MatchedMarket {
  ticker: string;
  title?: string;
  status?: string;
  closeTime?: string;
  yesBid?: number;
  yesAsk?: number;
  lastPrice?: number;
  volume?: number;
  openInterest?: number;
  matchReason: string;
  confidence: 'low' | 'medium' | 'high';
  externalImpliedProbability?: number;
}

interface PricingGapNote {
  ticker: string;
  internalLabel: string;
  internalImplied: number;
  externalImplied: number;
  gapPp: number;
  note: string;
}

interface Comparison {
  id: string;
  createdAt: string;
  createdBy: string;
  wagerId: string;
  wagerTitle: string;
  kalshiSnapshotId?: string;
  matchedKalshiMarkets: MatchedMarket[];
  wagerPricingSummary: {
    kind: string;
    metric: string;
    targetDate: string;
    rows: { label: string; americanOdds: number; impliedProbability: number }[];
  };
  externalPricingSummary: {
    marketsConsidered: number;
    highestConfidence: 'low' | 'medium' | 'high' | null;
    midProbabilities: { ticker: string; impliedProbability: number }[];
  };
  pricingGapNotes: PricingGapNote[];
  hedgeReviewNotes: string[];
  warnings: string[];
  recommendations: string[];
  verdict: keyof typeof VERDICT_COLOR;
  status: 'advisory_only';
}

interface Summary {
  totalComparisons: number;
  latestComparison: Comparison | null;
  verdictCounts: Record<string, number>;
}

const API = '/api/admin/system/kalshi-market-comparison';
const KALSHI_DATA_API = '/api/admin/system/kalshi-market-data';

function formatPct(p?: number): string {
  if (p == null || !Number.isFinite(p)) return '—';
  return `${(p * 100).toFixed(1)}%`;
}

export default function KalshiMarketComparisonCenter() {
  const [tab, setTab] = useState<Tab>('overview');
  const [wagers, setWagers] = useState<SlimWager[]>([]);
  const [snapshots, setSnapshots] = useState<KalshiSnapshotSummary[]>([]);
  const [selectedWagerId, setSelectedWagerId] = useState('');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [active, setActive] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [wagersRes, snapsRes, listRes, summaryRes] = await Promise.all([
          fetch(`${API}?action=list-wagers`),
          fetch(`${KALSHI_DATA_API}?action=list-snapshots&limit=20`),
          fetch(`${API}?action=list&limit=50`),
          fetch(`${API}?action=summary`),
        ]);
        const [wagersJ, snapsJ, listJ, summaryJ] = await Promise.all([
          wagersRes.json(),
          snapsRes.json(),
          listRes.json(),
          summaryRes.json(),
        ]);
        if (cancelled) return;
        if (!wagersRes.ok) throw new Error(wagersJ.message ?? 'list-wagers failed');
        setWagers(wagersJ.wagers ?? []);
        const snapItems = (snapsJ.snapshots ?? []).map((s: any) => ({
          id: s.id,
          createdAt: s.createdAt,
          kalshiEnv: s.kalshiEnv,
          marketCount: s.markets?.length ?? 0,
        }));
        setSnapshots(snapItems);
        setComparisons(listJ.comparisons ?? []);
        setSummary(summaryJ.summary ?? null);
        if ((wagersJ.wagers ?? []).length > 0 && !selectedWagerId) {
          setSelectedWagerId(wagersJ.wagers[0].id);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const [listRes, summaryRes] = await Promise.all([
      fetch(`${API}?action=list&limit=50`),
      fetch(`${API}?action=summary`),
    ]);
    const listJ = await listRes.json();
    const summaryJ = await summaryRes.json();
    if (listRes.ok) setComparisons(listJ.comparisons ?? []);
    if (summaryRes.ok) setSummary(summaryJ.summary ?? null);
  }

  async function onGenerate() {
    if (!selectedWagerId) {
      setError('Pick a wager first.');
      return;
    }
    setBusy('generate');
    setError(null);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          wagerId: selectedWagerId,
          snapshotId: selectedSnapshotId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'generate failed');
      setActive(json.comparison ?? null);
      await refresh();
      setTab('detail');
    } catch (e: any) {
      setError(e?.message ?? 'Generate failed.');
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
      setActive(j.comparison ?? null);
      setTab('detail');
    } catch (e: any) {
      setError(e?.message ?? 'Open failed.');
    } finally {
      setBusy(null);
    }
  }

  const wagerOptions = useMemo(() => {
    return wagers.map((w) => (
      <option key={w.id} value={w.id}>
        {w.ticketNumber ? `${w.ticketNumber} · ` : ''}
        {w.title} ({w.kind}, {w.status}, {w.targetDate})
      </option>
    ));
  }, [wagers]);

  return (
    <div style={{ background: '#0f172a', minHeight: '100vh', padding: 16, color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Kalshi Market Comparison Center</h1>
      <p style={{ ...muted, marginBottom: 12 }}>
        Internal admin intelligence only. Kalshi is treated as an external market / competitor venue. Comparisons are advisory; nothing here mutates wagers, pricing, or external orders.
      </p>

      <div style={BANNER}>
        <span>
          Kalshi Comparison is admin-only and advisory. It does not place trades, hedge automatically, mirror markets, or change WagerOnWeather pricing.
        </span>
      </div>

      <div style={{ ...muted, marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        See also:
        <a href="/admin/system/kalshi-market-data" style={{ color: '#60a5fa' }}>Kalshi Market Data</a>
        <a href="/admin/system/manual-hedge-review" style={{ color: '#60a5fa' }}>Manual Hedge Review</a>
        <a href="/admin/system/house-exposure" style={{ color: '#60a5fa' }}>House Exposure</a>
        <a href="/admin/wagers" style={{ color: '#60a5fa' }}>Pricing Engine / Market Design Lab</a>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(
          [
            ['overview', 'Overview'],
            ['generate', 'Generate Comparison'],
            ['detail', 'Comparison Detail'],
            ['hedge', 'Hedge Review'],
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

      {tab === 'overview' && (
        <div style={card}>
          <h2 style={sectionHeader}>Overview</h2>
          {loading ? (
            <div style={muted}>Loading…</div>
          ) : summary ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div style={tile}>
                <div style={muted}>Comparisons (recent)</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.totalComparisons}</div>
              </div>
              {Object.entries(summary.verdictCounts).map(([v, n]) => (
                <div key={v} style={tile}>
                  <div style={muted}>{v.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: VERDICT_COLOR[v] ?? '#e2e8f0' }}>{n}</div>
                </div>
              ))}
            </div>
          ) : null}

          <h3 style={{ ...sectionHeader, fontSize: 14 }}>Comparison ledger</h3>
          {comparisons.length === 0 ? (
            <div style={muted}>No comparisons yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Wager</th>
                    <th style={th}>Verdict</th>
                    <th style={th}>Matched</th>
                    <th style={th}>Gaps</th>
                    <th style={th}>By</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((c) => (
                    <tr key={c.id}>
                      <td style={td}>{new Date(c.createdAt).toLocaleString()}</td>
                      <td style={td}>{c.wagerTitle}</td>
                      <td style={td}>
                        <span style={{ color: VERDICT_COLOR[c.verdict], fontWeight: 600 }}>
                          {c.verdict.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={td}>{c.matchedKalshiMarkets.length}</td>
                      <td style={td}>{c.pricingGapNotes.length}</td>
                      <td style={td}>{c.createdBy}</td>
                      <td style={td}>
                        <button style={btn('#475569')} onClick={() => onOpen(c.id)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'generate' && (
        <div style={card}>
          <h2 style={sectionHeader}>Generate Comparison</h2>
          <p style={muted}>
            Pick an internal wager and an optional Kalshi snapshot. Latest snapshot is used when no snapshot is specified.
            The generated comparison is stored advisory-only and never mutates wagers or pricing.
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
              <span style={label}>Kalshi snapshot</span>
              <select
                style={{ ...input, width: '100%' }}
                value={selectedSnapshotId}
                onChange={(e) => setSelectedSnapshotId(e.target.value)}
              >
                <option value="">latest</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.createdAt).toLocaleString()} · {s.kalshiEnv} · {s.marketCount} markets
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              style={{ ...btn('#3b82f6'), opacity: !selectedWagerId || busy ? 0.6 : 1 }}
              disabled={!selectedWagerId || !!busy}
              onClick={onGenerate}
            >
              {busy === 'generate' ? 'Generating…' : 'Generate comparison'}
            </button>
          </div>
        </div>
      )}

      {tab === 'detail' && (
        <div style={card}>
          <h2 style={sectionHeader}>Comparison Detail</h2>
          {!active ? (
            <div style={muted}>Pick a comparison from Overview, or generate a new one.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div style={tile}>
                  <div style={muted}>Wager</div>
                  <div style={{ fontWeight: 700 }}>{active.wagerTitle}</div>
                  <div style={muted}>{active.wagerId}</div>
                </div>
                <div style={tile}>
                  <div style={muted}>Verdict</div>
                  <div style={{ fontWeight: 700, color: VERDICT_COLOR[active.verdict] }}>
                    {active.verdict.replace(/_/g, ' ')}
                  </div>
                </div>
                <div style={tile}>
                  <div style={muted}>Snapshot</div>
                  <div style={{ fontWeight: 700 }}>{active.kalshiSnapshotId ?? '—'}</div>
                </div>
                <div style={tile}>
                  <div style={muted}>Matched markets</div>
                  <div style={{ fontWeight: 700 }}>{active.matchedKalshiMarkets.length}</div>
                </div>
              </div>

              <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 16 }}>Internal pricing</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Outcome</th>
                    <th style={th}>American odds</th>
                    <th style={th}>Implied probability</th>
                  </tr>
                </thead>
                <tbody>
                  {active.wagerPricingSummary.rows.map((r, i) => (
                    <tr key={i}>
                      <td style={td}>{r.label}</td>
                      <td style={td}>{r.americanOdds > 0 ? `+${r.americanOdds}` : r.americanOdds}</td>
                      <td style={td}>{formatPct(r.impliedProbability)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 16 }}>Matched external markets</h3>
              {active.matchedKalshiMarkets.length === 0 ? (
                <div style={muted}>No external markets matched.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>Ticker</th>
                        <th style={th}>Title</th>
                        <th style={th}>Status</th>
                        <th style={th}>Yes bid/ask</th>
                        <th style={th}>Last</th>
                        <th style={th}>Implied</th>
                        <th style={th}>Confidence</th>
                        <th style={th}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.matchedKalshiMarkets.map((m) => (
                        <tr key={m.ticker}>
                          <td style={td}><code style={{ fontSize: 11 }}>{m.ticker}</code></td>
                          <td style={td}>{m.title ?? '—'}</td>
                          <td style={td}>{m.status ?? '—'}</td>
                          <td style={td}>
                            {m.yesBid ?? '—'} / {m.yesAsk ?? '—'}
                          </td>
                          <td style={td}>{m.lastPrice ?? '—'}</td>
                          <td style={td}>{formatPct(m.externalImpliedProbability)}</td>
                          <td style={td}>
                            <span style={{ color: CONF_COLOR[m.confidence], fontWeight: 600 }}>{m.confidence}</span>
                          </td>
                          <td style={td}><span style={muted}>{m.matchReason}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 style={{ ...sectionHeader, fontSize: 14, marginTop: 16 }}>Possible pricing gaps</h3>
              {active.pricingGapNotes.length === 0 ? (
                <div style={muted}>No pricing gaps over threshold.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                  {active.pricingGapNotes.map((g, i) => (
                    <div key={i} style={tile}>
                      <div style={{ fontWeight: 700 }}>
                        {g.internalLabel} vs {g.ticker}
                      </div>
                      <div style={muted}>
                        Internal {(g.internalImplied * 100).toFixed(1)}% · external {(g.externalImplied * 100).toFixed(1)}% · {g.gapPp > 0 ? '+' : ''}{g.gapPp}pp
                      </div>
                      <div style={{ ...muted, marginTop: 6 }}>{g.note}</div>
                    </div>
                  ))}
                </div>
              )}

              {active.warnings.length > 0 && (
                <div style={{ ...tile, marginTop: 16, borderColor: '#854d0e', background: '#1f1500' }}>
                  <strong style={{ color: '#fbbf24' }}>Warnings</strong>
                  <ul style={{ marginTop: 8 }}>
                    {active.warnings.map((w, i) => (
                      <li key={i} style={muted}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {active.recommendations.length > 0 && (
                <div style={{ ...tile, marginTop: 12 }}>
                  <strong>Recommendations</strong>
                  <ul style={{ marginTop: 8 }}>
                    {active.recommendations.map((r, i) => (
                      <li key={i} style={muted}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'hedge' && (
        <div style={card}>
          <h2 style={sectionHeader}>Hedge Review</h2>
          <p style={muted}>
            Hedge review notes are advisory. They highlight cases where a WagerOnWeather market has high projected
            worst-case loss and at least one plausible external Kalshi match. The operator decides whether to act
            externally — this tool does not place or stage hedges.
          </p>
          {!active ? (
            <div style={{ ...muted, marginTop: 12 }}>Open a comparison to view its hedge-review notes.</div>
          ) : active.hedgeReviewNotes.length === 0 ? (
            <div style={{ ...muted, marginTop: 12 }}>No hedge-review notes for this comparison.</div>
          ) : (
            <ul style={{ marginTop: 12 }}>
              {active.hedgeReviewNotes.map((n, i) => (
                <li key={i} style={{ marginBottom: 8 }}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h2 style={sectionHeader}>Methodology</h2>
          <ul style={{ marginTop: 8, lineHeight: 1.7 }}>
            <li>Reads the WagerOnWeather wager and the latest (or chosen) Kalshi snapshot. Both reads are read-only.</li>
            <li>Tokenizes wager fields (title, location, metric, target date) and scores each Kalshi market by keyword/location/date overlap.</li>
            <li>Confidence: high (score ≥ 5), medium (3–4), low (1–2). Markets scoring 0 are not included.</li>
            <li>Internal implied probability: American odds → standard formula. External implied probability: Kalshi mid (yesBid/yesAsk avg or lastPrice) divided by 100.</li>
            <li>Possible pricing gap is flagged only on high-confidence matches with concrete external pricing and an absolute gap ≥ 5pp.</li>
            <li>Hedge review fires only when the latest house-exposure snapshot shows projected worst-case loss for the wager ≥ $1,000 and at least one match is medium- or high-confidence.</li>
            <li>Verdict precedence: hedge_review_recommended &gt; possible_pricing_gap &gt; manual_review_required &gt; watch &gt; no_match.</li>
            <li>Audit event: <code>kalshi_market_comparison_generated</code>. Storage: <code>kalshi-comparison:&lt;id&gt;</code>, <code>kalshi-comparisons:all</code>, <code>kalshi-comparison:wager:&lt;wagerId&gt;</code>.</li>
            <li>No order, position, or balance endpoints are touched. No wager or pricing mutation. Advisory only.</li>
          </ul>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SystemNav activeHref="/admin/system/kalshi-market-comparison" />
      </div>
    </div>
  );
}
