// ── MET Norway (Norwegian Meteorological Institute) ─────────────────────────
//
// A genuinely independent third opinion for the forecast blend. Chosen because:
//   - it is a national meteorological service, not a reseller;
//   - it is free with NO API key, so nothing to expire or pay for;
//   - it is global, so it covers every ZIP the site serves;
//   - it is a different model lineage (ECMWF-based) from Open-Meteo's default,
//     so it disagrees in useful ways rather than echoing the base forecast.
//
// AccuWeather was the original plan but retired its permanent free tier in 2026,
// leaving only 14-day trials. This needs no account at all.
//
// TERMS: MET's API requires a descriptive, contactable User-Agent and will block
// generic ones. Do not remove or genericise MET_UA. They also ask that clients
// respect caching and not poll aggressively — hence the short in-memory cache.
// https://api.met.no/doc/TermsOfService
//
// Fully defensive: every failure path returns an empty list so the consensus
// simply proceeds without this source.

const MET_UA = 'WagerOnWeather/1.0 (https://wageronweather.com; contact@wageronweather.com)';
const ENDPOINT = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const TIMEOUT_MS = 4000;
/** MET updates roughly hourly; caching 30 min is well within their guidance. */
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface MetnoDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  highF?: number;
  lowF?: number;
}

/** Hourly temperature by local "YYYY-MM-DDTHH", for the hourly blend. */
export type MetnoHours = Map<string, number>;

export interface MetnoForecast {
  daily: MetnoDay[];
  hourly: MetnoHours;
}

const cache = new Map<string, { value: MetnoForecast; at: number }>();

function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

/**
 * MET returns UTC timestamps ("2026-07-30T14:00:00Z"). The rest of the pipeline
 * keys on times LOCAL to the point (Open-Meteo timezone=auto), so shift by the
 * location's offset before bucketing — otherwise days and hours land wrong for
 * every location that is not on UTC, which is all of the US.
 */
function toLocalKey(utcIso: string, utcOffsetSeconds: number): { date: string; hourKey: string } | null {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + utcOffsetSeconds * 1000);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { date, hourKey: `${date}T${String(d.getUTCHours()).padStart(2, '0')}` };
}

/**
 * Fetch MET Norway and reduce it to daily highs/lows plus hourly temps, both
 * keyed in the location's local time and in Fahrenheit.
 *
 * `utcOffsetSeconds` must be the location's offset (base.utcOffsetSeconds).
 */
export async function fetchMetnoForecast(
  lat: number,
  lon: number,
  utcOffsetSeconds: number,
): Promise<MetnoForecast> {
  const empty: MetnoForecast = { daily: [], hourly: new Map() };
  // MET asks for coordinates truncated to 4 decimals; it also improves cache hits.
  const la = lat.toFixed(4);
  const lo = lon.toFixed(4);
  const key = `${la},${lo},${utcOffsetSeconds}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  try {
    const res = await fetch(`${ENDPOINT}?lat=${la}&lon=${lo}`, {
      headers: { 'User-Agent': MET_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return empty;

    const json: any = await res.json();
    const series: any[] = json?.properties?.timeseries ?? [];
    if (!Array.isArray(series) || series.length === 0) return empty;

    const perDay = new Map<string, { min: number; max: number }>();
    const hourly: MetnoHours = new Map();

    for (const entry of series) {
      const tempC = entry?.data?.instant?.details?.air_temperature;
      if (typeof tempC !== 'number' || !Number.isFinite(tempC)) continue;
      const keys = toLocalKey(entry?.time, utcOffsetSeconds);
      if (!keys) continue;

      const f = cToF(tempC);
      hourly.set(keys.hourKey, Math.round(f));

      const cur = perDay.get(keys.date);
      if (!cur) perDay.set(keys.date, { min: f, max: f });
      else {
        if (f < cur.min) cur.min = f;
        if (f > cur.max) cur.max = f;
      }
    }

    // MET's resolution drops to 6-hourly beyond ~2-3 days, so late days have few
    // samples and their min/max understate the true swing. Only emit a day when
    // there is enough coverage to be meaningful — a "high" from two samples would
    // drag the blend the wrong way.
    const daily: MetnoDay[] = [];
    const sampleCounts = new Map<string, number>();
    for (const hourKey of hourly.keys()) {
      const date = hourKey.slice(0, 10);
      sampleCounts.set(date, (sampleCounts.get(date) ?? 0) + 1);
    }
    for (const [date, v] of perDay) {
      if ((sampleCounts.get(date) ?? 0) < 4) continue;
      daily.push({ date, highF: Math.round(v.max), lowF: Math.round(v.min) });
    }
    daily.sort((a, b) => a.date.localeCompare(b.date));

    const value: MetnoForecast = { daily, hourly };
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    return empty;
  }
}

/** Test seam. */
export function clearMetnoCache() {
  cache.clear();
}
