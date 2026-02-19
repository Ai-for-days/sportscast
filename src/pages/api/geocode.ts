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
    // Detect zip code queries (US 5-digit or Canadian A1A 1A1)
    const isUsZip = /^\d{5}(-\d{4})?$/.test(q.trim());
    const isCaPostal = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(q.trim());

    let searchUrl: string;
    if (isUsZip) {
      searchUrl = `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(q.trim())}&country=us&addressdetails=1&limit=5`;
    } else if (isCaPostal) {
      searchUrl = `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(q.trim())}&country=ca&addressdetails=1&limit=5`;
    } else {
      searchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=5`;
    }

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'WagerOnWeather/1.0 (sports weather dashboard)',
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim returned ${response.status}`);
    }

    const results = await response.json();
    const locations = results.map((r: any) => {
      const addr = r.address || {};
      const city = addr.city || addr.town || addr.village || addr.hamlet || '';
      const state = addr.state || '';
      const name = city || r.display_name.split(',')[0];
      const displayName = city && state ? `${city}, ${state}` : r.display_name;
      const zip = addr.postcode || '';
      const countryCode = addr.country_code || 'us';

      return {
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        name,
        displayName,
        state,
        country: countryCode,
        zip,
      };
    });

    // If the first result has no postal code, reverse geocode to get it
    if (locations.length > 0 && !locations[0].zip) {
      try {
        const revRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${locations[0].lat}&lon=${locations[0].lon}&zoom=14&addressdetails=1`,
          { headers: { 'User-Agent': 'WagerOnWeather/1.0 (sports weather dashboard)' } }
        );
        if (revRes.ok) {
          const revData = await revRes.json();
          locations[0].zip = revData.address?.postcode || '';
          if (!locations[0].country || locations[0].country === 'us') {
            locations[0].country = revData.address?.country_code || 'us';
          }
        }
      } catch {}
    }

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
