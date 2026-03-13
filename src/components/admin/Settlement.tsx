import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface SettlementRecord {
  id: string; createdAt: string; source: string; marketId?: string; orderId?: string;
  ticker?: string; title?: string; status: string; resolutionValue?: any;
  grossPnlCents: number; feesCents: number; netPnlCents: number; slippageCents: number; notes?: string;
}

interface EnhancedPosition {
  id: string; source: string; ticker: string; title: string; side: string;
  contractsOpen: number; contractsClosed: number; contractsTotal: number;
  avgEntryPrice: number; avgExitPrice: number; closeStatus: string;
  grossRealizedPnlCents: number; feesCents: number; netRealizedPnlCents: number;
  unrealizedPnlCents: number; unrealizedMethod: string;
  openedAt: string; closedAt?: string;
}

interface DiscrepancyRecord {
  id: string; reconRecordId: string; orderId: string; ticker: string;
  issue: string; severity: string; mode: string; resolution: string;
  resolvedAt?: string; notes?: string;
}

interface Overview {
  pending: number; resolved: number; settled: number; disputed: number;
  grossPnlCents: number; totalFeesCents: number; netPnlCents: number;
  openPositions: number; closedPositions: number; partialPositions: number;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600,
});
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff',
});
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 12, width: '100%' };

const STATUS_COLORS: Record<string, string> = {
  pending: '#eab308', resolved: '#3b82f6', settled: '#22c55e', disputed: '#dc2626',
  open: '#3b82f6', partially_closed: '#eab308', closed: '#22c55e',
  reviewed: '#3b82f6', ignored: '#64748b',
};

