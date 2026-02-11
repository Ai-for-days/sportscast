import type { APIRoute } from 'astro';
import { getMapGrid } from '../../lib/weather-queries';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const north = parseFloat(url.searchParams.get('north') || '');
  const south = parseFloat(url.searchParams.get('south') || '');
  const east = parseFloat(url.searchParams.get('east') || '');
  const west = parseFloat(url.searchParams.get('west') || '');

  if ([north, south, east, west].some(isNaN)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid bounding box parameters (north, south, east, west)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (north < south || east < west) {
    return new Response(JSON.stringify({ error: 'Invalid bounding box: north must be > south, east must be > west' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await getMapGrid(north, south, east, west);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=900',
      },
    });
  } catch (err) {
    console.error('Map grid API error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch map grid data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
