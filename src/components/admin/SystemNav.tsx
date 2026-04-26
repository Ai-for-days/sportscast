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
      { href: '/admin/system/strategy-mode',  title: 'Strategy Mode',  description: 'Decision support / operator-approved / systematic research — controls signal labeling' },
      { href: '/admin/system/paper-strategy-portfolio', title: 'Paper Strategy Portfolio', description: 'Track which systematic-eligible signals would have been taken + later performance (paper only)' },
      { href: '/admin/system/desk-decisions', title: 'Desk Decisions', description: 'Manual decision journal: take / skip / watch / reject + outcome review' },
      { href: '/admin/system/desk-dry-run',   title: 'Desk Dry Run',   description: '21-step staged rehearsal of the full operator workflow' },
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
