import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, HeatmapGrid, EmptyChart } from './charts';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #334155', fontSize: 12, color: '#94a3b8' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #1e293b', fontSize: 13 };
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });

const urgencyColor: Record<string, string> = { critical: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
const categoryColor: Record<string, string> = { edge: '#06b6d4', allocation: '#a855f7', pilot: '#22c55e', governance: '#f59e0b', ops: '#64748b' };
const tierColor: Record<string, string> = { critical_now: '#dc2626', today: '#f59e0b', soon: '#3b82f6', backlog: '#64748b' };
const tierLabel: Record<string, string> = { critical_now: 'Critical Now', today: 'Today', soon: 'Soon', backlog: 'Backlog' };
const sourceColor: Record<string, string> = { scorecard: '#6366f1', alert: '#ef4444', brief: '#06b6d4' };

type Tab = 'live' | 'category' | 'timeline' | 'methodology';

export default function DeskQueue() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('live');

  useEffect(() => { reload(); }, []);

  async function reload() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/system/desk-queue', { credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? j.error ?? 'failed');
      setData(j.queue);
    } catch (e: any) { setError(e?.message ?? 'network'); }
    setLoading(false);
  }

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>Loading desk queue…</div>;
  if (error) return <div style={{ color: '#ef4444', padding: 40 }}>Failed to load: {error}</div>;
  if (!data) return null;

  const queue: any[] = data.queue ?? [];
  const summary = data.summary;

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/desk-queue" /></div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>Desk Queue</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            Prioritized, time-aware action queue across scorecard, alerts, briefs, decisions, and active pilots.{' '}
            <strong>Prioritization + workflow only</strong> — no autonomous trading, no order submission, no execution-candidate creation, no pilot state changes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/admin/system/execution-playbook" style={btn('#22c55e')}>Start Playbook →</a>
          <a href="/admin/system/strategy-brief" style={btn('#0ea5e9')}>Strategy Brief →</a>
          <a href="/admin/system/strategy-scorecard" style={btn('#0ea5e9')}>Scorecard →</a>
          <button onClick={reload} style={btn('#6366f1')}>Refresh</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Stat label="Total tasks"      value={summary.total} />
          <Stat label="Critical Now"     value={summary.byTier.critical_now} color={tierColor.critical_now} />
          <Stat label="Today"            value={summary.byTier.today}        color={tierColor.today} />
          <Stat label="Soon"             value={summary.byTier.soon}         color={tierColor.soon} />
          <Stat label="Backlog"          value={summary.byTier.backlog}      color={tierColor.backlog} />
          <Stat label="Blocking"         value={summary.blockingCount}       color="#a855f7" />
          <Stat label="Overdue"          value={summary.overdueCount}        color="#ef4444" />
          <Stat label="Top score"        value={summary.topPriorityScore} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['live',        `Live Queue (${queue.length})`],
          ['category',    'By Category'],
          ['timeline',    'Timeline'],
          ['methodology', 'Methodology'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? '#6366f1' : '#334155'), padding: '8px 14px', fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'live' && <LiveView data={data} />}
      {tab === 'category' && <CategoryView data={data} />}
      {tab === 'timeline' && <TimelineView data={data} />}
      {tab === 'methodology' && <MethodologyView />}

      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 4 }}>
        Generated at {new Date(data.generatedAt).toLocaleString()}
      </div>
    </div>
  );
}

// ── Live Queue ──────────────────────────────────────────────────────────────

function LiveView({ data }: { data: any }) {
  const queue: any[] = data.queue ?? [];
  const top3 = queue.slice(0, 3);
  const byTier = data.byTier ?? { critical_now: [], today: [], soon: [], backlog: [] };

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top 3 — Do these first</h3>
        {top3.length === 0 ? (
          <div style={{ color: '#22c55e', fontSize: 13 }}>✓ Queue is empty. Nothing requires action right now.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {top3.map((t: any) => <TopTaskCard key={t.id} task={t} />)}
          </div>
        )}
      </div>

      {(['critical_now', 'today', 'soon', 'backlog'] as const).map(tier => {
        const list: any[] = byTier[tier] ?? [];
        if (list.length === 0) return null;
        return (
          <div key={tier} style={{ ...card, borderLeft: `3px solid ${tierColor[tier]}` }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>
              {tierLabel[tier]} <span style={{ color: '#94a3b8', fontWeight: 500 }}>({list.length})</span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map((t: any) => <TaskRow key={t.id} task={t} />)}
            </div>
          </div>
        );
      })}
    </>
  );
}

