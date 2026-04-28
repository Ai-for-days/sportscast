import React, { useEffect, useState } from 'react';
import SystemNav from './SystemNav';
import { BarChart, GaugeIndicator, HeatmapGrid, EmptyChart } from './charts';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const gradeColor: Record<string, string> = { A: '#22c55e', B: '#06b6d4', C: '#3b82f6', D: '#f59e0b', F: '#ef4444' };
const modeColor: Record<string, string> = { paper: '#06b6d4', demo: '#a855f7', live: '#ef4444' };
const categoryColor: Record<string, string> = {
  signal_review: '#06b6d4', risk_review: '#a855f7', pilot_linking: '#22c55e',
  approval: '#f59e0b', execution: '#ef4444', post_trade: '#64748b',
};
const categoryLabel: Record<string, string> = {
  signal_review: 'Signal Review', risk_review: 'Risk Review', pilot_linking: 'Pilot Linking',
  approval: 'Approval', execution: 'Execution', post_trade: 'Post-Trade',
};

type Tab = 'summary' | 'compliance' | 'outcomes' | 'friction' | 'methodology';

export default function PlaybookAudit() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('summary');

  useEffect(() => { reload(); }, []);

  async function reload() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/system/playbook-audit', { credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
      setData(j.audit);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading playbook audit…</div>;
  if (error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {error}</div>;
  if (!data) return null;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/playbook-audit" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Playbook Audit</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Compliance + execution-quality audit over Step 90 manual playbook runs.{' '}
            <strong>Audit only</strong> — no autonomous trading, no order submission, no candidate auto-creation, no execution behavior changes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/operator-training" style={btn('#a855f7')}>Practice (Training) →</a>
          <a href="/admin/system/execution-playbook" style={btn('#22c55e')}>Execution Playbook →</a>
          <button onClick={reload} style={btn('#6366f1')}>Refresh</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['summary',     `Summary · ${data.compliance.grade} (${data.compliance.score})`],
          ['compliance',  'Compliance'],
          ['outcomes',    'Outcomes'],
          ['friction',    `Friction Points (${data.frictionPoints.length})`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' && <SummaryView audit={data} />}
      {tab === 'compliance' && <ComplianceView audit={data} />}
      {tab === 'outcomes' && <OutcomesView audit={data} />}
      {tab === 'friction' && <FrictionView audit={data} />}
      {tab === 'methodology' && <MethodologyView audit={data} />}

      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 4 }}>
        Generated at {new Date(data.generatedAt).toLocaleString()}
      </div>
    </div>
  );
}

// ── Summary ─────────────────────────────────────────────────────────────────

