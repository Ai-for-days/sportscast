import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';

export const prerender = false;

const BACKLOG_ITEMS = [
  // Observability
  { title: 'Instrument forecast ingestion with metrics', category: 'Observability', description: 'Forecast ingestion runs via external API calls with no single handler entry point. Refactoring to a unified handler would enable withMetric() instrumentation.', priority: 'medium', effort: 'medium' },
  { title: 'Instrument pricing/market generation', category: 'Observability', description: 'Pricing is generated in-memory by bookmaker-pricing.ts. No POST handler exists to wrap. Would need a dedicated generation endpoint.', priority: 'medium', effort: 'medium' },
  { title: 'Instrument candidate creation', category: 'Observability', description: 'Candidates are created via execution-candidates POST. Could add withMetric() wrapping to the createCandidate call.', priority: 'low', effort: 'small' },
  { title: 'Add API request middleware timing', category: 'Observability', description: 'Generic API request timing would require Astro middleware wrapping all routes. Would provide comprehensive latency data.', priority: 'low', effort: 'large' },

  // Data Integrity
  { title: 'Signal → Market cross-domain check', category: 'Data Integrity', description: 'Signals use ticker to reference markets but do not store a marketId. Cross-domain check would require ticker-based lookup against Kalshi market index.', priority: 'low', effort: 'medium' },
  { title: 'Reconciliation → Execution cross-domain check', category: 'Data Integrity', description: 'Reconciliation records use orderId + mode but the combined lookup across demo/live order stores is not straightforward.', priority: 'low', effort: 'medium' },
  { title: 'Settlement → Live Order validation', category: 'Data Integrity', description: 'Current settlement→order check only validates against demo orders. Should check both demo and live order prefixes.', priority: 'medium', effort: 'small' },

  // UX
  { title: 'Unify admin UI theme system', category: 'UX', description: 'Two theme systems coexist: light-mode Tailwind (Steps 22-35) and dark-mode inline styles (Steps 36+). Cosmetic unification would improve visual consistency.', priority: 'low', effort: 'large' },
  { title: 'Standardize table pagination controls', category: 'UX', description: 'Most pages use limit parameters but few have page-forward/back controls. Adding consistent pagination would improve large dataset navigation.', priority: 'medium', effort: 'medium' },
  { title: 'Add global admin search', category: 'UX', description: 'No cross-page search exists. Each page manages its own data independently. A global search would help operators find records quickly.', priority: 'low', effort: 'large' },
  { title: 'Improve empty state actionability', category: 'UX', description: 'Some empty states could link directly to the pipeline that generates data (e.g., "No signals — go to Kalshi Lab to generate").', priority: 'low', effort: 'small' },

  // Performance
  { title: 'Redis query batching', category: 'Performance', description: 'Many list functions query records one-by-one in a loop. Using Redis mget or pipeline would reduce round trips.', priority: 'medium', effort: 'medium' },
  { title: 'Cache tuning for high-traffic pages', category: 'Performance', description: 'Current cache TTL is 30s for most endpoints. High-traffic pages like Trading Desk could benefit from longer caching with manual invalidation.', priority: 'low', effort: 'small' },

  // Operational
  { title: 'Automated reconciliation scheduling', category: 'Operational', description: 'Reconciliation currently requires manual triggering. A cron-based schedule would ensure regular reconciliation without operator intervention.', priority: 'high', effort: 'medium' },
  { title: 'Establish forecast ingestion cadence', category: 'Operational', description: 'No automated pipeline scheduling exists for forecasts. Data freshness depends on manual runs. A scheduled ingestion would prevent stale data.', priority: 'high', effort: 'medium' },
  { title: 'Multi-operator identity support', category: 'Operational', description: 'Current system is single-operator (primary-admin). Multi-operator would require per-operator credentials instead of shared passphrase.', priority: 'low', effort: 'large' },
];

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const categories = [...new Set(BACKLOG_ITEMS.map(i => i.category))];
    const byPriority = { high: BACKLOG_ITEMS.filter(i => i.priority === 'high').length, medium: BACKLOG_ITEMS.filter(i => i.priority === 'medium').length, low: BACKLOG_ITEMS.filter(i => i.priority === 'low').length };

    return new Response(JSON.stringify({
      items: BACKLOG_ITEMS,
      summary: { total: BACKLOG_ITEMS.length, ...byPriority },
      categories,
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
