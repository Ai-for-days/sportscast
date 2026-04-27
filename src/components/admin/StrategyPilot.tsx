import React, { useEffect, useState } from 'react';
import { BarChart, LineChart, GaugeIndicator, EmptyChart } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });
const inputStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 };

const statusColor: Record<string, string> = {
  draft: '#64748b', scheduled: '#3b82f6', active: '#22c55e', paused: '#f59e0b', completed: '#06b6d4', cancelled: '#475569',
};
const modeColor: Record<string, string> = {
  paper: '#94a3b8', demo: '#8b5cf6', live_pilot: '#ef4444',
};
const warnColor: Record<string, string> = {
  healthy: '#22c55e', watch: '#f59e0b', breach: '#ef4444',
};

type Tab = 'plans' | 'control' | 'limits' | 'execution' | 'results' | 'methodology';

export default function StrategyPilot() {
  const [data, setData] = useState<any>(null);
  const [active, setActive] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('plans');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Selected pilot for detail/monitoring
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [execReview, setExecReview] = useState<any>(null);
  const [linkInput, setLinkInput] = useState({ recordType: 'candidate', recordId: '' });

  // Create form (URL-prefill aware)
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    strategyId: '', strategyName: '', mode: 'paper',
    startDate: '', endDate: '',
    maxCapital: '500.00', maxDailyLoss: '50.00', maxOpenPositions: '10', maxSingleTrade: '50.00',
    allowedSources: '', allowedMetrics: '', notes: '',
  });

  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get('prefill');
    if (prefill) {
      try {
        const obj = JSON.parse(decodeURIComponent(prefill));
        setForm(prev => ({
          ...prev,
          strategyId: obj.strategyId ?? '',
          strategyName: obj.strategyName ?? '',
          mode: obj.mode ?? 'paper',
        }));
        setCreating(true);
      } catch { /* ignore */ }
    }
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const [list, act] = await Promise.all([
        fetch('/api/admin/system/strategy-pilot?action=list', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/admin/system/strategy-pilot?action=active', { credentials: 'include' }).then(r => r.json()),
      ]);
      setData(list);
      setActive(act);
      if (selectedId) {
        const det = await fetch(`/api/admin/system/strategy-pilot?action=detail&id=${selectedId}`, { credentials: 'include' }).then(r => r.json());
        setDetail(det);
      }
    } catch { setData({ error: 'Failed to load' }); }
    setLoading(false);
  }

  async function loadDetail(id: string) {
    setSelectedId(id);
    const det = await fetch(`/api/admin/system/strategy-pilot?action=detail&id=${id}`, { credentials: 'include' }).then(r => r.json());
    setDetail(det);
  }

  async function loadExecReview(id: string) {
    setSelectedId(id);
    const er = await fetch(`/api/admin/system/strategy-pilot?action=execution-review&id=${id}`, { credentials: 'include' }).then(r => r.json());
    setExecReview(er);
  }

  async function postAction(action: string, body: any = {}) {
    setBusy(action);
    try {
      const res = await fetch('/api/admin/system/strategy-pilot', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const j = await res.json();
      if (res.ok) {
        setToast(`✓ ${action.replace(/-/g, ' ')}`);
        await reload();
      } else {
        setToast(`Error: ${j.error || 'failed'}${j.message ? ` — ${j.message}` : ''}`);
      }
    } catch (e: any) {
      setToast(`Error: ${e?.message || 'network'}`);
    }
    setBusy(null);
    setTimeout(() => setToast(null), 4000);
  }

  async function submitCreate() {
    if (!form.strategyId.trim()) {
      setToast('strategyId is required (use Create Pilot from Strategy Registry)');
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const dollarsToCents = (s: string) => Math.round(parseFloat(s || '0') * 100);
    await postAction('create-pilot', {
      strategyId: form.strategyId,
      mode: form.mode,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      maxCapitalCents: dollarsToCents(form.maxCapital),
      maxDailyLossCents: dollarsToCents(form.maxDailyLoss),
      maxOpenPositions: parseInt(form.maxOpenPositions, 10) || 1,
      maxSingleTradeCents: dollarsToCents(form.maxSingleTrade),
      allowedSources: form.allowedSources ? form.allowedSources.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      allowedMetrics: form.allowedMetrics ? form.allowedMetrics.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      notes: form.notes || undefined,
    });
    setCreating(false);
    setForm({
      strategyId: '', strategyName: '', mode: 'paper',
      startDate: '', endDate: '',
      maxCapital: '500.00', maxDailyLoss: '50.00', maxOpenPositions: '10', maxSingleTrade: '50.00',
      allowedSources: '', allowedMetrics: '', notes: '',
    });
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading pilot control room…</div>;
  if (!data || data.error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {data?.error || 'unknown'}</div>;

  const pilots = (data.pilots ?? []) as any[];
  const fmtCents = (v: number | null | undefined) => v == null ? '—' : `$${(v / 100).toFixed(2)}`;
  const fmtSignedCents = (v: number | null | undefined) => v == null ? '—' : `${v >= 0 ? '+' : ''}$${(v / 100).toFixed(2)}`;
  const fmtPct = (v: number | null | undefined) => v == null ? '—' : `${v.toFixed(1)}%`;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/strategy-pilot" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Strategy Pilot Control Room</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 760 }}>
            Plan, monitor, and review manual pilots for strategies that have reached <code>paper_approved</code> or <code>pilot_ready</code>.
            <strong> No autonomous trading.</strong> Pilot state never activates trading automatically — orders remain a manual operator action.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href="/admin/system/strategy-scorecard" style={{ ...btn('#0ea5e9'), textDecoration: 'none', whiteSpace: 'nowrap' }}>Scorecard →</a>
          <button onClick={() => setCreating(true)} style={btn('#22c55e')}>+ New pilot</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['plans', `Pilot Plans (${pilots.length})`],
          ['control', active?.active ? `Active Control Room · ${active.active.strategyName}` : 'Active Control Room'],
          ['limits', 'Risk Limits'],
          ['execution', 'Execution Review'],
          ['results', 'Results'],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'plans' && (
        <div style={card}>
          {pilots.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No pilots yet. Open <a href="/admin/system/strategy-registry" style={{ color: '#a5b4fc' }}>Strategy Registry</a>, find a strategy in <strong>paper_approved</strong> or <strong>pilot_ready</strong>, and click "Create Pilot".
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Strategy</th>
                    <th style={th}>Status</th>
                    <th style={th}>Mode</th>
                    <th style={th}>Window</th>
                    <th style={th}>Max capital</th>
                    <th style={th}>Daily loss cap</th>
                    <th style={th}>Max open</th>
                    <th style={th}>Per trade</th>
                    <th style={th}>Created</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pilots.map((p: any) => (
                    <tr key={p.id}>
                      <td style={td}>
                        <button onClick={() => { loadDetail(p.id); setTab('control'); }} style={{ background: 'none', border: 'none', color: '#a5b4fc', cursor: 'pointer', padding: 0, fontWeight: 700, textAlign: 'left' }}>{p.strategyName}</button>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{p.id}</div>
                      </td>
                      <td style={td}><span style={badge(statusColor[p.status] ?? '#64748b')}>{p.status}</span></td>
                      <td style={td}><span style={badge(modeColor[p.mode] ?? '#64748b')}>{p.mode.replace('_', ' ')}</span></td>
                      <td style={td}>{p.startDate ?? '—'}<span style={{ color: '#64748b' }}> → </span>{p.endDate ?? '—'}</td>
                      <td style={td}>{fmtCents(p.maxCapitalCents)}</td>
                      <td style={td}>{fmtCents(p.maxDailyLossCents)}</td>
                      <td style={td}>{p.maxOpenPositions}</td>
                      <td style={td}>{fmtCents(p.maxSingleTradeCents)}</td>
                      <td style={td}>{new Date(p.createdAt).toLocaleString()}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {p.status === 'draft' && <button onClick={() => postAction('transition-pilot', { id: p.id, toStatus: 'scheduled' })} disabled={!!busy} style={btn('#3b82f6')}>Schedule</button>}
                          {p.status === 'scheduled' && <button onClick={() => postAction('transition-pilot', { id: p.id, toStatus: 'active' })} disabled={!!busy} style={btn('#22c55e')}>Activate</button>}
                          {p.status === 'active' && <button onClick={() => postAction('transition-pilot', { id: p.id, toStatus: 'paused' })} disabled={!!busy} style={btn('#f59e0b')}>Pause</button>}
                          {p.status === 'paused' && <button onClick={() => postAction('transition-pilot', { id: p.id, toStatus: 'active' })} disabled={!!busy} style={btn('#22c55e')}>Resume</button>}
                          {(p.status === 'active' || p.status === 'paused') && <button onClick={() => postAction('complete-pilot', { id: p.id })} disabled={!!busy} style={btn('#06b6d4')}>Complete</button>}
                          {(p.status === 'draft' || p.status === 'scheduled' || p.status === 'paused') && <button onClick={() => postAction('cancel-pilot', { id: p.id })} disabled={!!busy} style={btn('#475569')}>Cancel</button>}
                          <button onClick={() => { loadDetail(p.id); setTab('control'); }} style={btn('#6366f1')}>Open</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'control' && (
        <div>
          {!active?.active && !detail?.pilot && (
            <div style={{ ...card, padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No pilot selected. Pick one from <strong>Pilot Plans</strong>.
            </div>
          )}
          {(detail?.pilot || active?.active) && (() => {
            const pilot = detail?.pilot ?? active.active;
            const m = detail?.monitoring ?? active.monitoring ?? {};
            return (
              <>
                <div style={{ ...card, borderLeft: `4px solid ${warnColor[m.warningStatus ?? 'healthy']}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>Active pilot</div>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>{pilot.strategyName}</div>
                      <div style={{ fontSize: 12, color: '#cbd5e1' }}>
                        <span style={badge(statusColor[pilot.status] ?? '#64748b')}>{pilot.status}</span>{' '}
                        <span style={badge(modeColor[pilot.mode] ?? '#64748b')}>{pilot.mode.replace('_', ' ')}</span>{' '}
                        <span style={badge(warnColor[m.warningStatus ?? 'healthy'])}>{(m.warningStatus ?? 'healthy').toUpperCase()}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <a href={`/admin/system/strategy-registry`} style={{ ...btn('#475569'), textDecoration: 'none' }}>Strategy Registry</a>
                      <a href={`/admin/system/paper-strategy-portfolio`} style={{ ...btn('#475569'), textDecoration: 'none' }}>Paper Portfolio</a>
                      <a href={`/admin/system/allocation-stress-test`} style={{ ...btn('#475569'), textDecoration: 'none' }}>Stress Test</a>
                      <a href={`/admin/system/edge-validation`} style={{ ...btn('#475569'), textDecoration: 'none' }}>Edge Validation</a>
                    </div>
                  </div>
                </div>

                {m.breaches && m.breaches.length > 0 && (
                  <div style={{ ...card, background: '#3b1d1d', borderLeft: '4px solid #ef4444' }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#fca5a5' }}>⚠ Limit breaches</h4>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
                      {m.breaches.map((b: string, i: number) => <li key={i} style={{ marginBottom: 3 }}>{b}</li>)}
                    </ul>
                  </div>
                )}

                <div style={grid4}>
                  <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Open positions</div><div style={{ fontSize: 24, fontWeight: 700 }}>{m.openPositions ?? 0}</div></div>
                  <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Settled</div><div style={{ fontSize: 24, fontWeight: 700 }}>{m.settledPositions ?? 0}</div></div>
                  <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Total exposure</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCents(m.totalExposureCents)}</div></div>
                  <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Daily P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: (m.dailyPnlCents ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSignedCents(m.dailyPnlCents)}</div></div>
                  <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Total P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: (m.totalPnlCents ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSignedCents(m.totalPnlCents)}</div></div>
                  <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>ROI</div><div style={{ fontSize: 24, fontWeight: 700 }}>{m.roiPct != null ? `${m.roiPct >= 0 ? '+' : ''}${m.roiPct.toFixed(1)}%` : '—'}</div></div>
                  <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Max drawdown</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{fmtCents(m.maxDrawdownCents)}</div></div>
                  <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Current drawdown</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCents(m.currentDrawdownCents)}</div></div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
                  <div style={card}>
                    <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Capital utilisation</h4>
                    <GaugeIndicator value={Math.min(1, (m.utilization?.capitalPct ?? 0) / 100)} label="Capital" sublabel={`${fmtCents(m.totalExposureCents)} / ${fmtCents(pilot.maxCapitalCents)}`} />
                  </div>
                  <div style={card}>
                    <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Cumulative P&L</h4>
                    {(m.cumulative ?? []).length === 0
                      ? <EmptyChart title="Cumulative P&L" message="No settled trades match this pilot yet." />
                      : <LineChart yLabel="Cumulative $" valueFormatter={v => `${v >= 0 ? '+' : ''}$${(v / 100).toFixed(2)}`} data={m.cumulative.map((c: any) => ({ x: `#${c.idx}`, y: c.cumulativePnlCents }))} />}
                  </div>
                  <div style={card}>
                    <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Daily P&L</h4>
                    {(m.dailyPnl ?? []).length === 0
                      ? <EmptyChart title="Daily P&L" message="No daily P&L history yet." />
                      : <BarChart signColored valueFormatter={v => `${v >= 0 ? '+' : ''}$${(v / 100).toFixed(2)}`} data={m.dailyPnl.map((d: any) => ({ label: d.date.slice(5), value: d.pnlCents }))} />}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {tab === 'limits' && (
        <div>
          {pilots.length === 0
            ? <div style={{ ...card, padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No pilots to evaluate.</div>
            : pilots.map((p: any) => {
                const m = (selectedId === p.id ? detail?.monitoring : null) ?? null;
                return (
                  <div key={p.id} style={{ ...card, borderLeft: m ? `4px solid ${warnColor[m.warningStatus ?? 'healthy']}` : '4px solid #334155' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <strong>{p.strategyName}</strong>{' '}
                        <span style={badge(statusColor[p.status])}>{p.status}</span>{' '}
                        <span style={badge(modeColor[p.mode])}>{p.mode.replace('_', ' ')}</span>
                      </div>
                      <button onClick={() => loadDetail(p.id)} disabled={!!busy} style={btn('#6366f1')}>Compute monitoring</button>
                    </div>
                    {m ? (
                      <table style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse' }}>
                        <thead><tr>
                          <th style={th}>Limit</th><th style={th}>Cap</th><th style={th}>Current</th><th style={th}>Utilisation</th><th style={th}>Status</th>
                        </tr></thead>
                        <tbody>
                          {[
                            { name: 'Max capital',          cap: fmtCents(m.limits.maxCapitalCents),     cur: fmtCents(m.totalExposureCents),                    util: m.utilization.capitalPct },
                            { name: 'Max daily loss',      cap: fmtCents(m.limits.maxDailyLossCents),    cur: fmtCents(Math.max(0, -(m.dailyPnlCents ?? 0))),    util: m.utilization.dailyLossPct },
                            { name: 'Max open positions',  cap: `${m.limits.maxOpenPositions}`,          cur: `${m.openPositions}`,                              util: m.utilization.openPositionsPct },
                            { name: 'Max single trade',    cap: fmtCents(m.limits.maxSingleTradeCents),  cur: '— largest open —',                                util: m.utilization.largestSingleTradePct },
                          ].map(row => (
                            <tr key={row.name}>
                              <td style={td}>{row.name}</td>
                              <td style={td}>{row.cap}</td>
                              <td style={td}>{row.cur}</td>
                              <td style={td}>{row.util.toFixed(1)}%</td>
                              <td style={td}>
                                <span style={badge(row.util >= 100 ? warnColor.breach : row.util >= 80 ? warnColor.watch : warnColor.healthy)}>
                                  {row.util >= 100 ? 'BREACH' : row.util >= 80 ? 'WATCH' : 'OK'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>Click "Compute monitoring" to load utilisation.</div>
                    )}
                  </div>
                );
              })}
        </div>
      )}

      {tab === 'execution' && (
        <div>
          {pilots.length === 0 && (
            <div style={{ ...card, padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No pilots yet.</div>
          )}
          {!selectedId && pilots.length > 0 && (
            <div style={{ ...card, padding: 20, color: '#cbd5e1', fontSize: 13 }}>
              Pick a pilot from <strong>Pilot Plans</strong> first, then come back here.
            </div>
          )}
          {selectedId && (
            <>
              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong>Pilot:</strong> {pilots.find(p => p.id === selectedId)?.strategyName ?? '—'}{' '}
                    <span style={{ fontSize: 11, color: '#64748b' }}>{selectedId}</span>
                  </div>
                  <button onClick={() => loadExecReview(selectedId)} disabled={!!busy} style={btn('#3b82f6')}>
                    {execReview && execReview.pilot?.id === selectedId ? 'Reload review' : 'Load execution review'}
                  </button>
                </div>
              </div>

              {execReview && execReview.pilot?.id === selectedId && (
                <>
                  <div style={card}>
                    <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Linked vs inferred</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                      <div style={{ background: '#0f172a', padding: 10, borderRadius: 6 }}><div style={{ fontSize: 11, color: '#94a3b8' }}>Linked candidates</div><div style={{ fontSize: 20, fontWeight: 700 }}>{execReview.linked.candidates.length}</div></div>
                      <div style={{ background: '#0f172a', padding: 10, borderRadius: 6 }}><div style={{ fontSize: 11, color: '#94a3b8' }}>Linked demo orders</div><div style={{ fontSize: 20, fontWeight: 700 }}>{execReview.linked.demoOrders.length}</div></div>
                      <div style={{ background: '#0f172a', padding: 10, borderRadius: 6 }}><div style={{ fontSize: 11, color: '#94a3b8' }}>Linked live orders</div><div style={{ fontSize: 20, fontWeight: 700, color: execReview.linked.liveOrders.length > 0 ? '#ef4444' : '#e2e8f0' }}>{execReview.linked.liveOrders.length}</div></div>
                      <div style={{ background: '#0f172a', padding: 10, borderRadius: 6 }}><div style={{ fontSize: 11, color: '#94a3b8' }}>Linked paper records</div><div style={{ fontSize: 20, fontWeight: 700 }}>{execReview.linked.paperRecords.length}</div></div>
                      <div style={{ background: '#0f172a', padding: 10, borderRadius: 6 }}><div style={{ fontSize: 11, color: '#94a3b8' }}>Linked settlements</div><div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{execReview.linked.settlements.length}</div></div>
                      <div style={{ background: '#0f172a', padding: 10, borderRadius: 6 }}><div style={{ fontSize: 11, color: '#94a3b8' }}>Settled P&L (linked)</div><div style={{ fontSize: 20, fontWeight: 700, color: execReview.summary.settledPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSignedCents(execReview.summary.settledPnlCents)}</div></div>
                    </div>
                    {execReview.summary.totalLinkedRecords === 0 && (
                      <p style={{ marginTop: 12, fontSize: 12, color: '#fbbf24' }}>
                        No records have been linked to this pilot yet. Monitoring is currently <strong>inferred</strong> from paper-portfolio filters. Use the form below to link a candidate / order / paper record by id.
                      </p>
                    )}
                  </div>

                  <div style={card}>
                    <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Link a record to this pilot</h4>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select value={linkInput.recordType} onChange={e => setLinkInput({ ...linkInput, recordType: e.target.value })} style={inputStyle}>
                        <option value="candidate">candidate</option>
                        <option value="demo_order">demo_order</option>
                        <option value="live_order">live_order</option>
                        <option value="paper_record">paper_record</option>
                      </select>
                      <input value={linkInput.recordId} onChange={e => setLinkInput({ ...linkInput, recordId: e.target.value })} placeholder="record id" style={{ ...inputStyle, minWidth: 320 }} />
                      <button
                        onClick={async () => {
                          if (!linkInput.recordId.trim()) { setToast('record id required'); setTimeout(() => setToast(null), 2500); return; }
                          await postAction('link-record-to-pilot', { pilotId: selectedId, recordType: linkInput.recordType, recordId: linkInput.recordId.trim() });
                          await loadExecReview(selectedId);
                          setLinkInput({ recordType: linkInput.recordType, recordId: '' });
                        }}
                        disabled={!!busy}
                        style={btn('#22c55e')}
                      >Link</button>
                    </div>
                    <p style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
                      Server-side validation: live orders require <code>pilot.mode='live_pilot'</code>; demo orders are blocked from live pilots; completed/cancelled pilots refuse new links.
                    </p>
                  </div>

                  {[
                    { title: 'Linked candidates', key: 'candidates' as const, rt: 'candidate' as const, columns: ['id', 'title', 'side', 'edge', 'state'] },
                    { title: 'Linked demo orders', key: 'demoOrders' as const, rt: 'demo_order' as const, columns: ['id', 'ticker', 'side', 'price', 'status'] },
                    { title: 'Linked live orders', key: 'liveOrders' as const, rt: 'live_order' as const, columns: ['id', 'ticker', 'side', 'price', 'status'] },
                    { title: 'Linked paper records', key: 'paperRecords' as const, rt: 'paper_record' as const, columns: ['id', 'title', 'side', 'cappedStakeCents', 'status'] },
                  ].map(group => {
                    const rows: any[] = (execReview.linked as any)[group.key] ?? [];
                    return (
                      <div key={group.key} style={card}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>{group.title} ({rows.length})</h4>
                        {rows.length === 0
                          ? <div style={{ color: '#64748b', fontSize: 12 }}>No linked {group.key}.</div>
                          : (
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead><tr>{group.columns.map(c => <th key={c} style={th}>{c}</th>)}<th style={th}></th></tr></thead>
                                <tbody>
                                  {rows.map((r: any) => (
                                    <tr key={r.id}>
                                      {group.columns.map(c => (
                                        <td key={c} style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: c === 'id' ? 'monospace' : undefined, fontSize: c === 'id' ? 11 : 13 }} title={String(r[c] ?? '')}>
                                          {c === 'cappedStakeCents' ? fmtCents(r[c]) : (r[c] ?? '—')}
                                        </td>
                                      ))}
                                      <td style={td}>
                                        <button
                                          onClick={async () => {
                                            await postAction('unlink-record-from-pilot', { recordType: group.rt, recordId: r.id });
                                            await loadExecReview(selectedId);
                                          }}
                                          disabled={!!busy}
                                          style={{ ...btn('#475569'), fontSize: 11, padding: '4px 10px' }}
                                        >Unlink</button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                      </div>
                    );
                  })}

                  <div style={card}>
                    <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Linked settlements ({execReview.linked.settlements.length})</h4>
                    {execReview.linked.settlements.length === 0
                      ? <div style={{ color: '#64748b', fontSize: 12 }}>None — settlements appear here when a linked demo/live order resolves.</div>
                      : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead><tr><th style={th}>Order id</th><th style={th}>Net P&L</th></tr></thead>
                          <tbody>
                            {execReview.linked.settlements.map((s: any) => (
                              <tr key={s.id ?? s.orderId}>
                                <td style={{ ...td, fontSize: 11, fontFamily: 'monospace' }}>{s.orderId}</td>
                                <td style={{ ...td, color: (s.netPnlCents ?? 0) >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{fmtSignedCents(s.netPnlCents)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'results' && (
        <div style={card}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Completed pilots</h4>
          {(() => {
            const completed = pilots.filter(p => p.status === 'completed' || p.status === 'cancelled');
            if (completed.length === 0) return <div style={{ color: '#64748b', fontSize: 13 }}>No completed pilots yet.</div>;
            return (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>Strategy</th><th style={th}>Status</th><th style={th}>Mode</th><th style={th}>Window</th><th style={th}>Max capital</th><th style={th}>Created</th>
                </tr></thead>
                <tbody>
                  {completed.map((p: any) => (
                    <tr key={p.id}>
                      <td style={td}>{p.strategyName}</td>
                      <td style={td}><span style={badge(statusColor[p.status])}>{p.status}</span></td>
                      <td style={td}><span style={badge(modeColor[p.mode])}>{p.mode.replace('_', ' ')}</span></td>
                      <td style={td}>{p.startDate ?? '—'} → {p.endDate ?? '—'}</td>
                      <td style={td}>{fmtCents(p.maxCapitalCents)}</td>
                      <td style={td}>{new Date(p.createdAt).toLocaleString()}</td>
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
            <li>Pilot lifecycle: <strong>draft → scheduled → active</strong>, with paused/completed/cancelled branches. Every transition is manual and audit-logged.</li>
            <li>Mode-vs-status guard: <code>live_pilot</code> requires <code>strategy.status === 'pilot_ready'</code>; <code>demo</code> and <code>paper</code> require <code>paper_approved</code> or <code>pilot_ready</code>.</li>
            <li>Activation re-checks the strategy status at transition time — a strategy demoted between scheduling and activation will block pilot activation with <code>mode_status_mismatch</code>.</li>
            <li>Monitoring metrics derive from the Step 80 paper portfolio filtered to records that match the pilot's start/end window and allowed sources/metrics. v1 caveat: orders are not currently tagged with a pilot id, so live_pilot/demo monitoring is directional rather than authoritative until that linkage exists.</li>
            <li>Limit checks: maxCapital, maxDailyLoss, maxOpenPositions, maxSingleTrade. Warning levels: <strong>healthy</strong> (all utilisation &lt; 80%), <strong>watch</strong> (any utilisation 80–99%), <strong>breach</strong> (any limit ≥ 100%).</li>
            <li>Storage: Redis. <code>pilot:{'{id}'}</code> with sorted-set <code>pilots:all</code>. Auto-trim oldest beyond 200 pilots.</li>
            <li>30s cache on monitoring summaries (per-pilot key).</li>
            <li><strong>Safety:</strong> no autonomous trading, no order submission, no execution candidate auto-creation, no live execution changes. Pilot state never activates trading automatically — orders remain a manual operator action.</li>
          </ul>
        </div>
      )}

      {creating && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setCreating(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1e293b', borderRadius: 10, padding: 22, width: 520, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Create pilot</h3>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 12px' }}>
              {form.strategyName ? <>For strategy <strong>{form.strategyName}</strong> <code style={{ color: '#64748b' }}>({form.strategyId})</code></> : 'Create from Strategy Registry to prefill strategy.'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Mode">
                <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} style={{ ...inputStyle, width: '100%' }}>
                  <option value="paper">paper</option>
                  <option value="demo">demo</option>
                  <option value="live_pilot">live_pilot</option>
                </select>
              </Field>
              <Field label="Strategy ID">
                <input value={form.strategyId} onChange={e => setForm({ ...form, strategyId: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
              </Field>
              <Field label="Start date"><input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} style={{ ...inputStyle, width: '100%' }} /></Field>
              <Field label="End date"><input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} style={{ ...inputStyle, width: '100%' }} /></Field>
              <Field label="Max capital ($)"><input value={form.maxCapital} onChange={e => setForm({ ...form, maxCapital: e.target.value })} style={{ ...inputStyle, width: '100%' }} /></Field>
              <Field label="Max daily loss ($)"><input value={form.maxDailyLoss} onChange={e => setForm({ ...form, maxDailyLoss: e.target.value })} style={{ ...inputStyle, width: '100%' }} /></Field>
              <Field label="Max open positions"><input value={form.maxOpenPositions} onChange={e => setForm({ ...form, maxOpenPositions: e.target.value })} style={{ ...inputStyle, width: '100%' }} /></Field>
              <Field label="Max single trade ($)"><input value={form.maxSingleTrade} onChange={e => setForm({ ...form, maxSingleTrade: e.target.value })} style={{ ...inputStyle, width: '100%' }} /></Field>
              <Field label="Allowed sources (comma)"><input value={form.allowedSources} onChange={e => setForm({ ...form, allowedSources: e.target.value })} placeholder="kalshi, sportsbook" style={{ ...inputStyle, width: '100%' }} /></Field>
              <Field label="Allowed metrics (comma)"><input value={form.allowedMetrics} onChange={e => setForm({ ...form, allowedMetrics: e.target.value })} placeholder="high_temp, actual_wind" style={{ ...inputStyle, width: '100%' }} /></Field>
            </div>
            <Field label="Notes (optional)">
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setCreating(false)} disabled={!!busy} style={btn('#475569')}>Cancel</button>
              <button onClick={submitCreate} disabled={!!busy} style={btn('#22c55e')}>Create pilot in draft</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '10px 16px', borderRadius: 6, fontSize: 13, maxWidth: 480 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
