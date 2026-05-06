import React, { useEffect, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const badge = (bg: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: bg, color: '#fff' });
const sectionHeader: React.CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' };

const safetyColor: Record<string, string> = {
  advisory: '#22c55e',
  manual: '#f59e0b',
  operational: '#ef4444',
};
const safetyLabel: Record<string, string> = {
  advisory: 'advisory only',
  manual: 'manual-persisted',
  operational: 'operational',
};

interface ToolCard {
  title: string;
  href: string;
  description: string;
  safetyClass: 'advisory' | 'manual' | 'operational';
  safetyNote: string;
}

const TOOLS: ToolCard[] = [
  // ── Market creation ──
  {
    title: 'Wager Creation', href: '/admin/wagers', safetyClass: 'manual',
    description: 'Create odds / over-under / pointspread wagers with location, metric, target date, line, and odds.',
    safetyNote: 'Persists when you click Create Wager. Pricing engine + market design lab run inside the modal as advisory.',
  },
  {
    title: 'Pricing & Margin Engine', href: '/admin/wagers', safetyClass: 'advisory',
    description: 'Suggests odds with configurable margin (fair / 6% / 10% / custom). Embedded in the wager modal.',
    safetyNote: 'Advisory only. Apply Suggested Odds updates the form, not persisted data.',
  },
  {
    title: 'Market Design Lab', href: '/admin/wagers', safetyClass: 'advisory',
    description: 'Pre-publication scoring (fairness / fun / risk / house edge) with verdict + recommendations.',
    safetyNote: 'Advisory. Does not create or modify wagers.',
  },

  // ── Resolution & settlement ──
  {
    title: 'Wager Resolution', href: '/admin/system/wager-resolution', safetyClass: 'manual',
    description: 'Manually grade locked wagers with observed weather data, or void with a written reason.',
    safetyNote: 'Persists wager status (graded / void). Preview required before grade. Does not move money.',
  },
  {
    title: 'Settlement Preview', href: '/admin/system/wager-settlement-preview', safetyClass: 'advisory',
    description: 'Read-only payout / liability projection from existing bet records.',
    safetyNote: 'Advisory only. Does not move money, update balances, or pay users.',
  },
  {
    title: 'Market Integrity', href: '/admin/system/market-integrity', safetyClass: 'advisory',
    description: 'Surveillance: concentration, pricing, participant, and operational signals → integrity score + verdict.',
    safetyNote: 'Advisory only. No bans, no freezes, no enforcement actions.',
  },

  // ── Operator governance ──
  {
    title: 'Operator Training', href: '/admin/system/operator-training', safetyClass: 'advisory',
    description: 'Sandboxed practice with scenarios (signal review / risk / pilot / playbook / incident response). Mock data only.',
    safetyNote: 'Sandbox. Confined to training:* keys. Does not touch real wagers, orders, or pilots.',
  },
  {
    title: 'Operator Certification', href: '/admin/system/operator-certification', safetyClass: 'manual',
    description: 'Manual certification ledger with readiness verdicts and validity windows.',
    safetyNote: 'Persists cert records only. Does not grant RBAC or enable live execution.',
  },
  {
    title: 'RBAC Review', href: '/admin/system/operator-rbac-review', safetyClass: 'advisory',
    description: 'Reviews comparing certification status to current RBAC roles + permissions.',
    safetyNote: 'Advisory only. Does not grant, revoke, or modify RBAC.',
  },
  {
    title: 'Security & Access', href: '/admin/security', safetyClass: 'operational',
    description: 'Authoritative RBAC: assign / disable users, roles, permissions, approval requests.',
    safetyNote: 'Operational. The only place RBAC is mutated. Other admin pages link here for human action.',
  },

  // ── Strategy / quant tools ──
  {
    title: 'Calibration Lab', href: '/admin/system/calibration-lab', safetyClass: 'advisory',
    description: 'Probability calibration, segment Brier scores, edge correlation. Populates after orders settle.',
    safetyNote: 'Read-only analysis.',
  },
  {
    title: 'Execution Playbook', href: '/admin/system/execution-playbook', safetyClass: 'manual',
    description: 'Manual checklist walking signal → risk → pilot → approval → execution → post-trade.',
    safetyNote: 'Persists checklist runs. Does not submit orders or create candidates.',
  },
  {
    title: 'Playbook Audit', href: '/admin/system/playbook-audit', safetyClass: 'advisory',
    description: 'Compliance + execution-quality audit over playbook runs.',
    safetyNote: 'Read-only analysis.',
  },
  {
    title: 'Strategy Scorecard', href: '/admin/system/strategy-scorecard', safetyClass: 'advisory',
    description: 'Executive command view: 5 health scores, top actions, lifecycle funnel.',
    safetyNote: 'Read-only.',
  },
  {
    title: 'Desk Queue', href: '/admin/system/desk-queue', safetyClass: 'advisory',
    description: 'Prioritized, time-aware action queue across scorecard / alerts / decisions / pilots.',
    safetyNote: 'Read-only.',
  },
  {
    title: 'Operator Dashboard', href: '/admin/operator-dashboard', safetyClass: 'operational',
    description: 'Daily operator workspace — open tasks, P&L, reconciliation, live execution links.',
    safetyNote: 'Mix of operational and advisory. Each linked tool documents its own safety class.',
  },
];

