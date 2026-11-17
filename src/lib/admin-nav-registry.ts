// Admin navigation registry (WOW-024). The single directory of every admin
// page: which section of the admin menu it sits in, or why it is hidden.
//
// Every file under src/pages/admin/**.astro has exactly one entry here
// (tests/admin-nav-registry.test.ts N1). Hidden pages stay reachable by URL;
// hiding is clutter control, not a safety control — the server-side order
// block and the public-data-only Kalshi state are the controls.
//
// Pure data and helpers: no fetch, no Redis, safe to import anywhere.

export type AdminSection =
  | 'today' | 'markets' | 'grading' | 'risk' | 'odds' | 'weather' | 'system' | 'team'
  | 'research' | 'external';

export type HiddenReason =
  | 'order-path' | 'candidate-write' | 'external-execution' | 'dead' | 'duplicate' | 'retired-source';

export interface AdminNavEntry {
  route: string;
  title: string;
  description: string;
  section: AdminSection | 'hidden';
  hiddenReason?: HiddenReason;
}

export const HIDDEN_REASONS: readonly HiddenReason[] = [
  'order-path', 'candidate-write', 'external-execution', 'dead', 'duplicate', 'retired-source',
];

/** Menu order: Hub first (it is the first Today entry), then the eight sections, then the two collapsed ones. */
export const SECTION_ORDER: { id: AdminSection; title: string; blurb: string; collapsed?: boolean }[] = [
  { id: 'today', title: 'Today', blurb: 'What needs attention today: briefs, alerts and the daily checklist.' },
  { id: 'markets', title: 'Markets', blurb: 'Create, schedule and review the wagers on the board.' },
  { id: 'grading', title: 'Grading & Settlement', blurb: 'Grade finished wagers, check the weather evidence and handle disputes.' },
  { id: 'risk', title: 'Risk & Players', blurb: 'House exposure, hedging review and player risk signals.' },
  { id: 'odds', title: 'Odds & Lines', blurb: 'The sportsbook odds feed, line movement and pricing.' },
  { id: 'weather', title: 'Weather & Forecasts', blurb: 'Forecast accuracy, research, the WOW Score and roof status.' },
  { id: 'system', title: 'System & Site', blurb: 'Health of the site, its data pipelines, incidents and SEO.' },
  { id: 'team', title: 'Team & Training', blurb: 'Search, the training manual, admins and operator certification.' },
  { id: 'research', title: 'Research', blurb: 'Quant research and validation tools. Not needed day to day.', collapsed: true },
  { id: 'external', title: 'External Markets (read-only)', blurb: 'Public Kalshi and Polymarket market data. No trading.', collapsed: true },
];

const e = (route: string, title: string, description: string, section: AdminSection | 'hidden', hiddenReason?: HiddenReason): AdminNavEntry =>
  ({ route, title, description, section, ...(hiddenReason ? { hiddenReason } : {}) });

