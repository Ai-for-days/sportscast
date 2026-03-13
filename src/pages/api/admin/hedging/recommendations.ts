import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { generateHedgingRecommendations } from '../../../../lib/exposure-hedging';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const riskFilter = url.searchParams.get('risk');
    const typeFilter = url.searchParams.get('type');

    let recommendations = await generateHedgingRecommendations();

    if (riskFilter) {
      recommendations = recommendations.filter(r => r.riskLevel === riskFilter);
    }
    if (typeFilter) {
      recommendations = recommendations.filter(r => r.marketType === typeFilter);
    }

    return new Response(JSON.stringify({ recommendations }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed' }), { status: 500 });
  }
};
