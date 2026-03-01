import { getRedis } from './redis';
import { getWager, gradeWager, voidWager, lockExpiredWagers, getWagersByDate } from './wager-store';
import type { Wager, NWSObservation, WagerMetric, OddsWager, OverUnderWager, PointspreadWager } from './wager-types';

const NWS_UA = 'WagerOnWeather/1.0 (contact@wageronweather.com)';
const OBS_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days
const MIN_OBSERVATIONS = 4;
const VOID_AFTER_HOURS = 48;

// ── Fetch NWS observations ──────────────────────────────────────────────────

export async function fetchNWSObservations(
  stationId: string,
  date: string,
  timeZone: string,
): Promise<NWSObservation | null> {
  const redis = getRedis();
  const cacheKey = `nws-obs:${stationId}:${date}`;

  // Check cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return typeof cached === 'string' ? JSON.parse(cached) : cached as unknown as NWSObservation;
  }

  // Build time range: midnight to midnight in local time zone
  const startLocal = new Date(`${date}T00:00:00`);
  const endLocal = new Date(`${date}T23:59:59`);

  // Use the NWS API to fetch observations for the date range
  const startISO = startLocal.toISOString();
  const endISO = endLocal.toISOString();

  const url = `https://api.weather.gov/stations/${stationId}/observations?start=${startISO}&end=${endISO}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': NWS_UA, Accept: 'application/geo+json' },
  });

  if (!res.ok) {
    console.error(`NWS observations failed for ${stationId} on ${date}: ${res.status}`);
    return null;
  }

  const data = await res.json();
  const features = data.features || [];

  if (features.length < MIN_OBSERVATIONS) {
    console.warn(`Only ${features.length} observations for ${stationId} on ${date} (need ${MIN_OBSERVATIONS})`);
    return null;
  }

  // Compute daily aggregates
  let highTemp = -Infinity;
  let lowTemp = Infinity;
  let totalPrecip = 0;
  let maxWind = 0;
  let maxGust = 0;
  let validTemps = 0;

  for (const f of features) {
    const props = f.properties;

    // Temperature (C → F)
    if (props.temperature?.value != null) {
      const tempF = (props.temperature.value * 9) / 5 + 32;
      if (tempF > highTemp) highTemp = tempF;
      if (tempF < lowTemp) lowTemp = tempF;
      validTemps++;
    }

    // Precipitation (mm → inches)
    if (props.precipitationLastHour?.value != null && props.precipitationLastHour.value > 0) {
      totalPrecip += props.precipitationLastHour.value / 25.4;
    }

    // Wind (km/h → mph)
    if (props.windSpeed?.value != null) {
      const mph = props.windSpeed.value * 0.621371;
      if (mph > maxWind) maxWind = mph;
    }

    // Wind gusts (km/h → mph)
    if (props.windGust?.value != null) {
      const mph = props.windGust.value * 0.621371;
      if (mph > maxGust) maxGust = mph;
    }
  }

  const obs: NWSObservation = {
    stationId,
    date,
    highTemp: validTemps > 0 ? Math.round(highTemp * 10) / 10 : undefined,
    lowTemp: validTemps > 0 ? Math.round(lowTemp * 10) / 10 : undefined,
    precip: Math.round(totalPrecip * 100) / 100,
    windSpeed: Math.round(maxWind * 10) / 10,
    windGust: Math.round(maxGust * 10) / 10,
    observationCount: features.length,
    fetchedAt: new Date().toISOString(),
  };

  // Cache
  await redis.set(cacheKey, JSON.stringify(obs), { ex: OBS_CACHE_TTL });

  return obs;
}

// ── Grading functions ────────────────────────────────────────────────────────

function getObservedValue(obs: NWSObservation, metric: WagerMetric): number | undefined {
  switch (metric) {
    case 'actual_temp': return obs.highTemp; // graded against latest observation temp
    case 'high_temp': return obs.highTemp;
    case 'low_temp': return obs.lowTemp;
    case 'precip': return obs.precip;
    case 'wind_speed': return obs.windSpeed;
    case 'wind_gust': return obs.windGust;
  }
}

export function gradeOddsWager(wager: OddsWager, observed: number): string {
  for (const outcome of wager.outcomes) {
    if (observed >= outcome.minValue && observed <= outcome.maxValue) {
      return outcome.label;
    }
  }
  return 'none'; // no outcome matched
}

export function gradeOverUnderWager(wager: OverUnderWager, observed: number): string {
  if (observed > wager.line) return 'over';
  if (observed < wager.line) return 'under';
  return 'push';
}

export function gradePointspreadWager(
  wager: PointspreadWager,
  observedA: number,
  observedB: number,
): string {
  const actualDiff = observedA - observedB;
  if (actualDiff > wager.spread) return 'locationA';
  if (actualDiff < wager.spread) return 'locationB';
  return 'push';
}

// ── Daily grading orchestrator ──────────────────────────────────────────────

export async function runDailyGrading(): Promise<{
  locked: string[];
  graded: string[];
  voided: string[];
  errors: string[];
}> {
  const result = { locked: [] as string[], graded: [] as string[], voided: [] as string[], errors: [] as string[] };

  // Step 1: Lock expired open wagers
  try {
    result.locked = await lockExpiredWagers();
  } catch (err: any) {
    result.errors.push(`Lock step failed: ${err.message}`);
  }

  // Step 2: Find wagers that need grading (locked, targetDate in the past)
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check last 3 days to catch any missed
  for (let daysBack = 1; daysBack <= 3; daysBack++) {
    const checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - daysBack);
    const dateStr = checkDate.toISOString().split('T')[0];

    let dayWagers: Wager[];
    try {
      dayWagers = await getWagersByDate(dateStr);
    } catch {
      continue;
    }

    for (const wager of dayWagers) {
      if (wager.status !== 'locked') continue;

      try {
        if (wager.kind === 'pointspread') {
          await gradePointspreadWagerFull(wager, result);
        } else {
          await gradeSingleLocationWager(wager, result);
        }
      } catch (err: any) {
        result.errors.push(`Grading ${wager.id} failed: ${err.message}`);

        // Void after 48h if still can't grade
        const lockAge = Date.now() - new Date(wager.lockTime).getTime();
        if (lockAge > VOID_AFTER_HOURS * 60 * 60 * 1000) {
          try {
            await voidWager(wager.id, 'Insufficient NWS observation data after 48h');
            result.voided.push(wager.id);
          } catch { /* ignore */ }
        }
      }
    }
  }

  return result;
}

async function gradeSingleLocationWager(
  wager: OddsWager | OverUnderWager,
  result: { graded: string[]; voided: string[]; errors: string[] },
) {
  const obs = await fetchNWSObservations(wager.location.stationId, wager.targetDate, wager.location.timeZone);

  if (!obs) {
    throw new Error(`No observations for ${wager.location.stationId} on ${wager.targetDate}`);
  }

  const observed = getObservedValue(obs, wager.metric);
  if (observed == null) {
    throw new Error(`No ${wager.metric} data for ${wager.location.stationId} on ${wager.targetDate}`);
  }

  let winningOutcome: string;
  if (wager.kind === 'odds') {
    winningOutcome = gradeOddsWager(wager, observed);
  } else {
    winningOutcome = gradeOverUnderWager(wager, observed);
  }

  await gradeWager(wager.id, observed, winningOutcome);
  result.graded.push(wager.id);
}

async function gradePointspreadWagerFull(
  wager: PointspreadWager,
  result: { graded: string[]; voided: string[]; errors: string[] },
) {
  const [obsA, obsB] = await Promise.all([
    fetchNWSObservations(wager.locationA.stationId, wager.targetDate, wager.locationA.timeZone),
    fetchNWSObservations(wager.locationB.stationId, wager.targetDate, wager.locationB.timeZone),
  ]);

  if (!obsA || !obsB) {
    throw new Error(`Missing observations for pointspread wager ${wager.id}`);
  }

  const observedA = getObservedValue(obsA, wager.metric);
  const observedB = getObservedValue(obsB, wager.metric);

  if (observedA == null || observedB == null) {
    throw new Error(`No ${wager.metric} data for pointspread wager ${wager.id}`);
  }

  const winningOutcome = gradePointspreadWager(wager, observedA, observedB);

  // Store both observed values
  const redis = getRedis();
  const existing = await getWager(wager.id);
  if (existing && existing.kind === 'pointspread') {
    const updated = {
      ...existing,
      observedValue: observedA,
      observedValueA: observedA,
      observedValueB: observedB,
      winningOutcome,
      status: 'graded' as const,
      updatedAt: new Date().toISOString(),
    };
    await redis.set(`wager:${wager.id}`, JSON.stringify(updated));

    // Move between status sets
    await redis.zrem('wagers:by-status:locked', wager.id);
    await redis.zadd('wagers:by-status:graded', {
      score: new Date(wager.targetDate).getTime(),
      member: wager.id,
    });
  }

  result.graded.push(wager.id);
}
