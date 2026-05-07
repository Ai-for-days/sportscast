// ── Step 126: Polymarket Market Data Center (admin-only UI) ─────────────────
//
// Read-only admin view of Polymarket weather market discovery snapshots.
// No order placement. No wallet connection. No signing. No automatic
// hedging or mirroring. The persistent banner at the top states the
// safety posture explicitly.
//
// Mirrors the structure of KalshiMarketDataCenter for consistent operator
// muscle memory.

import React, { useEffect, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'block' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13, color: '#e2e8f0' };
const sectionHeader: React.CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' };
const muted: React.CSSProperties = { fontSize: 12, color: '#94a3b8' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #5b21b6, #7c3aed)',
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

type Tab = 'status' | 'discover' | 'snapshots' | 'uses' | 'methodology';

interface ConnectivityResult {
  code: string;
  ok: boolean;
  httpStatus: number;
  marketsReturned: number;
  message: string;
}

interface MarketSummary {
  id: string;
  question: string;
  slug?: string;
  url?: string;
  category?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  endDate?: string;
  startDate?: string;
  outcomes: string[];
  outcomePrices: number[];
  volumeUsd?: number;
  liquidityUsd?: number;
  tags: string[];
  rawSource: 'polymarket';
}

interface Snapshot {
  id: string;
  createdAt: string;
  createdBy: string;
  source: 'polymarket';
  strategy: 'tag' | 'keyword' | 'mixed';
  note: string;
  query: { limit: number };
  markets: MarketSummary[];
  warnings: string[];
  status: 'read_only_snapshot';
}

const API = '/api/admin/system/polymarket-market-data';

function fmtPct(p: number | undefined): string {
  if (p === undefined || !Number.isFinite(p)) return '—';
  return `${(p * 100).toFixed(1)}%`;
}

function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export default function PolymarketMarketDataCenter() {
  const [tab, setTab] = useState<Tab>('status');
  const [connectivity, setConnectivity] = useState<ConnectivityResult | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeSnapshot, setActiveSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [limit, setLimit] = useState<number>(100);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const snapsRes = await fetch(`${API}?action=list-snapshots&limit=50`);
        const snapsJson = await snapsRes.json();
        if (cancelled) return;
        if (!snapsRes.ok) throw new Error(snapsJson.message ?? 'list-snapshots failed');
        setSnapshots(snapsJson.snapshots ?? []);
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

  async function refreshSnapshots() {
    const r = await fetch(`${API}?action=list-snapshots&limit=50`);
    const j = await r.json();
    if (r.ok) setSnapshots(j.snapshots ?? []);
  }

  async function onDiscover() {
    setBusy('discover');
    setError(null);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'discover-weather-markets',
          limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'discover failed');
      setActiveSnapshot(json.snapshot ?? null);
      await refreshSnapshots();
      setTab('snapshots');
    } catch (e: any) {
      setError(e?.message ?? 'Discovery failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onTestConnectivity() {
    setBusy('test');
    setError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test-connectivity' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'test-connectivity failed');
      setConnectivity(j.result ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Connectivity test failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onOpenSnapshot(id: string) {
    setBusy('open');
    setError(null);
    try {
      const r = await fetch(`${API}?action=get-snapshot&id=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'get-snapshot failed');
      setActiveSnapshot(j.snapshot ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Open failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ background: '#0f172a', minHeight: '100vh', padding: 16, color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Polymarket Market Data Center</h1>

      <div style={BANNER}>
        <span>
          Polymarket Market Data is admin-only and read-only. No wallet, no signing, no orders, no auto-hedging, no auto-mirroring.
        </span>
        <span style={{ fontSize: 11, fontWeight: 500 }}>READ_ONLY · NO_WALLET</span>
      </div>

      <div style={{ ...muted, marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        See also:
        <a href="/admin/system/kalshi-market-data" style={{ color: '#a78bfa' }}>
          Kalshi Market Data
        </a>
        <a href="/admin/system/kalshi-market-comparison" style={{ color: '#a78bfa' }}>
          Kalshi Comparison
        </a>
        <a href="https://polymarket.com/weather" target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>
          polymarket.com/weather ↗
        </a>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(
          [
            ['status', 'Status'],
            ['discover', 'Discover Weather Markets'],
            ['snapshots', 'Snapshots'],
            ['uses', 'Bookmaking Uses'],
            ['methodology', 'Methodology'],
          ] as [Tab, string][]
        ).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              ...btn(tab === k ? '#7c3aed' : '#334155'),
              opacity: tab === k ? 1 : 0.85,
            }}
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

      {tab === 'status' && (
        <div style={card}>
          <h2 style={sectionHeader}>Status</h2>
          <p style={muted}>
            Polymarket's public Gamma API (<code>https://gamma-api.polymarket.com</code>) is read-only and does not require authentication. There is no API key, no wallet, no signing material associated with this integration.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 12 }}>
            <div style={tile}>
              <div style={muted}>Source</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Polymarket Gamma API</div>
            </div>
            <div style={tile}>
              <div style={muted}>Auth</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>None — public read-only</div>
            </div>
            <div style={tile}>
              <div style={muted}>Wallet / signing</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#22c55e' }}>Not implemented</div>
              <div style={{ ...muted, marginTop: 4 }}>By design — see methodology.</div>
            </div>
            <div style={tile}>
              <div style={muted}>Snapshot retention</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Latest 200</div>
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
            <h3 style={{ ...sectionHeader, fontSize: 13 }}>Test connectivity</h3>
            <p style={muted}>
              Issues a single read-only <code>GET /markets?limit=1</code> against the Gamma API and reports the result. Audit-logged. Does not place orders or persist a snapshot.
            </p>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                style={{ ...btn('#7c3aed'), opacity: busy ? 0.6 : 1 }}
                disabled={!!busy}
                onClick={onTestConnectivity}
              >
                {busy === 'test' ? 'Testing…' : 'Run test'}
              </button>
              {connectivity && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: connectivity.ok ? '#22c55e' : '#ef4444',
                  }}
                >
                  {connectivity.message}
                  {connectivity.ok ? ` (markets=${connectivity.marketsReturned})` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'discover' && (
        <div style={card}>
          <h2 style={sectionHeader}>Discover Weather Markets</h2>
          <p style={muted}>
            Issues a read-only GET against the Gamma API to find Polymarket markets tagged or matching weather keywords (<code>weather, temperature, rain, snow, hurricane, storm, climate, forecast, tornado, wind, heatwave, flood</code>). Normalizes results and stores a snapshot. No order endpoints are called. No wallet is connected.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 12, maxWidth: 480 }}>
            <div>
              <span style={labelStyle}>Limit (max 500)</span>
              <input
                style={{ ...input, width: '100%' }}
                type="number"
                min={1}
                max={500}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button
              style={{ ...btn('#7c3aed'), opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={onDiscover}
            >
              {busy === 'discover' ? 'Discovering…' : 'Discover & save snapshot'}
            </button>
          </div>
        </div>
      )}

      {tab === 'snapshots' && (
        <div style={card}>
          <h2 style={sectionHeader}>Snapshots</h2>
          <p style={muted}>
            Each snapshot is the output of one read-only discovery run. Rows here come from Redis, not from a fresh Polymarket call.
          </p>
          {loading ? (
            <div style={{ ...muted, marginTop: 12 }}>Loading…</div>
          ) : snapshots.length === 0 ? (
            <div style={{ ...muted, marginTop: 12 }}>No snapshots yet.</div>
          ) : (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Strategy</th>
                    <th style={th}>Markets</th>
                    <th style={th}>By</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.id}>
                      <td style={td}>{new Date(s.createdAt).toLocaleString()}</td>
                      <td style={td}>{s.strategy}</td>
                      <td style={td}>{s.markets.length}</td>
                      <td style={td}>{s.createdBy}</td>
                      <td style={td}>
                        <button style={btn('#475569')} onClick={() => onOpenSnapshot(s.id)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeSnapshot && (
            <div style={{ ...card, marginTop: 16, background: '#0f172a', border: '1px solid #1e293b' }}>
              <h3 style={{ ...sectionHeader, fontSize: 14 }}>
                Snapshot {activeSnapshot.id}
              </h3>
              <div style={muted}>
                {new Date(activeSnapshot.createdAt).toLocaleString()} · strategy={activeSnapshot.strategy} · {activeSnapshot.markets.length} markets · by {activeSnapshot.createdBy}
              </div>
              <div style={{ ...muted, marginTop: 6, fontStyle: 'italic' }}>{activeSnapshot.note}</div>
              {activeSnapshot.warnings.length > 0 && (
                <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 12 }}>
                  {activeSnapshot.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              {activeSnapshot.markets.length === 0 ? (
                <div style={{ ...muted, marginTop: 12 }}>No markets matched.</div>
              ) : (
                <div style={{ marginTop: 12, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>Question</th>
                        <th style={th}>Outcomes (price)</th>
                        <th style={th}>Volume</th>
                        <th style={th}>Liquidity</th>
                        <th style={th}>End</th>
                        <th style={th}>Status</th>
                        <th style={th}>Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSnapshot.markets.map((m) => (
                        <tr key={m.id}>
                          <td style={td}>{m.question}</td>
                          <td style={td}>
                            {m.outcomes.length === 0
                              ? '—'
                              : m.outcomes.map((o, i) => (
                                  <div key={i}>
                                    <span>{o}</span>{' '}
                                    <span style={muted}>{fmtPct(m.outcomePrices[i])}</span>
                                  </div>
                                ))}
                          </td>
                          <td style={td}>{fmtUsd(m.volumeUsd)}</td>
                          <td style={td}>{fmtUsd(m.liquidityUsd)}</td>
                          <td style={td}>{m.endDate ? new Date(m.endDate).toLocaleDateString() : '—'}</td>
                          <td style={td}>
                            {m.closed ? 'closed' : m.archived ? 'archived' : m.active ? 'active' : '—'}
                          </td>
                          <td style={td}>
                            {m.url ? (
                              <a href={m.url} target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>
                                Open ↗
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'uses' && (
        <div style={card}>
          <h2 style={sectionHeader}>Bookmaking Uses</h2>
          <p style={muted}>
            Polymarket is treated as an external prediction-market intelligence source alongside Kalshi. This tool surfaces its public read-only data so the operator can use it for bookmaking intelligence, price comparison, sentiment monitoring, and manual review. None of these uses execute trades.
          </p>
          <ul style={{ marginTop: 12, lineHeight: 1.7 }}>
            <li>Compare Polymarket implied probabilities with WagerOnWeather pricing on overlapping weather questions.</li>
            <li>Spot stale or mispriced weather markets across two independent external venues.</li>
            <li>Monitor external sentiment around weather events that could move our liabilities.</li>
            <li>Identify candidate markets that could inspire WagerOnWeather markets — the operator decides whether to create one manually.</li>
            <li>Feed a future three-way comparison: WagerOnWeather internal fair price vs. Kalshi vs. Polymarket.</li>
          </ul>
          <div style={{ ...tile, marginTop: 12 }}>
            <strong style={{ color: '#fbbf24' }}>Hedging note.</strong>{' '}
            <span style={muted}>
              This tool does not place hedges or any other orders. Any external trade is initiated and confirmed by the operator outside this system. No wallet, no signer, and no key custody exist anywhere in the codebase.
            </span>
          </div>
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h2 style={sectionHeader}>Methodology</h2>
          <ul style={{ marginTop: 8, lineHeight: 1.7 }}>
            <li>Source: <code>{`{POLYMARKET_GAMMA_API_BASE}/markets`}</code> (public, unauthenticated).</li>
            <li>Discovery: tag filter <code>tag_slug=weather</code> first; falls back to active-market keyword scan.</li>
            <li>Snapshot storage: <code>polymarket-market-snapshot:&lt;id&gt;</code> + sorted set <code>polymarket-market-snapshots:all</code>, retention 200.</li>
            <li>Audit events: <code>polymarket_market_snapshot_fetched</code>, <code>polymarket_connectivity_test</code> (uses platform-wide <code>audit-log.ts</code>).</li>
            <li>Read-only: no order, position, wallet, or signing endpoints exist in this client.</li>
            <li>No credentials: there are no Polymarket API keys, no wallet keys, no signing material in this codebase.</li>
            <li>No public/customer exposure: Polymarket data is admin-only and is never embedded in any anonymous or <code>requireUser</code>-gated route.</li>
          </ul>
          <div style={{ ...tile, marginTop: 12 }}>
            <strong>Out of scope (Phase 2):</strong>{' '}
            <span style={muted}>
              orderbook depth, historical bar/tick storage, three-way comparison UI, manual hedge linkage, automatic alerts. These belong to later phases per <code>docs/polymarket-integration-plan.md</code>.
            </span>
          </div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SystemNav activeHref="/admin/system/polymarket-market-data" />
      </div>
    </div>
  );
}
