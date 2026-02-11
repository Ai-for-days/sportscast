import type { APIRoute } from 'astro';
import { getEnsembleForecast } from '../../lib/weather-queries';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lon = parseFloat(url.searchParams.get('lon') || '');
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return new Response(JSON.stringify({ error: 'Invalid lat/lon parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!start || !end || isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
    return new Response(JSON.stringify({ error: 'Invalid start/end time parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await getEnsembleForecast(lat, lon, start, end);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=900',
      },
    });
  } catch (err) {
    console.error('Ensemble API error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch ensemble data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
