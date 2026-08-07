import type { APIRoute } from 'astro';
import { buildLocationSlug } from '../../lib/slug-utils';
import { findNearestZipWithin } from '../../lib/zip-lookup';

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

  const latN = Number(lat);
  const lonN = Number(lon);
  const fallbackUrl = `/forecast/${latN.toFixed(4)},${lonN.toFixed(4)}`;

  // Local zip data first, before any network call.
  //
  // The Nominatim loop below used to run for every request and came back
  // not-ok on all four zoom levels, so this endpoint returned the bare
  // lat/lon fallback for US visitors. /forecast/<lat,lon> then hit the same
  // wall and bounced them to the homepage, which is why "Use My Location"
  // looked like it did nothing at all.
  //
  // It is not a hard IP ban: a single international lookup still succeeds
  // from here. The likely cause is the request pattern. Nominatim's usage
  // policy asks for at most one request per second and this fired four in a
  // burst, per visitor, with no caching.
  //
  // Either way, asking a rate-limited third party to answer a question we can
  // answer ourselves was the real mistake. We ship a 41K-entry US zip
  // dataset, so for a US visitor this is instant and cannot fail. Keeping US
  // traffic off Nominatim also leaves its budget for the calls that genuinely
  // need it.
  const local = findNearestZipWithin(latN, lonN);
  if (local) {
    return new Response(
      JSON.stringify({
        url: buildLocationSlug(local.zip, local.city, local.state, 'us'),
        city: local.city,
        state: local.state,
        zip: local.zip,
        countryCode: 'us',
        lat: latN,
        lon: lonN,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Not near any US zip. Nominatim may still resolve it, so it stays as the
  // path for international coords.
  try {
    // Try multiple zoom levels to reliably get a postal code; remember the
    // best address we saw along the way so callers can still render the
    // page with city/state even if no zip is found.
    let bestCity = '';
    let bestState = '';
    let bestCountry = 'us';

    for (const zoom of [18, 16, 14, 10]) {
      const data = await reverseGeo(lat, lon, zoom);
      if (!data) continue;
      const addr = data.address || {};
      const city = addr.city || addr.town || addr.village || addr.hamlet || '';
      const state = addr.state || '';
      const country = addr.country_code || 'us';
      if (city && !bestCity) bestCity = city;
      if (state && !bestState) bestState = state;
      if (country) bestCountry = country;

      const zip = addr.postcode || '';
      if (zip) {
        const slug = buildLocationSlug(zip, city || bestCity, state || bestState, country);
        return new Response(
          JSON.stringify({
            url: slug,
            city: city || bestCity,
            state: state || bestState,
            zip,
            countryCode: country,
            lat: Number(lat),
            lon: Number(lon),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // No zip found at any zoom — return the lat,lon fallback URL plus any
    // city/state we managed to scrape so the slug page can still render.
    return new Response(
      JSON.stringify({
        url: fallbackUrl,
        city: bestCity,
        state: bestState,
        zip: '',
        countryCode: bestCountry,
        lat: Number(lat),
        lon: Number(lon),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Reverse geocode error:', err);
    return new Response(
      JSON.stringify({
        url: fallbackUrl,
        city: '',
        state: '',
        zip: '',
        countryCode: 'us',
        lat: Number(lat),
        lon: Number(lon),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
