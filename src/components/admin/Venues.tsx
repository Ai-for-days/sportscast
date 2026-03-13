import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface VenueMeta {
  name: string; displayName: string; description: string; status: string;
  capabilities: Record<string, boolean>;
  supportedModes: string[];
  marketCategories: string[];
}

interface VenueHealth {
  venue: string; status: string; message: string; checkedAt: string; details?: any;
}

interface VenueMarket {
  venue: string; marketId: string; ticker: string; title: string;
  category?: string; metric?: string; locationName?: string; targetDate?: string;
  threshold?: number; yesPrice?: number; noPrice?: number;
  bestBid?: number; bestAsk?: number; volume?: number; openInterest?: number;
  closeTime?: string; mapped?: boolean;
}

interface VenueOrder {
  venue: string; venueOrderId?: string; clientOrderId: string; ticker: string;
  title?: string; side: string; action: string; price: number; quantity: number;
  status: string; mode: string; createdAt: string; updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const STATUS_COLORS: Record<string, string> = { healthy: '#22c55e', degraded: '#f59e0b', down: '#ef4444', unknown: '#64748b', active: '#22c55e', stub: '#3b82f6', disabled: '#64748b' };
const CAP_LABELS: [string, string][] = [
  ['marketFetch', 'Market Fetch'], ['orderSubmit', 'Order Submit'], ['orderCancel', 'Cancel'],
  ['orderRefresh', 'Refresh'], ['positions', 'Positions'], ['demoSupport', 'Demo'], ['liveSupport', 'Live'],
];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function Venues() {
  const [venues, setVenues] = useState<VenueMeta[]>([]);
  const [health, setHealth] = useState<VenueHealth[]>([]);
  const [markets, setMarkets] = useState<VenueMarket[]>([]);
  const [orders, setOrders] = useState<VenueOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'overview' | 'markets' | 'orders'>('overview');

  const fetchOverview = async () => {
    try {
      const res = await fetch('/api/admin/venues');
      if (res.ok) {
        const d = await res.json();
        setVenues(d.venues || []);
        setHealth(d.health || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const fetchMarkets = async () => {
    try {
      const res = await fetch('/api/admin/venues?action=markets&limit=30');
      if (res.ok) {
        const d = await res.json();
        setMarkets(d.markets || []);
      }
    } catch { /* ignore */ }
  };

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/admin/venues?action=orders&limit=30');
      if (res.ok) {
        const d = await res.json();
        setOrders(d.orders || []);
      }
    } catch { /* ignore */ }
  };

  const refreshHealth = async () => {
    setMsg('Checking health...');
    try {
      const res = await fetch('/api/admin/venues?action=health');
      if (res.ok) {
        const d = await res.json();
        setHealth(d.health || []);
        setMsg('Health check complete');
      }
    } catch { setMsg('Health check failed'); }
  };

  useEffect(() => { fetchOverview(); }, []);
  useEffect(() => { if (tab === 'markets') fetchMarkets(); }, [tab]);
  useEffect(() => { if (tab === 'orders') fetchOrders(); }, [tab]);

  const navLinks = [
    { href: '/admin/trading-desk', label: 'Trading Desk' },
    { href: '/admin/operator-dashboard', label: 'Operator' },
    { href: '/admin/reports', label: 'Reports' },
    { href: '/admin/model-attribution', label: 'Attribution' },
    { href: '/admin/venues', label: 'Venues', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading venues...</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Venue Management</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Multi-venue broker abstraction layer — adapters, health, and normalized data</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['overview', 'markets', 'orders'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize' }}>{t}</button>
        ))}
        <button onClick={refreshHealth} style={btn('#22c55e')}>Refresh Health</button>
      </div>

      {/* === OVERVIEW TAB === */}
      {tab === 'overview' && (
        <>
          {/* Venue cards */}
          <div style={grid3}>
            {venues.map(v => {
              const h = health.find(hh => hh.venue === v.name);
              return (
                <div key={v.name} style={{ ...card, borderLeft: `3px solid ${STATUS_COLORS[v.status] || '#64748b'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{v.displayName}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{v.description}</div>
                    </div>
                    <span style={badge(STATUS_COLORS[v.status] || '#64748b')}>{v.status}</span>
                  </div>
                  <div style={{ fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: '#94a3b8' }}>Modes:</span> {v.supportedModes.join(', ')}
                  </div>
                  <div style={{ fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: '#94a3b8' }}>Categories:</span> {v.marketCategories.join(', ')}
                  </div>
                  {h && (
                    <div style={{ fontSize: 12, marginTop: 8, padding: '6px 8px', borderRadius: 4, background: '#0f172a' }}>
                      <span style={badge(STATUS_COLORS[h.status] || '#64748b')}>{h.status}</span>
                      <span style={{ marginLeft: 8, color: '#94a3b8' }}>{h.message.slice(0, 80)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Health table */}
          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Venue Health</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Venue</th><th style={th}>Status</th><th style={th}>Message</th><th style={th}>Checked At</th></tr></thead>
                <tbody>
                  {health.map(h => (
                    <tr key={h.venue}>
                      <td style={td}>{h.venue}</td>
                      <td style={td}><span style={badge(STATUS_COLORS[h.status] || '#64748b')}>{h.status}</span></td>
                      <td style={{ ...td, maxWidth: 400, wordBreak: 'break-word' }}>{h.message}</td>
                      <td style={td}>{h.checkedAt?.slice(11, 19)}</td>
                    </tr>
                  ))}
                  {health.length === 0 && <tr><td colSpan={4} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No health data</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Capabilities matrix */}
          <div style={card}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Capabilities Matrix</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Venue</th>
                    {CAP_LABELS.map(([key, label]) => <th key={key} style={th}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {venues.map(v => (
                    <tr key={v.name}>
                      <td style={td}>{v.displayName}</td>
                      {CAP_LABELS.map(([key]) => (
                        <td key={key} style={td}>
                          {v.capabilities[key]
                            ? <span style={{ color: '#22c55e', fontWeight: 600 }}>✓</span>
                            : <span style={{ color: '#64748b' }}>—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* === MARKETS TAB === */}
      {tab === 'markets' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Normalized Markets ({markets.length})</h3>
          <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>Markets from all venues normalized into a single shape</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Venue</th><th style={th}>Ticker</th><th style={th}>Title</th>
                  <th style={th}>Location</th><th style={th}>Date</th><th style={th}>Threshold</th>
                  <th style={th}>Yes</th><th style={th}>No</th><th style={th}>Volume</th><th style={th}>Mapped</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m, i) => (
                  <tr key={i}>
                    <td style={td}><span style={badge(m.venue === 'kalshi' ? '#6366f1' : '#3b82f6')}>{m.venue}</span></td>
                    <td style={{ ...td, fontSize: 11, fontFamily: 'monospace' }}>{m.ticker}</td>
                    <td style={{ ...td, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</td>
                    <td style={td}>{m.locationName || '—'}</td>
                    <td style={td}>{m.targetDate || '—'}</td>
                    <td style={td}>{m.threshold != null ? `${m.threshold}°` : '—'}</td>
                    <td style={td}>{m.yesPrice != null ? `${m.yesPrice}¢` : '—'}</td>
                    <td style={td}>{m.noPrice != null ? `${m.noPrice}¢` : '—'}</td>
                    <td style={td}>{m.volume ?? '—'}</td>
                    <td style={td}>{m.mapped ? <span style={{ color: '#22c55e' }}>✓</span> : <span style={{ color: '#64748b' }}>—</span>}</td>
                  </tr>
                ))}
                {markets.length === 0 && <tr><td colSpan={10} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No markets available</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === ORDERS TAB === */}
      {tab === 'orders' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Normalized Orders ({orders.length})</h3>
          <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>Orders from all venues normalized into a single shape</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Venue</th><th style={th}>Mode</th><th style={th}>Ticker</th>
                  <th style={th}>Side</th><th style={th}>Price</th><th style={th}>Qty</th>
                  <th style={th}>Status</th><th style={th}>Created</th><th style={th}>Venue ID</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={i}>
                    <td style={td}><span style={badge('#6366f1')}>{o.venue}</span></td>
                    <td style={td}><span style={badge(o.mode === 'live' ? '#ef4444' : o.mode === 'demo' ? '#f59e0b' : '#64748b')}>{o.mode}</span></td>
                    <td style={{ ...td, fontSize: 11, fontFamily: 'monospace' }}>{o.ticker}</td>
                    <td style={td}>{o.side}</td>
                    <td style={td}>{o.price}¢</td>
                    <td style={td}>{o.quantity}</td>
                    <td style={td}><span style={badge(o.status === 'filled' ? '#22c55e' : o.status === 'open' ? '#3b82f6' : o.status === 'failed' ? '#ef4444' : '#64748b')}>{o.status}</span></td>
                    <td style={td}>{o.createdAt?.slice(0, 16).replace('T', ' ')}</td>
                    <td style={{ ...td, fontSize: 11, fontFamily: 'monospace' }}>{o.venueOrderId?.slice(0, 12) || '—'}</td>
                  </tr>
                ))}
                {orders.length === 0 && <tr><td colSpan={9} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No orders available</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
