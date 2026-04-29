import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, GaugeIndicator, EmptyChart } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const gradeColor: Record<string, string> = {
  A: '#22c55e', B: '#06b6d4', C: '#3b82f6', D: '#f59e0b', F: '#ef4444',
};
const priorityColor: Record<string, string> = {
  critical: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6',
};
const categoryColor: Record<string, string> = {
  edge: '#06b6d4', allocation: '#a855f7', pilot: '#22c55e', governance: '#f59e0b', ops: '#64748b',
};
const pilotStatusColor: Record<string, string> = {
  draft: '#475569', scheduled: '#3b82f6', active: '#22c55e', paused: '#f59e0b', completed: '#06b6d4', cancelled: '#64748b',
};
const strategyStatusColor: Record<string, string> = {
  draft: '#64748b', research: '#3b82f6', watchlist: '#06b6d4',
  paper_approved: '#a855f7', pilot_ready: '#22c55e', paused: '#f59e0b', retired: '#475569',
};

type Tab = 'command' | 'health' | 'pipeline' | 'actions' | 'methodology';

export default function StrategyScorecard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('command');
  const [error, setError] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  useEffect(() => { reload(); }, []);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/system/strategy-scorecard', { credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
      setData(j.scorecard);
    } catch (e: any) {
      setError(e?.message ?? 'network');
    }
    setLoading(false);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading strategy scorecard…</div>;
  if (error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {error}</div>;
  if (!data) return null;

  const sc = data;
  const overall = sc.overall;
  const components: any[] = sc.overall.components;
  const filteredActions = (sc.topActions ?? []).filter((a: any) =>
    (filterPriority === 'all' || a.priority === filterPriority)
    && (filterCategory === 'all' || a.category === filterCategory),
  );

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/strategy-scorecard" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Strategy Operating Scorecard</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Executive command view across signal → allocation → paper → pilot → review → decision.
            <strong> Visibility only</strong> — no autonomous trading, no order submission, no execution candidate creation,
            no pilot state changes, no automatic strategy promotion.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/desk-queue" style={btn('#22c55e')}>Open Desk Queue →</a>
          <a href="/admin/system/playbook-audit" style={btn('#0ea5e9')}>Playbook Audit →</a>
          <a href="/admin/system/strategy-brief" style={btn('#0ea5e9')}>Daily Brief →</a>
          <button onClick={reload} style={btn('#6366f1')}>Refresh</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['command',     `Command View · ${overall.grade} (${overall.score})`],
          ['health',      'Health Scores'],
          ['pipeline',    'Strategy Pipeline'],
          ['actions',     `Top Actions (${(sc.topActions ?? []).length})`],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'command' && <CommandView sc={sc} components={components} />}
      {tab === 'health' && <HealthScoresView sc={sc} components={components} />}
      {tab === 'pipeline' && <PipelineView sc={sc} />}
      {tab === 'actions' && (
        <ActionsView
          actions={filteredActions}
          allActions={sc.topActions ?? []}
          filterPriority={filterPriority}
          setFilterPriority={setFilterPriority}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
        />
      )}
      {tab === 'methodology' && <MethodologyView sc={sc} />}
    </div>
  );
}

// ── Command View ────────────────────────────────────────────────────────────

