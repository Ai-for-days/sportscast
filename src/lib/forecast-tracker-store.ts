import { getRedis } from './redis';
import type { ForecastEntry, ForecastMetric } from './forecast-tracker-types';
import {
  calculateLeadTimeHours,
  getLeadTimeMultiplier,
  calculateAccuracyScore,
} from './forecast-tracker-types';

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

  return { stationId: firstStation.properties?.stationIdentifier, timeZone };
}

// ── Geocode a location string ───────────────────────────────────────────────

async function geocodeLocation(locationName: string): Promise<{ lat: number; lon: number }> {
  const encoded = encodeURIComponent(locationName);
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
  metric: ForecastMetric;
  targetDate: string;
  targetTime?: string;
  forecastValue: number;
}): Promise<ForecastEntry> {
  const redis = getRedis();
  const id = generateId();
  const inputAt = new Date().toISOString();

  // Geocode location and resolve NWS station
  const { lat, lon } = await geocodeLocation(input.locationName);
  const { stationId, timeZone } = await resolveNWSStation(lat, lon);

  const leadTimeHours = calculateLeadTimeHours(inputAt, input.targetDate, input.targetTime);

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

// ── NWS Observation Fetching ────────────────────────────────────────────────

interface NWSRawObservation {
  time: string;
  tempF?: number;
  windMph?: number;
  gustMph?: number;
}

async function fetchDayObservations(stationId: string, date: string): Promise<NWSRawObservation[]> {
  const startISO = new Date(`${date}T00:00:00Z`).toISOString();
  const endISO = new Date(`${date}T23:59:59Z`).toISOString();
  const url = `https://api.weather.gov/stations/${stationId}/observations?start=${startISO}&end=${endISO}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': NWS_UA, Accept: 'application/geo+json' },
  });
  if (!res.ok) throw new Error(`NWS observations failed: ${res.status}`);

  const data = await res.json();
  const features = data.features || [];

  return features.map((f: any) => {
    const props = f.properties;
    return {
      time: props.timestamp,
      tempF: props.temperature?.value != null
        ? Math.round(((props.temperature.value * 9) / 5 + 32) * 10) / 10
        : undefined,
      windMph: props.windSpeed?.value != null
        ? Math.round(props.windSpeed.value * 0.621371 * 10) / 10
        : undefined,
      gustMph: props.windGust?.value != null
        ? Math.round(props.windGust.value * 0.621371 * 10) / 10
        : undefined,
    };
  });
}

function getActualValue(
  observations: NWSRawObservation[],
  metric: ForecastMetric,
  targetTime?: string,
): number | null {
  if (observations.length === 0) return null;

  if (metric === 'high_temp') {
    const temps = observations.map(o => o.tempF).filter((t): t is number => t != null);
    return temps.length > 0 ? Math.max(...temps) : null;
  }

  if (metric === 'low_temp') {
    const temps = observations.map(o => o.tempF).filter((t): t is number => t != null);
    return temps.length > 0 ? Math.min(...temps) : null;
  }

  // For time-specific metrics, find observation closest to target time
  if (targetTime) {
    const targetHour = parseInt(targetTime.split(':')[0]);
    const targetMin = parseInt(targetTime.split(':')[1] || '0');
    const targetMinutes = targetHour * 60 + targetMin;

    let closest: NWSRawObservation | null = null;
    let closestDiff = Infinity;

    for (const obs of observations) {
      const obsDate = new Date(obs.time);
      const obsMinutes = obsDate.getUTCHours() * 60 + obsDate.getUTCMinutes();
      const diff = Math.abs(obsMinutes - targetMinutes);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = obs;
      }
    }

    if (!closest) return null;

    if (metric === 'actual_temp') return closest.tempF ?? null;
    if (metric === 'wind_speed') return closest.windMph ?? null;
    if (metric === 'wind_gust') return closest.gustMph ?? null;
  }

  // Fallback for wind metrics without time: use max for the day
  if (metric === 'wind_speed') {
    const vals = observations.map(o => o.windMph).filter((v): v is number => v != null);
    return vals.length > 0 ? Math.max(...vals) : null;
  }
  if (metric === 'wind_gust') {
    const vals = observations.map(o => o.gustMph).filter((v): v is number => v != null);
    return vals.length > 0 ? Math.max(...vals) : null;
  }

  return null;
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

    // Only verify if target date is in the past (give NWS time to publish — wait until next day)
    const targetEnd = new Date(`${entry.targetDate}T23:59:59Z`);
    if (now.getTime() < targetEnd.getTime() + 12 * 60 * 60 * 1000) {
      // Target date hasn't passed + 12h buffer for NWS to publish
      result.skipped++;
      continue;
    }

    try {
      const observations = await fetchDayObservations(entry.stationId, entry.targetDate);
      if (observations.length < 4) {
        result.skipped++;
        continue; // Not enough data yet
      }

      const actualValue = getActualValue(observations, entry.metric, entry.targetTime);
      if (actualValue === null) {
        result.skipped++;
        continue;
      }

      // Score it
      const errorAbs = Math.round(Math.abs(entry.forecastValue - actualValue) * 10) / 10;
      const accuracyScore = calculateAccuracyScore(entry.metric, errorAbs);
      const { multiplier } = getLeadTimeMultiplier(entry.leadTimeHours);
      const weightedScore = Math.round(accuracyScore * multiplier * 10) / 10;

      const verified: ForecastEntry = {
        ...entry,
        actualValue,
        verifiedAt: now.toISOString(),
        errorAbs,
        accuracyScore,
        leadTimeMultiplier: multiplier,
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
