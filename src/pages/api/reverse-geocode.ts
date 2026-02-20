import type { APIRoute } from 'astro';
import { buildLocationSlug } from '../../lib/slug-utils';

export const prerender = false;

const UA = 'WagerOnWeather/1.0 (sports weather dashboard)';

export const GET: APIRoute = async ({ url }) => {
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');

  if (!lat || !lon || isNaN(Number(lat)) || isNaN(Number(lon))) {
    return new Response(JSON.stringify({ error: 'lat and lon are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`,
      { headers: { 'User-Agent': UA } }
    );

    if (!res.ok) {
      return new Response(JSON.stringify({ url: `/forecast/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    const addr = data.address || {};
    const zip = addr.postcode || '';
    const city = addr.city || addr.town || addr.village || addr.hamlet || '';
    const state = addr.state || '';
    const country = addr.country_code || 'us';

    if (zip) {
      const slug = buildLocationSlug(zip, city, state, country);
      return new Response(JSON.stringify({ url: slug }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // No zip found — fallback to lat,lon route
    return new Response(JSON.stringify({ url: `/forecast/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Reverse geocode error:', err);
    return new Response(JSON.stringify({ url: `/forecast/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
