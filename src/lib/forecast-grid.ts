/* ------------------------------------------------------------------ */
/*  Server-side weather grids for the ZIP-page map tabs                 */
/*                                                                      */
/*  The ForecastMaps heatmaps used to hit Open-Meteo directly from the  */
/*  browser on every pan/zoom — which got rate-limited and blanked the  */
/*  layers. This module moves those fetches server-side and caches them */
/*  so ONE upstream call per viewport per ~10 min serves every user.    */
/*                                                                      */
/*  Two cache layers: in-memory `cached()` (instance-hot, fast path) in */
/*  front of Redis (cross-instance / cross-user, the real fix). Both    */
/*  degrade gracefully — if Redis is unconfigured we just compute.      */
/*                                                                      */
/*  Resolution math mirrors the client layers exactly so the rendered   */
/*  maps look identical: heatmapGridStep/aqiStep/getTierForZoom and the */
/*  point-count clamps are copied from ForecastMaps.tsx. Keep in sync.  */
/* ------------------------------------------------------------------ */

import { getRedis } from './redis';
import { cached } from './performance-cache';
import { cities } from './us-cities';

export type ForecastGridLayer = 'wind' | 'aqi' | 'towns' | 'aqitowns';

export interface WindGridPoint { lat: number; lon: number; speed: number; gust: number; dir: number; }
export interface AqiGridPoint { lat: number; lon: number; aqi: number; }
export interface TownTempPoint { name: string; lat: number; lon: number; tempF: number; }
export interface AqiTownPoint { name: string; lat: number; lon: number; aqi: number; }

const TTL_SECONDS = 600;        // 10 min in Redis
const TTL_MS = TTL_SECONDS * 1000;
const UA = { 'User-Agent': 'WagerOnWeather/1.0' };

/* ----- resolution math (mirrors ForecastMaps.tsx — keep in sync) ----- */

function heatmapGridStep(zoom: number): { latStep: number; lonStep: number } {
  if (zoom >= 12) return { latStep: 0.02, lonStep: 0.025 };
  if (zoom >= 11) return { latStep: 0.04, lonStep: 0.05 };
  if (zoom >= 10) return { latStep: 0.06, lonStep: 0.075 };
  if (zoom >= 9) return { latStep: 0.12, lonStep: 0.15 };
  if (zoom >= 8) return { latStep: 0.2, lonStep: 0.25 };
  if (zoom >= 7) return { latStep: 0.35, lonStep: 0.42 };
  if (zoom >= 6) return { latStep: 0.65, lonStep: 0.8 };
  return { latStep: 1.2, lonStep: 1.5 };
}

function aqiStep(zoom: number): number {
  return zoom >= 12 ? 0.1 : zoom >= 11 ? 0.15 : zoom >= 10 ? 0.2 : zoom >= 9 ? 0.3
    : zoom >= 8 ? 0.4 : zoom >= 7 ? 0.6 : zoom >= 6 ? 1.0 : zoom >= 5 ? 1.5 : 2.5;
}

