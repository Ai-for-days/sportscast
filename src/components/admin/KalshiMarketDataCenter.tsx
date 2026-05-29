// ── Step 118: Kalshi Market Data Center (admin-only UI) ─────────────────────
//
// Read-only admin view of Kalshi market snapshots. No order placement.
// No automatic hedging. No automatic mirroring. Persistent banner at top
// states the safety posture explicitly.

import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';
import { formatCentsAsAmericanOdds } from '../../lib/odds';

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

type Tab = 'config' | 'fetch' | 'snapshots' | 'uses' | 'methodology';

interface ConfigStatus {
  apiKeyIdConfigured: boolean;
  privateKeyPresent: boolean;
  env: 'demo' | 'live';
  readOnly: boolean;
}

interface ConnectivityResult {
  code: string;
  ok: boolean;
  httpStatus: number;
  env: 'demo' | 'live';
  marketsReturned: number;
  message: string;
}

interface MarketSummary {
  ticker: string;
  title?: string;
  category?: string;
  status?: string;
  closeTime?: string;
  yesBid?: number;
  yesAsk?: number;
  noBid?: number;
  noAsk?: number;
  lastPrice?: number;
  volume?: number;
  openInterest?: number;
}

interface Snapshot {
  id: string;
  createdAt: string;
  createdBy: string;
  kalshiEnv: 'demo' | 'live';
  query: { q?: string; event_ticker?: string; status?: string; limit?: number };
  markets: MarketSummary[];
  warnings: string[];
  status: 'read_only_snapshot';
}

const API = '/api/admin/system/kalshi-market-data';

