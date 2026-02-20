import type { APIRoute } from 'astro';
import { buildLocationSlug } from '../../lib/slug-utils';

export const prerender = false;

const UA = 'WagerOnWeather/1.0 (sports weather dashboard)';

async function reverseGeo(lat: string, lon: string, zoom: number) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${zoom}&addressdetails=1`,
    { headers: { 'User-Agent': UA } }
  );
  if (!res.ok) return null;
  return res.json();
}

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
    // Try multiple zoom levels to reliably get a postal code
    for (const zoom of [18, 16, 14, 10]) {
      const data = await reverseGeo(lat, lon, zoom);
      if (!data) continue;
      const addr = data.address || {};
      const zip = addr.postcode || '';
      if (zip) {
        const city = addr.city || addr.town || addr.village || addr.hamlet || '';
        const state = addr.state || '';
        const country = addr.country_code || 'us';
        const slug = buildLocationSlug(zip, city, state, country);
        return new Response(JSON.stringify({ url: slug }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // No zip found at any zoom — fallback to lat,lon route
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
