import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';

export const prerender = false;

const PAGES_REVIEWED = [
  { page: 'Trading Desk', path: '/admin/trading-desk', status: 'improved', fix: 'Added page description (Step 57)' },
  { page: 'Execution Control', path: '/admin/execution-control', status: 'materially_improved', fix: 'Added page description + success/error feedback banners for config changes and kill switch toggle + disabled states while saving' },
  { page: 'Demo Execution', path: '/admin/demo-execution', status: 'materially_improved', fix: 'Added page description + replaced alert() with inline feedback banner + improved empty state with actionable guidance' },
  { page: 'Live Execution', path: '/admin/live-execution', status: 'improved', fix: 'Added page description (Step 57)' },
  { page: 'Launch Readiness', path: '/admin/launch-readiness', status: 'improved', fix: 'Added page description (Step 57)' },
  { page: 'Settlement', path: '/admin/settlement', status: 'materially_improved', fix: 'Color-coded message banner (green success / red error) + disabled action buttons while processing + better empty state with actionable text + descriptive success messages' },
  { page: 'Reconciliation', path: '/admin/reconciliation', status: 'materially_improved', fix: 'Added success/error feedback banner after actions + descriptive success messages with auto-dismiss' },
  { page: 'Signals', path: '/admin/signals', status: 'materially_improved', fix: 'Improved empty state with guidance + replaced alert() with inline visual feedback + clearer button labels ("Add to Journal", "Create Candidate")' },
  { page: 'Operations Center', path: '/admin/operations-center', status: 'reviewed', fix: 'Already has title, description, nav, tabs — consistent' },
  { page: 'Operator Dashboard', path: '/admin/operator-dashboard', status: 'reviewed', fix: 'Already has title, description, summary objects — consistent' },
  { page: 'Validation Center', path: '/admin/system/validation-center', status: 'reviewed', fix: 'Step 51/52 — full pattern compliance' },
  { page: 'Security Audit', path: '/admin/system/security-audit', status: 'reviewed', fix: 'Step 53 — full pattern compliance' },
  { page: 'Authorization Audit', path: '/admin/system/authorization-audit', status: 'reviewed', fix: 'Step 54 — full pattern compliance' },
  { page: 'E2E Validation', path: '/admin/system/end-to-end-validation', status: 'reviewed', fix: 'Step 56 — full pattern compliance' },
];

const FIX_CATEGORIES = [
  { category: 'A. Empty states', count: 3, severity: 'medium', description: 'Improved empty state messages on Signals (filter guidance + next action), Demo Execution (actionable next step), and Settlement (specific rebuild instructions). Changed from generic "No data" to operator-actionable guidance.' },
  { category: 'B. Loading/error states', count: 4, severity: 'medium', description: 'Added success/error feedback banners to Execution Control, Demo Execution, Settlement, and Reconciliation. Replaced alert() dialogs with inline banners. Added disabled-button states during async operations. Color-coded messages (green=success, red=error).' },
  { category: 'C. Action clarity', count: 2, severity: 'medium', description: 'Signals: renamed vague "Journal" and "Candidate" buttons to "Add to Journal" and "Create Candidate". Settlement: added descriptive success messages showing which action completed.' },
  { category: 'D. Workflow clarity', count: 5, severity: 'medium', description: 'Added page descriptions to 5 high-traffic pages explaining what each page does and when to use it. Descriptions help new operators understand the workflow sequence.' },
  { category: 'E. Table usability', count: 0, severity: 'low', description: 'Tables are generally consistent within their theme system. No structural table changes were needed — the primary friction was around empty states and action feedback, not table layout.' },
];

const REMAINING_DEBT = [
  'Two UI theme systems coexist: light-mode Tailwind (Steps 22-35) and dark-mode inline styles (Steps 36-57). Both are functional — cosmetic unification is low priority.',
  'Table column widths are not standardized across all pages — each page sizes to its own data.',
  'No global search or cross-page filtering — each page manages its own data independently.',
  'Pagination is not standardized — most pages use limit parameters but few have page-forward controls.',
  'Some pages still use alert() for edge cases (e.g., LiveExecution confirmation flow uses a modal which is appropriate).',
];

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const materially = PAGES_REVIEWED.filter(p => p.status === 'materially_improved').length;
    const improved = PAGES_REVIEWED.filter(p => p.status === 'improved').length;
    const reviewed = PAGES_REVIEWED.filter(p => p.status === 'reviewed').length;

    return new Response(JSON.stringify({
      pagesReviewed: PAGES_REVIEWED.length,
      pagesMateriallyImproved: materially,
      pagesLightlyImproved: improved,
      pagesAlreadyConsistent: reviewed,
      pages: PAGES_REVIEWED,
      fixCategories: FIX_CATEGORIES,
      remainingDebt: REMAINING_DEBT,
      auditCompletedAt: new Date().toISOString(),
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