function CommandView({ sc, components }: { sc: any; components: any[] }) {
  const overall = sc.overall;
  const top5 = (sc.topActions ?? []).slice(0, 5);

  return (
    <>
      {/* Overall + component gauges */}
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, alignItems: 'center' }}>
          <div style={{ textAlign: 'center', padding: 12 }}>
            <GaugeIndicator value={overall.score / 100} label="Overall Strategy Health" sublabel={`Grade ${overall.grade}`} height={200} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {components.map(c => {
              const grade = (
                c.score >= 90 ? 'A' : c.score >= 75 ? 'B' : c.score >= 60 ? 'C' : c.score >= 40 ? 'D' : 'F'
              );
              return (
                <div key={c.name} style={tile}>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.name}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: gradeColor[grade] }}>{c.score}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>weight {(c.weight * 100).toFixed(0)}% · grade {grade}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Operational warnings */}
      {sc.operationalWarnings?.length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #f59e0b' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Operational Warnings ({sc.operationalWarnings.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#fbbf24' }}>
            {sc.operationalWarnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Top 5 actions */}
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top Recommended Actions</h3>
        {top5.length === 0 ? (
          <div style={{ color: '#22c55e', padding: 12, fontSize: 13 }}>✓ No urgent actions. Strategy program is in good standing.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {top5.map((a: any) => <ActionCard key={a.id} action={a} />)}
          </div>
        )}
      </div>

      {/* Distributions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Pilot Status Distribution</h3>
          {sc.pilotStatusDistribution.length === 0 ? <EmptyChart title="No pilots" message="No pilots registered yet." /> : (
            <BarChart
              data={sc.pilotStatusDistribution.map((d: any) => ({ label: d.status, value: d.count, color: pilotStatusColor[d.status] ?? '#64748b' }))}
              valueFormatter={v => `${v}`}
              height={180}
            />
          )}
        </div>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Strategy Status Distribution</h3>
          {sc.strategyStatusDistribution.length === 0 ? <EmptyChart title="No strategies" message="No strategies registered yet." /> : (
            <BarChart
              data={sc.strategyStatusDistribution.map((d: any) => ({ label: d.status, value: d.count, color: strategyStatusColor[d.status] ?? '#64748b' }))}
              valueFormatter={v => `${v}`}
              height={180}
            />
          )}
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 4 }}>
        Generated at {new Date(sc.generatedAt).toLocaleString()}
      </div>
    </>
  );
}

// ── Health Scores View ──────────────────────────────────────────────────────

function HealthScoresView({ sc, components }: { sc: any; components: any[] }) {
  const sections: { key: string; title: string; score: any }[] = [
    { key: 'edgeHealth',          title: 'Edge Health',          score: sc.edgeHealth },
    { key: 'allocationHealth',    title: 'Allocation Health',    score: sc.allocationHealth },
    { key: 'pilotHealth',         title: 'Pilot Health',         score: sc.pilotHealth },
    { key: 'governanceHealth',    title: 'Governance Health',    score: sc.governanceHealth },
    { key: 'operationalHealth',   title: 'Operational Health',   score: sc.operationalHealth },
  ];

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Component Scores</h3>
        <BarChart
          data={components.map(c => ({
            label: c.name, value: c.score, sublabel: `${(c.weight * 100).toFixed(0)}%`,
            color: gradeColor[c.score >= 90 ? 'A' : c.score >= 75 ? 'B' : c.score >= 60 ? 'C' : c.score >= 40 ? 'D' : 'F'],
          }))}
          valueFormatter={v => `${v}`}
          height={220}
        />
      </div>

      {sections.map(({ key, title, score }) => (
        <div key={key} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{title}</h3>
            <div>
              <span style={{ fontSize: 28, fontWeight: 800, color: gradeColor[score.grade] }}>{score.score}</span>
              <span style={{ fontSize: 14, color: '#94a3b8', marginLeft: 8 }}>grade {score.grade}</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Reasons</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {score.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Inputs</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {Object.entries(score.inputs).map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ ...td, color: '#94a3b8', width: '60%' }}>{k}</td>
                      <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{v == null ? '—' : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// ── Pipeline View ───────────────────────────────────────────────────────────

function PipelineView({ sc }: { sc: any }) {
  const f = sc.pipelineFunnel;
  const stages: { label: string; value: number; link?: string }[] = [
    { label: 'Signals',                  value: f.signals,              link: '/admin/system/strategy-mode' },
    { label: 'Systematic Eligible',      value: f.systematicEligible,   link: '/admin/system/strategy-mode' },
    { label: 'Allocated',                value: f.allocated,            link: '/admin/system/portfolio-allocation' },
    { label: 'Captured Paper',           value: f.capturedPaper,        link: '/admin/system/paper-strategy-portfolio' },
    { label: 'Settled Paper',            value: f.settledPaper,         link: '/admin/system/paper-strategy-portfolio' },
    { label: 'Registered Strategies',    value: f.registeredStrategies, link: '/admin/system/strategy-registry' },
    { label: 'Active Pilots',            value: f.activePilots,         link: '/admin/system/strategy-pilot' },
    { label: 'Completed Reviews',        value: f.completedReviews,     link: '/admin/system/pilot-review' },
    { label: 'Completed Decisions',      value: f.completedDecisions,   link: '/admin/system/pilot-decisions' },
  ];
  const max = Math.max(1, ...stages.map(s => s.value));

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Strategy Lifecycle Funnel</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stages.map((s, i) => {
            const pct = max > 0 ? (s.value / max) * 100 : 0;
            const Row = (
              <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 60px', gap: 10, alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: '#cbd5e1' }}>{i + 1}. {s.label}</div>
                <div style={{ background: '#0f172a', borderRadius: 4, overflow: 'hidden', height: 24, position: 'relative' }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: `linear-gradient(90deg, #6366f1, #06b6d4)`,
                    transition: 'width 0.3s',
                  }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace', textAlign: 'right' }}>{s.value}</div>
              </div>
            );
            return s.link ? (
              <a key={s.label} href={s.link} style={{ textDecoration: 'none', color: '#e2e8f0' }} title={`Open ${s.label}`}>
                {Row}
              </a>
            ) : (
              <div key={s.label} style={{ color: '#e2e8f0' }} title={`${s.label} — no destination link configured`}>
                {Row}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 10 }}>
          Click a row to jump to that pipeline stage. Bar widths are normalized to the largest stage.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <div style={card}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Decision Summary</h3>
          <div style={grid4}>
            <Tile label="Total decisions"      value={`${sc.decisionSummary.total}`} />
            <Tile label="Open"                 value={`${sc.decisionSummary.byStatus.open + sc.decisionSummary.byStatus.in_progress}`} />
            <Tile label="Completed"            value={`${sc.decisionSummary.byStatus.completed}`} />
            <Tile label="Overdue"              value={`${sc.decisionSummary.overdueCount}`} color={sc.decisionSummary.overdueCount > 0 ? '#ef4444' : undefined} />
            <Tile label="Acceptance rate"      value={sc.decisionSummary.acceptanceRatePct == null ? '—' : `${sc.decisionSummary.acceptanceRatePct}%`} />
          </div>
        </div>
      </div>
    </>
  );
}

// ── Actions View ────────────────────────────────────────────────────────────

function ActionsView({
  actions, allActions, filterPriority, setFilterPriority, filterCategory, setFilterCategory,
}: {
  actions: any[]; allActions: any[];
  filterPriority: string; setFilterPriority: (v: string) => void;
  filterCategory: string; setFilterCategory: (v: string) => void;
}) {
  const priorityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const a of allActions) priorityCounts[a.priority] = (priorityCounts[a.priority] ?? 0) + 1;

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Action Priority Distribution</h3>
        {allActions.length === 0 ? (
          <div style={{ color: '#22c55e', padding: 12, fontSize: 13 }}>✓ No actions recommended. Strategy program is healthy.</div>
        ) : (
          <BarChart
            data={['critical', 'high', 'medium', 'low'].map(p => ({
              label: p, value: priorityCounts[p] ?? 0, color: priorityColor[p],
            }))}
            valueFormatter={v => `${v}`}
            height={160}
          />
        )}
      </div>

      <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Priority:</span>
        {['all', 'critical', 'high', 'medium', 'low'].map(p => (
          <button key={p} onClick={() => setFilterPriority(p)} style={btn(filterPriority === p ? '#6366f1' : '#334155')}>{p}</button>
        ))}
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 12 }}>Category:</span>
        {['all', 'edge', 'allocation', 'pilot', 'governance', 'ops'].map(c => (
          <button key={c} onClick={() => setFilterCategory(c)} style={btn(filterCategory === c ? '#6366f1' : '#334155')}>{c}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {actions.length === 0 ? (
          <div style={{ ...card, color: '#22c55e' }}>✓ No actions match the current filter.</div>
        ) : (
          actions.map((a: any) => <ActionCard key={a.id} action={a} />)
        )}
      </div>
    </>
  );
}

// ── Methodology View ────────────────────────────────────────────────────────

function MethodologyView({ sc }: { sc: any }) {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>How the scorecard is computed</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          {(sc.notes ?? []).map((n: string, i: number) => <li key={i} style={{ marginBottom: 6 }}>{n}</li>)}
        </ul>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Component weights</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Component</th><th style={th}>Weight</th><th style={th}>What it covers</th></tr></thead>
          <tbody>
            <tr><td style={td}>Edge</td><td style={td}>30%</td><td style={td}>Calibration quality, sample size, validated edge count, segment reliability</td></tr>
            <tr><td style={td}>Allocation</td><td style={td}>25%</td><td style={td}>Stress test verdict, concentration, drawdown vs capital, exposure ratio</td></tr>
            <tr><td style={td}>Pilot</td><td style={td}>20%</td><td style={td}>Active pilot warning status, ROI, drawdown, linked vs inferred records</td></tr>
            <tr><td style={td}>Governance</td><td style={td}>15%</td><td style={td}>Overdue/open decisions, unreviewed pilots, draft reviews, pilot_ready strategies w/o pilot</td></tr>
            <tr><td style={td}>Operational</td><td style={td}>10%</td><td style={td}>Paper portfolio sample size, open ratio, allocation warnings</td></tr>
          </tbody>
        </table>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Grade thresholds</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {[
            { g: 'A', range: '90-100', desc: 'Excellent — all components healthy' },
            { g: 'B', range: '75-89',  desc: 'Good — minor concerns only' },
            { g: 'C', range: '60-74',  desc: 'Acceptable — some attention needed' },
            { g: 'D', range: '40-59',  desc: 'Concerning — significant action required' },
            { g: 'F', range: '0-39',   desc: 'Failing — immediate review required' },
          ].map(x => (
            <div key={x.g} style={tile}>
              <div style={{ fontSize: 32, fontWeight: 800, color: gradeColor[x.g] }}>{x.g}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{x.range}</div>
              <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>{x.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>No autonomous trading, no order submission, no execution candidate creation.</li>
          <li>No pilot state changes, no auto-pause, no auto-resume.</li>
          <li>No automatic strategy promotion or status transitions.</li>
          <li>No live execution behavior changes.</li>
          <li>Read-only aggregation across pre-existing libraries.</li>
        </ul>
      </div>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ActionCard({ action }: { action: any }) {
  return (
    <a href={action.link} style={{ textDecoration: 'none', color: '#e2e8f0' }}>
      <div style={{ ...tile, borderLeft: `3px solid ${priorityColor[action.priority]}`, transition: 'background 0.15s' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={badge(priorityColor[action.priority])}>{action.priority}</span>
              <span style={badge(categoryColor[action.category])}>{action.category}</span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{action.title}</span>
            </div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>{action.description}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Why: {action.reason}</div>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>Open →</div>
        </div>
      </div>
    </a>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#e2e8f0', fontFamily: 'ui-monospace, Menlo, monospace' }}>{value}</div>
    </div>
  );
}
