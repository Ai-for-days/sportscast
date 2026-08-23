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
  const metricA = url.searchParams.get('metricA') || undefined;
  const metricB = url.searchParams.get('metricB') || undefined;
  const parseCoord = (name: string): number | undefined => {
    const raw = url.searchParams.get(name);
    const n = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const locationALat = parseCoord('locationALat');
  const locationALon = parseCoord('locationALon');
  const locationBLat = parseCoord('locationBLat');
  const locationBLon = parseCoord('locationBLon');

  if (!locationAName || !locationBName || !metric || !targetDate) {
    return new Response(JSON.stringify({ error: 'locationAName, locationBName, metric, and targetDate are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const targetDateISO = normalizeDate(targetDate);

  try {
    const pointspread = await suggestPointspread({
      locationAName, locationBName, metric, targetDate: targetDateISO, targetTime,
      metricA, metricB, locationALat, locationALon, locationBLat, locationBLon,
    });

    if (!pointspread) {
      const hint = locationALat != null && locationALon != null && locationBLat != null && locationBLon != null
        ? 'No tracked forecasts and the live forecast lookup also failed for one or both locations — check the location names/coordinates and try again.'
        : 'No tracked forecasts for one or both locations, and no coordinates were provided to fall back to a live forecast.';
      return new Response(JSON.stringify({ error: hint }), {
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