export const ADMIN_NAV: AdminNavEntry[] = [
  // ── Today (7) ──
  e('/admin', 'Admin Home', 'Start here: every admin section on one page.', 'today'),
  e('/admin/system/weather-market-daily-brief', 'Daily Market Brief', 'Today’s highlights, risk alerts, QA queue, stale drafts and feedback. Read-only.', 'today'),
  e('/admin/system/weather-market-daily-digest', 'Daily Digest Preview', 'The daily brief formatted as an email, preview only.', 'today'),
  e('/admin/system/daily-operator-runbook', 'Daily Runbook', 'One-per-day operating checklist: creation, monitoring, resolution, governance, safety.', 'today'),
  e('/admin/system/end-of-day-report', 'End-of-Day Report', 'Date-scoped snapshot of markets, grading, settlement and integrity. Read-only.', 'today'),
  e('/admin/system/alert-log', 'Alert Log', 'Every alert and notice, 24 h / 7 d summaries, and upstream source status.', 'today'),
  e('/admin/system/admin-notification-inbox', 'Admin Inbox', 'Internal inbox of critical findings across admin tools. Never sends anything out.', 'today'),

  // ── Markets (5) ──
  e('/admin/wagers', 'Wager Dashboard', 'Create, edit, lock and review wagers on the board.', 'markets'),
  e('/admin/system/wager-schedule', 'Wager Schedule', 'All-sports schedule for a date with rotation numbers and venue forecasts; create a wager from any game.', 'markets'),
  e('/admin/system/weather-market-ideas', 'Weather Market Ideas', 'Draft ideas for temperature-spread markets. Nothing is created until an admin publishes it.', 'markets'),
  e('/admin/system/wager-change-control', 'Change Control', 'Approve and document proposed wager changes: odds, line, void, regrade, settlement review.', 'markets'),
  e('/admin/market-performance', 'Market Performance', 'How published markets performed: handle, results and hold.', 'markets'),
  e('/admin/line-results', 'Line Results', 'How accurate our numbers were vs the actual temperatures, and how often favorites covered.', 'markets'),

  // ── Grading & Settlement (4) ──
  e('/admin/system/wager-resolution', 'Wager Resolution', 'Grade locked wagers from observed weather: preview, then grade. Audit-logged.', 'grading'),
  e('/admin/system/weather-evidence', 'Weather Evidence', 'Multi-source weather observations with consensus and spread. Advisory; does not grade.', 'grading'),
  e('/admin/system/wager-settlement-preview', 'Settlement Preview', 'Payout and liability projection for graded wagers. Does not move money.', 'grading'),
  e('/admin/system/dispute-workflow', 'Disputes', 'Document, investigate and resolve disputed outcomes.', 'grading'),

  // ── Risk & Players (6) ──
  e('/admin/system/house-exposure', 'House Exposure', 'Worst-case exposure, graded results, and market and player concentration. Read-only.', 'risk'),
  e('/admin/trading-desk', 'Trading Desk', 'The risk desk overview.', 'risk'),
  e('/admin/trading-desk/risk', 'Desk Risk', 'Open risk by market.', 'risk'),
  e('/admin/trading-desk/hedging', 'Hedging Review', 'Where exposure could be offset. Review only; no orders.', 'risk'),
  e('/admin/system/market-integrity', 'Market Integrity', 'Surveillance signals: concentration, pricing, participants, operations. Advisory.', 'risk'),
  e('/admin/system/user-risk-monitoring', 'User Risk', 'Responsible-play and integrity signals per player. Advisory only.', 'risk'),

  // ── Odds & Lines (4) ──
  e('/admin/system/odds-feed', 'Odds Feed', 'Sportsbook odds pushed from the scraper: last push, unmatched games, refused pushes.', 'odds'),
  e('/admin/trading-desk/line-movement', 'Line Movement', 'How lines moved over time.', 'odds'),
  e('/admin/trading-desk/closing-line', 'Closing Line', 'Closing-line comparison for settled markets.', 'odds'),
  e('/admin/pricing-lab', 'Pricing Lab', 'Try pricing settings on sample markets.', 'odds'),

  // ── Weather & Forecasts (5) ──
  e('/admin/forecasts', 'Forecast Tracker', 'Logged forecasts by city, measure and source, with verification.', 'weather'),
  e('/admin/forecast-performance', 'Forecast Performance', 'Accuracy, mean error and bias over time by source, measure, location and lead time.', 'weather'),
  e('/admin/system/forecast-research', 'Forecast Market Research', 'Operator forecast detail for setting markets: outlook, revisions, volatility, suggested lines.', 'weather'),
  e('/admin/system/wes-control', 'WOW Score Control', 'WOW Score per game, and its weights.', 'weather'),
  e('/admin/system/roof-status', 'Roof Status', 'Open/closed override for retractable-roof venues.', 'weather'),

  // ── System & Site (9) ──
  e('/admin/system/health', 'System Health', 'Operation timings and subsystem health.', 'system'),
  e('/admin/system/operational-health', 'Operational Health', 'Stale data, workflow backlogs, API failures and Redis health.', 'system'),
  e('/admin/system/data-integrity', 'Data Integrity', 'Freshness and structure checks across 11 data areas.', 'system'),
  e('/admin/system/pipeline-cadence', 'Pipeline Cadence', 'Are the forecast, pricing and settlement stages on schedule?', 'system'),
  e('/admin/system/command-center', 'Command Center', 'System map: overview, workflow, status and what to do next.', 'system'),
  e('/admin/system/incident-management', 'Incident Management', 'Record, triage and resolve operational incidents.', 'system'),
  e('/admin/system/audit-investigation', 'Audit Investigation', 'Timeline across wagers, disputes, incidents and governance, with saved views. Read-only.', 'system'),
  e('/admin/system/seo-health', 'SEO Health', 'Sitemaps, hub coverage, ZIP tiers, noindex groups and canonical host.', 'system'),
  e('/admin/system/pretend-user-testing', 'Pretend User Testing', 'Walk the public flow as a fake user. No real money.', 'system'),

  // ── Team & Training (7) ──
  e('/admin/search', 'Search Admin Tools', 'Find any admin tool by name or what it does.', 'team'),
  e('/admin/training', 'Training Manual', 'The operator and admin guide. Start here when onboarding.', 'team'),
  e('/admin/admins', 'Manage Admins', 'Owner only: add admins with their own login.', 'team'),
  e('/admin/security', 'Security', 'Admin security settings and sessions.', 'team'),
  e('/admin/system/operator-training', 'Operator Training', 'Practice scenarios with mock data and scoring.', 'team'),
  e('/admin/system/operator-certification', 'Operator Certification', 'Readiness verdicts and the certification ledger. Advisory.', 'team'),
  e('/admin/system/operator-rbac-review', 'RBAC Review', 'Certification status against current access. Advisory; changes no permissions.', 'team'),

  // ── Research, collapsed (31) ──
  e('/admin/backtesting', 'Backtesting', 'Backtest pricing and strategies on history.', 'research'),
  e('/admin/launch-readiness', 'Launch Readiness', 'Launch checklist status.', 'research'),
  e('/admin/model-governance', 'Model Governance', 'Model versions and approvals.', 'research'),
  e('/admin/reports', 'Reports', 'Generated reports.', 'research'),
  e('/admin/system/allocation-stress-test', 'Allocation Stress Test', 'Monte Carlo and stress scenarios on the research allocation.', 'research'),
  e('/admin/system/authorization-audit', 'Authorization Audit', 'Who can do what, audited.', 'research'),
  e('/admin/system/calibration-backtest', 'Calibration Backtest', 'Raw against calibrated strategy comparison.', 'research'),
  e('/admin/system/calibration-lab', 'Calibration Lab', 'Probability calibration and segment Brier scores.', 'research'),
  e('/admin/system/cleanup-backlog', 'Cleanup Backlog', 'House-keeping checklist.', 'research'),
  e('/admin/system/desk-queue', 'Desk Queue', 'Prioritized research action queue.', 'research'),
  e('/admin/system/edge-validation', 'Edge Validation', 'Realized against expected edge with confidence intervals.', 'research'),
  e('/admin/system/end-to-end-validation', 'E2E Validation', 'Workflow checks and governance sign-offs.', 'research'),
  e('/admin/system/forecast-divergence', 'Forecast Divergence', 'Divergence and volatility scoring across forecast snapshots. Read-only.', 'research'),
  e('/admin/system/forecast-provider-comparison', 'Forecast Provider Comparison', 'A/B harness for forecast providers. Read-only diagnostics.', 'research'),
  e('/admin/system/outcome-evaluation', 'Outcome Evaluation', 'Win/loss and edge buckets after the fact.', 'research'),
  e('/admin/system/paper-strategy-portfolio', 'Paper Strategy Portfolio', 'Paper-only tracking of research signals.', 'research'),
  e('/admin/system/pilot-decisions', 'Pilot Decisions', 'Decision journal for pilot recommendations.', 'research'),
  e('/admin/system/pilot-review', 'Pilot Review', 'Go / no-go recommendations for pilots.', 'research'),
  e('/admin/system/portfolio-allocation', 'Portfolio Allocation', 'Research sizing for signals. Recommendation only.', 'research'),
  e('/admin/system/pre-launch-audit', 'Pre-Launch Audit', 'Launch risk summary.', 'research'),
  e('/admin/system/quant-edge-audit', 'Quant Edge Audit', 'Friction haircut and statistical tests.', 'research'),
  e('/admin/system/quant-review', 'Quant Review', 'Forecast, pricing and signal diagnostics.', 'research'),
  e('/admin/system/security-audit', 'Security Audit', 'Security review checklist.', 'research'),
  e('/admin/system/strategy-brief', 'Strategy Brief', 'Research briefing and scorecard alerts.', 'research'),
  e('/admin/system/strategy-comparison', 'Strategy Comparison', 'Side-by-side research strategy variants.', 'research'),
  e('/admin/system/strategy-mode', 'Strategy Mode', 'How research signals are labelled.', 'research'),
  e('/admin/system/strategy-pilot', 'Pilot Control Room', 'Plan and review paper pilots.', 'research'),
  e('/admin/system/strategy-registry', 'Strategy Registry', 'Research strategy lifecycle.', 'research'),
  e('/admin/system/strategy-scorecard', 'Strategy Scorecard', 'Research health scores and lifecycle funnel.', 'research'),
  e('/admin/system/validation-center', 'Validation Center', 'Platform-wide validation checks.', 'research'),
  e('/admin/system/weathernext-probe', 'WeatherNext Probe', 'Diagnostic for the WeatherNext endpoint. Disabled by default.', 'research'),

  // ── External Markets (read-only), collapsed (4) ──
  e('/admin/system/kalshi-market-data', 'Kalshi Market Data', 'Public Kalshi market snapshots. No account, no trades.', 'external'),
  e('/admin/system/kalshi-market-comparison', 'Kalshi Comparison', 'Our wagers next to Kalshi snapshots. Advisory only.', 'external'),
  e('/admin/system/kalshi-integration', 'Kalshi Integration', 'Kalshi data connectivity status.', 'external'),
  e('/admin/system/polymarket-market-data', 'Polymarket Market Data', 'Public Polymarket weather markets. No wallet, no orders.', 'external'),

  // ── Hidden (33): reachable by URL, never linked from the menu, Hub or search ──
  e('/admin/demo-execution', 'Demo Execution', 'Kalshi demo order page.', 'hidden', 'order-path'),
  e('/admin/execution-control', 'Execution Control', 'Kalshi execution settings.', 'hidden', 'order-path'),
  e('/admin/live-execution', 'Live Execution', 'Kalshi live order page.', 'hidden', 'order-path'),
  e('/admin/live-readiness', 'Live Readiness', 'Kalshi live-trading enablement.', 'hidden', 'order-path'),
  e('/admin/execution-candidates', 'Execution Candidates', 'Kalshi order candidates.', 'hidden', 'candidate-write'),
  e('/admin/signals', 'Signals', 'Kalshi signal candidates.', 'hidden', 'candidate-write'),
  e('/admin/portfolio', 'Portfolio', 'Kalshi portfolio candidates.', 'hidden', 'candidate-write'),
  e('/admin/kalshi-lab', 'Kalshi Lab', 'Kalshi experiments.', 'hidden', 'candidate-write'),
  e('/admin/alerts', 'Alerts (old)', 'External execution alerts.', 'hidden', 'external-execution'),
  e('/admin/operator-dashboard', 'Operator Dashboard', 'External execution operator view.', 'hidden', 'external-execution'),
  e('/admin/reconciliation', 'Reconciliation', 'External order reconciliation.', 'hidden', 'external-execution'),
  e('/admin/trade-journal', 'Trade Journal', 'External trade journal.', 'hidden', 'external-execution'),
  e('/admin/system/desk-decisions', 'Desk Decisions', 'External trade decision journal.', 'hidden', 'external-execution'),
  e('/admin/system/desk-dry-run', 'Desk Dry Run', 'External execution rehearsal.', 'hidden', 'external-execution'),
  e('/admin/system/execution-economics', 'Execution Economics', 'External execution costs.', 'hidden', 'external-execution'),
  e('/admin/system/execution-playbook', 'Execution Playbook', 'External execution checklist.', 'hidden', 'external-execution'),
  e('/admin/system/manual-hedge-review', 'Hedge Review (external)', 'External hedge ledger.', 'hidden', 'external-execution'),
  e('/admin/system/playbook-audit', 'Playbook Audit', 'External execution audit.', 'hidden', 'external-execution'),
  e('/admin/history', 'History', 'Unused page.', 'hidden', 'dead'),
  e('/admin/market-making', 'Market Making', 'Unused page.', 'hidden', 'dead'),
  e('/admin/model-attribution', 'Model Attribution', 'Unused page.', 'hidden', 'dead'),
  e('/admin/notifications', 'Notifications (old)', 'Unused page.', 'hidden', 'dead'),
  e('/admin/research-sandbox', 'Research Sandbox', 'Unused page.', 'hidden', 'dead'),
  e('/admin/resilience', 'Resilience', 'Unused page.', 'hidden', 'dead'),
  e('/admin/settlement', 'Settlement (old)', 'Unused page.', 'hidden', 'dead'),
  e('/admin/venues', 'Venues (old)', 'Unused page.', 'hidden', 'dead'),
  e('/admin/system/update-control', 'Update Control', 'Unused page.', 'hidden', 'dead'),
  e('/admin/system/ux-audit', 'UX Audit', 'Unused page.', 'hidden', 'dead'),
  e('/admin/change-control', 'Change Control (old)', 'Duplicate of system/wager-change-control.', 'hidden', 'duplicate'),
  e('/admin/operations-center', 'Operations Center', 'Duplicate of system/incident-management.', 'hidden', 'duplicate'),
  e('/admin/compliance', 'Compliance', 'Duplicate of system/audit-investigation.', 'hidden', 'duplicate'),
  e('/admin/performance', 'Performance', 'Duplicate of system/health.', 'hidden', 'duplicate'),
  e('/admin/system/odds-usage', 'Odds API Usage', 'The Odds API was cancelled.', 'hidden', 'retired-source'),
];