function getTierForZoom(zoom: number): number {
  if (zoom <= 3) return 1;
  if (zoom <= 4) return 2;
  if (zoom <= 5) return 3;
  if (zoom <= 6) return 4;
  return 5;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const snap = (v: number, inc: number) => Math.round(v / inc) * inc;

// Shift a grid's start so a node lands exactly on `center`. Keeps the grid
// rectangular (no off-grid points) so the heatmap mesh stays hole-free, while
// guaranteeing one node sits on the ZIP centroid — that node's Open-Meteo value
// is then the SAME query the air-quality CARD makes, so map and card agree.
function alignOrigin(start: number, center: number, step: number): number {
  return center - Math.ceil((center - start) / step) * step;
}

/* ----- shared upstream fetch (batched) ----- */

async function fetchCurrent(
  baseUrl: string, lats: number[], lons: number[], current: string,
  extraQuery: string, batchSize: number, signal?: AbortSignal,
): Promise<any[]> {
  const results: any[] = [];
  for (let b = 0; b < lats.length; b += batchSize) {
    const bLats = lats.slice(b, b + batchSize);
    const bLons = lons.slice(b, b + batchSize);
    const url = `${baseUrl}?latitude=${bLats.join(',')}&longitude=${bLons.join(',')}`
      + `&current=${current}${extraQuery}`;
    const res = await fetch(url, { headers: UA, signal });
    if (!res.ok) continue;
    const data = await res.json();
    results.push(...(Array.isArray(data) ? data : [data]));
  }
  return results;
}

/* ----- per-layer compute (no caching — pure upstream) ----- */

async function computeWind(n0: number, s0: number, e0: number, w0: number, zoom: number): Promise<WindGridPoint[]> {
  let { latStep, lonStep } = heatmapGridStep(zoom);
  const n = Math.min(85, n0 + latStep);
  const s = Math.max(-85, s0 - latStep);
  const e = Math.min(180, e0 + lonStep);
  const w = Math.max(-180, w0 - lonStep);

  const count = () => {
    let a = 0, b = 0;
    for (let la = s; la <= n; la += latStep) a++;
    for (let lo = w; lo <= e; lo += lonStep) b++;
    return a * b;
  };
  while (count() > 400) { latStep *= 1.15; lonStep *= 1.15; }

  const lats: number[] = [], lons: number[] = [];
  for (let la = s; la <= n; la += latStep) {
    for (let lo = w; lo <= e; lo += lonStep) { lats.push(round2(la)); lons.push(round2(lo)); }
  }
  if (lats.length === 0) return [];

  const results = await fetchCurrent(
    'https://api.open-meteo.com/v1/forecast', lats, lons,
    'wind_speed_10m,wind_direction_10m,wind_gusts_10m', '&wind_speed_unit=mph', 100,
  );
  return results.map((r, i) => ({
    lat: lats[i], lon: lons[i],
    speed: r.current?.wind_speed_10m ?? 0,
    gust: r.current?.wind_gusts_10m ?? 0,
    dir: r.current?.wind_direction_10m ?? 0,
  }));
}

async function computeAqi(
  n0: number, s0: number, e0: number, w0: number, zoom: number, clat?: number, clon?: number,
): Promise<AqiGridPoint[]> {
  let step = aqiStep(zoom);
  const n = Math.min(85, n0 + step);
  const s = Math.max(-85, s0 - step);
  const e = Math.min(180, e0 + step);
  const w = Math.max(-180, w0 - step);

  const count = () => {
    let a = 0, b = 0;
    for (let la = s; la <= n; la += step) a++;
    for (let lo = w; lo <= e; lo += step) b++;
    return a * b;
  };
  while (count() > 250) step *= 1.15;

  // Phase the grid through the ZIP centroid so one node matches the AQI card.
  const latOrigin = clat != null ? alignOrigin(s, clat, step) : s;
  const lonOrigin = clon != null ? alignOrigin(w, clon, step) : w;

  const lats: number[] = [], lons: number[] = [];
  for (let la = latOrigin; la <= n; la += step) {
    for (let lo = lonOrigin; lo <= e; lo += step) { lats.push(round2(la)); lons.push(round2(lo)); }
  }
  if (lats.length === 0) return [];

  const results = await fetchCurrent(
    'https://air-quality-api.open-meteo.com/v1/air-quality', lats, lons, 'us_aqi', '', 100,
  );
  return results.map((r, i) => ({
    lat: r.latitude ?? lats[i], lon: r.longitude ?? lons[i], aqi: r.current?.us_aqi ?? 0,
  }));
}

async function computeTowns(n0: number, s0: number, e0: number, w0: number, zoom: number): Promise<TownTempPoint[]> {
  const maxTier = getTierForZoom(zoom);
  const n = n0 + 0.5, s = s0 - 0.5, e = e0 + 0.5, w = w0 - 0.5;

  let visible = cities.filter(c =>
    c.tier <= maxTier && c.lat >= s && c.lat <= n && c.lon >= w && c.lon <= e,
  );
  if (visible.length > 800) visible = visible.slice(0, 800);
  if (visible.length === 0) return [];

  const lats = visible.map(c => c.lat);
  const lons = visible.map(c => c.lon);
  const results = await fetchCurrent(
    'https://api.open-meteo.com/v1/forecast', lats, lons, 'temperature_2m', '&temperature_unit=fahrenheit', 250,
  );
  return visible.map((c, i) => ({
    name: c.name, lat: c.lat, lon: c.lon,
    tempF: Math.round(results[i]?.current?.temperature_2m ?? 0),
  }));
}

// AQI labelled at named cities (mirrors computeTowns) so the AQI map shows
// scores next to town names like the temperature map does, instead of on an
// abstract grid lattice.
async function computeAqiTowns(n0: number, s0: number, e0: number, w0: number, zoom: number): Promise<AqiTownPoint[]> {
  const maxTier = getTierForZoom(zoom);
  const n = n0 + 0.5, s = s0 - 0.5, e = e0 + 0.5, w = w0 - 0.5;

  let visible = cities.filter(c =>
    c.tier <= maxTier && c.lat >= s && c.lat <= n && c.lon >= w && c.lon <= e,
  );
  if (visible.length > 800) visible = visible.slice(0, 800);
  if (visible.length === 0) return [];

  const lats = visible.map(c => c.lat);
  const lons = visible.map(c => c.lon);
  const results = await fetchCurrent(
    'https://air-quality-api.open-meteo.com/v1/air-quality', lats, lons, 'us_aqi', '', 100,
  );
  return visible.map((c, i) => ({
    name: c.name, lat: c.lat, lon: c.lon,
    aqi: Math.round(results[i]?.current?.us_aqi ?? 0),
  }));
}

/* ----- public entry: snap → cache (memory → Redis) → compute ----- */

export async function getForecastGrid(
  layer: ForecastGridLayer, north: number, south: number, east: number, west: number, zoom: number,
  clat?: number, clon?: number,
): Promise<WindGridPoint[] | AqiGridPoint[] | TownTempPoint[] | AqiTownPoint[]> {
  // Snap bounds to a coarse grid so nearby pans collapse onto one cache key.
  const inc = layer === 'aqi' ? aqiStep(zoom)
    : layer === 'towns' || layer === 'aqitowns' ? 0.5
    : heatmapGridStep(zoom).lonStep;
  const n = snap(north, inc), s = snap(south, inc), e = snap(east, inc), w = snap(west, inc);
  // AQI grid is phased through the ZIP centroid, so the centroid is part of the key.
  const center = layer === 'aqi' && clat != null && clon != null ? `:c${round2(clat)},${round2(clon)}` : '';
  const key = `fgrid:v1:${layer}:${n.toFixed(2)},${s.toFixed(2)},${e.toFixed(2)},${w.toFixed(2)},z${zoom}${center}`;

  return cached(key, async () => {
    // Try Redis (shared across all serverless instances + users).
    try {
      const redis = getRedis();
      const hit = await redis.get(key);
      if (hit) return hit as any;
    } catch { /* Redis unconfigured — fall through to compute */ }

    const data = layer === 'wind' ? await computeWind(n, s, e, w, zoom)
      : layer === 'aqi' ? await computeAqi(n, s, e, w, zoom, clat, clon)
      : layer === 'aqitowns' ? await computeAqiTowns(n, s, e, w, zoom)
      : await computeTowns(n, s, e, w, zoom);

    if (data.length > 0) {
      try { await getRedis().set(key, data, { ex: TTL_SECONDS }); } catch { /* no-op */ }
    }
    return data;
  }, TTL_MS);
}
