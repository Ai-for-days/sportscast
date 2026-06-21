import type { APIRoute } from 'astro';
import { getForecastGrid, type ForecastGridLayer } from '../../lib/forecast-grid';

export const prerender = false;

const LAYERS: ForecastGridLayer[] = ['wind', 'aqi', 'towns'];

export const GET: APIRoute = async ({ url }) => {
  const layer = url.searchParams.get('layer') as ForecastGridLayer;
  const north = parseFloat(url.searchParams.get('north') || '');
  const south = parseFloat(url.searchParams.get('south') || '');
  const east = parseFloat(url.searchParams.get('east') || '');
  const west = parseFloat(url.searchParams.get('west') || '');
  const zoom = parseInt(url.searchParams.get('zoom') || '', 10);

  if (!LAYERS.includes(layer)) {
    return json({ error: `layer must be one of ${LAYERS.join(', ')}` }, 400);
  }
  if ([north, south, east, west].some(isNaN) || isNaN(zoom)) {
    return json({ error: 'Missing or invalid params (north, south, east, west, zoom)' }, 400);
  }
  if (north < south || east < west) {
    return json({ error: 'Invalid bounding box: north must be > south, east must be > west' }, 400);
  }

  try {
    const points = await getForecastGrid(layer, north, south, east, west, zoom);
    return json({ points }, 200, 'public, max-age=300');
  } catch (err) {
    console.error('forecast-grid API error:', err);
    // Degrade to empty grid rather than 500 — the client keeps its previous grid.
    return json({ points: [] }, 200, 'public, max-age=30');
  }
};

function json(body: unknown, status: number, cacheControl?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  return new Response(JSON.stringify(body), { status, headers });
}