const pnl = (cents: number) => {
  const val = (cents / 100).toFixed(2);
  const color = cents > 0 ? '#22c55e' : cents < 0 ? '#ef4444' : '#94a3b8';
  return <span style={{ color, fontWeight: 600 }}>${val}</span>;
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function Settlement() {
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [positions, setPositions] = useState<EnhancedPosition[]>([]);
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyRecord[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'settlements' | 'positions' | 'discrepancies'>('settlements');
  const [discNotes, setDiscNotes] = useState<Record<string, string>>({});

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/settlement');
      if (res.ok) {
        const d = await res.json();
        setSettlements(d.settlements || []);
        setPositions(d.positions || []);
        setDiscrepancies(d.discrepancies || []);
        setOverview(d.overview || null);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const post = async (body: any) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/settlement', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return; }
      setMsg('Done');
      await fetchData();
    } catch (e: any) { setMsg(e.message); }
  };

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading settlement dashboard...</div>;

  const navLinks = [
    { href: '/admin/trading-desk', label: 'Trading Desk' },
    { href: '/admin/reconciliation', label: 'Reconciliation' },
    { href: '/admin/alerts', label: 'Alerts' },
    { href: '/admin/settlement', label: 'Settlement', active: true },
  ];

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none',
            background: l.active ? '#6366f1' : '#334155', color: '#fff',
          }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Settlement & Accounting</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Resolution workflow, fee accounting, position closes, discrepancy closure</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Summary cards */}
      {overview && (
        <div style={grid4}>
          <div style={card}><div style={{ fontSize: 22, fontWeight: 700 }}>{overview.pending}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Pending</div></div>
          <div style={card}><div style={{ fontSize: 22, fontWeight: 700 }}>{overview.settled}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Settled</div></div>
          <div style={card}><div style={{ fontSize: 22, fontWeight: 700, color: '#dc2626' }}>{overview.disputed}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Disputed</div></div>
          <div style={card}><div style={{ fontSize: 22, fontWeight: 700 }}>{pnl(overview.grossPnlCents)}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Gross P&L</div></div>
          <div style={card}><div style={{ fontSize: 22, fontWeight: 700, color: '#eab308' }}>${(overview.totalFeesCents / 100).toFixed(2)}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Fees</div></div>
          <div style={card}><div style={{ fontSize: 22, fontWeight: 700 }}>{pnl(overview.netPnlCents)}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Net P&L</div></div>
          <div style={card}><div style={{ fontSize: 22, fontWeight: 700 }}>{overview.openPositions}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Open Pos</div></div>
          <div style={card}><div style={{ fontSize: 22, fontWeight: 700 }}>{overview.closedPositions}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Closed Pos</div></div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => post({ action: 'rebuild-settlements' })} style={btn('#22c55e')}>Rebuild Settlements</button>
        <button onClick={() => post({ action: 'rebuild-position-closes' })} style={btn('#3b82f6')}>Rebuild Positions</button>
        <button onClick={() => post({ action: 'rebuild-unrealized-pnl' })} style={btn('#6366f1')}>Update Unrealized P&L</button>
        <button onClick={() => post({ action: 'rebuild-discrepancies' })} style={btn('#eab308')}>Rebuild Discrepancies</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['settlements', 'positions', 'discrepancies'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {/* ============================================================ */}
      {/* SETTLEMENTS TABLE                                              */}
      {/* ============================================================ */}
      {tab === 'settlements' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Settlements ({settlements.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Source</th><th style={th}>Ticker / Title</th><th style={th}>Status</th>
                  <th style={th}>Gross</th><th style={th}>Fees</th><th style={th}>Net</th>
                  <th style={th}>Created</th><th style={th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map(s => (
                  <tr key={s.id}>
                    <td style={td}><span style={{ fontSize: 11, color: '#94a3b8' }}>{s.source}</span></td>
                    <td style={td}><div style={{ fontWeight: 600 }}>{s.ticker}</div><div style={{ fontSize: 11, color: '#64748b' }}>{s.title}</div></td>
                    <td style={td}><span style={badge(STATUS_COLORS[s.status] || '#64748b')}>{s.status.toUpperCase()}</span></td>
                    <td style={td}>{pnl(s.grossPnlCents)}</td>
                    <td style={td}>${(s.feesCents / 100).toFixed(2)}</td>
                    <td style={td}>{pnl(s.netPnlCents)}</td>
                    <td style={td}>{s.createdAt?.slice(0, 10)}</td>
                    <td style={{ ...td, fontSize: 11 }}>{s.notes || '—'}</td>
                  </tr>
                ))}
                {settlements.length === 0 && <tr><td colSpan={8} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No settlements. Click Rebuild to generate.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* POSITIONS TABLE                                                */}
      {/* ============================================================ */}
      {tab === 'positions' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Positions ({positions.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Ticker</th><th style={th}>Source</th><th style={th}>Status</th>
                  <th style={th}>Open</th><th style={th}>Closed</th>
                  <th style={th}>Avg Entry</th><th style={th}>Avg Exit</th>
                  <th style={th}>Realized</th><th style={th}>Fees</th><th style={th}>Net</th>
                  <th style={th}>Unrealized</th><th style={th}>Method</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.id}>
                    <td style={td}><div style={{ fontWeight: 600 }}>{p.ticker}</div><div style={{ fontSize: 11, color: '#64748b' }}>{p.side}</div></td>
                    <td style={td}><span style={{ fontSize: 11 }}>{p.source}</span></td>
                    <td style={td}><span style={badge(STATUS_COLORS[p.closeStatus] || '#64748b')}>{p.closeStatus.toUpperCase()}</span></td>
                    <td style={td}>{p.contractsOpen}</td>
                    <td style={td}>{p.contractsClosed}</td>
                    <td style={td}>{p.avgEntryPrice.toFixed(2)}</td>
                    <td style={td}>{p.avgExitPrice > 0 ? p.avgExitPrice.toFixed(2) : '—'}</td>
                    <td style={td}>{pnl(p.grossRealizedPnlCents)}</td>
                    <td style={td}>${(p.feesCents / 100).toFixed(2)}</td>
                    <td style={td}>{pnl(p.netRealizedPnlCents)}</td>
                    <td style={td}>{pnl(p.unrealizedPnlCents)}</td>
                    <td style={td}><span style={{ fontSize: 11, color: '#94a3b8' }}>{p.unrealizedMethod}</span></td>
                  </tr>
                ))}
                {positions.length === 0 && <tr><td colSpan={12} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No positions. Click Rebuild to generate.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* DISCREPANCIES TABLE                                            */}
      {/* ============================================================ */}
      {tab === 'discrepancies' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Discrepancies ({discrepancies.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Ticker</th><th style={th}>Issue</th><th style={th}>Mode</th>
                  <th style={th}>Severity</th><th style={th}>Resolution</th><th style={th}>Notes</th><th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {discrepancies.map(d => (
                  <tr key={d.id}>
                    <td style={td}>{d.ticker || d.orderId}</td>
                    <td style={{ ...td, maxWidth: 200 }}>{d.issue}</td>
                    <td style={td}>{d.mode}</td>
                    <td style={td}><span style={badge(d.severity === 'high' ? '#dc2626' : d.severity === 'medium' ? '#eab308' : '#64748b')}>{d.severity}</span></td>
                    <td style={td}><span style={badge(STATUS_COLORS[d.resolution] || '#64748b')}>{d.resolution.toUpperCase()}</span></td>
                    <td style={td}>
                      <input
                        value={discNotes[d.id] ?? d.notes ?? ''}
                        onChange={e => setDiscNotes(prev => ({ ...prev, [d.id]: e.target.value }))}
                        placeholder="Add notes..."
                        style={inputStyle}
                      />
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {d.resolution !== 'resolved' && (
                          <button onClick={() => post({ action: 'resolve-discrepancy', id: d.id, notes: discNotes[d.id] })} style={btn('#22c55e')}>Resolve</button>
                        )}
                        {d.resolution !== 'disputed' && (
                          <button onClick={() => post({ action: 'dispute-discrepancy', id: d.id, notes: discNotes[d.id] })} style={btn('#dc2626')}>Dispute</button>
                        )}
                        {d.resolution === 'reviewed' && (
                          <button onClick={() => post({ action: 'ignore-discrepancy', id: d.id, notes: discNotes[d.id] })} style={btn('#64748b')}>Ignore</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {discrepancies.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No discrepancies. Click Rebuild to scan.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