interface SystemStatus {
  wagers: { open: number; locked: number; graded: number; void: number; total: number } | null;
  integrity: { totalReports: number; bySeverity: { critical: number; warning: number; info: number }; byVerdict: { healthy: number; monitor: number; elevated_risk: number }; warningCount: number; unresolvedAfterEventCount: number } | null;
  certification: { totalOperators: number; expiringSoonCount: number; byVerdict: any } | null;
  rbac: { totalReviews: number; bySeverity: { critical: number; warning: number; info: number }; unacknowledged: number } | null;
  settlement: { gradedCount: number; previewedCount: number; pending: number } | null;
  errors: { wagers?: string; integrity?: string; certification?: string; rbac?: string; settlement?: string };
}

export default function AdminCommandCenter() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { reload(); }, []);

  async function safeFetch<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: j.message ?? j.error ?? `HTTP ${res.status}` };
      return { ok: true, data: j as T };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'network error' };
    }
  }

  async function reload() {
    setLoading(true);
    const [wagersRes, integrityRes, certRes, rbacRes, settleGradedRes, settleListRes] = await Promise.all([
      safeFetch<{ wagers: any[] }>('/api/admin/wagers'),
      safeFetch<{ summary: any }>('/api/admin/system/market-integrity?action=summary'),
      safeFetch<{ summary: any }>('/api/admin/system/operator-certification?action=summary'),
      safeFetch<{ summary: any }>('/api/admin/system/operator-rbac-review?action=summary'),
      safeFetch<{ wagers: any[] }>('/api/admin/wager-settlement-preview?action=list-graded'),
      safeFetch<{ previews: any[] }>('/api/admin/wager-settlement-preview?action=list'),
    ]);

    const errors: SystemStatus['errors'] = {};

    let wagers: SystemStatus['wagers'] = null;
    if (wagersRes.ok) {
      const ws: any[] = (wagersRes.data?.wagers ?? []);
      const counts = { open: 0, locked: 0, graded: 0, void: 0, total: ws.length };
      for (const w of ws) {
        if (w.status === 'open') counts.open++;
        else if (w.status === 'locked') counts.locked++;
        else if (w.status === 'graded') counts.graded++;
        else if (w.status === 'void') counts.void++;
      }
      wagers = counts;
    } else { errors.wagers = wagersRes.error; }

    let integrity: SystemStatus['integrity'] = null;
    if (integrityRes.ok) {
      const s = integrityRes.data?.summary;
      if (s) {
        integrity = {
          totalReports: s.totalReports ?? 0,
          bySeverity: { critical: s.bySeverity?.critical ?? 0, warning: s.bySeverity?.warning ?? 0, info: s.bySeverity?.info ?? 0 },
          byVerdict: { healthy: s.byVerdict?.healthy ?? 0, monitor: s.byVerdict?.monitor ?? 0, elevated_risk: s.byVerdict?.elevated_risk ?? 0 },
          warningCount: s.warningCount ?? 0,
          unresolvedAfterEventCount: s.unresolvedAfterEventCount ?? 0,
        };
      }
    } else { errors.integrity = integrityRes.error; }

    let certification: SystemStatus['certification'] = null;
    if (certRes.ok) {
      const s = certRes.data?.summary;
      if (s) {
        certification = {
          totalOperators: s.totalOperators ?? 0,
          expiringSoonCount: s.expiringSoonCount ?? 0,
          byVerdict: s.byVerdict ?? {},
        };
      }
    } else { errors.certification = certRes.error; }

    let rbac: SystemStatus['rbac'] = null;
    if (rbacRes.ok) {
      const s = rbacRes.data?.summary;
      if (s) {
        rbac = {
          totalReviews: s.totalReviews ?? 0,
          bySeverity: { critical: s.bySeverity?.critical ?? 0, warning: s.bySeverity?.warning ?? 0, info: s.bySeverity?.info ?? 0 },
          unacknowledged: s.unacknowledged ?? 0,
        };
      }
    } else { errors.rbac = rbacRes.error; }

    let settlement: SystemStatus['settlement'] = null;
    if (settleGradedRes.ok && settleListRes.ok) {
      const gradedAndVoid = (settleGradedRes.data?.wagers ?? []) as any[];
      const previewed = new Set((settleListRes.data?.previews ?? []).map((p: any) => p.wagerId));
      const pending = gradedAndVoid.filter(w => !previewed.has(w.id)).length;
      settlement = {
        gradedCount: gradedAndVoid.length,
        previewedCount: (settleListRes.data?.previews ?? []).length,
        pending,
      };
    } else if (!settleGradedRes.ok) errors.settlement = settleGradedRes.error;

    setStatus({ wagers, integrity, certification, rbac, settlement, errors });
    setLoading(false);
  }

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}><SystemNav activeHref="/admin/system/command-center" /></div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800 }}>Admin Command Center</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', maxWidth: 820 }}>
            One page that explains the platform, where each tool lives, what's safe vs manual vs operational, and what to do next.
            Read-only — this page never mutates anything.
          </p>
        </div>
        <button type="button" onClick={reload} disabled={loading} style={btn('#6366f1')}
          title="Refresh status from existing read-only endpoints. No mutations.">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* 1. System Overview */}
      <div style={card}>
        <div style={sectionHeader}>1 · System Overview</div>
        <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', maxWidth: 820 }}>
          WagerOnWeather is an admin-driven weather sportsbook. The platform lets a human operator:
        </p>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13, color: '#cbd5e1' }}>
          <li><strong>Create</strong> weather wagers (odds / over-under / pointspread) tied to a location, metric, target date.</li>
          <li><strong>Price</strong> them with a configurable house margin and review market design before publishing.</li>
          <li><strong>Resolve</strong> outcomes manually using observed weather data, with a preview-then-grade workflow.</li>
          <li><strong>Preview settlement</strong> and liability against existing bet records — without moving money.</li>
          <li><strong>Monitor integrity</strong>: concentration risk, pricing anomalies, participant patterns, operational warnings.</li>
          <li><strong>Train and certify</strong> operators in a sandbox; track readiness via certification + RBAC review.</li>
          <li><strong>Govern access</strong> through a manual RBAC store with approvals and dual-control on sensitive actions.</li>
        </ul>
      </div>

      {/* 2. Workflow Map */}
      <div style={card}>
        <div style={sectionHeader}>2 · Workflow Map</div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 6 }}>Market creation</div>
          <FlowStrip steps={[
            { label: 'Draft wager', href: '/admin/wagers' },
            { label: 'Pricing rec', href: '/admin/wagers' },
            { label: 'Market design review', href: '/admin/wagers' },
            { label: 'Create Wager', href: '/admin/wagers' },
            { label: 'Lock', href: '/admin/wagers' },
            { label: 'Resolve / Grade', href: '/admin/system/wager-resolution' },
            { label: 'Settlement Preview', href: '/admin/system/wager-settlement-preview' },
            { label: 'Integrity', href: '/admin/system/market-integrity' },
          ]} />
        </div>

        <div>
          <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 6 }}>Operator governance</div>
          <FlowStrip steps={[
            { label: 'Training', href: '/admin/system/operator-training' },
            { label: 'Certification', href: '/admin/system/operator-certification' },
            { label: 'RBAC Review', href: '/admin/system/operator-rbac-review' },
            { label: 'Audit / Integrity', href: '/admin/system/market-integrity' },
          ]} />
        </div>
      </div>

      {/* 3. Tool Directory */}
      <div style={card}>
        <div style={sectionHeader}>3 · Tool Directory</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
          {TOOLS.map(t => <ToolCardView key={t.title} tool={t} />)}
        </div>
      </div>

      {/* 4. Current System Status */}
      <div style={card}>
        <div style={sectionHeader}>4 · Current System Status</div>
        {loading && !status ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading status from existing read-only endpoints…</div>
        ) : (
          <StatusBlock status={status} />
        )}
      </div>

      {/* 5. Safety Model */}
      <div style={{ ...card, borderLeft: '3px solid #22c55e' }}>
        <div style={sectionHeader}>5 · Safety Model</div>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#cbd5e1' }}>
          <li><strong>No autonomous trading.</strong> No system path submits orders, creates execution candidates, or changes live execution behavior automatically.</li>
          <li><strong>No automatic wager creation from analytics.</strong> Pricing recommendations and market design reviews are advisory only — the operator clicks Create Wager.</li>
          <li><strong>No automatic settlement.</strong> Grading and voiding require an explicit human click after a preview; settlement preview is read-only and never moves money.</li>
          <li><strong>No automatic RBAC changes.</strong> Operator certification and RBAC review are governance recommendations; the only place roles are mutated is <a href="/admin/security" style={{ color: '#6366f1' }}>/admin/security</a>.</li>
          <li><strong>Human confirmation required</strong> for grading, voiding, publishing, certifying, revoking, and applying pricing suggestions.</li>
        </ul>
      </div>

      {/* 6. What should I do next? */}
      <div style={card}>
        <div style={sectionHeader}>6 · What should I do next?</div>
        <NextActions status={status} />
      </div>

      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 4 }}>
        This page never mutates anything. Every link routes to a tool that documents its own safety class.
      </div>
    </div>
  );
}

