import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { suggestPricing } from '../../../lib/bookmaker-pricing';

function normalizeDate(input: string): string {
  if (input.includes('/')) {
    const [mm, dd, yyyy] = input.split('/');
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return input;
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const locationName = url.searchParams.get('locationName');
  const metric = url.searchParams.get('metric');
  const targetDate = url.searchParams.get('targetDate');
  const targetTime = url.searchParams.get('targetTime') || undefined;

  if (!locationName || !metric || !targetDate) {
    return new Response(JSON.stringify({ error: 'locationName, metric, and targetDate are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const targetDateISO = normalizeDate(targetDate);

  try {
    const result = await suggestPricing({ locationName, metric, targetDate: targetDateISO, targetTime });

    if (!result) {
      return new Response(JSON.stringify({ error: 'No matching forecasts found for the given parameters' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
