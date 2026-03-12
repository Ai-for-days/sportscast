import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { suggestPointspread } from '../../../lib/bookmaker-pricing';

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

  const locationAName = url.searchParams.get('locationAName');
  const locationBName = url.searchParams.get('locationBName');
  const metric = url.searchParams.get('metric');
  const targetDate = url.searchParams.get('targetDate');
  const targetTime = url.searchParams.get('targetTime') || undefined;

  if (!locationAName || !locationBName || !metric || !targetDate) {
    return new Response(JSON.stringify({ error: 'locationAName, locationBName, metric, and targetDate are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const targetDateISO = normalizeDate(targetDate);

  try {
    const pointspread = await suggestPointspread({ locationAName, locationBName, metric, targetDate: targetDateISO, targetTime });

    if (!pointspread) {
      return new Response(JSON.stringify({ error: 'No matching forecasts found for one or both locations' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ pointspread }), {
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
