import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface VersionAttribution {
  family: string; version: string; versionId: string; versionName: string;
  attributionMethodMix: { direct: number; inferred: number; unknown: number };
  records: number; signals: number; candidates: number; orders: number; fills: number; settled: number;
  grossPnlCents: number; netPnlCents: number; avgEdge: number; avgScore: number;
  winRate: number; fillRate: number; conversionRate: number;
}

interface StackAttribution {
  stackSignature: string; stackVersions: Record<string, string>;
  records: number; netPnlCents: number; winRate: number; fillRate: number; avgEdge: number;
}

interface AttributionOverview {
  totalAttributed: number; directCount: number; inferredCount: number; unknownCount: number;
  bestVersionByPnl: { family: string; version: string; netPnlCents: number } | null;
  bestVersionByWinRate: { family: string; version: string; winRate: number } | null;
  bestStack: { signature: string; netPnlCents: number } | null;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const inputStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 13, width: '100%' };
const selectStyle: React.CSSProperties = { ...inputStyle };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (color: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: color, color: '#fff' });

const METHOD_COLORS: Record<string, string> = { direct: '#22c55e', inferred: '#f59e0b', unknown: '#64748b' };

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtPnl(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toFixed(2);
  return cents < 0 ? `-$${dollars}` : `$${dollars}`;
}

