import { getRedis } from './redis';
import type { ForecastEntry, ForecastMetric } from './forecast-tracker-types';
import {
  calculateLeadTimeHours,
  getLeadTimeMultiplier,
  getPrecisionMultiplier,
  calculateAccuracyScore,
} from './forecast-tracker-types';
import { fetchDayObservations, getObservedValue } from './nws-observations';
import type { ObservationMetric } from './nws-observations';

// ── Redis keys ──────────────────────────────────────────────────────────────

const KEY = {
  entry: (id: string) => `forecast-entry:${id}`,
  all: 'forecast-entries:all',
  pending: 'forecast-entries:pending',
} as const;

const NWS_UA = 'WagerOnWeather/1.0 (contact@wageronweather.com)';

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `fc_${ts}_${rand}`;
}

// ── NWS Station Resolution ──────────────────────────────────────────────────

export async function resolveNWSStation(lat: number, lon: number): Promise<{ stationId: string; timeZone: string }> {
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: { 'User-Agent': NWS_UA },
  });
  if (!pointsRes.ok) throw new Error(`NWS points API failed: ${pointsRes.status}`);
  const pointsData = await pointsRes.json();
  const timeZone: string = pointsData.properties?.timeZone || 'America/New_York';
  const stationsUrl: string = pointsData.properties?.observationStations;
  if (!stationsUrl) throw new Error('No observation stations URL from NWS');

  const stationsRes = await fetch(stationsUrl, { headers: { 'User-Agent': NWS_UA } });
  if (!stationsRes.ok) throw new Error(`NWS stations API failed: ${stationsRes.status}`);
  const stationsData = await stationsRes.json();
  const firstStation = stationsData.features?.[0];
  if (!firstStation) throw new Error('No observation stations found');

  const stationId = firstStation.properties?.stationIdentifier;
  if (!stationId) throw new Error('Station has no identifier');
  return { stationId, timeZone };
}

// ── Geocode a location string ───────────────────────────────────────────────

