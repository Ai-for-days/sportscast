import type { APIRoute } from 'astro';
import {
  generateRepricingSuggestions,
  generateRepricingOverview,
  applySuggestion,
  listAppliedChanges,
} from '../../../lib/repricing-suggestions';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async () => {
  try {
    const suggestions = await generateRepricingSuggestions();
    const overview = await generateRepricingOverview(suggestions);
    const appliedChanges = await listAppliedChanges(30);

    return new Response(JSON.stringify({
      suggestions,
      overview,
      appliedChanges,
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/*  POST                                                                */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'apply-suggestion': {
        const { wagerId, appliedMarket, originalSuggestion, edited } = body;
        if (!wagerId || !appliedMarket || !originalSuggestion) {
          return new Response(JSON.stringify({ error: 'wagerId, appliedMarket, originalSuggestion required' }), { status: 400 });
        }
        const change = await applySuggestion(wagerId, appliedMarket, originalSuggestion, !!edited);
        if (!change) {
          return new Response(JSON.stringify({ error: 'Wager not found' }), { status: 404 });
        }
        return new Response(JSON.stringify({ ok: true, change }), { status: 200 });
      }

      case 'refresh-suggestions': {
        const suggestions = await generateRepricingSuggestions();
        const overview = await generateRepricingOverview(suggestions);
        return new Response(JSON.stringify({ ok: true, suggestions, overview }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
