import type { APIRoute } from 'astro';
import { getHistoricalForecast } from '../../lib/weather-queries';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lon = parseFloat(url.searchParams.get('lon') || '');
  const date = url.searchParams.get('date') || '';

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return new Response(JSON.stringify({ error: 'Invalid lat/lon parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!date || isNaN(Date.parse(date))) {
    return new Response(JSON.stringify({ error: 'Invalid date parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await getHistoricalForecast(lat, lon, date);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=604800',
      },
    });
  } catch (err) {
    console.error('Historical API error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch historical data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
