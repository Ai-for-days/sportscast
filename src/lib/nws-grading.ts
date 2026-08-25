import { getRedis } from './redis';
import { getWager, gradeWager, voidWager, lockExpiredWagers, getWagersByDate, localTimeToUTC } from './wager-store';
import { settleWagerBets, settleVoidedWagerBets } from './bet-settlement';
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
  const hourly: { time: string; tempF: number }[] = [];

  for (const f of features) {
    const props = f.properties;

    // Temperature (C → F)
    if (props.temperature?.value != null) {
      const tempF = (props.temperature.value * 9) / 5 + 32;
      if (tempF > highTemp) highTemp = tempF;
      if (tempF < lowTemp) lowTemp = tempF;
      validTemps++;
      if (props.timestamp) hourly.push({ time: props.timestamp, tempF: Math.round(tempF * 10) / 10 });
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

  hourly.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

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
    hourly,
  };

  // Cache
  await redis.set(cacheKey, JSON.stringify(obs), { ex: OBS_CACHE_TTL });

  return obs;
}

// ── Grading functions ────────────────────────────────────────────────────────

/** Nearest hourly reading to a target UTC instant — undefined when there's
 * no hourly data to search (older cached observations, or NWS omitted
 * per-reading timestamps), in which case the caller falls back to the
 * day's aggregate high. */
function nearestHourlyTemp(hourly: NWSObservation['hourly'], targetIso: string): number | undefined {
  if (!hourly || hourly.length === 0) return undefined;
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) return undefined;
  let best: number | undefined;
  let bestDiffMs = Infinity;
  for (const h of hourly) {
    const ms = Date.parse(h.time);
    if (!Number.isFinite(ms)) continue;
    const diff = Math.abs(ms - targetMs);
    if (diff < bestDiffMs) { bestDiffMs = diff; best = h.tempF; }
  }
  return best;
}

/**
 * `targetTime` + `timeZone` are only used for `actual_temp` (a by-time
 * wager's specific hour, e.g. "temp at first pitch") — every other metric
 * grades against the day's aggregate exactly as before. Reported live
 * (2026-08-25) while building the "at game start" venue O/U markets: this
 * previously always returned `obs.highTemp` for actual_temp regardless of
 * targetTime — the code comment claimed otherwise but there was no hourly
 * data to grade against. Now falls back to the day's high only when hourly
 * data genuinely isn't available, so existing wagers/cached observations
 * keep grading exactly as they did before this fix.
 */
export function getObservedValue(
  obs: NWSObservation,
  metric: WagerMetric,
  targetTime?: string,
  timeZone?: string,
): number | undefined {
  if (metric === 'actual_temp' && targetTime && timeZone) {
    const targetIso = localTimeToUTC(obs.date, targetTime, timeZone).toISOString();
    const near = nearestHourlyTemp(obs.hourly, targetIso);
    if (near != null) return near;
  }
  switch (metric) {
    case 'actual_temp': return obs.highTemp;
    case 'high_temp': return obs.highTemp;
    case 'low_temp': return obs.lowTemp;
    case 'actual_wind': return obs.windSpeed;
    case 'actual_gust': return obs.windGust;
  }
}

export function gradeOddsWager(wager: OddsWager, observed: number): string {
  for (const outcome of wager.outcomes) {
    if (observed >= outcome.minValue && observed <= outcome.maxValue) {
      return outcome.label;
    }
  }
  return 'no_match'; // no outcome matched — all bets lose
}

export function gradeOverUnderWager(wager: OverUnderWager, observed: number): string {
  if (observed > wager.line) return 'over';
  if (observed < wager.line) return 'under';
  return 'push';
}

/**
 * `spread` is locationA's own line in favorite/underdog notation (mirrors
 * locationAOdds/locationBOdds, and how PointspreadDisplay.tsx shows
 * spreadA=spread, spreadB=-spread) — the same convention as a standard ATS
 * spread bet. The correct comparison applies A's own spread to A's side
 * before comparing: A "covers" when (A + spread) exceeds B, i.e.
 * (A − B) + spread > 0. Reported live (2026-08-23): this previously
 * compared the raw diff straight against `spread` with no adjustment,
 * which graded backwards for exactly the close, competitively-priced
 * results the spread exists to split 50/50 — confirmed against 4 real
 * graded tickets Derek flagged as mis-scored, all of which flip under
 * this fix.
 */
export function gradePointspreadWager(
  wager: PointspreadWager,
  observedA: number,
  observedB: number,
): string {
  const adjustedDiff = (observedA - observedB) + wager.spread;
  if (adjustedDiff > 0) return 'locationA';
  if (adjustedDiff < 0) return 'locationB';
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
            await settleVoidedWagerBets(wager.id);
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

  const observed = getObservedValue(obs, wager.metric, wager.targetTime, wager.location.timeZone);
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
  await settleWagerBets(wager.id);
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

  // Step 145 — cross-metric pointspread: per-side metric falls back to
  // the shared `metric` field when metricA/metricB are unset. NWS source
  // and observation aggregation are unchanged.
  const metricA = wager.metricA ?? wager.metric;
  const metricB = wager.metricB ?? wager.metric;
  const observedA = getObservedValue(obsA, metricA, wager.targetTime, wager.locationA.timeZone);
  const observedB = getObservedValue(obsB, metricB, wager.targetTime, wager.locationB.timeZone);

  if (observedA == null || observedB == null) {
    throw new Error(`No ${metricA}/${metricB} data for pointspread wager ${wager.id}`);
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

  await settleWagerBets(wager.id);
  result.graded.push(wager.id);
}
