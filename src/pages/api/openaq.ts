import type { APIRoute } from 'astro';

export const prerender = false;

const OPENAQ_KEY = import.meta.env.OPENAQ_API_KEY || '';
const STALE_DAYS = 7; // Skip stations with no data in the last 7 days

/**
 * Proxy endpoint for OpenAQ v3 API.
 * GET /api/openaq?lat=34.05&lon=-81.03
 *
 * Returns the nearest active station's latest PM2.5, PM10, O3, NO2, SO2, CO
 * readings along with station name, distance, and last updated time.
 */
export const GET: APIRoute = async ({ url }) => {
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');

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
    const userLat = parseFloat(lat);
    const userLon = parseFloat(lon);
    const cutoff = Date.now() - STALE_DAYS * 86400000;

    // Search with expanding radius: 25km, then 50km, then 100km
    for (const radiusKm of [25000, 50000, 100000]) {
      const locationsUrl = `https://api.openaq.org/v3/locations?coordinates=${lat},${lon}&radius=${radiusKm}&limit=20`;
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
      const allLocations = locData.results || [];

      // Filter to only stations with recent data
      const activeLocations = allLocations.filter((loc: any) => {
        const lastStr = loc.datetimeLast?.utc || loc.datetimeLast?.local || '';
        if (!lastStr) return false;
        return new Date(lastStr).getTime() > cutoff;
      });

      if (activeLocations.length === 0) continue; // try wider radius

      // Sort active stations by distance
      activeLocations.sort((a: any, b: any) => {
        const aLat = a.coordinates?.latitude ?? 0;
        const aLon = a.coordinates?.longitude ?? 0;
        const bLat = b.coordinates?.latitude ?? 0;
        const bLon = b.coordinates?.longitude ?? 0;
        return haversine(userLat, userLon, aLat, aLon) - haversine(userLat, userLon, bLat, bLon);
      });

      // Try up to 3 closest active stations to find one with readings
      for (const station of activeLocations.slice(0, 3)) {
        const result = await fetchStationReadings(station, userLat, userLon);
        if (result) {
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=900',
            },
          });
        }
      }
    }

    // No active stations found in any radius
    return new Response(JSON.stringify({ stations: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/** Fetch latest readings from a single station. Returns null if no usable data. */
async function fetchStationReadings(station: any, userLat: number, userLon: number) {
  const stationId = station.id;

  // Build sensor ID → parameter map from the location's sensors array
  const sensorMap: Record<number, { name: string; units: string }> = {};
  for (const s of station.sensors || []) {
    sensorMap[s.id] = {
      name: (s.parameter?.name || s.name || '').toLowerCase(),
      units: s.parameter?.units || '',
    };
  }

  const latestRes = await fetch(`https://api.openaq.org/v3/locations/${stationId}/latest`, {
    headers: { 'X-API-Key': OPENAQ_KEY, 'Accept': 'application/json' },
  });

  if (!latestRes.ok) return null;

  const latestData = await latestRes.json();
  const latestResults = latestData.results || [];

  // Build a map of parameter -> latest value
  const readings: Record<string, { value: number; unit: string; lastUpdated: string }> = {};
  for (const reading of latestResults) {
    const sensorInfo = sensorMap[reading.sensorsId] || { name: '', units: '' };
    const paramName = sensorInfo.name;
    const mapped = paramName.includes('pm2') ? 'pm25'
      : paramName.includes('pm10') ? 'pm10'
      : paramName.includes('ozone') || paramName === 'o3' ? 'o3'
      : paramName.includes('nitrogen') || paramName === 'no2' ? 'no2'
      : paramName.includes('sulfur') || paramName === 'so2' ? 'so2'
      : paramName.includes('carbon monoxide') || paramName === 'co' ? 'co'
      : paramName;

    if (reading.value != null) {
      readings[mapped] = {
        value: Math.round(reading.value * 10) / 10,
        unit: sensorInfo.units,
        lastUpdated: reading.datetime?.utc || '',
      };
    }
  }

  // Must have at least PM2.5 or O3 for a meaningful AQI
  if (!readings.pm25 && !readings.o3) return null;

  // Skip if the key reading is older than 6 hours
  const keyReading = readings.pm25?.lastUpdated || readings.o3?.lastUpdated || '';
  if (keyReading) {
    const readingAge = Date.now() - new Date(keyReading).getTime();
    if (readingAge > 6 * 3600000) return null; // >6 hours old, try next station
  }

  const stationLat = station.coordinates?.latitude ?? 0;
  const stationLon = station.coordinates?.longitude ?? 0;
  const distKm = haversine(userLat, userLon, stationLat, stationLon);
  const distMi = Math.round(distKm * 0.621371 * 10) / 10;

  let aqi: number | null = null;
  if (readings.pm25) {
    aqi = pm25ToAqi(readings.pm25.value);
  }

  return {
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
}

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