/** Entries a menu, Hub or search may show (everything except hidden). */
export function visibleEntries(): AdminNavEntry[] {
  return ADMIN_NAV.filter((x) => x.section !== 'hidden');
}

export function entriesFor(section: AdminSection): AdminNavEntry[] {
  return ADMIN_NAV.filter((x) => x.section === section);
}

/** True for /admin and any path below it (not /administrator etc.). */
export function isAdminPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  return p === '/admin' || p.startsWith('/admin/');
}

/**
 * Whether the admin menu bar renders: only on admin paths and only for a
 * signed-in admin. Inner admin pages redirect to /admin before rendering when
 * there is no session, so reaching their layout implies one; /admin itself
 * (the login form) must pass its session state explicitly.
 */
export function shouldShowAdminNav(pathname: string, hasSession: boolean): boolean {
  return isAdminPath(pathname) && hasSession === true;
}

/** Which section a path belongs to, for highlighting (longest matching route wins). */
export function sectionForPath(pathname: string): AdminSection | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  let best: AdminNavEntry | null = null;
  for (const x of ADMIN_NAV) {
    // The Hub (/admin) is highlighted by the "Admin Home" button, never as a
    // section; skipping it also stops every /admin/... path matching "Today".
    if (x.section === 'hidden' || x.route === '/admin') continue;
    if ((p === x.route || p.startsWith(x.route + '/')) && (!best || x.route.length > best.route.length)) best = x;
  }
  return best ? (best.section as AdminSection) : null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Server-rendered menu bar HTML (no client framework; native <details>).
 * Used by BaseLayout and by the tests, so the tests check exactly what ships.
 */
