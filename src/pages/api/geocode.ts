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
  const hasCity = !!city && !/^\d+$/.test(city.trim());
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
    _hasCity: hasCity,  // track whether we got a real city name
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

    // Deduplicate: keep the first entry for each unique displayName (which has zip due to sort)
    {
      const seen = new Set<string>();
      locations = locations.filter(loc => {
        const key = (loc.displayName || `${loc.name},${loc.state}`).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Reverse geocode results that are missing city name or zip code
    for (const loc of locations) {
      if (!loc._hasCity || !loc.zip) {
        try {
          const revRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lon}&zoom=14&addressdetails=1`,
            { headers: { 'User-Agent': UA } }
          );
          if (revRes.ok) {
            const revData = await revRes.json();
            const revAddr = revData.address || {};
            if (!loc.zip) {
              loc.zip = revAddr.postcode || '';
            }
            if (!loc._hasCity) {
              const revCity = revAddr.city || revAddr.town || revAddr.village || revAddr.hamlet || '';
              if (revCity) {
                loc.name = revCity;
                loc.displayName = `${revCity}, ${loc.state}`;
                loc._hasCity = true;
              }
            }
            if (!loc.country || loc.country === 'us') {
              loc.country = revAddr.country_code || 'us';
            }
          }
        } catch {}
      }
    }

    // Structured city search fallback for results still missing zip (e.g. county-level results)
    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      if (!loc.zip && loc.name && loc.state) {
        try {
          const cc = loc.country || 'us';
          const cityRes = await nominatimSearch(
            `https://nominatim.openstreetmap.org/search?format=json&city=${encodeURIComponent(loc.name)}&state=${encodeURIComponent(loc.state)}&countrycodes=${cc}&addressdetails=1&limit=1`
          );
          if (cityRes.length > 0) {
            const mapped = mapResult(cityRes[0]);
            if (mapped.zip) {
              locations[i] = { ...mapped, _hasCity: mapped._hasCity };
            }
          }
        } catch {}
      }
    }

    // Remove results that still have no zip code — they can't produce a valid URL
    locations = locations.filter(loc => !!loc.zip);

    // Strip internal fields before response
    const cleaned = locations.map(({ _hasCity, ...rest }) => rest);

    return new Response(JSON.stringify(cleaned), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=86400, max-age=3600',
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