async function geocodeLocation(locationName: string): Promise<{ lat: number; lon: number }> {
  // Try local zip data first
  const { searchLocal, lookupZip } = await import('./zip-lookup');
  const trimmed = locationName.trim();

  // If it looks like a zip code, do exact lookup
  if (/^\d{5}$/.test(trimmed)) {
    const result = lookupZip(trimmed);
    if (result) return { lat: result.lat, lon: result.lon };
  }

  // Search local data by name
  const localResults = searchLocal(trimmed);
  if (localResults.length > 0) {
    return { lat: localResults[0].lat, lon: localResults[0].lon };
  }

  // Fallback to Nominatim
  const encoded = encodeURIComponent(trimmed);
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encoded}&countrycodes=us&format=json&limit=1`,
    { headers: { 'User-Agent': NWS_UA } }
  );
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  if (!data.length) throw new Error(`Location not found: "${locationName}"`);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

// ── Create forecast entry ───────────────────────────────────────────────────

export async function createForecastEntry(input: {
  locationName: string;
  lat?: number;
  lon?: number;
  metric: ForecastMetric;
  targetDate: string;
  targetTime?: string;
  forecastValue: number;
  source?: string[];
}): Promise<ForecastEntry> {
  const redis = getRedis();
  const id = generateId();
  const inputAt = new Date().toISOString();

  // Use provided lat/lon or geocode the location name
  const { lat, lon } = (input.lat != null && input.lon != null)
    ? { lat: input.lat, lon: input.lon }
    : await geocodeLocation(input.locationName);
  const { stationId, timeZone } = await resolveNWSStation(lat, lon);

  const leadTimeHours = calculateLeadTimeHours(inputAt, input.targetDate, input.targetTime, timeZone);

  const entry: ForecastEntry = {
    id,
    locationName: input.locationName,
    stationId,
    lat,
    lon,
    timeZone,
    metric: input.metric,
    targetDate: input.targetDate,
    targetTime: input.targetTime,
    forecastValue: input.forecastValue,
    source: input.source,
    inputAt,
    leadTimeHours,
  };

  const pipeline = redis.pipeline();
  pipeline.set(KEY.entry(id), JSON.stringify(entry));
  pipeline.zadd(KEY.all, { score: Date.now(), member: id });
  pipeline.sadd(KEY.pending, id);
  await pipeline.exec();

  return entry;
}

// ── List all entries ────────────────────────────────────────────────────────

export async function listForecastEntries(limit = 50): Promise<ForecastEntry[]> {
  const redis = getRedis();
  const ids = await redis.zrange(KEY.all, 0, limit - 1, { rev: true }) as string[];
  if (ids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.get(KEY.entry(id));
  const results = await pipeline.exec();

  return results
    .filter(Boolean)
    .map(raw => typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ForecastEntry);
}

// ── Delete an entry ─────────────────────────────────────────────────────────

export async function deleteForecastEntry(id: string): Promise<boolean> {
  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.del(KEY.entry(id));
  pipeline.zrem(KEY.all, id);
  pipeline.srem(KEY.pending, id);
  await pipeline.exec();
  return true;
}

// ── Map forecast metrics to shared observation metrics ──────────────────────

const FORECAST_TO_OBS_METRIC: Record<ForecastMetric, ObservationMetric> = {
  actual_temp: 'actual_temp',
  high_temp: 'high_temp',
  low_temp: 'low_temp',
  wind_speed: 'wind_speed',
  wind_gust: 'wind_gust',
};

// ── Forecast end time helper ────────────────────────────────────────────────

function getForecastEndTimeMs(entry: ForecastEntry): number {
  if (entry.timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: entry.timeZone, timeZoneName: 'shortOffset' });
    const parts = formatter.formatToParts(new Date(`${entry.targetDate}T12:00:00`));
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
    const offsetMatch = tzPart.match(/GMT([+-]?\d+)?(?::(\d+))?/);
    let offsetMinutes = 0;
    if (offsetMatch) {
      const hours = parseInt(offsetMatch[1] || '0', 10);
      const mins = parseInt(offsetMatch[2] || '0', 10);
      offsetMinutes = hours * 60 + (hours < 0 ? -mins : mins);
    }
    if (entry.targetTime) {
      // End = targetTime on targetDate in local tz → UTC
      const localMs = new Date(`${entry.targetDate}T${entry.targetTime}:00`).getTime();
      return localMs - offsetMinutes * 60 * 1000;
    }
    // End of local day → UTC
    return new Date(`${entry.targetDate}T23:59:59`).getTime() - offsetMinutes * 60 * 1000;
  }
  // No timezone — use UTC end of day
  return new Date(`${entry.targetDate}T23:59:59Z`).getTime();
}

// ── Verify pending entries ──────────────────────────────────────────────────

export async function verifyPendingEntries(): Promise<{
  verified: number;
  skipped: number;
  errors: string[];
}> {
  const redis = getRedis();
  const result = { verified: 0, skipped: 0, errors: [] as string[] };

  const pendingIds = await redis.smembers(KEY.pending) as string[];
  if (pendingIds.length === 0) return result;

  const now = new Date();

  for (const id of pendingIds) {
    const raw = await redis.get(KEY.entry(id));
    if (!raw) {
      await redis.srem(KEY.pending, id);
      continue;
    }

    const entry: ForecastEntry = typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ForecastEntry;

    // Only verify if the forecast's end time + 15 min buffer has passed
    const forecastEndMs = getForecastEndTimeMs(entry);
    if (now.getTime() < forecastEndMs + 15 * 60 * 1000) {
      result.skipped++;
      continue;
    }

    try {
      const observations = await fetchDayObservations(entry.stationId, entry.targetDate, entry.timeZone);
      if (observations.length === 0) {
        result.skipped++;
        continue; // No observation data yet
      }

      const obsMetric = FORECAST_TO_OBS_METRIC[entry.metric] || entry.metric as ObservationMetric;
      const actualValue = getObservedValue(observations, obsMetric, entry.targetTime, entry.timeZone);
      if (actualValue === null) {
        result.skipped++;
        continue;
      }

      // Score it
      const errorAbs = Math.round(Math.abs(entry.forecastValue - actualValue) * 10) / 10;
      const accuracyScore = calculateAccuracyScore(entry.metric, errorAbs, entry.leadTimeHours);
      const { multiplier } = getLeadTimeMultiplier(entry.leadTimeHours);
      const { multiplier: precisionMult } = getPrecisionMultiplier(entry.targetTime);
      const weightedScore = Math.round(accuracyScore * multiplier * precisionMult * 10) / 10;

      const verified: ForecastEntry = {
        ...entry,
        actualValue,
        verifiedAt: now.toISOString(),
        errorAbs,
        accuracyScore,
        leadTimeMultiplier: multiplier,
        precisionMultiplier: precisionMult,
        weightedScore,
      };

      await redis.set(KEY.entry(id), JSON.stringify(verified));
      await redis.srem(KEY.pending, id);
      result.verified++;
    } catch (err: any) {
      result.errors.push(`${id}: ${err.message}`);
    }
  }

  return result;
}
