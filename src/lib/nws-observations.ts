// ── Shared NWS Observation Fetching ──────────────────────────────────────────
// Used by both forecast tracker and wager auto-grading.

const NWS_UA = 'WagerOnWeather/1.0 (contact@wageronweather.com)';

export interface NWSRawObservation {
  time: string;
  tempF?: number;
  windMph?: number;
  gustMph?: number;
}

export async function fetchDayObservations(stationId: string, date: string, timeZone?: string): Promise<NWSRawObservation[]> {
  let startISO: string;
  let endISO: string;

  if (timeZone) {
    const startLocal = new Date(`${date}T00:00:00`);
    const endLocal = new Date(`${date}T23:59:59`);

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    });

    const parts = formatter.formatToParts(startLocal);
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
    const offsetMatch = tzPart.match(/GMT([+-]?\d+)?(?::(\d+))?/);
    let offsetMinutes = 0;
    if (offsetMatch) {
      const hours = parseInt(offsetMatch[1] || '0', 10);
      const mins = parseInt(offsetMatch[2] || '0', 10);
      offsetMinutes = hours * 60 + (hours < 0 ? -mins : mins);
    }

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
        ? Math.round((props.temperature.value * 9) / 5 + 32)
        : undefined,
      windMph: props.windSpeed?.value != null
        ? Math.round(props.windSpeed.value * 0.621371)
        : undefined,
      gustMph: props.windGust?.value != null
        ? Math.round(props.windGust.value * 0.621371)
        : undefined,
    };
  });
}

/** Convert a UTC timestamp to local hours+minutes in the given IANA timezone. */
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

export type ObservationMetric = 'high_temp' | 'low_temp' | 'actual_temp' | 'wind_speed' | 'wind_gust' | 'actual_wind' | 'actual_gust';

/**
 * Extract an actual observed value from NWS observations for a given metric.
 * Works for both forecast tracker metrics and wager metrics.
 */
export function getObservedValue(
  observations: NWSRawObservation[],
  metric: ObservationMetric,
  targetTime?: string,
  timeZone?: string,
): number | null {
  if (observations.length === 0) return null;

  // Temperature metrics
  if (metric === 'high_temp') {
    const temps = observations.map(o => o.tempF).filter((t): t is number => t != null);
    return temps.length > 0 ? Math.round(Math.max(...temps)) : null;
  }
  if (metric === 'low_temp') {
    const temps = observations.map(o => o.tempF).filter((t): t is number => t != null);
    return temps.length > 0 ? Math.round(Math.min(...temps)) : null;
  }

  // Time-specific metrics: find the observation CLOSEST TO TARGET TIME that
  // actually has a value for this metric. Skipping data gaps matters for wind:
  // NWS SPECI obs (and some stations) report temperature but a null windSpeed
  // at a given timestamp, so picking the single nearest obs and reading its
  // (missing) wind field would null out the whole verification.
  if (targetTime) {
    const targetHour = parseInt(targetTime.split(':')[0]);
    const targetMin = parseInt(targetTime.split(':')[1] || '0');
    const targetMinutes = targetHour * 60 + targetMin;

    const valueFor = (o: NWSRawObservation): number | undefined => {
      if (metric === 'actual_temp') return o.tempF;
      if (metric === 'actual_wind' || metric === 'wind_speed') return o.windMph;
      // gust: fall back to sustained wind when NWS reports no gust
      if (metric === 'actual_gust' || metric === 'wind_gust') return o.gustMph ?? o.windMph;
      return undefined;
    };

    let closestVal: number | null = null;
    let closestDiff = Infinity;
    for (const obs of observations) {
      const v = valueFor(obs);
      if (v == null) continue; // skip observations missing this metric
      const obsMinutes = timeZone
        ? toLocalMinutes(obs.time, timeZone)
        : (() => { const d = new Date(obs.time); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
      const diff = Math.abs(obsMinutes - targetMinutes);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestVal = v;
      }
    }

    if (closestVal != null) return closestVal;
    // No observation near the target time had this metric — fall through to
    // the daily aggregates below (wind) or return null (temp).
  }

  // Fallback: daily aggregates for wind
  if (metric === 'actual_wind' || metric === 'wind_speed') {
    const vals = observations.map(o => o.windMph).filter((v): v is number => v != null);
    return vals.length > 0 ? Math.round(Math.max(...vals)) : null;
  }
  if (metric === 'actual_gust' || metric === 'wind_gust') {
    const gustVals = observations.map(o => o.gustMph).filter((v): v is number => v != null);
    if (gustVals.length > 0) return Math.round(Math.max(...gustVals));
    // NWS reports no gusts when wind is steady — fall back to max sustained wind
    const windVals = observations.map(o => o.windMph).filter((v): v is number => v != null);
    return windVals.length > 0 ? Math.round(Math.max(...windVals)) : null;
  }

  return null;
}
