import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface PerfSample {
  id: string; route: string; category: string; durationMs: number;
  success: boolean; rowCount?: number; createdAt: string;
}
interface RouteStats {
  route: string; category: string; totalHits: number; failures: number;
  avgDurationMs: number; maxDurationMs: number; lastSeen: string;
}
interface CacheEntry {
  key: string; ttlRemaining: number; expiresAt: string; createdAt: string;
  hits: number; misses: number; expired: boolean;
}
interface CacheStats {
  totalKeys: number; activeKeys: number; expiredKeys: number;
  totalHits: number; totalMisses: number;
}
interface PerfSummary {
  totalRequests: number; avgDurationMs: number; slowEndpoints: number;
  recentFailures: number; trackedRoutes: number;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const TABS = ['overview', 'routes', 'cache', 'samples'] as const;
type Tab = typeof TABS[number];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function Performance() {
  const [perfSummary, setPerfSummary] = useState<PerfSummary | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [topRoutes, setTopRoutes] = useState<RouteStats[]>([]);
  const [allRoutes, setAllRoutes] = useState<RouteStats[]>([]);
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [samples, setSamples] = useState<PerfSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  const fetchOverview = async () => {
    try {
      const r = await fetch('/api/admin/performance');
      const d = await r.json();
      setPerfSummary(d.performance);
      setCacheStats(d.cache);
      setTopRoutes(d.topRoutes || []);
      setSamples(d.recentSamples || []);
    } catch { /* ignore */ }
  };

  const fetchRoutes = async () => {
    try {
      const r = await fetch('/api/admin/performance?action=routes');
      const d = await r.json();
      setAllRoutes(d.routes || []);
    } catch { /* ignore */ }
  };

  const fetchCache = async () => {
    try {
      const r = await fetch('/api/admin/performance?action=cache');
      const d = await r.json();
      setCacheEntries(d.entries || []);
      setCacheStats(d.stats || null);
    } catch { /* ignore */ }
  };

  const fetchSamples = async () => {
    try {
      const r = await fetch('/api/admin/performance?action=metrics&limit=100');
      const d = await r.json();
      setSamples(d.samples || []);
      setAllRoutes(d.stats || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchOverview();
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (tab === 'routes') fetchRoutes();
    if (tab === 'cache') fetchCache();
    if (tab === 'samples') fetchSamples();
  }, [tab]);

  const invalidateCache = async (key?: string) => {
    const body: any = { action: 'invalidate-cache' };
    if (key) body.key = key;
    const r = await fetch('/api/admin/performance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    setMsg(d.ok ? `Cache invalidated${key ? `: ${key}` : ' (all)'}` : d.error);
    fetchCache();
  };

  const resetAllMetrics = async () => {
    const r = await fetch('/api/admin/performance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset-metrics' }) });
    const d = await r.json();
    setMsg(d.ok ? `Metrics reset (${d.cleared} entries)` : d.error);
    fetchOverview();
  };

  if (loading) return <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>Loading performance data…</div>;

