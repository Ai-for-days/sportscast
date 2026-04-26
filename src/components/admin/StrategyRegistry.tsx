import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, EmptyChart } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });
const inputStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 };

const statusColor: Record<string, string> = {
  draft: '#64748b',
  research: '#3b82f6',
  watchlist: '#8b5cf6',
  paper_approved: '#06b6d4',
  pilot_ready: '#22c55e',
  paused: '#f59e0b',
  retired: '#475569',
};
const verdictColor: Record<string, string> = {
  not_ready: '#ef4444', watch: '#f59e0b', promotion_candidate: '#3b82f6', ready_for_pilot: '#22c55e',
};
const promoStatusColor: Record<string, string> = {
  pending: '#f59e0b', approved: '#22c55e', rejected: '#ef4444',
};

type Tab = 'registry' | 'promotions' | 'detail' | 'history' | 'methodology';

export default function StrategyRegistry() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('registry');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [promoteForm, setPromoteForm] = useState<{ strategyId: string; requestedStatus: string; notes: string } | null>(null);

  useEffect(() => { reload(); }, []);
  async function reload() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/system/strategy-registry?action=list', { credentials: 'include' });
      const j = await res.json();
      setData(j);
    } catch { setData({ error: 'Failed to load' }); }
    setLoading(false);
  }

  // Read prefill from URL (Step 81 -> Step 82 handoff via ?prefill=...)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get('prefill');
    if (prefill) {
      try {
        const obj = JSON.parse(decodeURIComponent(prefill));
        setCreating(true);
        setForm({ name: obj.name ?? '', description: obj.description ?? '' });
        // attach filters + sourceVariantId for the create call below via window state
        (window as any).__strategyPrefill = obj;
      } catch { /* ignore */ }
    }
  }, []);

  async function postAction(action: string, body: any = {}) {
    setBusy(action);
    try {
      const res = await fetch('/api/admin/system/strategy-registry', {
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
    setTimeout(() => setToast(null), 3500);
  }

  async function submitCreate() {
    if (!form.name.trim()) {
      setToast('Name is required');
      setTimeout(() => setToast(null), 2000);
      return;
    }
    const prefill = typeof window !== 'undefined' ? (window as any).__strategyPrefill : null;
    await postAction('create-strategy', {
      name: form.name,
      description: form.description,
      sourceVariantId: prefill?.sourceVariantId,
      filters: prefill?.filters,
      latestVerdict: prefill?.latestVerdict,
      latestMetrics: prefill?.latestMetrics,
      initialStatus: 'research',
    });
    setCreating(false);
    setForm({ name: '', description: '' });
    if (typeof window !== 'undefined') (window as any).__strategyPrefill = null;
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading registry…</div>;
  if (!data || data.error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {data?.error || 'unknown'}</div>;

  const strategies: any[] = data.strategies ?? [];
  const promotions: any[] = data.promotions ?? [];
  const statusDist: any[] = data.statusDistribution ?? [];
  const selectedStrategy = strategies.find(s => s.id === selected) ?? null;
  const selectedPromos = promotions.filter(p => p.strategyId === selected);

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/strategy-registry" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Strategy Registry</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 760 }}>
            Formal strategy lifecycle: draft → research → watchlist → paper_approved → pilot_ready, plus paused / retired.
            Every transition is manual and audit-logged. <strong>No autonomous trading. No automatic promotion.</strong>
          </p>
        </div>
        <button onClick={() => setCreating(true)} disabled={!!busy} style={btn('#22c55e')}>+ New strategy</button>
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['registry', `Registry (${strategies.length})`],
          ['promotions', `Promotion Requests (${promotions.filter((p: any) => p.status === 'pending').length})`],
          ['detail', selectedStrategy ? `Strategy Detail · ${selectedStrategy.name}` : 'Strategy Detail'],
          ['history', 'Lifecycle History'],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }} disabled={t === 'detail' && !selectedStrategy}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'registry' && (
        <div>
          {/* Status distribution */}
          <div style={card}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Status distribution</h4>
            {strategies.length === 0
              ? <EmptyChart title="No strategies" message="Click + New strategy or come from /admin/system/strategy-comparison." />
              : <BarChart valueFormatter={v => `${v}`} data={statusDist.map((d: any) => ({ label: d.status.replace(/_/g, ' '), value: d.count, color: statusColor[d.status] ?? '#64748b' }))} />}
          </div>

          {strategies.length > 0 && (
            <div style={card}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Strategy</th>
                      <th style={th}>Status</th>
                      <th style={th}>Source variant</th>
                      <th style={th}>Latest verdict</th>
                      <th style={th}>ROI</th>
                      <th style={th}>Drawdown</th>
                      <th style={th}>Sample</th>
                      <th style={th}>Updated</th>
                      <th style={th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategies.map((s: any) => (
                      <tr key={s.id}>
                        <td style={td}>
                          <button onClick={() => { setSelected(s.id); setTab('detail'); }} style={{ background: 'none', border: 'none', color: '#a5b4fc', cursor: 'pointer', padding: 0, fontWeight: 700, textAlign: 'left' }}>
                            {s.name}
                          </button>
                          <div style={{ fontSize: 11, color: '#64748b' }}>{s.id}</div>
                        </td>
                        <td style={td}><span style={badge(statusColor[s.status] ?? '#64748b')}>{s.status.replace(/_/g, ' ')}</span></td>
                        <td style={td}>{s.sourceVariantId ?? '—'}</td>
                        <td style={td}>{s.latestVerdict ? <span style={badge(verdictColor[s.latestVerdict] ?? '#64748b')}>{s.latestVerdict.replace(/_/g, ' ')}</span> : '—'}</td>
                        <td style={td}>{s.latestMetrics?.roiPct != null ? `${s.latestMetrics.roiPct >= 0 ? '+' : ''}${s.latestMetrics.roiPct.toFixed(1)}%` : '—'}</td>
                        <td style={td}>{s.latestMetrics?.maxDrawdownCents != null ? `$${(s.latestMetrics.maxDrawdownCents / 100).toFixed(2)}` : '—'}</td>
                        <td style={td}>{s.latestMetrics?.settled ?? '—'}</td>
                        <td style={td}>{new Date(s.updatedAt).toLocaleString()}</td>
                        <td style={td}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button onClick={() => { setSelected(s.id); setTab('detail'); }} style={btn('#6366f1')}>Open</button>
                            {(s.status === 'paper_approved' || s.status === 'pilot_ready') && (
                              <a
                                href={`/admin/system/strategy-pilot?prefill=${encodeURIComponent(JSON.stringify({
                                  strategyId: s.id,
                                  strategyName: s.name,
                                  mode: s.status === 'pilot_ready' ? 'demo' : 'paper',
                                }))}`}
                                style={{ ...btn('#06b6d4'), textDecoration: 'none', display: 'inline-block' }}
                                title="Create a pilot for this approved strategy"
                              >
                                + Pilot
                              </a>
                            )}
                            {s.status !== 'retired' && <button onClick={() => postAction('retire-strategy', { id: s.id })} disabled={!!busy} style={btn('#475569')}>Retire</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'promotions' && (
        <div style={card}>
          {promotions.length === 0
            ? <div style={{ padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No promotion requests yet.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Strategy</th>
                    <th style={th}>From → To</th>
                    <th style={th}>Verdict</th>
                    <th style={th}>Requested by</th>
                    <th style={th}>Status</th>
                    <th style={th}>Decided by</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.map((p: any) => {
                    const s = strategies.find(x => x.id === p.strategyId);
                    return (
                      <tr key={p.id}>
                        <td style={td}>{new Date(p.createdAt).toLocaleString()}</td>
                        <td style={td}>{s?.name ?? p.strategyId}</td>
                        <td style={td}>{p.fromStatus.replace(/_/g, ' ')} → <strong>{p.requestedStatus.replace(/_/g, ' ')}</strong></td>
                        <td style={td}><span style={badge(verdictColor[p.readinessVerdict] ?? '#64748b')}>{p.readinessVerdict.replace(/_/g, ' ')}</span></td>
                        <td style={td}>{p.requestedBy}</td>
                        <td style={td}><span style={badge(promoStatusColor[p.status] ?? '#64748b')}>{p.status}</span></td>
                        <td style={td}>{p.approvedBy ?? '—'}</td>
                        <td style={td}>
                          {p.status === 'pending' && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => postAction('approve-promotion', { id: p.id })} disabled={!!busy} style={btn('#22c55e')}>Approve</button>
                              <button onClick={() => postAction('reject-promotion', { id: p.id })} disabled={!!busy} style={btn('#ef4444')}>Reject</button>
                            </div>
                          )}
                          {p.status === 'approved' && (
                            <button
                              onClick={() => postAction('transition-status', { id: p.strategyId, toStatus: p.requestedStatus, promotionSnapshotId: p.id, reason: 'promotion approved' })}
                              disabled={!!busy}
                              style={btn('#6366f1')}
                              title="Apply this approved snapshot to advance the strategy"
                            >Apply transition</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      )}

      {tab === 'detail' && selectedStrategy && (
        <div>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>{selectedStrategy.name}</h3>
                <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>{selectedStrategy.description || 'No description.'}</p>
              </div>
              <span style={badge(statusColor[selectedStrategy.status] ?? '#64748b')}>{selectedStrategy.status.replace(/_/g, ' ')}</span>
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12, color: '#94a3b8' }}>Quick transitions:</strong>
              {['research', 'watchlist', 'paused'].map(s => (
                <button key={s} onClick={() => postAction('transition-status', { id: selectedStrategy.id, toStatus: s })} disabled={!!busy} style={btn('#475569')}>
                  → {s}
                </button>
              ))}
              <button onClick={() => setPromoteForm({ strategyId: selectedStrategy.id, requestedStatus: 'paper_approved', notes: '' })} disabled={!!busy} style={btn('#06b6d4')}>
                Request promotion → paper_approved
              </button>
              <button onClick={() => setPromoteForm({ strategyId: selectedStrategy.id, requestedStatus: 'pilot_ready', notes: '' })} disabled={!!busy} style={btn('#22c55e')}>
                Request promotion → pilot_ready
              </button>
            </div>
          </div>

          <div style={card}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Filters</h4>
            <pre style={{ margin: 0, fontSize: 12, color: '#cbd5e1', background: '#0f172a', padding: 10, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(selectedStrategy.filters, null, 2)}</pre>
          </div>

          <div style={card}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Promotion criteria</h4>
            <pre style={{ margin: 0, fontSize: 12, color: '#cbd5e1', background: '#0f172a', padding: 10, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(selectedStrategy.promotionCriteria, null, 2)}</pre>
          </div>

          {selectedPromos.length > 0 && (
            <div style={card}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Promotion requests for this strategy</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>When</th><th style={th}>From → To</th><th style={th}>Verdict</th><th style={th}>Requested by</th><th style={th}>Status</th>
                </tr></thead>
                <tbody>
                  {selectedPromos.map((p: any) => (
                    <tr key={p.id}>
                      <td style={td}>{new Date(p.createdAt).toLocaleString()}</td>
                      <td style={td}>{p.fromStatus.replace(/_/g, ' ')} → {p.requestedStatus.replace(/_/g, ' ')}</td>
                      <td style={td}><span style={badge(verdictColor[p.readinessVerdict] ?? '#64748b')}>{p.readinessVerdict.replace(/_/g, ' ')}</span></td>
                      <td style={td}>{p.requestedBy}</td>
                      <td style={td}><span style={badge(promoStatusColor[p.status] ?? '#64748b')}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedStrategy.notes && selectedStrategy.notes.length > 0 && (
            <div style={card}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Notes</h4>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
                {selectedStrategy.notes.map((n: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{n}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div style={card}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Lifecycle history (most recent first, all strategies)</h4>
          {(() => {
            const all: any[] = [];
            for (const s of strategies) {
              for (const h of (s.history ?? [])) {
                all.push({ ...h, strategyName: s.name, strategyId: s.id });
              }
            }
            all.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
            if (all.length === 0) return <div style={{ color: '#64748b', fontSize: 13 }}>No transitions recorded yet.</div>;
            return (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>When</th>
                  <th style={th}>Strategy</th>
                  <th style={th}>Actor</th>
                  <th style={th}>From → To</th>
                  <th style={th}>Reason</th>
                  <th style={th}>Snapshot</th>
                </tr></thead>
                <tbody>
                  {all.slice(0, 200).map((h: any, i: number) => (
                    <tr key={i}>
                      <td style={td}>{new Date(h.at).toLocaleString()}</td>
                      <td style={td}>{h.strategyName}</td>
                      <td style={td}>{h.actor}</td>
                      <td style={td}>{h.fromStatus.replace(/_/g, ' ')} → <strong>{h.toStatus.replace(/_/g, ' ')}</strong></td>
                      <td style={td}>{h.reason ?? '—'}</td>
                      <td style={{ ...td, fontSize: 10, color: '#64748b' }}>{h.promotionSnapshotId ?? ''}</td>
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
            <li>Strategies move through 7 statuses: <strong>draft → research → watchlist → paper_approved → pilot_ready</strong>, plus <strong>paused</strong> and <strong>retired</strong>.</li>
            <li>Every transition is manual and audit-logged via <code>logAuditEvent</code>. No status change is ever automatic.</li>
            <li>Promotion to <strong>paper_approved</strong> or <strong>pilot_ready</strong> requires an approved promotion snapshot.</li>
            <li>Promotion snapshots are created from <a href="/admin/system/strategy-comparison" style={{ color: '#a5b4fc' }}>Strategy Comparison</a> output and capture the metrics + readiness verdict at request time.</li>
            <li>Approval rule: the requester cannot self-approve. A different operator must approve. (Single-operator deployments will need to log out / re-bind to a different operator id.)</li>
            <li>Storage: Redis. <code>strategy:{'{id}'}</code>, sorted-set <code>strategies:all</code>; <code>strategy:promo:{'{id}'}</code>, sorted-set <code>strategies:promotions:all</code>. Auto-trim oldest beyond capacity.</li>
            <li>Lifecycle history is stored inline on each strategy record (last 50 transitions). Lifecycle History tab aggregates across all strategies, newest first.</li>
            <li><strong>Safety:</strong> no autonomous trading, no order submission, no candidate auto-creation, no live execution changes, no automatic promotion. Manual governance only.</li>
          </ul>
        </div>
      )}

      {/* Create-strategy modal */}
      {creating && (
        <Modal title="Create strategy" onClose={() => setCreating(false)} actions={
          <>
            <button onClick={() => setCreating(false)} disabled={!!busy} style={btn('#475569')}>Cancel</button>
            <button onClick={submitCreate} disabled={!!busy} style={btn('#22c55e')}>Create in research</button>
          </>
        }>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Name</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: 10 }} />
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Description</label>
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
          {typeof window !== 'undefined' && (window as any).__strategyPrefill && (
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
              Prefilled from variant <code>{(window as any).__strategyPrefill.sourceVariantId}</code> with filters and latest metrics from Strategy Comparison.
            </p>
          )}
        </Modal>
      )}

      {/* Request-promotion modal */}
      {promoteForm && (
        <Modal title={`Request promotion → ${promoteForm.requestedStatus}`} onClose={() => setPromoteForm(null)} actions={
          <>
            <button onClick={() => setPromoteForm(null)} disabled={!!busy} style={btn('#475569')}>Cancel</button>
            <button onClick={async () => {
              const s = strategies.find(x => x.id === promoteForm.strategyId);
              await postAction('request-promotion', {
                id: promoteForm.strategyId,
                requestedStatus: promoteForm.requestedStatus,
                variantId: s?.sourceVariantId,
                metricsSnapshot: s?.latestMetrics ?? {},
                readinessVerdict: s?.latestVerdict ?? 'unknown',
                reasons: ['Operator-requested via Strategy Registry'],
                notes: promoteForm.notes,
              });
              setPromoteForm(null);
            }} disabled={!!busy} style={btn('#06b6d4')}>Submit request</button>
          </>
        }>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
            Snapshot will capture the strategy's currently stored latestMetrics + latestVerdict. If those are stale, refresh from Strategy Comparison first.
          </p>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Notes (optional)</label>
          <textarea value={promoteForm.notes} onChange={e => setPromoteForm({ ...promoteForm, notes: e.target.value })} rows={3} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
        </Modal>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '10px 16px', borderRadius: 6, fontSize: 13, maxWidth: 480 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Modal({ title, children, onClose, actions }: { title: string; children: React.ReactNode; onClose: () => void; actions: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1e293b', borderRadius: 10, padding: 22, width: 460, maxWidth: '95vw', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>{title}</h3>
        <div>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          {actions}
        </div>
      </div>
    </div>
  );
}
