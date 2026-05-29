import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';

export const prerender = false;

// Allow up to ~10 candidate stations near the chosen point so the
// operator can pick a more representative one than the literal nearest
// (e.g. an airport ASOS over a private home weather station).
const LIMIT = 10;

const NWS_HEADERS = { 'User-Agent': 'WagerOnWeather/1.0 (contact@wageronweather.com)' };

interface StationCandidate {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  timeZone: string;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const GET: APIRoute = async ({ url, request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const latStr = url.searchParams.get('lat');
  const lonStr = url.searchParams.get('lon');
  const lat = latStr ? parseFloat(latStr) : NaN;
  const lon = lonStr ? parseFloat(lonStr) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return new Response(JSON.stringify({ error: 'lat and lon are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Two-hop NWS lookup: /points/{lat},{lon} → observationStations → list
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: NWS_HEADERS }
    );
    if (!pointsRes.ok) {
      return new Response(
        JSON.stringify({ error: `NWS points API failed: ${pointsRes.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const pointsData = await pointsRes.json();
    const stationsUrl: string | undefined = pointsData.properties?.observationStations;
    const timeZone: string = pointsData.properties?.timeZone || 'America/New_York';
    if (!stationsUrl) {
      return new Response(JSON.stringify({ error: 'No observation stations URL from NWS' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const stationsRes = await fetch(stationsUrl, { headers: NWS_HEADERS });
    if (!stationsRes.ok) {
      return new Response(
        JSON.stringify({ error: `NWS stations API failed: ${stationsRes.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const stationsData = await stationsRes.json();
    const features: any[] = Array.isArray(stationsData.features) ? stationsData.features : [];

    const candidates: StationCandidate[] = features
      .map((f) => {
        const stationId: string = f?.properties?.stationIdentifier ?? '';
        const name: string = f?.properties?.name ?? stationId;
        const coords = f?.geometry?.coordinates;
        const sLon = Array.isArray(coords) ? Number(coords[0]) : NaN;
        const sLat = Array.isArray(coords) ? Number(coords[1]) : NaN;
        if (!stationId || !Number.isFinite(sLat) || !Number.isFinite(sLon)) return null;
        return {
          stationId,
          name,
          lat: sLat,
          lon: sLon,
          distanceMiles: Math.round(haversineMiles(lat, lon, sLat, sLon) * 10) / 10,
          timeZone,
        };
      })
      .filter((s): s is StationCandidate => s !== null)
      .slice(0, LIMIT);

    return new Response(JSON.stringify({ stations: candidates, timeZone }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'NWS lookup failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
