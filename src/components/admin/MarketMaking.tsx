import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Factors {
  modelDrift?: number;
  liability?: number;
  lopsidedPct?: number;
  moveCount?: number;
  staleHours?: number;
}

interface MarketData {
  overUnder?: { line: number; overOdds: number; underOdds: number };
  pointspread?: { spread: number; locationAOdds: number; locationBOdds: number };
  rangeOdds?: { bands: { label: string; odds: number }[] };
}

interface Suggestion {
  wagerId: string;
  title: string;
  ticketNumber: string;
  marketType: string;
  current: MarketData;
  suggested: MarketData;
  reason: string;
  priority: string;
  factors: Factors;
  generatedAt: string;
}

interface Overview {
  totalSuggestions: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  avgModelDrift: number;
  totalAtRiskLiability: number;
}

interface AppliedChange {
  id: string;
  wagerId: string;
  title: string;
  marketType: string;
  before: MarketData;
  after: MarketData;
  reason: string;
  appliedAt: string;
  appliedBy: string;
  edited: boolean;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
});
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: 80 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };

const PRIORITY_COLORS: Record<string, string> = { critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#22c55e' };
const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff',
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatMarket(m: MarketData, type: string): string {
  if (type === 'over-under' && m.overUnder) {
    return `Line ${m.overUnder.line} | O ${m.overUnder.overOdds} / U ${m.overUnder.underOdds}`;
  }
  if (type === 'pointspread' && m.pointspread) {
    return `Spread ${m.pointspread.spread} | A ${m.pointspread.locationAOdds} / B ${m.pointspread.locationBOdds}`;
  }
  if (type === 'odds' && m.rangeOdds) {
    return m.rangeOdds.bands.map(b => `${b.label}: ${b.odds}`).join(', ');
  }
  return '—';
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function MarketMaking() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [appliedChanges, setAppliedChanges] = useState<AppliedChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // Preview / edit modal
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<MarketData | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/market-making');
      if (res.ok) {
        const d = await res.json();
        setSuggestions(d.suggestions || []);
        setOverview(d.overview || null);
        setAppliedChanges(d.appliedChanges || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleApply = async (s: Suggestion, edited: boolean, market?: MarketData) => {
    setMsg('');
    try {
      const res = await fetch('/api/admin/market-making', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply-suggestion',
          wagerId: s.wagerId,
          appliedMarket: market || s.suggested,
          originalSuggestion: s,
          edited,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Error'); return; }
      setMsg('Repricing applied');
      setPreviewIdx(null);
      setEditValues(null);
      await fetchData();
    } catch (e: any) { setMsg(e.message); }
  };

  const handleRefresh = async () => {
    setMsg(''); setLoading(true);
    try {
      const res = await fetch('/api/admin/market-making', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-suggestions' }),
      });
      if (res.ok) {
        const d = await res.json();
        setSuggestions(d.suggestions || []);
        setOverview(d.overview || null);
        setMsg('Refreshed');
      }
    } catch { setMsg('Refresh failed'); }
    setLoading(false);
  };

  const openPreview = (idx: number) => {
    setPreviewIdx(idx);
    // Deep copy suggestion for editing
    setEditValues(JSON.parse(JSON.stringify(suggestions[idx].suggested)));
  };

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading market-making controls...</div>;

  const navLinks = [
    { href: '/admin/trading-desk', label: 'Trading Desk' },
    { href: '/admin/operator-dashboard', label: 'Operator' },
    { href: '/admin/market-performance', label: 'Market Perf' },
    { href: '/admin/market-making', label: 'Market Making', active: true },
  ];

  const previewSuggestion = previewIdx !== null ? suggestions[previewIdx] : null;

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

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Market Making Controls</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Repricing suggestions — review and apply manually</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* ============================================================ */}
      {/* SUMMARY CARDS                                                  */}
      {/* ============================================================ */}
      {overview && (
        <div style={grid4}>
          <div style={card}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{overview.totalSuggestions}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Markets Needing Reprice</div>
          </div>
          <div style={{ ...card, borderLeft: '3px solid #dc2626' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#dc2626' }}>{overview.critical}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Critical</div>
          </div>
          <div style={{ ...card, borderLeft: '3px solid #f97316' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#f97316' }}>{overview.high}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>High Priority</div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{overview.avgModelDrift.toFixed(2)}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Avg Model Drift</div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>${(overview.totalAtRiskLiability / 100).toFixed(0)}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>At-Risk Liability</div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <button onClick={handleRefresh} style={btn('#334155')}>Refresh Suggestions</button>
      </div>

      {/* ============================================================ */}
      {/* REPRICING QUEUE TABLE                                          */}
      {/* ============================================================ */}
      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Repricing Queue</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Ticket / Title</th>
                <th style={th}>Type</th>
                <th style={th}>Current Market</th>
                <th style={th}>Suggested Market</th>
                <th style={th}>Reason</th>
                <th style={th}>Priority</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s, i) => (
                <tr key={s.wagerId}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{s.ticketNumber || s.wagerId.slice(0, 10)}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.title}</div>
                  </td>
                  <td style={td}>{s.marketType}</td>
                  <td style={{ ...td, fontSize: 12, maxWidth: 200 }}>{formatMarket(s.current, s.marketType)}</td>
                  <td style={{ ...td, fontSize: 12, maxWidth: 200, color: '#93c5fd' }}>{formatMarket(s.suggested, s.marketType)}</td>
                  <td style={{ ...td, fontSize: 12, maxWidth: 180 }}>{s.reason}</td>
                  <td style={td}><span style={badge(PRIORITY_COLORS[s.priority] || '#64748b')}>{s.priority.toUpperCase()}</span></td>
                  <td style={td}>
                    <button onClick={() => openPreview(i)} style={{ ...btn('#6366f1'), fontSize: 11, marginRight: 4 }}>Preview</button>
                    <button onClick={() => handleApply(s, false)} style={{ ...btn('#22c55e'), fontSize: 11 }}>Apply</button>
                  </td>
                </tr>
              ))}
              {suggestions.length === 0 && (
                <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No repricing suggestions. All markets look healthy.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================ */}
      {/* APPLIED CHANGES FEED                                           */}
      {/* ============================================================ */}
      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Recent Applied Changes</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Title</th>
                <th style={th}>Type</th>
                <th style={th}>Before</th>
                <th style={th}>After</th>
                <th style={th}>Reason</th>
                <th style={th}>Applied</th>
                <th style={th}>Edited?</th>
              </tr>
            </thead>
            <tbody>
              {appliedChanges.map(c => (
                <tr key={c.id}>
                  <td style={td}>{c.title}</td>
                  <td style={td}>{c.marketType}</td>
                  <td style={{ ...td, fontSize: 12 }}>{formatMarket(c.before, c.marketType)}</td>
                  <td style={{ ...td, fontSize: 12, color: '#93c5fd' }}>{formatMarket(c.after, c.marketType)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{c.reason}</td>
                  <td style={td}>{c.appliedAt?.slice(0, 16).replace('T', ' ')}</td>
                  <td style={td}>{c.edited ? 'Yes' : 'No'}</td>
                </tr>
              ))}
              {appliedChanges.length === 0 && (
                <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No applied changes yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================ */}
      {/* PREVIEW / EDIT MODAL                                           */}
      {/* ============================================================ */}
      {previewSuggestion && editValues && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 600, width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Repricing Preview</h3>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>{previewSuggestion.title} — {previewSuggestion.ticketNumber}</p>

            {/* Factors */}
            <div style={{ ...card, background: '#0f172a' }}>
              <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>Key Factors</h4>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                {previewSuggestion.factors.modelDrift != null && <div>Drift: <strong>{previewSuggestion.factors.modelDrift.toFixed(2)}</strong></div>}
                {previewSuggestion.factors.liability != null && <div>Liability: <strong>${(previewSuggestion.factors.liability / 100).toFixed(0)}</strong></div>}
                {previewSuggestion.factors.lopsidedPct != null && <div>Lopsided: <strong>{(previewSuggestion.factors.lopsidedPct * 100).toFixed(0)}%</strong></div>}
                {previewSuggestion.factors.moveCount != null && <div>Moves: <strong>{previewSuggestion.factors.moveCount}</strong></div>}
                {previewSuggestion.factors.staleHours != null && <div>Stale: <strong>{previewSuggestion.factors.staleHours.toFixed(1)}h</strong></div>}
              </div>
              <p style={{ fontSize: 12, color: '#cbd5e1', marginTop: 8 }}>Reason: {previewSuggestion.reason}</p>
            </div>

            {/* Current vs Suggested / Editable */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Current</h4>
                <div style={{ fontSize: 13, background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  {formatMarket(previewSuggestion.current, previewSuggestion.marketType)}
                </div>
              </div>
              <div>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: '#93c5fd', marginBottom: 4 }}>Suggested (editable)</h4>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  {previewSuggestion.marketType === 'over-under' && editValues.overUnder && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <div><label style={{ fontSize: 10, color: '#64748b' }}>Line</label>
                        <input type="number" step="0.5" value={editValues.overUnder.line} onChange={e => setEditValues({ ...editValues, overUnder: { ...editValues.overUnder!, line: parseFloat(e.target.value) || 0 } })} style={inputStyle} /></div>
                      <div><label style={{ fontSize: 10, color: '#64748b' }}>Over</label>
                        <input type="number" step="5" value={editValues.overUnder.overOdds} onChange={e => setEditValues({ ...editValues, overUnder: { ...editValues.overUnder!, overOdds: parseInt(e.target.value) || 0 } })} style={inputStyle} /></div>
                      <div><label style={{ fontSize: 10, color: '#64748b' }}>Under</label>
                        <input type="number" step="5" value={editValues.overUnder.underOdds} onChange={e => setEditValues({ ...editValues, overUnder: { ...editValues.overUnder!, underOdds: parseInt(e.target.value) || 0 } })} style={inputStyle} /></div>
                    </div>
                  )}
                  {previewSuggestion.marketType === 'pointspread' && editValues.pointspread && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <div><label style={{ fontSize: 10, color: '#64748b' }}>Spread</label>
                        <input type="number" step="0.5" value={editValues.pointspread.spread} onChange={e => setEditValues({ ...editValues, pointspread: { ...editValues.pointspread!, spread: parseFloat(e.target.value) || 0 } })} style={inputStyle} /></div>
                      <div><label style={{ fontSize: 10, color: '#64748b' }}>A Odds</label>
                        <input type="number" step="5" value={editValues.pointspread.locationAOdds} onChange={e => setEditValues({ ...editValues, pointspread: { ...editValues.pointspread!, locationAOdds: parseInt(e.target.value) || 0 } })} style={inputStyle} /></div>
                      <div><label style={{ fontSize: 10, color: '#64748b' }}>B Odds</label>
                        <input type="number" step="5" value={editValues.pointspread.locationBOdds} onChange={e => setEditValues({ ...editValues, pointspread: { ...editValues.pointspread!, locationBOdds: parseInt(e.target.value) || 0 } })} style={inputStyle} /></div>
                    </div>
                  )}
                  {previewSuggestion.marketType === 'odds' && editValues.rangeOdds && (
                    <div>
                      {editValues.rangeOdds.bands.map((b, bi) => (
                        <div key={bi} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: '#94a3b8', minWidth: 80 }}>{b.label}</span>
                          <input type="number" step="10" value={b.odds} onChange={e => {
                            const bands = [...editValues.rangeOdds!.bands];
                            bands[bi] = { ...bands[bi], odds: parseInt(e.target.value) || 0 };
                            setEditValues({ ...editValues, rangeOdds: { bands } });
                          }} style={inputStyle} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setPreviewIdx(null); setEditValues(null); }} style={btn('#334155')}>Cancel</button>
              <button onClick={() => handleApply(previewSuggestion, false, previewSuggestion.suggested)} style={btn('#22c55e')}>Apply As-Is</button>
              <button onClick={() => handleApply(previewSuggestion, true, editValues!)} style={btn('#3b82f6')}>Apply Edited</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