export default function KalshiMarketDataCenter() {
  const [tab, setTab] = useState<Tab>('config');
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [connectivity, setConnectivity] = useState<ConnectivityResult | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeSnapshot, setActiveSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch form
  const [q, setQ] = useState('');
  const [eventTicker, setEventTicker] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [limit, setLimit] = useState<number>(100);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [cfgRes, snapsRes] = await Promise.all([
          fetch(`${API}?action=config-status`),
          fetch(`${API}?action=list-snapshots&limit=50`),
        ]);
        const cfgJson = await cfgRes.json();
        const snapsJson = await snapsRes.json();
        if (cancelled) return;
        if (!cfgRes.ok) throw new Error(cfgJson.message ?? 'config-status failed');
        if (!snapsRes.ok) throw new Error(snapsJson.message ?? 'list-snapshots failed');
        setConfig(cfgJson.config ?? null);
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

  async function onFetchMarkets() {
    setBusy('fetch');
    setError(null);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fetch-markets',
          q: q || undefined,
          event_ticker: eventTicker || undefined,
          status: statusFilter || undefined,
          limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'fetch-markets failed');
      setActiveSnapshot(json.snapshot ?? null);
      await refreshSnapshots();
      setTab('snapshots');
    } catch (e: any) {
      setError(e?.message ?? 'Fetch failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onFetchClimateMarkets() {
    setBusy('fetch-climate');
    setError(null);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fetch-climate-markets' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'fetch-climate-markets failed');
      setActiveSnapshot(json.snapshot ?? null);
      await refreshSnapshots();
      setTab('snapshots');
    } catch (e: any) {
      setError(e?.message ?? 'Fetch failed.');
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

  const credsReady = !!(config?.apiKeyIdConfigured && config?.privateKeyPresent);

  return (
    <div style={{ background: '#0f172a', minHeight: '100vh', padding: 16, color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Kalshi Market Data Center</h1>

      <div style={BANNER}>
        <span>
          Kalshi Market Data is admin-only and read-only. It does not place trades, hedge automatically, or create WagerOnWeather markets.
        </span>
        {config && (
          <span style={{ fontSize: 11, fontWeight: 500 }}>
            {config.env.toUpperCase()} · READ_ONLY={String(config.readOnly)}
          </span>
        )}
      </div>

      <div style={{ ...muted, marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        See also:
        <a href="/admin/system/kalshi-integration" style={{ color: '#60a5fa' }}>
          Kalshi Integration
        </a>
        <a href="/admin/system/kalshi-market-comparison" style={{ color: '#60a5fa' }}>
          Kalshi Comparison
        </a>
        <a href="/admin/system/weather-market-daily-brief" style={{ color: '#60a5fa' }}>
          Daily Market Brief →
        </a>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(
          [
            ['config', 'Config Status'],
            ['fetch', 'Fetch Markets'],
            ['snapshots', 'Market Snapshots'],
            ['uses', 'Bookmaking Uses'],
            ['methodology', 'Methodology'],
          ] as [Tab, string][]
        ).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              ...btn(tab === k ? '#3b82f6' : '#334155'),
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

      {tab === 'config' && (
        <div style={card}>
          <h2 style={sectionHeader}>Config Status</h2>
          {loading ? (
            <div style={muted}>Loading config…</div>
          ) : config ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <div style={tile}>
                <div style={muted}>API Key ID configured</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {config.apiKeyIdConfigured ? 'Yes' : 'No'}
                </div>
              </div>
              <div style={tile}>
                <div style={muted}>Private key present</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {config.privateKeyPresent ? 'Yes' : 'No'}
                </div>
                <div style={{ ...muted, marginTop: 4 }}>
                  Value never returned to the client.
                </div>
              </div>
              <div style={tile}>
                <div style={muted}>Environment</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{config.env}</div>
              </div>
              <div style={tile}>
                <div style={muted}>Read-only guard</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: config.readOnly ? '#22c55e' : '#ef4444' }}>
                  {config.readOnly ? 'Enabled' : 'Disabled'}
                </div>
              </div>
            </div>
          ) : (
            <div style={muted}>No config data.</div>
          )}
          <p style={{ ...muted, marginTop: 12 }}>
            Set credentials via <code style={{ color: '#e2e8f0' }}>KALSHI_API_KEY_ID</code> and{' '}
            <code style={{ color: '#e2e8f0' }}>KALSHI_PRIVATE_KEY_BASE64</code> on the server. Defaults: env=demo,
            readOnly=true.
          </p>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
            <h3 style={{ ...sectionHeader, fontSize: 13 }}>Test connectivity</h3>
            <p style={muted}>
              Issues a single read-only <code>GET /markets?limit=1</code> against the configured environment and reports
              the result. Audit-logged. Does not place orders or persist a snapshot.
            </p>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                style={{ ...btn('#3b82f6'), opacity: !credsReady || busy ? 0.6 : 1 }}
                disabled={!credsReady || !!busy}
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

      {tab === 'fetch' && (
        <div style={card}>
          <h2 style={sectionHeader}>Fetch Markets</h2>
          <p style={muted}>
            Issues a read-only GET against Kalshi <code>/markets</code> in the configured environment, normalizes
            the response, and stores a snapshot. No order endpoints are called.
          </p>
          {!credsReady && (
            <div style={{ ...tile, borderColor: '#7f1d1d', background: '#450a0a', marginTop: 12 }}>
              Credentials are not configured. Fetch is disabled until <code>KALSHI_API_KEY_ID</code> and{' '}
              <code>KALSHI_PRIVATE_KEY_BASE64</code> are set on the server.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 12 }}>
            <div>
              <span style={label}>Search query (q)</span>
              <input style={{ ...input, width: '100%' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. high temperature" />
            </div>
            <div>
              <span style={label}>Event ticker</span>
              <input style={{ ...input, width: '100%' }} value={eventTicker} onChange={(e) => setEventTicker(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <span style={label}>Status filter</span>
              <input style={{ ...input, width: '100%' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} placeholder="open / closed / settled" />
            </div>
            <div>
              <span style={label}>Limit (max 1000)</span>
              <input
                style={{ ...input, width: '100%' }}
                type="number"
                min={1}
                max={1000}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              style={{ ...btn('#10b981'), opacity: !credsReady || busy ? 0.6 : 1 }}
              disabled={!credsReady || !!busy}
              onClick={onFetchClimateMarkets}
              title="One-click fetch scoped to climate markets only (q=temperature, then filtered to KXHIGH/KXLOW ticker prefixes)."
            >
              {busy === 'fetch-climate' ? 'Fetching climate…' : 'Fetch climate markets'}
            </button>
            <button
              style={{ ...btn('#3b82f6'), opacity: !credsReady || busy ? 0.6 : 1 }}
              disabled={!credsReady || !!busy}
              onClick={onFetchMarkets}
              title="Free-form fetch using whatever filters you put in the form fields above."
            >
              {busy === 'fetch' ? 'Fetching…' : 'Fetch with form filters'}
            </button>
          </div>
          <p style={{ ...muted, marginTop: 8 }}>
            <strong>Fetch climate markets</strong> ignores the form fields and pulls Kalshi's KXHIGH/KXLOW
            (highest/lowest temperature) series. Use the second button to send custom filters.
          </p>
        </div>
      )}

      {tab === 'snapshots' && (
        <div style={card}>
          <h2 style={sectionHeader}>Market Snapshots</h2>
          <p style={muted}>
            Each snapshot is the output of one read-only fetch. Rows here come straight from Redis, not from a fresh
            Kalshi call.
          </p>
          {snapshots.length === 0 ? (
            <div style={{ ...muted, marginTop: 12 }}>No snapshots yet.</div>
          ) : (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Env</th>
                    <th style={th}>Markets</th>
                    <th style={th}>Query</th>
                    <th style={th}>By</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.id}>
                      <td style={td}>{new Date(s.createdAt).toLocaleString()}</td>
                      <td style={td}>{s.kalshiEnv}</td>
                      <td style={td}>{s.markets.length}</td>
                      <td style={td}>
                        <code style={{ fontSize: 11 }}>
                          {[s.query?.q, s.query?.event_ticker, s.query?.status]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </code>
                      </td>
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
                {new Date(activeSnapshot.createdAt).toLocaleString()} · {activeSnapshot.kalshiEnv} · {activeSnapshot.markets.length} markets · by {activeSnapshot.createdBy}
              </div>
              {activeSnapshot.warnings.length > 0 && (
                <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 12 }}>
                  {activeSnapshot.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              <p style={{ ...muted, marginTop: 8, marginBottom: 4 }}>
                <strong style={{ color: '#22c55e' }}>Yes</strong> /
                <strong style={{ color: '#ef4444' }}> No</strong> columns show <strong>American odds</strong>
                (sportsbook style — negative = favorite, positive = underdog). The four cent-price columns
                preserve Kalshi's raw quote for reference. American odds are derived from the matching
                "ask" cent price: <code>cents=65 → -186</code>, <code>cents=35 → +186</code>.
              </p>
              <div style={{ marginTop: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Ticker</th>
                      <th style={th}>Title</th>
                      <th style={th}>Status</th>
                      <th style={{ ...th, color: '#22c55e' }}>Yes</th>
                      <th style={{ ...th, color: '#ef4444' }}>No</th>
                      <th style={th}>Yes ¢ (bid/ask)</th>
                      <th style={th}>No ¢ (bid/ask)</th>
                      <th style={th}>Last ¢</th>
                      <th style={th}>Vol</th>
                      <th style={th}>OI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSnapshot.markets.map((m) => (
                      <tr key={m.ticker}>
                        <td style={td}><code style={{ fontSize: 11 }}>{m.ticker}</code></td>
                        <td style={td}>{m.title ?? '—'}</td>
                        <td style={td}>{m.status ?? '—'}</td>
                        <td style={{ ...td, color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>
                          {formatCentsAsAmericanOdds(m.yesAsk)}
                        </td>
                        <td style={{ ...td, color: '#ef4444', fontWeight: 700, fontFamily: 'monospace' }}>
                          {formatCentsAsAmericanOdds(m.noAsk)}
                        </td>
                        <td style={{ ...td, fontFamily: 'monospace', color: '#94a3b8' }}>
                          {m.yesBid ?? '—'} / {m.yesAsk ?? '—'}
                        </td>
                        <td style={{ ...td, fontFamily: 'monospace', color: '#94a3b8' }}>
                          {m.noBid ?? '—'} / {m.noAsk ?? '—'}
                        </td>
                        <td style={td}>{m.lastPrice ?? '—'}</td>
                        <td style={td}>{m.volume ?? '—'}</td>
                        <td style={td}>{m.openInterest ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'uses' && (
        <div style={card}>
          <h2 style={sectionHeader}>Bookmaking Uses</h2>
          <p style={muted}>
            Kalshi is treated as an external market / competitor venue. This tool surfaces its public read-only data so
            the operator can use it for bookmaking intelligence, price comparison, hedging decision support, sentiment
            monitoring, and manual review. None of these uses execute trades.
          </p>
          <ul style={{ marginTop: 12, lineHeight: 1.7 }}>
            <li>Compare Kalshi prices with WagerOnWeather pricing on overlapping weather questions.</li>
            <li>Spot possible hedging opportunities when in-house exposure builds up against an outcome.</li>
            <li>Monitor external market sentiment around weather events that could move our liabilities.</li>
            <li>Identify candidate Kalshi markets that could inspire WagerOnWeather markets — the operator decides whether to create one manually.</li>
            <li>Support bookmaking decisions (odds, lines, voiding) with an external pricing reference.</li>
          </ul>
          <div style={{ ...tile, marginTop: 12 }}>
            <strong style={{ color: '#fbbf24' }}>Hedging note.</strong>{' '}
            <span style={muted}>
              If a customer is wagering heavily against the house on a weather outcome, this tool may help the operator decide
              whether to manually hedge externally. It does not place hedges. Any external trade is initiated and confirmed by
              the operator outside this system.
            </span>
          </div>
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h2 style={sectionHeader}>Methodology</h2>
          <ul style={{ marginTop: 8, lineHeight: 1.7 }}>
            <li>Authentication: RSA-PSS-SHA256 over <code>timestamp + method + fullPath</code>, signature in <code>KALSHI-ACCESS-SIGNATURE</code>.</li>
            <li>Endpoints used: <code>GET /markets</code> (list, with optional q / event_ticker / status filters).</li>
            <li>Snapshot storage: <code>kalshi-market-snapshot:&lt;id&gt;</code> + sorted set <code>kalshi-market-snapshots:all</code>.</li>
            <li>Audit event: <code>kalshi_market_snapshot_fetched</code> (uses platform-wide <code>audit-log.ts</code>).</li>
            <li>Read-only: no order, position, or balance endpoints are exposed.</li>
            <li>Secrets: private key is read server-side only; never logged, never returned.</li>
          </ul>
          <div style={{ ...tile, marginTop: 12 }}>
            <strong>Out of scope (Phase A):</strong>{' '}
            <span style={muted}>
              orderbooks per market, depth charts, historical bar/tick storage, Kalshi event listings, mirroring, hedging
              execution, automatic alerts. These belong to later phases per <code>docs/kalshi-integration-plan.md</code>.
            </span>
          </div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SystemNav activeHref="/admin/system/kalshi-market-data" />
      </div>
    </div>
  );
}
