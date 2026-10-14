// Current conditions derived from the hourly forecast (2026-10-13).
//
// Open-Meteo bills a request by its variable count: max(1, variables / 10)
// per location, times the days factor. Our forecast asked for the same 13
// variables twice, once in `current` and again in `hourly`, 39 in all, about
// 4.5 billed calls per fetch. Every `current` variable is also an `hourly`
// one, so the current block is rebuilt here from the two hours either side of
// now, and the request drops to 26 variables, about 3 billed calls (-33%).
//
// What changes for the reader: Open-Meteo's `current` is a 15-minute model
// value; this is the hourly forecast interpolated to the same 15-minute mark.
// The difference is a fraction of a degree in normal weather. The things that
// matter most when it is NOT normal still come from observations: the
// description is upgraded from radar and the NWS station (open-meteo.ts), and
// precipitation already takes the max of this hour, the model and NWS.

export interface OpenMeteoHourlyBlock {
  time: string[];
  [variable: string]: unknown[] | string[];
}

export interface DerivedCurrent {
  time: string;
  temperature_2m: number;
  relative_humidity_2m: number;
  dew_point_2m: number;
  precipitation: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  wind_gusts_10m: number;
  cloud_cover: number;
  surface_pressure: number;
  apparent_temperature: number;
  uv_index: number;
  visibility: number;
  weather_code: number;
}

const LINEAR = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'wind_speed_10m', 'wind_gusts_10m',
  'cloud_cover', 'surface_pressure', 'apparent_temperature', 'uv_index', 'visibility',
] as const;

/** Local wall-clock "YYYY-MM-DDTHH:MM" at the location, floored to 15 minutes like Open-Meteo's. */
export function localQuarterHour(nowMs: number, utcOffsetSeconds: number): string {
  const local = new Date(nowMs + utcOffsetSeconds * 1000);
  local.setUTCMinutes(Math.floor(local.getUTCMinutes() / 15) * 15, 0, 0);
  return local.toISOString().slice(0, 16);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function lerp(a: number | null, b: number | null, f: number): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * f;
}

/** Shortest-way-round interpolation for a compass bearing. */
function lerpBearing(a: number | null, b: number | null, f: number): number | null {
  if (a == null) return b;
  if (b == null) return a;
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * f + 360) % 360;
}

/**
 * The `current` block Open-Meteo would have returned, rebuilt from `hourly`.
 * Null when the hourly series does not cover now (callers then fail the fetch
 * like any malformed response, rather than show a made-up number). Pure.
 */
export function currentFromHourly(h: OpenMeteoHourlyBlock, utcOffsetSeconds: number, nowMs = Date.now()): DerivedCurrent | null {
  const times = h?.time;
  if (!Array.isArray(times) || times.length === 0) return null;
  const now = localQuarterHour(nowMs, utcOffsetSeconds);

  // Last hour at or before now. Local naive timestamps of one fixed format
  // sort correctly as strings.
  let i = -1;
  for (let k = 0; k < times.length; k++) {
    if (times[k] <= now) i = k;
    else break;
  }
  if (i < 0) return null;
  const j = Math.min(i + 1, times.length - 1);
  const f = j === i ? 0 : Number(now.slice(14, 16)) / 60;

  const at = (name: string, idx: number) => num((h[name] as unknown[] | undefined)?.[idx]);
  const out: Record<string, number> = {};
  for (const name of LINEAR) {
    const v = lerp(at(name, i), at(name, j), f);
    if (name === 'temperature_2m' && v == null) return null;
    out[name] = v ?? 0;
  }
  out.wind_direction_10m = lerpBearing(at('wind_direction_10m', i), at('wind_direction_10m', j), f) ?? 0;
  // Hourly precipitation is the total for the hour ENDING at its timestamp, so
  // the hour now falls in is the next entry. Weather code: the nearer hour.
  out.precipitation = at('precipitation', j) ?? at('precipitation', i) ?? 0;
  out.weather_code = (f >= 0.5 ? at('weather_code', j) : at('weather_code', i)) ?? at('weather_code', i) ?? 0;

  return { time: now, ...out } as unknown as DerivedCurrent;
}
