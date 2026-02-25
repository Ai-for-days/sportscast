import type { APIRoute } from 'astro';

export const prerender = false;

const UA = 'WagerOnWeather/1.0 (sports weather dashboard)';

async function nominatimSearch(url: string): Promise<any[]> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return [];
  return res.json();
}

function mapResult(r: any) {
  const addr = r.address || {};
  const city = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || '';
  const state = addr.state || '';
  const zip = addr.postcode || '';
  // Don't let name be a zip code — fallback to county or display_name minus the zip
  let name = city;
  if (!name || /^\d+$/.test(name.trim())) {
    // Try county, then first non-numeric segment of display_name
    name = addr.county?.replace(/\s*County$/i, '') || '';
    if (!name) {
      const parts = (r.display_name || '').split(',').map((s: string) => s.trim());
      name = parts.find((p: string) => p && !/^\d+$/.test(p) && p !== state) || '';
    }
  }
  const displayName = city && state ? `${city}, ${state}` : name && state ? `${name}, ${state}` : r.display_name;
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
}

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') || '';

  if (!q || q.length < 2) {
    return new Response(JSON.stringify({ error: 'Query must be at least 2 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const trimmed = q.trim();
    const isUsZip = /^\d{5}(-\d{4})?$/.test(trimmed);
    const isCaPostal = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(trimmed);
    const isPartialDigits = /^\d{2,4}$/.test(trimmed);

    let locations: ReturnType<typeof mapResult>[] = [];

    if (isUsZip) {
      // Full US zip code — use postalcode-specific search
      let results = await nominatimSearch(
        `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(trimmed)}&country=us&addressdetails=1&limit=5`
      );
      // Fallback to general search if postalcode param returns empty
      if (results.length === 0) {
        results = await nominatimSearch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&countrycodes=us&addressdetails=1&limit=5`
        );
      }
      locations = results.map(mapResult);
    } else if (isCaPostal) {
      // Canadian postal code
      const results = await nominatimSearch(
        `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(trimmed)}&country=ca&addressdetails=1&limit=5`
      );
      locations = results.map(mapResult);
    } else if (isPartialDigits) {
      // 2-4 digits — likely typing a US zip; use postalcode param to avoid matching address numbers
      const results = await nominatimSearch(
        `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(trimmed)}&country=us&addressdetails=1&limit=5`
      );
      locations = results.map(mapResult);
    } else {
      // City/text search — US and Canada first, then fill with international
      const usResults = await nominatimSearch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=us,ca&addressdetails=1&limit=5`
      );
      locations = usResults.map(mapResult);

      if (locations.length < 5) {
        const intlResults = await nominatimSearch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=5`
        );
        const seen = new Set(locations.map(l => `${l.lat.toFixed(4)},${l.lon.toFixed(4)}`));
        for (const r of intlResults) {
          const loc = mapResult(r);
          const key = `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`;
          if (!seen.has(key)) {
            locations.push(loc);
            seen.add(key);
            if (locations.length >= 5) break;
          }
        }
      }
    }

    // Sort: results with zip codes come first
    locations.sort((a, b) => (b.zip ? 1 : 0) - (a.zip ? 1 : 0));

    // If the first result still has no postal code, reverse geocode to get it
    if (locations.length > 0 && !locations[0].zip) {
      try {
        const revRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${locations[0].lat}&lon=${locations[0].lon}&zoom=14&addressdetails=1`,
          { headers: { 'User-Agent': UA } }
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
