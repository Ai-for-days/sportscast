import { getRedis } from './redis';
import type { ForecastEntry, ForecastMetric } from './forecast-tracker-types';
import {
  calculateLeadTimeHours,
  getLeadTimeMultiplier,
  getPrecisionMultiplier,
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

  const stationId = firstStation.properties?.stationIdentifier;
  if (!stationId) throw new Error('Station has no identifier');
  return { stationId, timeZone };
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

async function fetchDayObservations(stationId: string, date: string, timeZone?: string): Promise<NWSRawObservation[]> {
  // Convert local-date boundaries to UTC so the NWS query covers the full local day.
  // E.g. for America/Los_Angeles, 2024-03-03 local = 2024-03-03T08:00Z to 2024-03-04T08:00Z.
  let startISO: string;
  let endISO: string;

  if (timeZone) {
    // Build a date in the target timezone, then find its UTC offset
    const startLocal = new Date(`${date}T00:00:00`);
    const endLocal = new Date(`${date}T23:59:59`);

    // Use Intl to get the UTC offset for this timezone on this date
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    });

    // Format a date in that tz to extract offset
    const parts = formatter.formatToParts(startLocal);
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
    // tzPart is like "GMT-8", "GMT+5:30", "GMT-4"
    const offsetMatch = tzPart.match(/GMT([+-]?\d+)?(?::(\d+))?/);
    let offsetMinutes = 0;
    if (offsetMatch) {
      const hours = parseInt(offsetMatch[1] || '0', 10);
      const mins = parseInt(offsetMatch[2] || '0', 10);
      offsetMinutes = hours * 60 + (hours < 0 ? -mins : mins);
    }

    // Local midnight in UTC = midnight minus UTC offset
    const startUtc = new Date(startLocal.getTime() - offsetMinutes * 60 * 1000);
    const endUtc = new Date(endLocal.getTime() - offsetMinutes * 60 * 1000);
    startISO = startUtc.toISOString();
    endISO = endUtc.toISOString();
  } else {
    startISO = new Date(`${date}T00:00:00Z`).toISOString();
    endISO = new Date(`${date}T23:59:59Z`).toISOString();
  }

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

/**
 * Convert a UTC timestamp to local hours+minutes in the given IANA timezone.
 */
function toLocalMinutes(utcIso: string, timeZone: string): number {
  const d = new Date(utcIso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  return h * 60 + m;
}

function getActualValue(
  observations: NWSRawObservation[],
  metric: ForecastMetric,
  targetTime?: string,
  timeZone?: string,
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
  // Target time is in the event's local timezone
  if (targetTime) {
    const targetHour = parseInt(targetTime.split(':')[0]);
    const targetMin = parseInt(targetTime.split(':')[1] || '0');
    const targetMinutes = targetHour * 60 + targetMin;

    let closest: NWSRawObservation | null = null;
    let closestDiff = Infinity;

    for (const obs of observations) {
      // Convert observation UTC timestamp to event-local time
      const obsMinutes = timeZone
        ? toLocalMinutes(obs.time, timeZone)
        : (() => { const d = new Date(obs.time); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
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
      const observations = await fetchDayObservations(entry.stationId, entry.targetDate, entry.timeZone);
      if (observations.length < 4) {
        result.skipped++;
        continue; // Not enough data yet
      }

      const actualValue = getActualValue(observations, entry.metric, entry.targetTime, entry.timeZone);
      if (actualValue === null) {
        result.skipped++;
        continue;
      }

      // Score it
      const errorAbs = Math.round(Math.abs(entry.forecastValue - actualValue) * 10) / 10;
      const accuracyScore = calculateAccuracyScore(entry.metric, errorAbs);
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