function TopTaskCard({ task }: { task: any }) {
  return (
    <a href={task.link} style={{ textDecoration: 'none', color: '#e2e8f0' }}>
      <div style={{ ...tile, padding: 16, borderLeft: `4px solid ${urgencyColor[task.urgency]}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: urgencyColor[task.urgency], fontFamily: 'ui-monospace, Menlo, monospace' }}>{task.priorityScore}</div>
          <span style={badge(tierColor[task.tier])}>{tierLabel[task.tier]}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={badge(urgencyColor[task.urgency])}>{task.urgency}</span>
          <span style={badge(categoryColor[task.category])}>{task.category}</span>
          <span style={badge(sourceColor[task.source])}>{task.source}</span>
          {task.blocking && <span style={badge('#a855f7')}>blocking</span>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{task.title}</div>
        <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 8 }}>{task.description}</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>{task.reason}</div>
        <div style={{ marginTop: 10 }}>
          <span style={btn('#6366f1')}>Go →</span>
        </div>
      </div>
    </a>
  );
}

function TaskRow({ task }: { task: any }) {
  return (
    <a href={task.link} style={{ textDecoration: 'none', color: '#e2e8f0' }}>
      <div style={{ ...tile, padding: 10, display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 12, alignItems: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: urgencyColor[task.urgency], fontFamily: 'ui-monospace, Menlo, monospace', textAlign: 'center' }}>
          {task.priorityScore}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={badge(urgencyColor[task.urgency])}>{task.urgency}</span>
            <span style={badge(categoryColor[task.category])}>{task.category}</span>
            <span style={badge(sourceColor[task.source])}>{task.source}</span>
            {task.blocking && <span style={badge('#a855f7')}>blocking</span>}
            {task.fireCount && task.fireCount >= 3 && <span style={badge('#f59e0b')}>×{task.fireCount}</span>}
            <span style={{ fontSize: 13, fontWeight: 700 }}>{task.title}</span>
          </div>
          <div style={{ fontSize: 12, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</div>
        </div>
        <span style={btn('#475569')}>Go →</span>
      </div>
    </a>
  );
}

// ── By Category ─────────────────────────────────────────────────────────────

function CategoryView({ data }: { data: any }) {
  const queue: any[] = data.queue ?? [];
  const cats: ('edge' | 'allocation' | 'pilot' | 'governance' | 'ops')[] = ['edge', 'allocation', 'pilot', 'governance', 'ops'];

  const byCategory = useMemo(() => {
    const m: Record<string, any[]> = { edge: [], allocation: [], pilot: [], governance: [], ops: [] };
    for (const t of queue) m[t.category].push(t);
    return m;
  }, [queue]);

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Category breakdown</h3>
        <BarChart
          data={cats.map(c => ({ label: c, value: byCategory[c].length, color: categoryColor[c] }))}
          valueFormatter={v => `${v}`}
          height={180}
        />
      </div>

      {cats.map(c => {
        const list = byCategory[c];
        if (list.length === 0) return null;
        return (
          <div key={c} style={{ ...card, borderLeft: `3px solid ${categoryColor[c]}` }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>
              {c.charAt(0).toUpperCase() + c.slice(1)} <span style={{ color: '#94a3b8', fontWeight: 500 }}>({list.length})</span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map((t: any) => <TaskRow key={t.id} task={t} />)}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ── Timeline View ───────────────────────────────────────────────────────────

function TimelineView({ data }: { data: any }) {
  const queue: any[] = data.queue ?? [];
  const overdue = queue.filter(t => t.factors?.timeSensitivity === 30);
  const today = queue.filter(t => t.factors?.timeSensitivity === 20);
  const stale = queue.filter(t => t.factors?.timeSensitivity === 15);
  const future = queue.filter(t => !t.factors?.timeSensitivity);

  // Urgency × tier heatmap
  const urgencies: ('critical' | 'high' | 'medium' | 'low')[] = ['critical', 'high', 'medium', 'low'];
  const tiers: ('critical_now' | 'today' | 'soon' | 'backlog')[] = ['critical_now', 'today', 'soon', 'backlog'];
  const heatmapCells = urgencies.flatMap(u =>
    tiers.map(tier => ({
      row: u,
      col: tierLabel[tier],
      value: queue.filter(t => t.urgency === u && t.tier === tier).length,
    })),
  );

  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Urgency × Tier heatmap</h3>
        {queue.length === 0 ? <EmptyChart title="No tasks" message="Queue is empty." /> : (
          <HeatmapGrid
            cells={heatmapCells}
            rowLabels={urgencies}
            colLabels={tiers.map(t => tierLabel[t])}
            valueFormatter={v => v == null ? '—' : `${v}`}
          />
        )}
      </div>

      <TimelineGroup label="Overdue" color="#dc2626" tasks={overdue} note="Past due dates / regenerated alerts" />
      <TimelineGroup label="Within 24 hours" color="#f59e0b" tasks={today} note="Decisions with dueDate inside next 24h" />
      <TimelineGroup label="Stale system / data" color="#a855f7" tasks={stale} note="Operational signals like paper-stale" />
      <TimelineGroup label="No deadline pressure" color="#3b82f6" tasks={future} note="Scored on severity / risk only" />
    </>
  );
}

function TimelineGroup({ label, color, tasks, note }: { label: string; color: string; tasks: any[]; note: string }) {
  if (tasks.length === 0) return null;
  return (
    <div style={{ ...card, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{label} <span style={{ color: '#94a3b8', fontWeight: 500 }}>({tasks.length})</span></h3>
        <div style={{ fontSize: 11, color: '#64748b' }}>{note}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tasks.map((t: any) => <TaskRow key={t.id} task={t} />)}
      </div>
    </div>
  );
}

// ── Methodology ─────────────────────────────────────────────────────────────

function MethodologyView() {
  return (
    <>
      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Priority score formula</h3>
        <p style={{ fontSize: 13, color: '#cbd5e1', margin: '0 0 10px' }}>
          Each candidate task is scored 0–100 by summing five weighted factors and capping at 100. Higher score = sooner.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Factor</th><th style={th}>Levels</th><th style={th}>Weight</th></tr></thead>
          <tbody>
            <tr><td style={td}>Severity</td><td style={td}>critical / high / medium / low</td><td style={td}>+40 / +25 / +10 / 0</td></tr>
            <tr><td style={td}>Time sensitivity</td><td style={td}>overdue / within 24h / stale / —</td><td style={td}>+30 / +20 / +15 / 0</td></tr>
            <tr><td style={td}>Risk impact</td><td style={td}>pilot breach / allocation unsafe / governance failure / data integrity / —</td><td style={td}>+30 / +25 / +20 / +15 / 0</td></tr>
            <tr><td style={td}>Dependency</td><td style={td}>blocks downstream decisions</td><td style={td}>+20</td></tr>
            <tr><td style={td}>Recurrence</td><td style={td}>fireCount ≥ 3</td><td style={td}>+10</td></tr>
          </tbody>
        </table>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Tier thresholds</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {(['critical_now', 'today', 'soon', 'backlog'] as const).map(t => (
            <div key={t} style={{ ...tile, borderLeft: `4px solid ${tierColor[t]}` }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{tierLabel[t]}</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{
                t === 'critical_now' ? 'score ≥ 80' :
                t === 'today'        ? 'score 60–79' :
                t === 'soon'         ? 'score 40–59' :
                                       'score < 40'
              }</div>
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Task sources</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li><strong>Scorecard top actions</strong> — re-scored under the priority engine's factor model.</li>
          <li><strong>Open / acknowledged scorecard alerts</strong> — resolved alerts are excluded; <code>fireCount</code> drives the recurrence factor.</li>
          <li><strong>Pilot decisions</strong> — open or in-progress; overdue → time +30, due within 24h → time +20.</li>
          <li><strong>Active pilots</strong> — breach (critical, +risk) and watch (high) per pilot id.</li>
          <li><strong>Missing reviews</strong> — active pilot with no PilotReview record (blocking) and draft reviews (medium).</li>
        </ul>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '8px 0 0' }}>
          Tasks are deduped by a stable <code>dedupeKey</code> — for example a pilot breach surfaced both by the scorecard and by an alert collapses into one task at the higher score.
        </p>
      </div>

      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Safety guarantees</h3>
        <ul style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, marginTop: 0 }}>
          <li>No autonomous trading, no order submission, no execution-candidate creation.</li>
          <li>No pilot state changes, no auto-pause, no auto-resume.</li>
          <li>No automatic strategy promotion or status transitions.</li>
          <li>No live-execution behavior changes.</li>
          <li>Read-only aggregation across the scorecard, alert, decision, pilot, and review libraries.</li>
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
