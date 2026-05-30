// ── Step 75: Reusable system / quant tool navigation ────────────────────────
//
// Drop-in component used on AdminDashboard, TradingDesk, OperatorDashboard,
// and SignalsDashboard so every system route is reachable in <=2 clicks
// from any operator-facing page.

import React from 'react';

interface NavItem {
  href: string;
  title: string;
  description: string;
  badge?: string;
  badgeColor?: string;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    heading: 'Calibration & Validation',
    items: [
      { href: '/admin/system/calibration-lab',       title: 'Calibration Lab',       description: 'Probability calibration, edge correlation, segment Brier scores' },
      { href: '/admin/system/calibration-backtest',  title: 'Calibration Backtest',  description: 'Raw vs calibrated strategy comparison + recommendations' },
      { href: '/admin/system/edge-validation',       title: 'Edge Validation',       description: 'Decision-grade: realized vs expected edge with Z-scores and CIs' },
      { href: '/admin/system/portfolio-allocation',  title: 'Portfolio Allocation',  description: 'Fractional-Kelly sizing for systematic-eligible signals (recommendation only)' },
      { href: '/admin/system/allocation-stress-test', title: 'Allocation Stress Test', description: 'Monte Carlo + 7 stress scenarios + drawdown verdict on the current allocation' },
      { href: '/admin/system/strategy-comparison',    title: 'Strategy Comparison', description: 'Side-by-side strategy variants with promotion-readiness verdicts' },
      { href: '/admin/system/strategy-registry',      title: 'Strategy Registry',   description: 'Formal strategy lifecycle (draft → research → … → pilot_ready) + manual promotion workflow' },
      { href: '/admin/system/strategy-pilot',         title: 'Pilot Control Room',  description: 'Plan, monitor, and review manual paper / demo / live_pilot deployments' },
      { href: '/admin/system/pilot-review',           title: 'Pilot Review',        description: 'Go / no-go recommendation: continue / pause / expand / stop / needs_more_data' },
      { href: '/admin/system/pilot-decisions',        title: 'Pilot Decisions',     description: 'Track operator follow-through on go/no-go recommendations (decision journal)' },
      { href: '/admin/system/strategy-scorecard',     title: 'Strategy Scorecard',  description: 'Executive command view: 5 health scores, top actions, and the full lifecycle funnel' },
      { href: '/admin/system/strategy-brief',         title: 'Strategy Brief',      description: 'Daily desk briefing + scorecard alerts (open / acknowledged / resolved)' },
      { href: '/admin/system/desk-queue',             title: 'Desk Queue',          description: 'Prioritized, time-aware action queue across scorecard / alerts / decisions / pilots' },
      { href: '/admin/system/execution-playbook',     title: 'Execution Playbook',  description: 'Manual checklist: signal → risk → pilot → approval → execution → post-trade' },
      { href: '/admin/system/playbook-audit',         title: 'Playbook Audit',      description: 'Compliance + execution-quality audit over manual playbook runs' },
      { href: '/admin/system/operator-training',      title: 'Operator Training',   description: 'Sandboxed practice scenarios with mock data + scoring rubric' },
      { href: '/admin/system/operator-certification', title: 'Operator Certification', description: 'Readiness verdicts + manual certification ledger (advisory only — no RBAC changes)' },
      { href: '/admin/system/operator-rbac-review',   title: 'RBAC Review',         description: 'Advisory governance: certification status vs current RBAC access (no permission changes)' },
      { href: '/admin/system/quant-review',          title: 'Quant Review',          description: 'Forecast / pricing / signal diagnostics + 3 quant mistakes' },
      { href: '/admin/system/quant-edge-audit',      title: 'Quant Edge Audit',      description: 'Friction haircut, statistical tests, conservative verdict' },
      { href: '/admin/system/outcome-evaluation',    title: 'Outcome Evaluation',    description: 'Win/loss, edge buckets, funnel — ex-post evidence' },
      { href: '/admin/system/end-to-end-validation', title: 'E2E Validation',        description: '24 workflow checks + 5 governance signoffs' },
      { href: '/admin/system/validation-center',     title: 'Validation Center',     description: 'Platform-wide validation (27 checks)' },
    ],
  },
  {
    heading: 'Execution & Economics',
    items: [
      { href: '/admin/system/execution-economics', title: 'Execution Economics', description: 'Expected vs realized edge, slippage, cost basis' },
      { href: '/admin/system/kalshi-integration',  title: 'Kalshi Integration',  description: 'External connectivity vs cached data + execution readiness' },
      { href: '/admin/system/kalshi-market-data',  title: 'Kalshi Market Data',  description: 'Read-only Kalshi market snapshots for bookmaking, comparison, and hedging analysis (no trades placed)' },
      { href: '/admin/system/polymarket-market-data', title: 'Polymarket Market Data', description: 'Read-only Polymarket weather market discovery (Gamma API). No wallet, no signing, no orders.', badge: 'NEW', badgeColor: 'bg-violet-100 text-violet-700' },
      { href: '/admin/system/forecast-provider-comparison', title: 'Forecast Provider Comparison', description: 'Admin-only A/B harness for forecast providers (Open-Meteo + opt-in WeatherNext sample/production). Read-only diagnostics — public default unchanged.', badge: 'NEW', badgeColor: 'bg-cyan-100 text-cyan-700' },
      { href: '/admin/system/forecast-research', title: 'Forecast Market Research', description: 'Enriched, operator-only forecast intelligence for setting markets: outlook, run-to-run revision history, model volatility, multi-day outlook, hourly detail, and suggested lines. Moved off the public ZIP pages. Read-only.', badge: 'NEW', badgeColor: 'bg-teal-100 text-teal-700' },
      { href: '/admin/system/weather-market-ideas', title: 'Weather Market Ideas', description: 'Admin-only draft generator for cross-location temperature spread markets. Idea-only — no market is created until an admin manually publishes one.', badge: 'NEW', badgeColor: 'bg-amber-100 text-amber-700' },
      { href: '/admin/system/weather-market-daily-brief', title: 'Daily Market Brief', description: 'Admin-only operator overview: today’s highlights, risk alerts, QA queue, stale drafts, and feedback signals. Read-only summary.', badge: 'NEW', badgeColor: 'bg-indigo-100 text-indigo-700' },
      { href: '/admin/system/weather-market-daily-digest', title: 'Daily Digest Preview', description: 'Server-rendered HTML + plaintext preview of the daily brief, formatted for an admin email handoff. Preview-only — no mailer wired up yet.', badge: 'NEW', badgeColor: 'bg-indigo-100 text-indigo-700' },
      { href: '/admin/system/forecast-divergence', title: 'Forecast Divergence', description: 'Admin-only divergence/volatility/settlement-risk/opportunity scoring across historical forecast snapshots. Pure heuristics; read-only.', badge: 'NEW', badgeColor: 'bg-sky-100 text-sky-700' },
      { href: '/admin/system/weathernext-probe', title: 'WeatherNext Probe', description: 'Admin-only diagnostic for the WeatherNext Vertex AI endpoint. Disabled by default; needs both kill-switch env vars to fire a single call. Open-Meteo remains the public default.', badge: 'NEW', badgeColor: 'bg-fuchsia-100 text-fuchsia-700' },
      { href: '/admin/system/seo-health', title: 'SEO Health', description: 'Read-only snapshot of the site SEO architecture: sitemap shard counts, hub coverage, ZIP priority tiers, noindex route groups, canonical host. No Search Console API integration.', badge: 'NEW', badgeColor: 'bg-emerald-100 text-emerald-700' },
      { href: '/admin/system/kalshi-market-comparison', title: 'Kalshi Comparison', description: 'Advisory diff between WagerOnWeather wagers and Kalshi snapshots — pricing gaps, hedge review (no execution, no auto-mirror)' },
      { href: '/admin/system/manual-hedge-review',      title: 'Hedge Review',     description: 'Documentation-only ledger for deciding whether to manually offset exposure on external venues like Kalshi. No order placement.', badge: 'NEW', badgeColor: 'bg-orange-100 text-orange-700' },
      { href: '/admin/system/pre-launch-audit',    title: 'Pre-Launch Audit',    description: 'Structured 20-risk launch readiness summary' },
    ],
  },
  {
    heading: 'System Health & Data',
    items: [
      { href: '/admin/system/health',             title: 'System Health',     description: 'Operation timings, subsystem health, instrumented coverage' },
      { href: '/admin/system/data-integrity',     title: 'Data Integrity',    description: '11-domain freshness + structural validation' },
      { href: '/admin/system/pipeline-cadence',   title: 'Pipeline Cadence',  description: 'Are forecast / pricing / settlement stages on schedule?' },
      { href: '/admin/system/cleanup-backlog',    title: 'Cleanup Backlog',   description: '16-item house-keeping checklist' },
    ],
  },
  {
    heading: 'Operator Tools',
    items: [
      { href: '/admin/system/command-center',   title: 'Command Center',     description: 'Top-level system map: overview, workflow, tool directory, current status, safety model, what to do next' },
      { href: '/admin/system/daily-operator-runbook', title: 'Daily Runbook', description: 'One-per-day operating checklist across creation / monitoring / resolution / governance / safety (recordkeeping only)' },
      { href: '/admin/system/end-of-day-report',     title: 'End-of-Day Report', description: 'Date-scoped snapshot of market / resolution / settlement / integrity / governance activity (read-only)' },
      { href: '/admin/system/incident-management',   title: 'Incident Management', description: 'Record, triage, investigate, and resolve operational incidents (workflow only — no auto-enforcement)' },
      { href: '/admin/system/weather-evidence',      title: 'Weather Evidence',   description: 'Manual multi-source weather observations with consensus / spread / verdict (advisory only — does not grade)' },
      { href: '/admin/system/dispute-workflow',      title: 'Disputes',           description: 'Document, investigate, recommend, and resolve disputed outcomes (advisory recommendations — no auto-regrade)' },
      { href: '/admin/system/wager-change-control',  title: 'Change Control',     description: 'Approve and document proposed wager changes (odds / line / void / regrade / settlement review). Approval only — implementation is manual.' },
      { href: '/admin/system/user-risk-monitoring',  title: 'User Risk',          description: 'Advisory responsible-play and integrity signals per user (no bans, no limits, no notifications)' },
      { href: '/admin/system/house-exposure',        title: 'House Exposure',     description: 'Read-only financial exposure & PnL: projected worst case, realized graded results, market + user concentration' },
      { href: '/admin/system/audit-investigation',   title: 'Audit Investigation', description: 'Read-only timeline reconstruction across wagers / disputes / incidents / integrity / governance — saved views with notes' },
      { href: '/admin/system/operational-health',    title: 'Operational Health', description: 'Subsystem status, stale data, workflow backlogs, API failures, Redis health — advisory snapshots only' },
      { href: '/admin/system/admin-notification-inbox', title: 'Admin Inbox',     description: 'Internal advisory inbox aggregating critical findings across all admin tools — never sends external notifications', badge: 'NEW', badgeColor: 'bg-indigo-100 text-indigo-700' },
      { href: '/admin/system/wager-resolution', title: 'Wager Resolution', description: 'Manually grade locked wagers using observed weather data — preview-then-grade, audit-logged, no balance changes' },
      { href: '/admin/system/wager-settlement-preview', title: 'Settlement Preview', description: 'Read-only payout / liability projection for graded wagers (does not move money)' },
      { href: '/admin/system/market-integrity',         title: 'Market Integrity',   description: 'Surveillance: concentration / pricing / participant / operational signals (advisory only — no enforcement)' },
      { href: '/admin/system/strategy-mode',  title: 'Strategy Mode',  description: 'Decision support / operator-approved / systematic research — controls signal labeling' },
      { href: '/admin/system/paper-strategy-portfolio', title: 'Paper Strategy Portfolio', description: 'Track which systematic-eligible signals would have been taken + later performance (paper only)' },
      { href: '/admin/system/desk-decisions', title: 'Desk Decisions', description: 'Manual decision journal: take / skip / watch / reject + outcome review' },
      { href: '/admin/system/desk-dry-run',   title: 'Desk Dry Run',   description: '21-step staged rehearsal of the full operator workflow' },
      { href: '/admin/system/pretend-user-testing', title: 'Pretend User Testing', description: 'Sandbox-only: walk the public/customer flow as a fake user. No real money or wallet writes.', badge: 'NEW', badgeColor: 'bg-emerald-100 text-emerald-700' },
    ],
  },
];

interface Props {
  /** When provided, the link matching this href is highlighted as the current page. */
  activeHref?: string;
  /** Defaults to "System / Quant Tools". */
  heading?: string;
}

/**
 * Light-mode card grid (matches the Tailwind admin pattern). Renders fine on
 * the dark inline-style admin pages too — its container is white so it
 * always reads cleanly regardless of surrounding theme.
 */
export default function SystemNav({ activeHref, heading = 'System / Quant Tools' }: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{heading}</h2>
        <a href="/admin" className="text-xs text-blue-600 hover:underline">Admin Home</a>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map(section => (
          <div key={section.heading}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{section.heading}</h3>
            <ul className="space-y-1.5">
              {section.items.map(item => {
                const isActive = activeHref === item.href;
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className={`block rounded px-2 py-1.5 text-xs transition-colors ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{item.title}</span>
                        {item.badge && (
                          <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${item.badgeColor ?? 'bg-gray-100 text-gray-600'}`}>
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500 leading-snug">{item.description}</div>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
