import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') || '';

  if (!q || q.length < 2) {
    return new Response(JSON.stringify({ error: 'Query must be at least 2 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Detect zip code queries
    const isZip = /^\d{5}(-\d{4})?$/.test(q.trim());

    const searchUrl = isZip
      ? `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(q.trim())}&country=us&addressdetails=1&limit=5`
      : `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=us&addressdetails=1&limit=5`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'SportsCast/1.0 (sports weather dashboard)',
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim returned ${response.status}`);
    }

    const results = await response.json();
    const locations = results.map((r: any) => {
      const addr = r.address || {};
      // Prefer city/town/village over county for the display name
      const city = addr.city || addr.town || addr.village || addr.hamlet || '';
      const state = addr.state || '';
      const name = city || r.display_name.split(',')[0];
      const displayName = city && state ? `${city}, ${state}` : r.display_name;

      return {
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        name,
        displayName,
        state,
        country: 'US',
      };
    });

    return new Response(JSON.stringify(locations), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('Geocode API error:', err);
    return new Response(JSON.stringify({ error: 'Failed to geocode location' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
