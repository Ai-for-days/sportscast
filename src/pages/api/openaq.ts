import type { APIRoute } from 'astro';

export const prerender = false;

const OPENAQ_KEY = import.meta.env.OPENAQ_API_KEY || '';

/**
 * Proxy endpoint for OpenAQ v3 API.
 * GET /api/openaq?lat=34.05&lon=-81.03&radius=15000
 *
 * Returns the nearest station's latest PM2.5, PM10, O3, NO2, SO2, CO readings
 * along with station name, distance, and last updated time.
 */
export const GET: APIRoute = async ({ url }) => {
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');
  const radius = url.searchParams.get('radius') || '15000'; // 15km default

  if (!lat || !lon) {
    return new Response(JSON.stringify({ error: 'lat and lon required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!OPENAQ_KEY) {
    return new Response(JSON.stringify({ error: 'OpenAQ API key not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Find nearby locations
    const locationsUrl = `https://api.openaq.org/v3/locations?coordinates=${lat},${lon}&radius=${radius}&limit=5`;
    const locRes = await fetch(locationsUrl, {
      headers: { 'X-API-Key': OPENAQ_KEY, 'Accept': 'application/json' },
    });

    if (!locRes.ok) {
      const text = await locRes.text();
      return new Response(JSON.stringify({ error: `OpenAQ returned ${locRes.status}`, detail: text }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const locData = await locRes.json();
    const locations = locData.results || [];

    if (locations.length === 0) {
      return new Response(JSON.stringify({ stations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
      });
    }

    // Sort by distance to find the closest station
    const userLat = parseFloat(lat);
    const userLon = parseFloat(lon);
    locations.sort((a: any, b: any) => {
      const aLat = a.coordinates?.latitude ?? a.lat;
      const aLon = a.coordinates?.longitude ?? a.lon;
      const bLat = b.coordinates?.latitude ?? b.lat;
      const bLon = b.coordinates?.longitude ?? b.lon;
      return haversine(userLat, userLon, aLat, aLon) - haversine(userLat, userLon, bLat, bLon);
    });

    const station = locations[0];
    const stationId = station.id;

    const latestUrl = `https://api.openaq.org/v3/locations/${stationId}/latest`;
    const latestRes = await fetch(latestUrl, {
      headers: { 'X-API-Key': OPENAQ_KEY, 'Accept': 'application/json' },
    });

    if (!latestRes.ok) {
      return new Response(JSON.stringify({ stations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const latestData = await latestRes.json();
    const sensors = latestData.results || [];

    // Build a map of parameter -> latest value
    const readings: Record<string, { value: number; unit: string; lastUpdated: string }> = {};
    for (const sensor of sensors) {
      const paramName = sensor.parameter?.name?.toLowerCase() || '';
      const mapped = paramName.includes('pm2') ? 'pm25'
        : paramName.includes('pm10') ? 'pm10'
        : paramName.includes('ozone') || paramName === 'o3' ? 'o3'
        : paramName.includes('nitrogen') || paramName === 'no2' ? 'no2'
        : paramName.includes('sulfur') || paramName === 'so2' ? 'so2'
        : paramName.includes('carbon monoxide') || paramName === 'co' ? 'co'
        : paramName;

      if (sensor.latest) {
        readings[mapped] = {
          value: Math.round(sensor.latest.value * 10) / 10,
          unit: sensor.parameter?.units || '',
          lastUpdated: sensor.latest.datetime?.utc || '',
        };
      }
    }

    // Calculate distance in miles from lat/lon to station
    const stationLat = station.coordinates?.latitude || station.lat;
    const stationLon = station.coordinates?.longitude || station.lon;
    const distKm = haversine(
      parseFloat(lat), parseFloat(lon),
      stationLat, stationLon
    );
    const distMi = Math.round(distKm * 0.621371 * 10) / 10;

    // Calculate US AQI from PM2.5 if available
    let aqi: number | null = null;
    if (readings.pm25) {
      aqi = pm25ToAqi(readings.pm25.value);
    }

    const result = {
      station: {
        id: stationId,
        name: station.name || 'EPA Monitor',
        distanceMi: distMi,
        lat: stationLat,
        lon: stationLon,
      },
      readings,
      aqi,
      lastUpdated: readings.pm25?.lastUpdated || readings.o3?.lastUpdated || '',
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=900', // 15 min cache
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Convert PM2.5 (ug/m3) to US AQI using EPA breakpoints */
function pm25ToAqi(pm: number): number {
  const breakpoints = [
    { lo: 0, hi: 12, aqiLo: 0, aqiHi: 50 },
    { lo: 12.1, hi: 35.4, aqiLo: 51, aqiHi: 100 },
    { lo: 35.5, hi: 55.4, aqiLo: 101, aqiHi: 150 },
    { lo: 55.5, hi: 150.4, aqiLo: 151, aqiHi: 200 },
    { lo: 150.5, hi: 250.4, aqiLo: 201, aqiHi: 300 },
    { lo: 250.5, hi: 500.4, aqiLo: 301, aqiHi: 500 },
  ];
  for (const bp of breakpoints) {
    if (pm >= bp.lo && pm <= bp.hi) {
      return Math.round(((bp.aqiHi - bp.aqiLo) / (bp.hi - bp.lo)) * (pm - bp.lo) + bp.aqiLo);
    }
  }
  return pm > 500 ? 500 : 0;
}