  return (
    <div style={{ color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Performance &amp; Scalability</h1>
        <button style={btn('#334155')} onClick={() => { fetchOverview(); setMsg(''); }}>Refresh</button>
      </div>

      {msg && <div style={{ ...card, background: '#164e63', fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t} style={{ ...btn(tab === t ? '#3b82f6' : '#334155'), textTransform: 'capitalize' }} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* ---- Overview ---- */}
      {tab === 'overview' && (
        <>
          {/* Summary cards */}
          <div style={grid4}>
            {perfSummary && <>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Total Requests</div><div style={{ fontSize: 22, fontWeight: 700 }}>{perfSummary.totalRequests}</div></div>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Avg Duration</div><div style={{ fontSize: 22, fontWeight: 700 }}>{perfSummary.avgDurationMs}ms</div></div>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Slow Endpoints</div><div style={{ fontSize: 22, fontWeight: 700, color: perfSummary.slowEndpoints > 0 ? '#f59e0b' : '#22c55e' }}>{perfSummary.slowEndpoints}</div></div>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Recent Failures</div><div style={{ fontSize: 22, fontWeight: 700, color: perfSummary.recentFailures > 0 ? '#ef4444' : '#22c55e' }}>{perfSummary.recentFailures}</div></div>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Tracked Routes</div><div style={{ fontSize: 22, fontWeight: 700 }}>{perfSummary.trackedRoutes}</div></div>
            </>}
            {cacheStats && <>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Cache Keys</div><div style={{ fontSize: 22, fontWeight: 700 }}>{cacheStats.activeKeys}</div></div>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Cache Hits</div><div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>{cacheStats.totalHits}</div></div>
              <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Cache Misses</div><div style={{ fontSize: 22, fontWeight: 700, color: '#f59e0b' }}>{cacheStats.totalMisses}</div></div>
            </>}
          </div>

          {/* Top routes by avg duration */}
          {topRoutes.length > 0 && (
            <div style={card}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Slowest Endpoints</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th}>Route</th><th style={th}>Avg</th><th style={th}>Max</th><th style={th}>Hits</th><th style={th}>Failures</th><th style={th}>Last</th>
                  </tr></thead>
                  <tbody>
                    {topRoutes.map(r => (
                      <tr key={r.route}>
                        <td style={td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.route}</span></td>
                        <td style={{ ...td, color: r.avgDurationMs > 500 ? '#f59e0b' : '#22c55e' }}>{r.avgDurationMs}ms</td>
                        <td style={td}>{r.maxDurationMs}ms</td>
                        <td style={td}>{r.totalHits}</td>
                        <td style={{ ...td, color: r.failures > 0 ? '#ef4444' : '#94a3b8' }}>{r.failures}</td>
                        <td style={{ ...td, fontSize: 11, color: '#94a3b8' }}>{new Date(r.lastSeen).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent samples */}
          {samples.length > 0 && (
            <div style={card}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Recent Samples</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th}>Time</th><th style={th}>Route</th><th style={th}>Duration</th><th style={th}>Status</th><th style={th}>Rows</th>
                  </tr></thead>
                  <tbody>
                    {samples.slice(0, 20).map(s => (
                      <tr key={s.id}>
                        <td style={{ ...td, fontSize: 11, color: '#94a3b8' }}>{new Date(s.createdAt).toLocaleString()}</td>
                        <td style={td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.route}</span></td>
                        <td style={{ ...td, color: s.durationMs > 500 ? '#f59e0b' : '#22c55e' }}>{s.durationMs}ms</td>
                        <td style={td}>{s.success ? <span style={badge('#22c55e')}>OK</span> : <span style={badge('#ef4444')}>FAIL</span>}</td>
                        <td style={{ ...td, color: '#94a3b8' }}>{s.rowCount ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ---- Routes ---- */}
      {tab === 'routes' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>All Tracked Routes</h3>
            <button style={btn('#ef4444')} onClick={resetAllMetrics}>Reset All Metrics</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Route</th><th style={th}>Category</th><th style={th}>Avg</th><th style={th}>Max</th><th style={th}>Hits</th><th style={th}>Failures</th><th style={th}>Last</th>
              </tr></thead>
              <tbody>
                {allRoutes.sort((a, b) => b.avgDurationMs - a.avgDurationMs).map(r => (
                  <tr key={r.route}>
                    <td style={td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.route}</span></td>
                    <td style={td}><span style={badge('#334155')}>{r.category}</span></td>
                    <td style={{ ...td, color: r.avgDurationMs > 500 ? '#f59e0b' : '#22c55e' }}>{r.avgDurationMs}ms</td>
                    <td style={td}>{r.maxDurationMs}ms</td>
                    <td style={td}>{r.totalHits}</td>
                    <td style={{ ...td, color: r.failures > 0 ? '#ef4444' : '#94a3b8' }}>{r.failures}</td>
                    <td style={{ ...td, fontSize: 11, color: '#94a3b8' }}>{new Date(r.lastSeen).toLocaleString()}</td>
                  </tr>
                ))}
                {allRoutes.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#64748b' }}>No route data yet. Endpoints will appear here after they are called.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Cache ---- */}
      {tab === 'cache' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>Cache Entries</h3>
            <button style={btn('#ef4444')} onClick={() => invalidateCache()}>Invalidate All</button>
          </div>
          {cacheStats && (
            <div style={{ ...grid4, marginBottom: 16 }}>
              <div style={{ ...card, padding: 10 }}><div style={{ fontSize: 11, color: '#94a3b8' }}>Active</div><div style={{ fontSize: 18, fontWeight: 700 }}>{cacheStats.activeKeys}</div></div>
              <div style={{ ...card, padding: 10 }}><div style={{ fontSize: 11, color: '#94a3b8' }}>Expired</div><div style={{ fontSize: 18, fontWeight: 700 }}>{cacheStats.expiredKeys}</div></div>
              <div style={{ ...card, padding: 10 }}><div style={{ fontSize: 11, color: '#94a3b8' }}>Hits</div><div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{cacheStats.totalHits}</div></div>
              <div style={{ ...card, padding: 10 }}><div style={{ fontSize: 11, color: '#94a3b8' }}>Misses</div><div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b' }}>{cacheStats.totalMisses}</div></div>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Key</th><th style={th}>TTL Remaining</th><th style={th}>Hits</th><th style={th}>Misses</th><th style={th}>Status</th><th style={th}>Actions</th>
              </tr></thead>
              <tbody>
                {cacheEntries.map(e => (
                  <tr key={e.key}>
                    <td style={td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.key}</span></td>
                    <td style={td}>{e.expired ? '—' : `${Math.round(e.ttlRemaining / 1000)}s`}</td>
                    <td style={{ ...td, color: '#22c55e' }}>{e.hits}</td>
                    <td style={{ ...td, color: '#f59e0b' }}>{e.misses}</td>
                    <td style={td}>{e.expired ? <span style={badge('#64748b')}>expired</span> : <span style={badge('#22c55e')}>active</span>}</td>
                    <td style={td}><button style={btn('#ef4444')} onClick={() => invalidateCache(e.key)}>Invalidate</button></td>
                  </tr>
                ))}
                {cacheEntries.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#64748b' }}>No cache entries. Cached summaries will appear here when endpoints are called.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Samples ---- */}
      {tab === 'samples' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Performance Samples (last 100)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Time</th><th style={th}>Route</th><th style={th}>Category</th><th style={th}>Duration</th><th style={th}>Status</th><th style={th}>Rows</th>
              </tr></thead>
              <tbody>
                {samples.map(s => (
                  <tr key={s.id}>
                    <td style={{ ...td, fontSize: 11, color: '#94a3b8' }}>{new Date(s.createdAt).toLocaleString()}</td>
                    <td style={td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.route}</span></td>
                    <td style={td}><span style={badge('#334155')}>{s.category}</span></td>
                    <td style={{ ...td, color: s.durationMs > 500 ? '#f59e0b' : '#22c55e' }}>{s.durationMs}ms</td>
                    <td style={td}>{s.success ? <span style={badge('#22c55e')}>OK</span> : <span style={badge('#ef4444')}>FAIL</span>}</td>
                    <td style={{ ...td, color: '#94a3b8' }}>{s.rowCount ?? '—'}</td>
                  </tr>
                ))}
                {samples.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#64748b' }}>No samples yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Notes */}
      <div style={{ ...card, background: '#0f172a', border: '1px solid #334155', marginTop: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Performance Notes</h3>
        <ul style={{ fontSize: 13, color: '#94a3b8', margin: 0, paddingLeft: 20 }}>
          <li>Performance metrics are collected in-memory and reset on server restart.</li>
          <li>Summary caching uses short TTL (30s default) — stale-but-acceptable for overview cards.</li>
          <li>Cache never bypasses authentication or authorization checks.</li>
          <li>Endpoints with &gt;500ms average duration are flagged as "slow".</li>
          <li>Pagination is available on heavy list endpoints via <code>page</code> and <code>limit</code> query params.</li>
        </ul>
      </div>
    </div>
  );
}
