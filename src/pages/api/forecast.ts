import type { APIRoute } from 'astro';
import { getForecast } from '../../lib/weather-queries';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lon = parseFloat(url.searchParams.get('lon') || '');
  const days = parseInt(url.searchParams.get('days') || '7');

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return new Response(JSON.stringify({ error: 'Invalid lat/lon parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (days < 1 || days > 15) {
    return new Response(JSON.stringify({ error: 'Days must be between 1 and 15' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await getForecast(lat, lon, days);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=900',
      },
    });
  } catch (err) {
    console.error('Forecast API error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch forecast data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