function SummaryView({ audit }: { audit: any }) {
  const t = audit.totals;
  const r = audit.required;
  const l = audit.links;
  const c = audit.compliance;

  const avgHrs = audit.averageTimeToCompleteMs == null ? null : (audit.averageTimeToCompleteMs / 3_600_000);

  return (
    <>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, alignItems: 'center' }}>
          <div style={{ textAlign: 'center', padding: 12 }}>
            <GaugeIndicator value={c.score / 100} label="Compliance Score" sublabel={`Grade ${c.grade}`} height={200} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <Stat label="Total runs" value={t.total} />
            <Stat label="Open" value={t.open} color="#3b82f6" />
            <Stat label="Completed" value={t.completed} color="#22c55e" />
            <Stat label="Cancelled" value={t.cancelled} color="#64748b" />
            <Stat label="Completion rate" value={t.total > 0 ? `${Math.round((t.completed / t.total) * 100)}%` : '—'} />
            <Stat label="Avg time-to-complete" value={avgHrs == null ? '—' : `${avgHrs.toFixed(1)}h`} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Required-item completion</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <Stat label="Slots" value={r.totalRequiredSlots} />
            <Stat label="Completed" value={r.completedRequired} color="#22c55e" />
            <Stat label="Skipped (with note / total)" value={`${r.skippedRequiredWithNote}/${r.skippedRequired}`} color="#f59e0b" />
            <Stat label="Blocked" value={r.blockedRequired} color="#ef4444" />
            <Stat label="Pending (open runs)" value={r.pendingRequired} color="#94a3b8" />
            <Stat label="Completion %" value={`${r.completionPct}%`} />
          </div>
        </div>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Linkage</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Link</th><th style={th}>Linked</th><th style={th}>Missing</th><th style={th}>Applicable</th></tr></thead>
            <tbody>
              <tr><td style={td}>Candidate (demo+live)</td><td style={td}>{l.candidateLinked}</td><td style={td}>{l.candidateMissing}</td><td style={td}>{l.applicableForCandidate}</td></tr>
              <tr><td style={td}>Order (demo+live)</td><td style={td}>{l.orderLinked}</td><td style={td}>{l.orderMissing}</td><td style={td}>{l.applicableForOrder}</td></tr>
              <tr><td style={td}>Pilot (any)</td><td style={td}>{l.pilotLinked}</td><td style={td}>{l.pilotMissing}</td><td style={td}>{t.total}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {audit.staleOpen.length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #ef4444' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Stale Open Playbooks ({audit.staleOpen.length})</h3>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: '#94a3b8' }}>Open playbooks older than 24h.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Run</th><th style={th}>Signal</th><th style={th}>Mode</th><th style={th}>Operator</th><th style={th}>Age</th><th style={th}>Pending req.</th><th style={th}>Blocked</th></tr></thead>
            <tbody>
              {audit.staleOpen.map((row: any) => (
                <tr key={row.runId}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{row.runId}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{row.signalId}</td>
                  <td style={td}><span style={badge(modeColor[row.mode])}>{row.mode}</span></td>
                  <td style={td}>{row.operatorId}</td>
                  <td style={td}>{(row.ageMs / 3_600_000).toFixed(1)}h</td>
                  <td style={td}>{row.pendingRequired}</td>
                  <td style={td}>{row.blockers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Compliance ──────────────────────────────────────────────────────────────

function ComplianceView({ audit }: { audit: any }) {
  const f = audit.compliance.factors;
  const r = audit.required;

  // Heatmap: category × status (completed, skipped, blocked, pending)
  const cats = ['signal_review', 'risk_review', 'pilot_linking', 'approval', 'execution', 'post_trade'] as const;
  const statuses = ['completed', 'skipped', 'blocked', 'pending'] as const;

  const counts: Record<string, Record<string, number>> = {};
  for (const c of cats) counts[c] = { completed: 0, skipped: 0, blocked: 0, pending: 0 };

  // Pull aggregated counts from the runs surfaced in audit (use blocked + skipped lists + required stats only)
  for (const row of audit.blockedItems) counts[row.category].blocked++;
  for (const row of audit.skippedItems) counts[row.category].skipped++;

  // For completed/pending we don't have per-category breakdown directly. Approximate using
  // the friction points (everything else is completed if the run was completed). Skip if empty.
  const heatmapCells = cats.flatMap(c =>
    statuses.map(s => ({
      row: categoryLabel[c],
      col: s,
      value: counts[c][s] || null,
    })),
  );

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Compliance score breakdown</h3>
        <BarChart
          data={[
            { label: 'Required completion', value: f.requiredCompletionPoints, color: '#22c55e', sublabel: '/30' },
            { label: 'Candidate link',      value: f.candidateLinkPoints,      color: '#06b6d4', sublabel: '/15' },
            { label: 'Order link',          value: f.orderLinkPoints,          color: '#3b82f6', sublabel: '/15' },
            { label: 'Pilot link',          value: f.pilotLinkPoints,          color: '#a855f7', sublabel: '/10' },
            { label: 'Skip-with-note',      value: f.skipNotePoints,           color: '#06b6d4', sublabel: '/10' },
            { label: 'Blocked penalty',     value: f.blockedPenalty,           color: '#ef4444', sublabel: 'min -20' },
            { label: 'Stale penalty',       value: f.stalePenalty,             color: '#f59e0b', sublabel: 'min -15' },
            { label: 'Thin-cancel penalty', value: f.thinCancelPenalty,        color: '#64748b', sublabel: 'min -10' },
          ]}
          valueFormatter={v => `${v >= 0 ? '+' : ''}${v}`}
          height={260}
          signColored
        />
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Reasoning</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          {audit.compliance.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Checklist heatmap (skipped / blocked by category)</h3>
        {(audit.blockedItems.length === 0 && audit.skippedItems.length === 0) ? (
          <EmptyChart title="No friction" message="No items have been skipped or blocked yet." />
        ) : (
          <HeatmapGrid
            cells={heatmapCells}
            rowLabels={cats.map(c => categoryLabel[c])}
            colLabels={[...statuses]}
            valueFormatter={v => v == null ? '—' : `${v}`}
          />
        )}
      </div>

      {audit.skippedItems.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Skipped items ({audit.skippedItems.length})</h3>
          <ItemTable rows={audit.skippedItems} statusColor="#f59e0b" />
        </div>
      )}

      {audit.blockedItems.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Blocked items ({audit.blockedItems.length})</h3>
          <ItemTable rows={audit.blockedItems} statusColor="#ef4444" />
        </div>
      )}

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Required-item rollup</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={{ ...td, color: '#94a3b8' }}>Total required slots</td><td style={td}>{r.totalRequiredSlots}</td></tr>
            <tr><td style={{ ...td, color: '#94a3b8' }}>Completed</td><td style={{ ...td, color: '#22c55e' }}>{r.completedRequired} ({r.completionPct}%)</td></tr>
            <tr><td style={{ ...td, color: '#94a3b8' }}>Skipped</td><td style={{ ...td, color: '#f59e0b' }}>{r.skippedRequired} (with note: {r.skippedRequiredWithNote})</td></tr>
            <tr><td style={{ ...td, color: '#94a3b8' }}>Blocked</td><td style={{ ...td, color: '#ef4444' }}>{r.blockedRequired}</td></tr>
            <tr><td style={{ ...td, color: '#94a3b8' }}>Pending (open runs)</td><td style={td}>{r.pendingRequired}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function ItemTable({ rows, statusColor }: { rows: any[]; statusColor: string }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Run</th><th style={th}>Signal</th><th style={th}>Mode</th>
            <th style={th}>Category</th><th style={th}>Item</th><th style={th}>Required</th><th style={th}>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any, i: number) => (
            <tr key={`${row.runId}-${row.title}-${i}`} style={{ borderLeft: `3px solid ${statusColor}` }}>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{row.runId}</td>
              <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{row.signalId}</td>
              <td style={td}><span style={badge(modeColor[row.mode])}>{row.mode}</span></td>
              <td style={td}><span style={badge(categoryColor[row.category])}>{categoryLabel[row.category]}</span></td>
              <td style={td}>{row.title}</td>
              <td style={td}>{row.required ? '✓' : '—'}</td>
              <td style={{ ...td, fontSize: 11, color: row.notes ? '#cbd5e1' : '#ef4444' }}>{row.notes ?? '— missing —'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Outcomes ────────────────────────────────────────────────────────────────

function OutcomesView({ audit }: { audit: any }) {
  const o = audit.outcomes;
  const cents = (n: number) => `${n >= 0 ? '+' : ''}$${(n / 100).toFixed(2)}`;

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Order linkage on completed playbooks</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <Stat label="With order linked" value={o.completedWithOrder} color="#22c55e" />
          <Stat label="Without order" value={o.completedWithoutOrder} color="#ef4444" />
          <Stat label="Matched in ledger" value={o.pnlMatchedRuns} color="#06b6d4" />
          <Stat label="Aggregate realized P&L" value={cents(o.pnlCents)} color={o.pnlCents >= 0 ? '#22c55e' : '#ef4444'} />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>P&L by run mode</h3>
        <BarChart
          data={(['paper', 'demo', 'live'] as const).map(m => ({
            label: m, value: o.pnlByMode[m] / 100, color: modeColor[m],
          }))}
          valueFormatter={v => `${v >= 0 ? '+' : ''}$${v.toFixed(2)}`}
          height={180}
          signColored
        />
      </div>

      <div style={{ ...card, color: '#cbd5e1', fontSize: 13 }}>
        <strong>How outcomes are matched:</strong> a completed playbook contributes to realized P&L only when its linked
        <code> orderId</code> appears in the realized PnL ledger. Missing or unmatched orderIds count as "without order"
        and are excluded from the aggregate. This is a best-effort lookup — it intentionally does not fabricate outcomes.
      </div>
    </>
  );
}

// ── Friction ────────────────────────────────────────────────────────────────

function FrictionView({ audit }: { audit: any }) {
  const fp: any[] = audit.frictionPoints;

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Most-friction checklist items</h3>
        {fp.length === 0 ? <EmptyChart title="No friction" message="No items have been blocked or skipped yet." /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Item</th><th style={th}>Category</th><th style={th}>Required</th>
                <th style={th}>Blocked</th><th style={th}>Skipped</th><th style={th}>Friction %</th>
              </tr>
            </thead>
            <tbody>
              {fp.map(p => (
                <tr key={p.title}>
                  <td style={td}>{p.title}</td>
                  <td style={td}><span style={badge(categoryColor[p.category])}>{categoryLabel[p.category]}</span></td>
                  <td style={td}>{p.required ? '✓' : '—'}</td>
                  <td style={td}>{p.blockedCount}</td>
                  <td style={td}>{p.skippedCount}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{p.frictionPct.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Operator stats</h3>
        {audit.operators.length === 0 ? <EmptyChart title="No operators yet" message="No playbook runs recorded." /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Operator</th><th style={th}>Total</th><th style={th}>Completed</th>
                <th style={th}>Cancelled</th><th style={th}>Open</th><th style={th}>Completion %</th><th style={th}>Avg time-to-complete</th>
              </tr>
            </thead>
            <tbody>
              {audit.operators.map((o: any) => (
                <tr key={o.operatorId}>
                  <td style={td}>{o.operatorId}</td>
                  <td style={td}>{o.total}</td>
                  <td style={{ ...td, color: '#22c55e' }}>{o.completed}</td>
                  <td style={{ ...td, color: '#64748b' }}>{o.cancelled}</td>
                  <td style={{ ...td, color: '#3b82f6' }}>{o.open}</td>
                  <td style={td}>{o.completionPct}%</td>
                  <td style={td}>{o.averageTimeToCompleteMs == null ? '—' : `${(o.averageTimeToCompleteMs / 3_600_000).toFixed(1)}h`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── Methodology ─────────────────────────────────────────────────────────────

function MethodologyView({ audit }: { audit: any }) {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>How the compliance score is computed</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Factor</th><th style={th}>Range</th><th style={th}>Source</th></tr></thead>
          <tbody>
            <tr><td style={td}>Required completion</td><td style={td}>0..30</td><td style={td}>completed required items / total required slots</td></tr>
            <tr><td style={td}>Candidate link</td><td style={td}>0..15</td><td style={td}>candidate-linked demo+live runs / applicable</td></tr>
            <tr><td style={td}>Order link</td><td style={td}>0..15</td><td style={td}>order-linked demo+live runs / applicable</td></tr>
            <tr><td style={td}>Pilot link</td><td style={td}>0..10</td><td style={td}>pilot-linked runs / total</td></tr>
            <tr><td style={td}>Skip-with-note</td><td style={td}>0..10</td><td style={td}>skipped required items with notes / skipped required (or 10 if none skipped)</td></tr>
            <tr><td style={td}>Blocked penalty</td><td style={td}>0..-20</td><td style={td}>4 points per blocked required item, min -20</td></tr>
            <tr><td style={td}>Stale penalty</td><td style={td}>0..-15</td><td style={td}>5 points per stale-open run (&gt;24h), min -15</td></tr>
            <tr><td style={td}>Thin-cancel penalty</td><td style={td}>0..-10</td><td style={td}>5 points per cancellation with reason &lt;20 chars, min -10</td></tr>
            <tr><td style={td}>Baseline</td><td style={td}>0 or +20</td><td style={td}>+20 once any playbook exists</td></tr>
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
          Final score is clamped to [0, 100]. Grades: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, else F.
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Notes</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          {(audit.notes ?? []).map((n: string, i: number) => <li key={i}>{n}</li>)}
        </ul>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>Audit is read-only — no playbook records are mutated by this page.</li>
          <li>No autonomous trading, no order submission, no execution-candidate creation.</li>
          <li>No execution-behavior changes anywhere in the system.</li>
          <li>P&L lookups are best-effort; missing orderIds are reported as missing, not synthesized.</li>
        </ul>
      </div>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#e2e8f0', fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</div>
    </div>
  );
}
