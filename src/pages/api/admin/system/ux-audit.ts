import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';

export const prerender = false;

const PAGES_REVIEWED = [
  { page: 'Trading Desk', path: '/admin/trading-desk', status: 'improved', fix: 'Added page description' },
  { page: 'Execution Control', path: '/admin/execution-control', status: 'improved', fix: 'Added page description' },
  { page: 'Demo Execution', path: '/admin/demo-execution', status: 'improved', fix: 'Added page description' },
  { page: 'Live Execution', path: '/admin/live-execution', status: 'improved', fix: 'Added page description' },
  { page: 'Launch Readiness', path: '/admin/launch-readiness', status: 'improved', fix: 'Added page description' },
  { page: 'Settlement', path: '/admin/settlement', status: 'reviewed', fix: 'Already has title, description, nav, summary cards' },
  { page: 'Operations Center', path: '/admin/operations-center', status: 'reviewed', fix: 'Already has title, description, nav, tabs' },
  { page: 'Reconciliation', path: '/admin/reconciliation', status: 'reviewed', fix: 'Already has title, nav, summary cards' },
  { page: 'Signals', path: '/admin/signals', status: 'reviewed', fix: 'Already has title, description, nav, ranking data' },
  { page: 'Operator Dashboard', path: '/admin/operator-dashboard', status: 'reviewed', fix: 'Already has title, description, summary objects' },
  { page: 'Validation Center', path: '/admin/system/validation-center', status: 'reviewed', fix: 'Step 51/52 — full pattern compliance' },
  { page: 'Security Audit', path: '/admin/system/security-audit', status: 'reviewed', fix: 'Step 53 — full pattern compliance' },
  { page: 'Authorization Audit', path: '/admin/system/authorization-audit', status: 'reviewed', fix: 'Step 54 — full pattern compliance' },
  { page: 'E2E Validation', path: '/admin/system/end-to-end-validation', status: 'reviewed', fix: 'Step 56 — full pattern compliance' },
];

const FIX_CATEGORIES = [
  { category: 'Missing page descriptions', count: 5, severity: 'medium', description: 'Added concise description paragraphs under page titles for Trading Desk, Execution Control, Demo Execution, Live Execution, and Launch Readiness.' },
  { category: 'Loading states', count: 0, severity: 'none', description: 'All reviewed pages already have loading states. Consistent "Loading [page name]..." pattern.' },
  { category: 'Error states', count: 0, severity: 'none', description: 'All high-traffic pages have error state handling. Light-mode pages use text-red-600, dark-mode pages use inline styles.' },
  { category: 'Navigation links', count: 0, severity: 'none', description: 'All reviewed pages have nav links or cross-page links. Consistent placement in header area.' },
  { category: 'Summary cards', count: 0, severity: 'none', description: 'High-traffic pages (Trading Desk, Reconciliation, Operator Dashboard, Signals) have summary cards. Consistent grid patterns.' },
  { category: 'Empty states', count: 0, severity: 'low', description: 'Most pages show "No data" or empty table states. Some could be more actionable (e.g., "Run forecast ingestion first").' },
];

const REMAINING_DEBT = [
  'Two UI theme systems coexist: light-mode Tailwind (Steps 22-35) and dark-mode inline styles (Steps 36-56). Both are functional — cosmetic unification is not a priority.',
  'Some empty states could provide more actionable guidance (e.g., link to the pipeline that generates data).',
  'Table column widths are not standardized across all pages — each page sizes to its own data.',
  'No global search or cross-page filtering — each page manages its own data independently.',
  'Pagination is not standardized — most pages use limit parameters but few have page-forward controls.',
];

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const improved = PAGES_REVIEWED.filter(p => p.status === 'improved').length;
    const reviewed = PAGES_REVIEWED.length;

    return new Response(JSON.stringify({
      pagesReviewed: reviewed,
      pagesImproved: improved,
      pagesAlreadyConsistent: reviewed - improved,
      pages: PAGES_REVIEWED,
      fixCategories: FIX_CATEGORIES,
      remainingDebt: REMAINING_DEBT,
      auditCompletedAt: new Date().toISOString(),
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