// ── Workflow flow strip ──────────────────────────────────────────────────────

function FlowStrip({ steps }: { steps: { label: string; href: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <a href={s.href} style={{ ...tile, padding: '6px 10px', textDecoration: 'none', color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}
            title={`Go to ${s.label}`}>
            {s.label}
          </a>
          {i < steps.length - 1 && <span style={{ color: '#475569', fontSize: 14 }}>→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Tool card ────────────────────────────────────────────────────────────────

function ToolCardView({ tool }: { tool: ToolCard }) {
  return (
    <a href={tool.href} style={{ textDecoration: 'none', color: '#e2e8f0' }}>
      <div style={{ ...tile, padding: 14, height: '100%', display: 'flex', flexDirection: 'column', gap: 6, borderLeft: `3px solid ${safetyColor[tool.safetyClass]}` }}
        title={`Open ${tool.title}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{tool.title}</span>
          <span style={badge(safetyColor[tool.safetyClass])}>{safetyLabel[tool.safetyClass]}</span>
        </div>
        <div style={{ fontSize: 12, color: '#cbd5e1' }}>{tool.description}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 'auto' }}>
          <strong style={{ color: '#64748b' }}>Safety:</strong> {tool.safetyNote}
        </div>
      </div>
    </a>
  );
}

// ── Status panel ─────────────────────────────────────────────────────────────

function StatusBlock({ status }: { status: SystemStatus | null }) {
  if (!status) return <div style={{ color: '#94a3b8', fontSize: 13 }}>No data.</div>;
  const { wagers, integrity, certification, rbac, settlement, errors } = status;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <StatusCard
          title="Wagers"
          err={errors.wagers}
          rows={wagers ? [
            ['Open', wagers.open, '#3b82f6'],
            ['Locked', wagers.locked, '#f59e0b'],
            ['Graded', wagers.graded, '#22c55e'],
            ['Void', wagers.void, '#64748b'],
            ['Total', wagers.total, undefined],
          ] : null}
          link={{ href: '/admin/wagers', label: 'All Wagers →' }}
        />
        <StatusCard
          title="Market integrity"
          err={errors.integrity}
          rows={integrity ? [
            ['Reports', integrity.totalReports, undefined],
            ['Critical', integrity.bySeverity.critical, '#ef4444'],
            ['Warning', integrity.bySeverity.warning, '#f59e0b'],
            ['Elevated risk', integrity.byVerdict.elevated_risk, '#ef4444'],
            ['Unresolved markets', integrity.unresolvedAfterEventCount, '#ef4444'],
          ] : null}
          link={{ href: '/admin/system/market-integrity', label: 'Market Integrity →' }}
        />
        <StatusCard
          title="Operator certification"
          err={errors.certification}
          rows={certification ? [
            ['Operators', certification.totalOperators, undefined],
            ['Certified', certification.byVerdict.certified ?? 0, '#22c55e'],
            ['Cert ready', certification.byVerdict.certification_ready ?? 0, '#3b82f6'],
            ['Needs practice', certification.byVerdict.needs_practice ?? 0, '#f59e0b'],
            ['Expiring ≤30d', certification.expiringSoonCount, '#f59e0b'],
          ] : null}
          link={{ href: '/admin/system/operator-certification', label: 'Operator Certification →' }}
        />
        <StatusCard
          title="RBAC review"
          err={errors.rbac}
          rows={rbac ? [
            ['Reviews', rbac.totalReviews, undefined],
            ['Critical', rbac.bySeverity.critical, '#ef4444'],
            ['Warning', rbac.bySeverity.warning, '#f59e0b'],
            ['Unacknowledged', rbac.unacknowledged, '#ef4444'],
          ] : null}
          link={{ href: '/admin/system/operator-rbac-review', label: 'RBAC Review →' }}
        />
        <StatusCard
          title="Settlement preview"
          err={errors.settlement}
          rows={settlement ? [
            ['Graded / void wagers', settlement.gradedCount, undefined],
            ['Previews on file', settlement.previewedCount, '#22c55e'],
            ['Pending preview', settlement.pending, settlement.pending > 0 ? '#f59e0b' : undefined],
          ] : null}
          link={{ href: '/admin/system/wager-settlement-preview', label: 'Settlement Preview →' }}
        />
      </div>
    </>
  );
}

function StatusCard({ title, err, rows, link }: { title: string; err?: string; rows: [string, number | string, string?][] | null; link: { href: string; label: string } }) {
  return (
    <div style={{ ...tile, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      {err ? (
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          <span style={{ color: '#fbbf24' }}>not available</span> · {err}
        </div>
      ) : !rows ? (
        <div style={{ fontSize: 12, color: '#94a3b8' }}>no data</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {rows.map(([label, value, color]) => (
              <tr key={label} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '4px 0', color: '#94a3b8' }}>{label}</td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'ui-monospace, Menlo, monospace', color: color ?? '#e2e8f0', fontWeight: 700 }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <a href={link.href} style={{ ...btn('#475569'), alignSelf: 'flex-start', marginTop: 4 }}>{link.label}</a>
    </div>
  );
}

// ── Next actions ─────────────────────────────────────────────────────────────

function NextActions({ status }: { status: SystemStatus | null }) {
  if (!status) {
    return <div style={{ color: '#94a3b8', fontSize: 13 }}>No status data — refresh to populate recommendations.</div>;
  }
  const items: { tier: 'critical' | 'warning' | 'info'; label: string; href: string }[] = [];

  // Wagers past lock / unresolved
  if (status.integrity?.unresolvedAfterEventCount && status.integrity.unresolvedAfterEventCount > 0) {
    items.push({
      tier: 'critical',
      label: `${status.integrity.unresolvedAfterEventCount} market(s) unresolved past target date — grade or void.`,
      href: '/admin/system/wager-resolution',
    });
  }
  if (status.wagers && status.wagers.locked > 0) {
    items.push({
      tier: 'warning',
      label: `${status.wagers.locked} locked wager(s) waiting to be graded.`,
      href: '/admin/system/wager-resolution',
    });
  }

  // Integrity flags
  if (status.integrity?.byVerdict.elevated_risk && status.integrity.byVerdict.elevated_risk > 0) {
    items.push({
      tier: 'critical',
      label: `${status.integrity.byVerdict.elevated_risk} integrity report(s) at elevated risk — investigate.`,
      href: '/admin/system/market-integrity',
    });
  }
  if (status.integrity?.bySeverity.warning && status.integrity.bySeverity.warning > 0) {
    items.push({
      tier: 'warning',
      label: `${status.integrity.bySeverity.warning} integrity warning(s) on file — review.`,
      href: '/admin/system/market-integrity',
    });
  }

  // Settlement preview backlog
  if (status.settlement?.pending && status.settlement.pending > 0) {
    items.push({
      tier: 'warning',
      label: `${status.settlement.pending} graded / voided wager(s) without a settlement preview yet.`,
      href: '/admin/system/wager-settlement-preview',
    });
  }

  // Certification
  if (status.certification?.expiringSoonCount && status.certification.expiringSoonCount > 0) {
    items.push({
      tier: 'warning',
      label: `${status.certification.expiringSoonCount} operator certification(s) expire within 30 days.`,
      href: '/admin/system/operator-certification',
    });
  }
  if (status.certification?.byVerdict?.needs_practice && status.certification.byVerdict.needs_practice > 0) {
    items.push({
      tier: 'info',
      label: `${status.certification.byVerdict.needs_practice} operator(s) need more training before certifying.`,
      href: '/admin/system/operator-training',
    });
  }

  // RBAC
  if (status.rbac?.bySeverity.critical && status.rbac.bySeverity.critical > 0) {
    items.push({
      tier: 'critical',
      label: `${status.rbac.bySeverity.critical} RBAC review(s) at critical severity.`,
      href: '/admin/system/operator-rbac-review',
    });
  }
  if (status.rbac?.unacknowledged && status.rbac.unacknowledged > 0) {
    items.push({
      tier: 'info',
      label: `${status.rbac.unacknowledged} RBAC review(s) unacknowledged.`,
      href: '/admin/system/operator-rbac-review',
    });
  }

  if (items.length === 0) {
    return (
      <div style={{ color: '#22c55e', fontSize: 13 }}>
        ✓ Nothing pressing right now. Spot-check market integrity reports periodically and re-run reviews on high-traffic markets.
      </div>
    );
  }

  // Sort by tier
  const tierRank = { critical: 0, warning: 1, info: 2 };
  items.sort((a, b) => tierRank[a.tier] - tierRank[b.tier]);

  const tierColor: Record<string, string> = { critical: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((it, i) => (
        <li key={i} style={{ ...tile, padding: 10, borderLeft: `3px solid ${tierColor[it.tier]}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#e2e8f0' }}>{it.label}</span>
          <a href={it.href} style={btn('#475569')}>Open →</a>
        </li>
      ))}
    </ul>
  );
}