export function renderAdminNavBar(pathname: string): string {
  const current = sectionForPath(pathname);
  const sectionHtml = (id: AdminSection, title: string, mobile: boolean) => {
    const items = entriesFor(id).filter((x) => x.route !== '/admin');
    const links = items.map((x) =>
      `<li><a class="admin-nav-link" href="${esc(x.route)}"${x.route === pathname ? ' aria-current="page"' : ''}>${esc(x.title)}</a></li>`).join('');
    return `<details class="admin-nav-section${mobile ? ' admin-nav-mobile-section' : ''}${current === id ? ' is-current' : ''}" data-section="${id}">`
      + `<summary>${esc(title)}</summary><ul>${links}</ul></details>`;
  };
  const desktop = SECTION_ORDER.map((s) => sectionHtml(s.id, s.title, false)).join('');
  const mobile = SECTION_ORDER.map((s) => sectionHtml(s.id, s.title, true)).join('');
  const search = `<form class="admin-nav-search" action="/admin/search" method="get" role="search">`
    + `<input type="search" name="q" placeholder="Search admin tools" aria-label="Search admin tools" /></form>`;
  return `<nav class="admin-nav" aria-label="Admin">`
    + `<div class="admin-nav-inner">`
    + `<a class="admin-nav-home${pathname.replace(/\/+$/, '') === '/admin' ? ' is-current' : ''}" href="/admin">Admin Home</a>`
    + `<div class="admin-nav-desktop">${desktop}</div>`
    + `<details class="admin-nav-menu"><summary>Admin menu</summary><div>${mobile}</div></details>`
    + search
    + `<a class="admin-nav-alerts" href="/admin/system/alert-log">Alert Log <span id="alert-log-badge" hidden></span></a>`
    + `</div></nav>`;
}
