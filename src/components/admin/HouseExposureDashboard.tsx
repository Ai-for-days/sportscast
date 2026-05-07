import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';
import { BarChart, EmptyChart } from './charts';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const statusColor: Record<string, string> = { open: '#3b82f6', locked: '#f59e0b', graded: '#22c55e', void: '#64748b' };

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #0c4a6e, #0369a1)', color: '#fff',
  padding: '10px 14px', borderRadius: 8, marginBottom: 16,
  fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 12, flexWrap: 'wrap',
};

type Tab = 'overview' | 'markets' | 'users' | 'ledger' | 'methodology';

function fmtUsd(cents: number, signed = false): string {
  if (!Number.isFinite(cents)) return '—';
  const sign = cents < 0 ? '-' : (signed && cents > 0 ? '+' : '');
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default function HouseExposureDashboard() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Generate form
  const [scope, setScope] = useState<'all' | 'open' | 'locked' | 'graded' | 'date_range'>('all');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  useEffect(() => { reload(); }, []);

  async function get(action: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/admin/system/house-exposure?${q.toString()}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
    return j;
  }
  async function post(body: any) {
    const res = await fetch('/api/admin/system/house-exposure', {
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
      const j = await get('summary');
      setSummary(j.summary);
      setSnapshots(j.snapshots ?? []);
      if (!active && j.summary?.latestSnapshot) setActive(j.summary.latestSnapshot);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  async function generate() {
    if (scope === 'date_range' && (!periodStart || !periodEnd)) {
      setError('Date range scope requires both periodStart and periodEnd.');
      return;
    }
    setBusy('generate'); setError(null);
    try {
      const j = await post({
        action: 'generate-snapshot',
        scope,
        periodStart: scope === 'date_range' ? periodStart : undefined,
        periodEnd: scope === 'date_range' ? periodEnd : undefined,
      });
      setActive(j.snapshot);
      await reload();
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  async function open(id: string) {
    setBusy(`open-${id}`); setError(null);
    try {
      const j = await get('get-snapshot', { id });
      setActive(j.snapshot);
    } catch (e: any) { setError(e?.message ?? 'failed'); }
    setBusy(null);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading house exposure…</div>;
  if (!summary) return null;

  const latest = active ?? summary.latestSnapshot;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/house-exposure" /></div>

      <div style={BANNER}>
        <span>💰 House Exposure is <strong>read-only</strong>. It does not settle balances, move money, change odds, or grade wagers.</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>Audit-logged · Snapshot only</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Financial Exposure & House PnL</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Snapshots current exposure, projected worst-case house result, realized PnL on graded markets, and user concentration.
            Reads <code>wager-store</code> + <code>bet-store</code> read-only and persists only the snapshot itself.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/wager-settlement-preview" style={btn('#0ea5e9')}>Settlement Preview →</a>
          <a href="/admin/system/market-integrity" style={btn('#0ea5e9')}>Market Integrity →</a>
          <a href="/admin/system/manual-hedge-review" style={btn('#f97316')}>Hedge Review →</a>
          <button type="button" onClick={reload} disabled={!!busy} style={btn('#6366f1')}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ ...card, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>}

      {/* Generate snapshot form */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Generate snapshot</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            Scope
            <select style={{ ...input, width: '100%', marginTop: 4 }} value={scope} onChange={(e: any) => setScope(e.target.value)}>
              <option value="all">all</option>
              <option value="open">open</option>
              <option value="locked">locked</option>
              <option value="graded">graded</option>
              <option value="date_range">date range (createdAt)</option>
            </select>
          </label>
          {scope === 'date_range' && (
            <>
              <label style={{ fontSize: 12, color: '#94a3b8' }}>
                Period start
                <input type="date" style={{ ...input, width: '100%', marginTop: 4 }} value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              </label>
              <label style={{ fontSize: 12, color: '#94a3b8' }}>
                Period end
                <input type="date" style={{ ...input, width: '100%', marginTop: 4 }} value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
              </label>
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" onClick={generate} disabled={!!busy} style={btn(busy === 'generate' ? '#475569' : '#22c55e')}
              title="Read-only computation. Persists only the snapshot itself; no wager / balance / pricing mutation.">
              {busy === 'generate' ? 'Generating…' : 'Generate Snapshot'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['overview', 'Exposure Overview'],
          ['markets', 'Market Risk'],
          ['users', 'User Concentration'],
          ['ledger', `Snapshot Ledger (${snapshots.length})`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewView snap={latest} summary={summary} />}
      {tab === 'markets' && <MarketsView snap={latest} />}
      {tab === 'users' && <UsersView snap={latest} />}
      {tab === 'ledger' && <LedgerView snapshots={snapshots} open={open} />}
      {tab === 'methodology' && <MethodologyView />}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ snap, summary }: { snap: any; summary: any }) {
  if (!snap) {
    return <div style={{ ...card, color: '#94a3b8' }}>No snapshots yet — generate one above.</div>;
  }

  const projColor = snap.projectedNetHouseResult >= 0 ? '#22c55e' : '#ef4444';
  const realColor = (snap.realizedNetHouseResult ?? 0) >= 0 ? '#22c55e' : '#ef4444';

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Snapshot · {snap.scope}{snap.scope === 'date_range' && snap.periodStart ? ` (${snap.periodStart}…${snap.periodEnd})` : ''}</h2>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {new Date(snap.generatedAt).toLocaleString()} · {snap.generatedBy} · <code>{snap.id}</code>
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
          <Stat label="Total stake (in scope)" value={fmtUsd(snap.totalStake)} />
          <Stat label="Total potential payout" value={fmtUsd(snap.totalPotentialPayout)} color="#a855f7" />
          <Stat label="Projected net (worst case)" value={fmtUsd(snap.projectedNetHouseResult, true)} color={projColor} />
          <Stat label="Realized net (graded)" value={snap.realizedNetHouseResult == null ? '—' : fmtUsd(snap.realizedNetHouseResult, true)} color={snap.realizedNetHouseResult == null ? undefined : realColor} />
          <Stat label="Unrealized exposure" value={fmtUsd(snap.unrealizedExposure)} color={(snap.unrealizedExposure ?? 0) > 0 ? '#f59e0b' : undefined} />
          <Stat label="Markets at risk" value={snap.marketsAtRisk} color={snap.marketsAtRisk > 0 ? '#f59e0b' : '#22c55e'} />
          <Stat label="Top user stake" value={snap.topUsersByExposure?.[0] ? fmtUsd(snap.topUsersByExposure[0].totalStakeCents) : '—'} />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top risk markets — house result by outcome</h3>
        {(snap.topRiskMarkets ?? []).length === 0 ? (
          <EmptyChart title="No markets" message="Generate a snapshot once wagers exist." />
        ) : (
          <BarChart
            data={(snap.topRiskMarkets ?? []).slice(0, 8).map((m: any) => ({
              label: m.ticketNumber ?? m.wagerId.slice(0, 8),
              value: -m.worstCaseHouseLoss / 100,           // negative = loss
              color: m.worstCaseHouseLoss > 0 ? '#ef4444' : '#22c55e',
            }))}
            valueFormatter={v => `${v >= 0 ? '+' : ''}$${v.toFixed(2)}`}
            height={220}
            signColored
          />
        )}
      </div>

      {(snap.warnings ?? []).length > 0 && (
        <div style={{ ...card, background: '#3f1d1d', borderLeft: '3px solid #ef4444' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>Warnings ({snap.warnings.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fecaca' }}>
            {snap.warnings.map((w: string, idx: number) => <li key={idx}>{w}</li>)}
          </ul>
        </div>
      )}

      {(snap.recommendations ?? []).length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Recommendations</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#cbd5e1' }}>
            {snap.recommendations.map((r: string, idx: number) => <li key={idx}>{r}</li>)}
          </ul>
        </div>
      )}

      {(snap.dataGaps ?? []).length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#fbbf24' }}>Data gaps ({snap.dataGaps.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#fbbf24' }}>
            {snap.dataGaps.map((g: string, idx: number) => <li key={idx}>{g}</li>)}
          </ul>
        </div>
      )}

      {summary.averageProjected != null && (
        <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right' }}>
          Average projected net across {summary.totalSnapshots} snapshot(s): {fmtUsd(summary.averageProjected, true)}
          {summary.averageRealized != null && <> · average realized: {fmtUsd(summary.averageRealized, true)}</>}
        </div>
      )}
    </>
  );
}

// ── Markets ──────────────────────────────────────────────────────────────────

function MarketsView({ snap }: { snap: any }) {
  if (!snap) return <div style={{ ...card, color: '#94a3b8' }}>Generate a snapshot to see market risk.</div>;
  const markets: any[] = snap.topRiskMarkets ?? [];
  if (markets.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No in-scope markets.</div>;
  }
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top risk markets ({markets.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Ticket</th><th style={th}>Title</th><th style={th}>Status</th>
                <th style={th}>Total stake</th><th style={th}>Potential payout</th>
                <th style={th}>Worst-case loss</th><th style={th}>Best-case gain</th>
                <th style={th}>Realized</th><th style={th}>Top user %</th><th style={th}>Flag</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m: any) => (
                <tr key={m.wagerId}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{m.ticketNumber ?? m.wagerId.slice(0, 12)}</td>
                  <td style={td}>{m.title}</td>
                  <td style={td}><span style={badge(statusColor[m.status] ?? '#64748b')}>{m.status}</span></td>
                  <td style={td}>{fmtUsd(m.totalStake)}</td>
                  <td style={td}>{fmtUsd(m.potentialPayout)}</td>
                  <td style={{ ...td, color: m.worstCaseHouseLoss > 0 ? '#ef4444' : '#22c55e' }}>{fmtUsd(m.worstCaseHouseLoss)}</td>
                  <td style={{ ...td, color: '#22c55e' }}>{fmtUsd(m.bestCaseHouseGain)}</td>
                  <td style={{ ...td, color: m.realizedHouseResult == null ? '#94a3b8' : (m.realizedHouseResult >= 0 ? '#22c55e' : '#ef4444') }}>
                    {m.realizedHouseResult == null ? '—' : fmtUsd(m.realizedHouseResult, true)}
                  </td>
                  <td style={td}>{m.topUserPctOfMarket}%</td>
                  <td style={td}>{m.concentrationWarning ? <span style={badge('#ef4444')}>flag</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Worst-case outcome breakdown for top market */}
      {markets[0] && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>
            Outcome payout map — {markets[0].ticketNumber ?? markets[0].wagerId.slice(0, 12)} · "{markets[0].title}"
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Outcome</th><th style={th}>Payout if wins</th><th style={th}>House result if wins</th></tr></thead>
              <tbody>
                {(markets[0].payoutByOutcome ?? []).map((p: any) => {
                  const houseResult = (markets[0].totalStake ?? 0) - (p.payoutCents ?? 0);
                  return (
                    <tr key={p.label}>
                      <td style={td}>{p.label}</td>
                      <td style={td}>{fmtUsd(p.payoutCents)}</td>
                      <td style={{ ...td, color: houseResult >= 0 ? '#22c55e' : '#ef4444' }}>{fmtUsd(houseResult, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ── Users ────────────────────────────────────────────────────────────────────

function UsersView({ snap }: { snap: any }) {
  if (!snap) return <div style={{ ...card, color: '#94a3b8' }}>Generate a snapshot to see user concentration.</div>;
  const users: any[] = snap.topUsersByExposure ?? [];
  if (users.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No participants in scope.</div>;
  }
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top users by exposure ({users.length})</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>User</th><th style={th}>Total stake</th><th style={th}>% of in-scope stake</th>
              <th style={th}>Potential payout</th><th style={th}>Markets touched</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: any) => (
              <tr key={u.userId}>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{u.userId}</td>
                <td style={td}>{fmtUsd(u.totalStakeCents)}</td>
                <td style={{ ...td, color: u.pctOfTotalStake >= 25 ? '#ef4444' : '#cbd5e1' }}>{u.pctOfTotalStake}%</td>
                <td style={td}>{fmtUsd(u.potentialPayoutCents)}</td>
                <td style={td}>{u.marketsTouched}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <a href={`/admin/system/user-risk-monitoring`} style={{ ...btn('#475569'), padding: '4px 10px' }}
                    title="Open User Risk Monitoring to investigate this user.">User Risk →</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Ledger ───────────────────────────────────────────────────────────────────

function LedgerView({ snapshots, open }: { snapshots: any[]; open: (id: string) => void }) {
  if (!snapshots || snapshots.length === 0) {
    return <div style={{ ...card, color: '#94a3b8' }}>No snapshots persisted yet.</div>;
  }
  return (
    <div style={card}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Generated</th><th style={th}>Scope</th><th style={th}>By</th>
              <th style={th}>Stake</th><th style={th}>Projected</th><th style={th}>Realized</th>
              <th style={th}>Unrealized</th><th style={th}>Markets at risk</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map(s => {
              const proj = s.projectedNetHouseResult;
              return (
                <tr key={s.id}>
                  <td style={td}>{new Date(s.generatedAt).toLocaleString()}</td>
                  <td style={td}>{s.scope}{s.scope === 'date_range' && s.periodStart ? ` (${s.periodStart}…${s.periodEnd})` : ''}</td>
                  <td style={td}>{s.generatedBy}</td>
                  <td style={td}>{fmtUsd(s.totalStake)}</td>
                  <td style={{ ...td, color: proj >= 0 ? '#22c55e' : '#ef4444' }}>{fmtUsd(proj, true)}</td>
                  <td style={{ ...td, color: s.realizedNetHouseResult == null ? '#94a3b8' : (s.realizedNetHouseResult >= 0 ? '#22c55e' : '#ef4444') }}>
                    {s.realizedNetHouseResult == null ? '—' : fmtUsd(s.realizedNetHouseResult, true)}
                  </td>
                  <td style={{ ...td, color: (s.unrealizedExposure ?? 0) > 0 ? '#f59e0b' : '#cbd5e1' }}>{fmtUsd(s.unrealizedExposure)}</td>
                  <td style={td}>{s.marketsAtRisk}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => open(s.id)} style={{ ...btn('#475569'), padding: '4px 10px' }}>Open</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Methodology ──────────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>How a snapshot is computed</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Pull wagers via <code>listAllWagers</code> and bets per wager via <code>getWagerBets</code> — read-only.</li>
          <li>Filter by scope: <code>all</code>, <code>open</code>, <code>locked</code>, <code>graded</code>, or <code>date_range</code> (on <code>createdAt</code>).</li>
          <li>For each market, sum potential payouts grouped by outcome label. Include the wager's defined outcome labels even if no bet exists, so "no bets on outcome X" still counts as a 0-payout outcome.</li>
          <li><strong>House result if outcome X wins</strong> = totalStake − payoutByOutcome[X].</li>
          <li><strong>Worst-case house loss</strong> = magnitude of the most negative house result across outcomes (clamped to ≥ 0).</li>
          <li><strong>Best-case house gain</strong> = best house result across outcomes (clamped to ≥ 0).</li>
          <li>For graded markets, realizedHouseResult uses the wager's <code>winningOutcome</code> only; void markets contribute 0 (refunded).</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Aggregates</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>projectedNetHouseResult</strong> — sum of each market's worst-case house result (the worst-case scenario across all in-scope markets).</li>
          <li><strong>realizedNetHouseResult</strong> — sum of realized house results across in-scope graded markets (only set if any graded markets exist).</li>
          <li><strong>unrealizedExposure</strong> — sum of <code>worstCaseHouseLoss</code> for non-graded markets — the most you could lose from open + locked exposure if every worst-case fires.</li>
          <li><strong>marketsAtRisk</strong> — count of markets where <code>worstCaseHouseLoss &gt; 0</code>.</li>
          <li><strong>topUsersByExposure</strong> — top 10 users by total stake across in-scope non-void bets.</li>
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Flags</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Market: <code>concentrationWarning</code> if worst-case loss ≥ $500 OR a single user holds ≥ 50% of the market's stake.</li>
          <li>Snapshot: warning when <code>projectedNetHouseResult ≤ -$500</code> (recommends Market Integrity / re-pricing review).</li>
          <li>Snapshot: warning when the top user holds ≥ 25% of in-scope stake (recommends User Risk Monitoring).</li>
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>The lib only imports <code>getRedis</code>, <code>logAuditEvent</code>, <code>listAllWagers</code> (read), and <code>getWagerBets</code> (read).</li>
          <li>No settlement, no balance changes, no payouts, no notifications.</li>
          <li>No wager mutation, no bet mutation, no pricing or grading mutation.</li>
          <li>Projected and unrealized numbers are scenario estimates — they are NOT settlement decisions.</li>
          <li>Writes confined to <code>house-exposure-snapshot:&#123;id&#125;</code>, <code>house-exposure-snapshots:all</code>, plus the audit log.</li>
          <li>Audit event: <code>house_exposure_snapshot_generated</code>.</li>
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
