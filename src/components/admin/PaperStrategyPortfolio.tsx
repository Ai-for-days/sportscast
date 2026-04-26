import React, { useEffect, useState } from 'react';
import { BarChart, LineChart, EmptyChart } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 14px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const statusColor: Record<string, string> = {
  open: '#3b82f6', settled: '#22c55e', void: '#64748b',
};
const outcomeColor: Record<string, string> = {
  win: '#22c55e', loss: '#ef4444', push: '#f59e0b',
};

type Tab = 'summary' | 'open' | 'settled' | 'performance' | 'drawdown' | 'methodology';

export default function PaperStrategyPortfolio() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('summary');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { reload(); }, []);
  async function reload() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/system/paper-strategy-portfolio?action=summary', { credentials: 'include' });
      const j = await res.json();
      setData(j);
    } catch { setData({ error: 'Failed to load' }); }
    setLoading(false);
  }

  async function postAction(action: string, body: any = {}) {
    setBusy(action);
    try {
      const res = await fetch('/api/admin/system/paper-strategy-portfolio', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const j = await res.json();
      if (res.ok) {
        if (action === 'capture-current-allocation') setToast(`Captured ${j.result.capturedCount} entries (${j.result.duplicateCount} duplicates skipped, ${j.result.skippedZeroStake} zero-stake skipped)`);
        else if (action === 'refresh-paper-outcomes') setToast(`Refreshed: ${j.result.updated} settled, ${j.result.stillOpen} still open`);
        else if (action === 'void-paper-entry') setToast(`Entry voided.`);
        await reload();
      } else {
        setToast(`Error: ${j.error || 'failed'}`);
      }
    } catch (e: any) {
      setToast(`Error: ${e?.message || 'network'}`);
    }
    setBusy(null);
    setTimeout(() => setToast(null), 3000);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading paper portfolio…</div>;
  if (!data || data.error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {data?.error || 'unknown'}</div>;

  const p = data.performance;
  const records = (data.records ?? []) as any[];
  const open = records.filter(r => r.status === 'open');
  const settled = records.filter(r => r.status === 'settled');

  const fmtCents = (v: number | null | undefined) => v == null ? '—' : `$${(v / 100).toFixed(2)}`;
  const fmtSignedCents = (v: number | null | undefined) => v == null ? '—' : `${v >= 0 ? '+' : ''}$${(v / 100).toFixed(2)}`;
  const fmtPct = (v: number | null | undefined) => v == null ? '—' : `${v.toFixed(1)}%`;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/paper-strategy-portfolio" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Paper Strategy Portfolio</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 760 }}>
            Records which systematic-eligible signals would have been taken under the Step 78 allocation engine and tracks their later performance. <strong>Paper only</strong> — no live trading, no order submission, no candidate creation.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => postAction('capture-current-allocation')} disabled={!!busy} style={btn('#22c55e')}>
            {busy === 'capture-current-allocation' ? 'Capturing…' : 'Capture Current Allocation'}
          </button>
          <button onClick={() => postAction('refresh-paper-outcomes')} disabled={!!busy} style={btn('#3b82f6')}>
            {busy === 'refresh-paper-outcomes' ? 'Refreshing…' : 'Refresh Outcomes'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['summary', 'Summary'],
          ['open', `Open (${open.length})`],
          ['settled', `Settled (${settled.length})`],
          ['performance', 'Performance'],
          ['drawdown', 'Drawdown'],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div>
          <div style={grid4}>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Captured positions</div><div style={{ fontSize: 24, fontWeight: 700 }}>{p.totals.captured}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Open</div><div style={{ fontSize: 24, fontWeight: 700, color: '#3b82f6' }}>{p.totals.open}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Settled</div><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{p.totals.settled}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Voided</div><div style={{ fontSize: 24, fontWeight: 700, color: '#94a3b8' }}>{p.totals.voided}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Win rate</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtPct(p.settled.winRatePct)}</div><div style={{ fontSize: 10, color: '#64748b' }}>{p.settled.wins}W / {p.settled.losses}L / {p.settled.pushes}P</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Total P&L</div><div style={{ fontSize: 24, fontWeight: 700, color: p.settled.totalPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSignedCents(p.settled.totalPnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>ROI</div><div style={{ fontSize: 24, fontWeight: 700, color: (p.settled.roiPct ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>{p.settled.roiPct != null ? `${p.settled.roiPct >= 0 ? '+' : ''}${p.settled.roiPct.toFixed(1)}%` : '—'}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Max drawdown</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{fmtCents(p.drawdown.maxDrawdownCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Open exposure</div><div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCents(p.exposure.openExposureCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Best trade</div><div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{fmtSignedCents(p.settled.bestPnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Worst trade</div><div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>{fmtSignedCents(p.settled.worstPnlCents)}</div></div>
            <div style={card}><div style={{ fontSize: 11, color: '#94a3b8' }}>Avg P&L</div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmtSignedCents(p.settled.avgPnlCents)}</div></div>
          </div>
        </div>
      )}

      {(tab === 'open' || tab === 'settled') && (
        <div style={card}>
          {(tab === 'open' ? open : settled).length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              {tab === 'open' ? 'No open paper positions. Click "Capture Current Allocation" above to record the current systematic-eligible allocation.' : 'No settled paper positions yet. After demo trades resolve, click "Refresh Outcomes".'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>When</th>
                    <th style={th}>Title</th>
                    <th style={th}>Side</th>
                    <th style={th}>City / Metric / Date</th>
                    <th style={th}>Stake</th>
                    <th style={th}>Cal edge</th>
                    <th style={th}>Reliability</th>
                    <th style={th}>Status</th>
                    <th style={th}>Outcome</th>
                    <th style={th}>P&L</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {(tab === 'open' ? open : settled).map(r => (
                    <tr key={r.id}>
                      <td style={td}>{new Date(r.createdAt).toLocaleString()}</td>
                      <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.title}>{r.title}</td>
                      <td style={td}>{r.side ?? '—'}</td>
                      <td style={{ ...td, fontSize: 11, color: '#cbd5e1' }}>{r.locationName ?? '—'} / {r.metric ?? '—'} / {r.targetDate ?? '—'}</td>
                      <td style={td}>{fmtCents(r.cappedStakeCents)}</td>
                      <td style={td}>{r.calibratedEdge != null ? `${(r.calibratedEdge * 100).toFixed(2)}%` : '—'}</td>
                      <td style={td}>{r.reliabilityFactor != null ? `${(r.reliabilityFactor * 100).toFixed(0)}%` : '—'}</td>
                      <td style={td}><span style={badge(statusColor[r.status])}>{r.status}</span></td>
                      <td style={td}>{r.outcome ? <span style={badge(outcomeColor[r.outcome])}>{r.outcome}</span> : '—'}</td>
                      <td style={{ ...td, color: (r.pnlCents ?? 0) >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{fmtSignedCents(r.pnlCents)}</td>
                      <td style={td}>
                        {r.status === 'open' && (
                          <button onClick={() => postAction('void-paper-entry', { id: r.id })} disabled={!!busy} style={{ ...btn('#475569'), fontSize: 11, padding: '4px 10px' }}>Void</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'performance' && (
        <div>
          <div style={card}>
            <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700 }}>By source</h4>
            <BucketTable rows={p.bySource} />
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700 }}>By metric</h4>
            <BucketTable rows={p.byMetric} />
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700 }}>By horizon</h4>
            <BucketTable rows={p.byHorizon} />
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700 }}>By reliability bucket</h4>
            <BucketTable rows={p.byReliability} />
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>P&L by source</h4>
            {p.bySource.every((b: any) => b.totalPnlCents === 0)
              ? <EmptyChart title="P&L by source" message="No settled paper P&L yet." />
              : <BarChart signColored valueFormatter={v => fmtSignedCents(v)} data={p.bySource.map((b: any) => ({ label: b.bucket, value: b.totalPnlCents, sublabel: `n=${b.settled}` }))} />}
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>P&L by metric (top 8)</h4>
            {p.byMetric.length === 0
              ? <EmptyChart title="P&L by metric" message="No metric breakdown yet." />
              : <BarChart signColored valueFormatter={v => fmtSignedCents(v)} data={p.byMetric.slice(0, 8).map((b: any) => ({ label: b.bucket, value: b.totalPnlCents, sublabel: `n=${b.settled}` }))} />}
          </div>
        </div>
      )}

      {tab === 'drawdown' && (
        <div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>Cumulative paper P&L</h4>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>Settled trades in chronological order (settledAt). Y axis is dollars.</p>
            {p.drawdown.cumulativePnl.length === 0
              ? <EmptyChart title="Cumulative paper P&L" message="No settled paper trades yet." />
              : <LineChart yLabel="Cumulative $" valueFormatter={v => fmtSignedCents(v)} data={p.drawdown.cumulativePnl.map((c: any, i: number) => ({ x: `#${i + 1}`, y: c.cumulativePnlCents }))} />}
          </div>
          <div style={card}>
            <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700 }}>ROI summary</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <div style={{ background: '#0f172a', padding: 10, borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Total stake (settled)</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtCents(p.settled.totalStakeCents)}</div>
              </div>
              <div style={{ background: '#0f172a', padding: 10, borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Total P&L</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: p.settled.totalPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{fmtSignedCents(p.settled.totalPnlCents)}</div>
              </div>
              <div style={{ background: '#0f172a', padding: 10, borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>ROI (settled)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: (p.settled.roiPct ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>{p.settled.roiPct != null ? `${p.settled.roiPct >= 0 ? '+' : ''}${p.settled.roiPct.toFixed(1)}%` : '—'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'methodology' && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Methodology</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' }}>
            <li>Capture is manual only — operator clicks <strong>Capture Current Allocation</strong>. No scheduled jobs.</li>
            <li>Capture pulls the current Step 78 allocation; only systematic-eligible records with <code>cappedStake &gt; 0</code> are recorded.</li>
            <li>Duplicate prevention: Redis index <code>paper-portfolio:idx:{'{signalId}'}:{'{targetDate}'}:{'{side}'}</code> blocks re-insert if the same triple already has an entry.</li>
            <li>Refresh Outcomes walks all open paper entries, looks for resolved orders by <code>ticker = signalId.replace(/^ks_/, '')</code> placed at or after the paper-entry creation time, on the same side; if a settlement with finalized <code>netPnlCents</code> exists, the paper entry is marked settled with that P&L. No-match entries stay open.</li>
            <li>ROI = totalPnlCents / totalStakeCents (settled only). Drawdown is computed by chronologically replaying settled P&L and tracking running max minus current cumulative.</li>
            <li>Performance buckets: source, metric, horizon (0–12h / 12–24h / 1–3d / 3–7d / 7–15d), reliability (0–25 / 25–40 / 40–60 / 60–85 / 85–100%).</li>
            <li>Voiding an entry is informational — the position is kept in the log with status void and excluded from win/loss/P&L stats.</li>
            <li>Storage: Redis. Sorted-set <code>paper-portfolio:all</code> chronological index. Auto-trims oldest beyond 5000 entries.</li>
            <li>No live trading. No order submission. No candidate auto-creation. Read-only relative to execution.</li>
          </ul>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '10px 16px', borderRadius: 6, fontSize: 13, maxWidth: 400 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function BucketTable({ rows }: { rows: any[] }) {
  if (rows.length === 0) return <div style={{ color: '#64748b', fontSize: 12, padding: 6 }}>No data.</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Bucket</th>
          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Total</th>
          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Settled</th>
          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Wins</th>
          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Hit rate</th>
          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Total P&L</th>
          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' }}>Avg P&L</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.bucket}>
            <td style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', fontSize: 13 }}><strong>{r.bucket}</strong></td>
            <td style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', fontSize: 13 }}>{r.count}</td>
            <td style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', fontSize: 13 }}>{r.settled}</td>
            <td style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', fontSize: 13 }}>{r.wins}</td>
            <td style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', fontSize: 13 }}>{r.hitRatePct != null ? `${r.hitRatePct.toFixed(1)}%` : '—'}</td>
            <td style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', fontSize: 13, color: r.totalPnlCents >= 0 ? '#22c55e' : '#ef4444' }}>{r.totalPnlCents >= 0 ? '+' : ''}${(r.totalPnlCents / 100).toFixed(2)}</td>
            <td style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', fontSize: 13 }}>{r.avgPnlCents != null ? `${r.avgPnlCents >= 0 ? '+' : ''}$${(r.avgPnlCents / 100).toFixed(2)}` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