function fmtPct(val: number): string {
  return `${(val * 100).toFixed(1)}%`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ModelAttribution() {
  const [versions, setVersions] = useState<VersionAttribution[]>([]);
  const [stacks, setStacks] = useState<StackAttribution[]>([]);
  const [overview, setOverview] = useState<AttributionOverview | null>(null);
  const [families, setFamilies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // Filters
  const [filterFamily, setFilterFamily] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterMode, setFilterMode] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [minSample, setMinSample] = useState('');

  // Detail
  const [detailVersion, setDetailVersion] = useState<VersionAttribution | null>(null);
  const [detailStack, setDetailStack] = useState<StackAttribution | null>(null);

  // Tab
  const [tab, setTab] = useState<'versions' | 'stacks'>('versions');

  const fetchData = async (params = '') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/model-attribution${params}`);
      if (res.ok) {
        const d = await res.json();
        setVersions(d.versions || []);
        setStacks(d.stacks || []);
        setOverview(d.overview || null);
        if (d.families) setFamilies(d.families);
      } else {
        const e = await res.json().catch(() => ({}));
        setMsg(e.error || 'Failed to load');
      }
    } catch { setMsg('Network error'); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const applyFilter = () => {
    const params: string[] = [];
    if (filterFamily) params.push(`family=${filterFamily}`);
    if (dateFrom) params.push(`dateFrom=${dateFrom}`);
    if (dateTo) params.push(`dateTo=${dateTo}`);
    if (filterSource) params.push(`source=${filterSource}`);
    if (filterMode) params.push(`mode=${filterMode}`);
    if (filterMethod) params.push(`attributionMethod=${filterMethod}`);
    if (minSample) params.push(`minSample=${minSample}`);
    fetchData(params.length ? `?${params.join('&')}` : '');
  };

  const resetFilters = () => {
    setFilterFamily(''); setDateFrom(''); setDateTo(''); setFilterSource('');
    setFilterMode(''); setFilterMethod(''); setMinSample('');
    fetchData();
  };

  const navLinks = [
    { href: '/admin/trading-desk', label: 'Trading Desk' },
    { href: '/admin/operator-dashboard', label: 'Operator' },
    { href: '/admin/reports', label: 'Reports' },
    { href: '/admin/model-governance', label: 'Governance' },
    { href: '/admin/history', label: 'History' },
    { href: '/admin/model-attribution', label: 'Attribution', active: true },
  ];

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading attribution data...</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {navLinks.map(l => (
          <a key={l.href} href={l.href} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: l.active ? '#6366f1' : '#334155', color: '#fff' }}>{l.label}</a>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Strategy Attribution by Model Version</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Connect trading outcomes to the exact model versions that generated them</p>

      {msg && <div style={{ ...card, background: '#1e3a5f', color: '#93c5fd', fontSize: 13 }}>{msg}</div>}

      {/* Overview cards */}
      {overview && (
        <div style={grid4}>
          <div style={card}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{overview.totalAttributed}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Total Attributed Records</div>
          </div>
          <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{overview.directCount}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Direct Attribution</div>
          </div>
          <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{overview.inferredCount}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Inferred Attribution</div>
          </div>
          <div style={{ ...card, borderLeft: '3px solid #64748b' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{overview.unknownCount}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Unknown Attribution</div>
          </div>
          {overview.bestVersionByPnl && (
            <div style={{ ...card, borderLeft: '3px solid #3b82f6' }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtPnl(overview.bestVersionByPnl.netPnlCents)}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Best Version (P&L)</div>
              <div style={{ fontSize: 12, color: '#cbd5e1' }}>{overview.bestVersionByPnl.family}:{overview.bestVersionByPnl.version}</div>
            </div>
          )}
          {overview.bestVersionByWinRate && (
            <div style={{ ...card, borderLeft: '3px solid #8b5cf6' }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtPct(overview.bestVersionByWinRate.winRate)}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Best Version (Win Rate)</div>
              <div style={{ fontSize: 12, color: '#cbd5e1' }}>{overview.bestVersionByWinRate.family}:{overview.bestVersionByWinRate.version}</div>
            </div>
          )}
          {overview.bestStack && (
            <div style={{ ...card, borderLeft: '3px solid #ec4899' }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtPnl(overview.bestStack.netPnlCents)}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Best Stack (P&L)</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', wordBreak: 'break-all' }}>{overview.bestStack.signature.slice(0, 60)}</div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 140 }}>
          <label style={{ fontSize: 11, color: '#94a3b8' }}>Family</label>
          <select value={filterFamily} onChange={e => setFilterFamily(e.target.value)} style={selectStyle}>
            <option value="">All</option>
            {families.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 120 }}>
          <label style={{ fontSize: 11, color: '#94a3b8' }}>From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ minWidth: 120 }}>
          <label style={{ fontSize: 11, color: '#94a3b8' }}>To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ minWidth: 100 }}>
          <label style={{ fontSize: 11, color: '#94a3b8' }}>Source</label>
          <input value={filterSource} onChange={e => setFilterSource(e.target.value)} placeholder="e.g. kalshi" style={inputStyle} />
        </div>
        <div style={{ minWidth: 100 }}>
          <label style={{ fontSize: 11, color: '#94a3b8' }}>Mode</label>
          <select value={filterMode} onChange={e => setFilterMode(e.target.value)} style={selectStyle}>
            <option value="">All</option>
            <option value="demo">Demo</option>
            <option value="live">Live</option>
          </select>
        </div>
        <div style={{ minWidth: 120 }}>
          <label style={{ fontSize: 11, color: '#94a3b8' }}>Attribution</label>
          <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)} style={selectStyle}>
            <option value="">All</option>
            <option value="direct">Direct</option>
            <option value="inferred">Inferred</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div style={{ minWidth: 80 }}>
          <label style={{ fontSize: 11, color: '#94a3b8' }}>Min Sample</label>
          <input type="number" value={minSample} onChange={e => setMinSample(e.target.value)} placeholder="0" style={inputStyle} />
        </div>
        <button onClick={applyFilter} style={btn('#6366f1')}>Filter</button>
        <button onClick={resetFilters} style={btn('#334155')}>Reset</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['versions', 'stacks'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), textTransform: 'capitalize' }}>{t === 'versions' ? `Versions (${versions.length})` : `Stacks (${stacks.length})`}</button>
        ))}
      </div>

      {/* Version table */}
      {tab === 'versions' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Version Performance</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Family</th><th style={th}>Version</th><th style={th}>Method Mix</th>
                  <th style={th}>Records</th><th style={th}>Signals</th><th style={th}>Orders</th>
                  <th style={th}>Fills</th><th style={th}>Settled</th><th style={th}>Net P&L</th>
                  <th style={th}>Win Rate</th><th style={th}>Avg Edge</th><th style={th}>Avg Score</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v, i) => {
                  const total = v.attributionMethodMix.direct + v.attributionMethodMix.inferred + v.attributionMethodMix.unknown;
                  return (
                    <tr key={i}>
                      <td style={td}><span style={badge('#6366f1')}>{v.family}</span></td>
                      <td style={td}>{v.version}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {v.attributionMethodMix.direct > 0 && <span style={badge(METHOD_COLORS.direct)}>{v.attributionMethodMix.direct}d</span>}
                          {v.attributionMethodMix.inferred > 0 && <span style={badge(METHOD_COLORS.inferred)}>{v.attributionMethodMix.inferred}i</span>}
                          {v.attributionMethodMix.unknown > 0 && <span style={badge(METHOD_COLORS.unknown)}>{v.attributionMethodMix.unknown}u</span>}
                        </div>
                      </td>
                      <td style={td}>{v.records}</td>
                      <td style={td}>{v.signals}</td>
                      <td style={td}>{v.orders}</td>
                      <td style={td}>{v.fills}</td>
                      <td style={td}>{v.settled}</td>
                      <td style={{ ...td, color: v.netPnlCents >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{fmtPnl(v.netPnlCents)}</td>
                      <td style={td}>{fmtPct(v.winRate)}</td>
                      <td style={td}>{(v.avgEdge * 100).toFixed(2)}%</td>
                      <td style={td}>{v.avgScore.toFixed(2)}</td>
                      <td style={td}><button onClick={() => setDetailVersion(v)} style={btn('#6366f1')}>Detail</button></td>
                    </tr>
                  );
                })}
                {versions.length === 0 && <tr><td colSpan={13} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No version attribution data available.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stack table */}
      {tab === 'stacks' && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Stack Performance</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Stack Signature</th><th style={th}>Records</th>
                  <th style={th}>Net P&L</th><th style={th}>Win Rate</th>
                  <th style={th}>Fill Rate</th><th style={th}>Avg Edge</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {stacks.map((s, i) => (
                  <tr key={i}>
                    <td style={{ ...td, maxWidth: 350, wordBreak: 'break-all', fontSize: 12 }}>{s.stackSignature}</td>
                    <td style={td}>{s.records}</td>
                    <td style={{ ...td, color: s.netPnlCents >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{fmtPnl(s.netPnlCents)}</td>
                    <td style={td}>{fmtPct(s.winRate)}</td>
                    <td style={td}>{fmtPct(s.fillRate)}</td>
                    <td style={td}>{(s.avgEdge * 100).toFixed(2)}%</td>
                    <td style={td}><button onClick={() => setDetailStack(s)} style={btn('#6366f1')}>Detail</button></td>
                  </tr>
                ))}
                {stacks.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center' }}>No stack attribution data available.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Version detail modal */}
      {detailVersion && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 600, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>{detailVersion.family} — {detailVersion.version}</h3>
                <p style={{ fontSize: 12, color: '#94a3b8' }}>Version Detail</p>
              </div>
              <button onClick={() => setDetailVersion(null)} style={btn('#334155')}>Close</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div style={{ ...card, margin: 0 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Records</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{detailVersion.records}</div>
              </div>
              <div style={{ ...card, margin: 0 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Net P&L</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: detailVersion.netPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtPnl(detailVersion.netPnlCents)}</div>
              </div>
              <div style={{ ...card, margin: 0 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Gross P&L</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtPnl(detailVersion.grossPnlCents)}</div>
              </div>
              <div style={{ ...card, margin: 0 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Win Rate</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtPct(detailVersion.winRate)}</div>
              </div>
            </div>

            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Conversion Funnel</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'Signals', val: detailVersion.signals },
                { label: 'Candidates', val: detailVersion.candidates },
                { label: 'Orders', val: detailVersion.orders },
                { label: 'Fills', val: detailVersion.fills },
                { label: 'Settled', val: detailVersion.settled },
              ].map(item => (
                <div key={item.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{item.val}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{item.label}</div>
                </div>
              ))}
            </div>

            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Quality Metrics</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{(detailVersion.avgEdge * 100).toFixed(2)}%</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Avg Edge</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{detailVersion.avgScore.toFixed(2)}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Avg Score</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtPct(detailVersion.conversionRate)}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Conversion Rate</div>
              </div>
            </div>

            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Attribution Confidence</h4>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <span style={badge(METHOD_COLORS.direct)}>{detailVersion.attributionMethodMix.direct} direct</span>
              <span style={badge(METHOD_COLORS.inferred)}>{detailVersion.attributionMethodMix.inferred} inferred</span>
              <span style={badge(METHOD_COLORS.unknown)}>{detailVersion.attributionMethodMix.unknown} unknown</span>
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <a href={`/admin/model-governance`} style={{ ...btn('#3b82f6'), textDecoration: 'none' }}>View in Governance</a>
              <a href={`/admin/history`} style={{ ...btn('#334155'), textDecoration: 'none' }}>View Snapshots</a>
            </div>
          </div>
        </div>
      )}

      {/* Stack detail modal */}
      {detailStack && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 600, width: '95%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Stack Detail</h3>
                <p style={{ fontSize: 12, color: '#94a3b8' }}>{detailStack.records} records</p>
              </div>
              <button onClick={() => setDetailStack(null)} style={btn('#334155')}>Close</button>
            </div>

            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Stack Versions</h4>
            <div style={{ background: '#0f172a', borderRadius: 6, padding: 10, marginBottom: 16 }}>
              {Object.entries(detailStack.stackVersions).map(([fam, ver]) => (
                <div key={fam} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                  <span style={{ color: '#94a3b8' }}>{fam}</span>
                  <span style={{ fontWeight: 600 }}>{ver}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ ...card, margin: 0 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Net P&L</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: detailStack.netPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtPnl(detailStack.netPnlCents)}</div>
              </div>
              <div style={{ ...card, margin: 0 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Win Rate</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtPct(detailStack.winRate)}</div>
              </div>
              <div style={{ ...card, margin: 0 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Fill Rate</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtPct(detailStack.fillRate)}</div>
              </div>
              <div style={{ ...card, margin: 0 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Avg Edge</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{(detailStack.avgEdge * 100).toFixed(2)}%</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
