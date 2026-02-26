import type { APIRoute } from 'astro';
import { searchLocal, lookupZip } from '../../lib/zip-lookup';

export const prerender = false;

const UA = 'WagerOnWeather/1.0 (sports weather dashboard)';

async function nominatimSearch(url: string): Promise<any[]> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return [];
  return res.json();
}

function mapNominatimResult(r: any) {
  const addr = r.address || {};
  const city = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || '';
  const state = addr.state || '';
  const zip = addr.postcode || '';
  let name = city;
  if (!name || /^\d+$/.test(name.trim())) {
    name = addr.county?.replace(/\s*County$/i, '') || '';
    if (!name) {
      const parts = (r.display_name || '').split(',').map((s: string) => s.trim());
      name = parts.find((p: string) => p && !/^\d+$/.test(p) && p !== state) || '';
    }
  }
  const displayName = city && state ? `${city}, ${state}` : name && state ? `${name}, ${state}` : r.display_name;
  const countryCode = addr.country_code || 'us';
  return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), name, displayName, state, country: countryCode, zip };
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

    type Location = { lat: number; lon: number; name: string; displayName: string; state: string; country: string; zip: string };
    let locations: Location[] = [];

    // --- Local-first: use 41K US zip code data for instant results ---

    if (isUsZip) {
      // Exact US zip lookup from local data
      const local = lookupZip(trimmed);
      if (local) {
        locations = [{
          lat: local.lat,
          lon: local.lon,
          name: local.city,
          displayName: `${local.city}, ${local.state}`,
          state: local.state,
          country: 'us',
          zip: local.zip,
        }];
      }
    } else if (isCaPostal) {
      // Canadian postal codes — must use Nominatim
      const results = await nominatimSearch(
        `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(trimmed)}&country=ca&addressdetails=1&limit=5`
      );
      locations = results.map(mapNominatimResult);
    } else if (isPartialDigits) {
      // 2-4 digits — search local zip data by prefix
      const localResults = searchLocal(trimmed, 5);
      locations = localResults.map(r => ({
        lat: r.lat,
        lon: r.lon,
        name: r.city,
        displayName: `${r.city}, ${r.state}`,
        state: r.state,
        country: 'us',
        zip: r.zip,
      }));
    } else {
      // City/text search — local first, Nominatim fallback for international
      const localResults = searchLocal(trimmed, 5);
      locations = localResults.map(r => ({
        lat: r.lat,
        lon: r.lon,
        name: r.city,
        displayName: `${r.city}, ${r.state}`,
        state: r.state,
        country: 'us',
        zip: r.zip,
      }));

      // Fill remaining slots with Nominatim for international results
      if (locations.length < 5) {
        try {
          const intlResults = await nominatimSearch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=5`
          );
          const seen = new Set(locations.map(l => `${l.name?.toLowerCase()}|${l.state?.toLowerCase()}`));
          for (const r of intlResults) {
            const loc = mapNominatimResult(r);
            const key = `${loc.name?.toLowerCase()}|${loc.state?.toLowerCase()}`;
            // Skip if already have this city from local data, or if no zip
            if (seen.has(key) || !loc.zip) continue;
            seen.add(key);
            locations.push(loc);
            if (locations.length >= 5) break;
          }
        } catch {
          // Nominatim failed — local results are still available
        }
      }
    }

    // Deduplicate by displayName
    {
      const seen = new Set<string>();
      locations = locations.filter(loc => {
        const key = (loc.displayName || `${loc.name},${loc.state}`).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Don't cache empty responses — they'd poison the CDN cache
    const cacheHeader = locations.length > 0
      ? 'public, s-maxage=86400, max-age=3600'
      : 'public, max-age=60';

    return new Response(JSON.stringify(locations), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': cacheHeader,
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
