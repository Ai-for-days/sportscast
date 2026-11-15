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
import { cacheGet, cacheSet } from './performance-cache';
import { cities } from './us-cities';
import { meteredOpenMeteoFetch } from './open-meteo-usage';

export type ForecastGridLayer = 'wind' | 'aqi' | 'towns' | 'aqitowns';

export interface WindGridPoint { lat: number; lon: number; speed: number; gust: number; dir: number; }
export interface AqiGridPoint { lat: number; lon: number; aqi: number; }
export interface TownTempPoint { name: string; lat: number; lon: number; tempF: number; }
export interface AqiTownPoint { name: string; lat: number; lon: number; aqi: number; }

const TTL_SECONDS = 600;        // 10 min in Redis
const TTL_MS = TTL_SECONDS * 1000;
export const EMPTY_TTL_MS = 30_000; // an empty/failed grid is retried after 30 s (WOW-018)
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

// Injectable for tests only (WOW-018); production always uses the real ones.
type GridRedis = { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown, o: { ex: number }) => Promise<unknown> };
const realDeps = { fetch: meteredOpenMeteoFetch, redis: (): GridRedis => getRedis() as unknown as GridRedis };
let deps = realDeps;
export function __setForecastGridDepsForTests(d: Partial<typeof realDeps> | null): void {
  deps = d ? { ...realDeps, ...d } : realDeps;
}

/**
 * All batches or nothing (WOW-018). The first refused, thrown, unparseable or
 * short batch fails the whole grid and stops the loop, so no later batch is
 * billed and no value is ever drawn at another point's coordinates. Before,
 * a refused batch was skipped and later batches shifted onto its points.
 */
async function fetchCurrent(
  baseUrl: string, lats: number[], lons: number[], current: string,
  extraQuery: string, batchSize: number, signal?: AbortSignal,
): Promise<any[] | null> {
  const results: any[] = [];
  for (let b = 0; b < lats.length; b += batchSize) {
    const bLats = lats.slice(b, b + batchSize);
    const bLons = lons.slice(b, b + batchSize);
    const url = `${baseUrl}?latitude=${bLats.join(',')}&longitude=${bLons.join(',')}`
      + `&current=${current}${extraQuery}`;
    try {
      const res = await deps.fetch(url, { headers: UA, signal }, 'forecast-grid');
      if (!res.ok) return null;
      const data = await res.json();
      const batch = Array.isArray(data) ? data : [data];
      if (batch.length !== bLats.length) return null;
      results.push(...batch);
    } catch {
      return null;
    }
  }
  return results;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
  if (!results) return [];
  // The wind mesh and particle lattice need a complete rectangle, so one
  // missing speed, gust or direction fails the whole grid (never drawn as 0).
  const points: WindGridPoint[] = [];
  for (let i = 0; i < results.length; i++) {
    const c = results[i]?.current;
    if (!isNum(c?.wind_speed_10m) || !isNum(c?.wind_gusts_10m) || !isNum(c?.wind_direction_10m)) return [];
    points.push({ lat: lats[i], lon: lons[i], speed: c.wind_speed_10m, gust: c.wind_gusts_10m, dir: c.wind_direction_10m });
  }
  return points;
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
  if (!results) return [];
  // A point with no AQI is dropped, never drawn as AQI 0.
  const points: AqiGridPoint[] = [];
  results.forEach((r, i) => {
    if (isNum(r?.current?.us_aqi)) points.push({ lat: r.latitude ?? lats[i], lon: r.longitude ?? lons[i], aqi: r.current.us_aqi });
  });
  return points;
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
  if (!results) return [];
  // A town with no temperature is dropped, never shown as 0°F.
  const points: TownTempPoint[] = [];
  visible.forEach((c, i) => {
    const t = results[i]?.current?.temperature_2m;
    if (isNum(t)) points.push({ name: c.name, lat: c.lat, lon: c.lon, tempF: Math.round(t) });
  });
  return points;
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
  if (!results) return [];
  // A town with no AQI is dropped, never shown as AQI 0.
  const points: AqiTownPoint[] = [];
  visible.forEach((c, i) => {
    const a = results[i]?.current?.us_aqi;
    if (isNum(a)) points.push({ name: c.name, lat: c.lat, lon: c.lon, aqi: Math.round(a) });
  });
  return points;
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

  // Memory cache (local to this module, WOW-018): a complete grid is kept
  // TTL_MS; an empty or failed grid only EMPTY_TTL_MS, so the map recovers
  // soon after Open-Meteo's cooldown instead of staying blank for 10 minutes.
  const hot = cacheGet<any[]>(key);
  if (hot !== null) return hot as any;

  // Try Redis (shared across all serverless instances + users).
  try {
    const hit = await deps.redis().get(key);
    if (Array.isArray(hit) && hit.length > 0) {
      cacheSet(key, hit, TTL_MS);
      return hit as any;
    }
  } catch { /* Redis unconfigured — fall through to compute */ }

  const data = layer === 'wind' ? await computeWind(n, s, e, w, zoom)
    : layer === 'aqi' ? await computeAqi(n, s, e, w, zoom, clat, clon)
    : layer === 'aqitowns' ? await computeAqiTowns(n, s, e, w, zoom)
    : await computeTowns(n, s, e, w, zoom);

  // Compute returns [] on any failed batch, so non-empty means complete.
  if (data.length > 0) {
    try { await deps.redis().set(key, data, { ex: TTL_SECONDS }); } catch { /* no-op */ }
    cacheSet(key, data, TTL_MS);
  } else {
    cacheSet(key, data, EMPTY_TTL_MS);
  }
  return data;
}
