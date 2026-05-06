import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const statusColor: Record<string, string> = { graded: '#22c55e', void: '#64748b', open: '#3b82f6', locked: '#f59e0b' };
const kindColor: Record<string, string> = { odds: '#06b6d4', 'over-under': '#a855f7', pointspread: '#22c55e' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)',
  color: '#fff', padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

function fmtUsd(cents: number, signed = false): string {
  const sign = cents < 0 ? '-' : (signed && cents > 0 ? '+' : '');
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

type Tab = 'graded' | 'detail' | 'warnings' | 'ledger' | 'methodology';

export default function WagerSettlementPreview() {
  const [tab, setTab] = useState<Tab>('graded');
  const [graded, setGraded] = useState<any[]>([]);
  const [previews, setPreviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedWagerId, setSelectedWagerId] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<any>(null);

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/wager-settlement-preview?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/wager-settlement-preview', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }

  async function reload() {
    setLoading(true); setError(null);
    try {
      const [g, p] = await Promise.all([get('list-graded'), get('list')]);
      setGraded(g.wagers ?? []);
      setPreviews(p.previews ?? []);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function generate(wagerId: string) {
    setBusy(`gen-${wagerId}`); setError(null);
    try {
      const j = await post({ action: 'generate', wagerId });
      setActivePreview(j.preview);
      setSelectedWagerId(wagerId);
      setTab('detail');
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function loadLatest(wagerId: string) {
    setBusy(`load-${wagerId}`); setError(null);
    try {
      const j = await get('get-by-wager', { wagerId });
      setActivePreview(j.preview);
      setSelectedWagerId(wagerId);
      setTab('detail');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function openPreview(id: string) {
    setBusy(`open-${id}`); setError(null);
    try {
      const j = await get('get', { id });
      setActivePreview(j.preview);
      setSelectedWagerId(j.preview?.wagerId ?? null);
      setTab('detail');
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  const totals = useMemo(() => {
    let exposure = 0, payout = 0, net = 0, pushes = 0, warnings = 0;
    for (const p of previews) {
      exposure += p.estimatedGrossExposure || 0;
      payout += p.payoutEstimate || 0;
      net += p.estimatedNetHouseResult || 0;
      pushes += p.betCounts?.pushes || 0;
      warnings += (p.liabilityWarnings ?? []).length;
    }
    return { count: previews.length, exposure, payout, net, pushes, warnings };
  }, [previews]);

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading settlement preview…</div>;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/wager-settlement-preview" /></div>

      <div style={BANNER}>
        <span>🛡️ Settlement Preview is <strong>read-only</strong>. It does not move money, update balances, or pay users.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Audit-logged · Preview only</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Settlement Preview & Liability Center</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Projects payout / liability impact for graded and voided wagers using existing bet records. The numbers are advisory — no
            balance updates, no payouts marked paid, no payment-rail calls. Use to sanity-check house exposure before any manual settlement.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/wager-resolution" style={btn('#0ea5e9')}>Resolution Center →</a>
          <button type="button" onClick={reload} disabled={!!busy} style={btn('#6366f1')}
            title="Refresh graded-wager list and preview ledger">Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Graded / void wagers" value={graded.length} />
          <Stat label="Previews on file"     value={totals.count} />
          <Stat label="Total gross exposure" value={fmtUsd(totals.exposure)} color="#a855f7" />
          <Stat label="Total projected payouts" value={fmtUsd(totals.payout)} color="#f59e0b" />
          <Stat label="Total net house result"  value={fmtUsd(totals.net, true)} color={totals.net >= 0 ? '#22c55e' : '#ef4444'} />
          <Stat label="Liability warnings"      value={totals.warnings}        color={totals.warnings > 0 ? '#f59e0b' : '#94a3b8'} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['graded',      `Graded Wagers (${graded.length})`],
          ['detail',      activePreview ? `Preview · ${activePreview.wagerTicketNumber ?? activePreview.wagerId.slice(0, 10)}` : 'Preview Detail'],
          ['warnings',    `Liability Warnings (${totals.warnings})`],
          ['ledger',      `Preview Ledger (${totals.count})`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'graded' && (
        <GradedView wagers={graded} generate={generate} loadLatest={loadLatest} busy={busy} />
      )}
      {tab === 'detail' && (
        <DetailView preview={activePreview} />
      )}
      {tab === 'warnings' && (
        <WarningsView previews={previews} openPreview={openPreview} />
      )}
      {tab === 'ledger' && (
        <LedgerView previews={previews} openPreview={openPreview} />
      )}
      {tab === 'methodology' && <MethodologyView />}
    </div>
  );
}

// ── Graded Wagers tab ────────────────────────────────────────────────────────

function GradedView({ wagers, generate, loadLatest, busy }: any) {
  if (!wagers || wagers.length === 0) {
    return (
      <div style={{ ...card, color: '#94a3b8' }}>
        No graded or voided wagers yet. Grade a wager from <a href="/admin/system/wager-resolution" style={{ color: '#6366f1' }}>Wager Resolution</a> to enable settlement previews.
      </div>
    );
  }
  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Ticket</th><th style={th}>Title</th><th style={th}>Kind</th>
              <th style={th}>Status</th><th style={th}>Winning outcome</th><th style={th}>Target date</th>
              <th style={th}>Has preview</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {wagers.map((w: any) => (
              <tr key={w.id}>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{w.ticketNumber}</td>
                <td style={td}>{w.title}</td>
                <td style={td}><span style={badge(kindColor[w.kind] ?? '#64748b')}>{w.kind}</span></td>
                <td style={td}>
                  <span style={badge(statusColor[w.status] ?? '#64748b')}>{w.status}</span>
                  {w.voidReason && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>({w.voidReason})</span>}
                </td>
                <td style={td}>{w.winningOutcome ?? <span style={{ color: '#94a3b8' }}>—</span>}</td>
                <td style={td}>{w.targetDate}</td>
                <td style={td}>{w.hasPreview ? <span style={{ color: '#22c55e' }}>✓</span> : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => generate(w.id)} disabled={!!busy}
                    style={{ ...btn('#6366f1'), padding: '4px 10px', marginRight: 6 }}
                    title="Recompute the settlement preview from current bet records. Read-only.">
                    {busy === `gen-${w.id}` ? 'Generating…' : 'Generate preview'}
                  </button>
                  {w.hasPreview && (
                    <button type="button" onClick={() => loadLatest(w.id)} disabled={!!busy}
                      style={{ ...btn('#475569'), padding: '4px 10px' }}
                      title="Open the latest existing preview for this wager (no new compute).">
                      View latest
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
        "Generate preview" runs a fresh projection from current bet records and audit-logs the action. It never writes to the wager, bets, or balances.
      </div>
    </div>
  );
}

// ── Preview Detail tab ───────────────────────────────────────────────────────

function DetailView({ preview }: { preview: any }) {
  if (!preview) {
    return (
      <div style={{ ...card, color: '#94a3b8' }}>
        Pick a wager from the <strong>Graded Wagers</strong> tab and click <strong>Generate preview</strong> or <strong>View latest</strong>.
      </div>
    );
  }
  const p = preview;
  const netColor = p.estimatedNetHouseResult >= 0 ? '#22c55e' : '#ef4444';

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{p.wagerTicketNumber ?? p.wagerId.slice(0, 12)}</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={badge(kindColor[p.wagerKind] ?? '#64748b')}>{p.wagerKind}</span>
            <span style={badge('#475569')}>preview only</span>
            {p.winningOutcome && <span style={badge(statusColor.graded)}>winner: {p.winningOutcome}</span>}
          </div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          <Field label="Wager id" value={p.wagerId} mono />
          <Field label="Preview id" value={p.id} mono />
          <Field label="Generated" value={`${new Date(p.generatedAt).toLocaleString()} · ${p.generatedBy}`} />
          <Field label="Metric" value={p.metric} />
          <Field label="Target date" value={p.targetDate} />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Liability projection</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <Stat label="Gross exposure"  value={fmtUsd(p.estimatedGrossExposure)} color="#a855f7" />
          <Stat label="Payout estimate" value={fmtUsd(p.payoutEstimate)}         color="#f59e0b" />
          <Stat label="Push refund"     value={fmtUsd(p.pushRefund)}              color="#94a3b8" />
          <Stat label="Winning stake"   value={fmtUsd(p.estimatedWinningStake)} />
          <Stat label="Losing stake"    value={fmtUsd(p.estimatedLosingStake)} />
          <Stat label="Net house result" value={fmtUsd(p.estimatedNetHouseResult, true)} color={netColor} />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Bet counts</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          <Stat label="Total"   value={p.betCounts?.total ?? 0} />
          <Stat label="Winners" value={p.betCounts?.winners ?? 0} color="#22c55e" />
          <Stat label="Losers"  value={p.betCounts?.losers ?? 0}  color="#ef4444" />
          <Stat label="Pushes"  value={p.betCounts?.pushes ?? 0}  color="#94a3b8" />
          <Stat label="Voided"  value={p.betCounts?.voided ?? 0}  color="#64748b" />
        </div>
      </div>

      {(p.topUsers ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top stakeholders</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>User</th><th style={th}>Stake</th><th style={th}>% of gross</th><th style={th}>Potential payout</th></tr></thead>
            <tbody>
              {p.topUsers.map((u: any) => (
                <tr key={u.userId}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{u.userId}</td>
                  <td style={td}>{fmtUsd(u.stakeCents)}</td>
                  <td style={td}>{u.pctOfGross.toFixed(1)}%</td>
                  <td style={td}>{fmtUsd(u.potentialPayoutCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(p.liabilityWarnings ?? []).length > 0 && (
        <div style={{ ...card, background: '#3f1d1d', borderLeft: '3px solid #ef4444' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>Liability warnings ({p.liabilityWarnings.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {p.liabilityWarnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {(p.notes ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Notes</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
            {p.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

// ── Warnings tab ─────────────────────────────────────────────────────────────

function WarningsView({ previews, openPreview }: { previews: any[]; openPreview: (id: string) => void }) {
  const flagged = (previews ?? []).filter(p => (p.liabilityWarnings ?? []).length > 0);
  if (flagged.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No previews carry liability warnings.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {flagged.map(p => (
        <div key={p.id} style={{ ...card, borderLeft: '3px solid #ef4444', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={badge(kindColor[p.wagerKind] ?? '#64748b')}>{p.wagerKind}</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>{p.wagerTicketNumber ?? p.wagerId.slice(0, 12)}</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>· generated {new Date(p.generatedAt).toLocaleString()} by {p.generatedBy}</span>
            </div>
            <button type="button" onClick={() => openPreview(p.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {p.liabilityWarnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Ledger tab ───────────────────────────────────────────────────────────────

function LedgerView({ previews, openPreview }: { previews: any[]; openPreview: (id: string) => void }) {
  if (!previews || previews.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No previews generated yet.</div>;
  }
  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Generated</th><th style={th}>Wager</th><th style={th}>Kind</th><th style={th}>Winner</th>
              <th style={th}>Bets</th><th style={th}>Gross exposure</th><th style={th}>Payout est.</th>
              <th style={th}>Net house</th><th style={th}>Warnings</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {previews.map((p: any) => (
              <tr key={p.id}>
                <td style={td}>{new Date(p.generatedAt).toLocaleString()}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{p.wagerTicketNumber ?? p.wagerId.slice(0, 12)}</td>
                <td style={td}><span style={badge(kindColor[p.wagerKind] ?? '#64748b')}>{p.wagerKind}</span></td>
                <td style={td}>{p.winningOutcome ?? <span style={{ color: '#94a3b8' }}>—</span>}</td>
                <td style={td}>{p.betCounts?.total ?? 0}</td>
                <td style={td}>{fmtUsd(p.estimatedGrossExposure)}</td>
                <td style={td}>{fmtUsd(p.payoutEstimate)}</td>
                <td style={{ ...td, color: p.estimatedNetHouseResult >= 0 ? '#22c55e' : '#ef4444' }}>{fmtUsd(p.estimatedNetHouseResult, true)}</td>
                <td style={td}>{(p.liabilityWarnings ?? []).length}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => openPreview(p.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Methodology tab ──────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>How a preview is computed</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Pull bet records via <code>getWagerBets(wagerId)</code> — read-only.</li>
          <li>Categorise each non-void bet:
            <ul style={{ paddingLeft: 18, marginTop: 4 }}>
              <li>Wager status <code>void</code> ⇒ every non-void bet is a <strong>push</strong> (refund stake).</li>
              <li>Wager status <code>graded</code> with no <code>winningOutcome</code> ⇒ defensive push (warns).</li>
              <li>Otherwise: bet is a <strong>winner</strong> if <code>bet.outcomeLabel === wager.winningOutcome</code>, else a <strong>loser</strong>.</li>
            </ul>
          </li>
          <li>Sum stakes and potential payouts:
            <ul style={{ paddingLeft: 18, marginTop: 4 }}>
              <li><code>winnerStake</code>, <code>loserStake</code>, <code>pushStake</code> → from <code>bet.amountCents</code>.</li>
              <li><code>payoutEstimate</code> = sum of <code>potentialPayoutCents</code> for winners (full payout, includes original stake).</li>
              <li><code>grossExposure</code> = <code>payoutEstimate + pushStake</code>.</li>
              <li><code>netHouseResult</code> = <code>winnerStake + loserStake + pushStake − payoutEstimate − pushStake</code> = <code>totalStake − payoutEstimate − pushStake</code>.</li>
            </ul>
          </li>
          <li>Per-user concentration is computed across non-void bets; top 5 stakeholders are surfaced.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Liability warnings</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>No participant stake data — bet records empty.</li>
          <li>Wager voided — every non-void bet refunds.</li>
          <li>High gross exposure (≥ $5,000).</li>
          <li>Net house loss projected.</li>
          <li>Single user holds ≥ 25% of gross stake.</li>
          <li>Some bets already carry a resolved status — they may have been settled outside this preview.</li>
          <li><code>winningOutcome</code> doesn't match the wager kind (e.g. odds wager with an unexpected label).</li>
          <li>Bets with <code>outcomeLabel</code> that doesn't match any current outcome on the wager — counted as losers in this preview.</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>No money moves. The lib never imports <code>wallet-store</code>, never updates balances, never marks payouts as paid.</li>
          <li>No wager mutation. Settlement status is never written back to the wager — <code>wager.status</code>, <code>winningOutcome</code>, and <code>voidReason</code> remain whatever the resolution center set them to.</li>
          <li>No bet mutation. The lib never calls <code>updateBetStatus</code>; bets keep their existing status.</li>
          <li>No payment-rail calls.</li>
          <li>Writes confined to <code>settlement-preview:*</code>, <code>settlement-previews:all</code>, <code>settlement-preview:wager:&#123;wagerId&#125;</code>, plus the audit log.</li>
        </ul>
      </div>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#e2e8f0', fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: mono ? 'ui-monospace, Menlo, monospace' : undefined, wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}
