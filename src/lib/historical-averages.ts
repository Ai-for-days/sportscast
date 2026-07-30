// ── Historical climatology aggregation ──────────────────────────────────────
//
// Pure aggregation split out of /api/weather/historical-averages so it can be
// tested without hitting the Open-Meteo Archive API, which is slow enough with
// hourly series that an end-to-end test is impractical.
//
// The reason hour bucketing exists: the endpoint used to return day-level
// figures only — temperature as the midpoint of average high and low, wind as
// the daily MAXIMUM, humidity averaged across all 24 hours. The game-day impact
// card therefore showed identical conditions for noon and 11pm on the same date.

export interface ArchiveYear {
  daily?: {
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_sum?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
    wind_gusts_10m_max?: (number | null)[];
  };
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    relative_humidity_2m?: (number | null)[];
    wind_speed_10m?: (number | null)[];
    wind_gusts_10m?: (number | null)[];
    precipitation?: (number | null)[];
  };
}

export interface HistoricalAverages {
  tempF: number;
  highTempF: number | null;
  lowTempF: number | null;
  windSpeedMph: number;
  windGustMph: number;
  humidity: number;
  precipProbability: number;
  /** True when the figures describe the requested hour rather than the whole day. */
  hourResolved: boolean;
  hourUsed: number | null;
  yearsUsed: number;
  daysSampled: number;
  hourSamples: number;
}

/** Measurable precipitation threshold, inches. */
const WET_THRESHOLD_IN = 0.01;

/**
 * Aggregate archive responses into climatology.
 *
 * When `hour` is 0-23 and at least one sample matches, every returned figure
 * describes THAT hour. Otherwise the day-level figures are returned and
 * `hourResolved` is false, so callers can label it honestly.
 *
 * Returns null when there is nothing usable at all.
 */
export function aggregateHistorical(
  results: (ArchiveYear | null)[],
  hour: number | null,
): HistoricalAverages | null {
  let totalHighTemp = 0, totalLowTemp = 0, totalWind = 0, totalGust = 0;
  let dayCount = 0, precipDaysCount = 0;

  let hTemp = 0, hHum = 0, hWind = 0, hGust = 0, hWet = 0, hCount = 0;
  let allHum = 0, allHumCount = 0;

  for (const data of results) {
    const d = data?.daily;
    if (d) {
      const len = d.temperature_2m_max?.length ?? 0;
      for (let i = 0; i < len; i++) {
        const hi = d.temperature_2m_max?.[i];
        const lo = d.temperature_2m_min?.[i];
        if (hi == null || lo == null) continue;
        totalHighTemp += hi;
        totalLowTemp += lo;
        totalWind += d.wind_speed_10m_max?.[i] ?? 0;
        totalGust += d.wind_gusts_10m_max?.[i] ?? 0;
        dayCount++;
        if ((d.precipitation_sum?.[i] ?? 0) >= WET_THRESHOLD_IN) precipDaysCount++;
      }
    }

    const h = data?.hourly;
    if (h?.time) {
      for (let i = 0; i < h.time.length; i++) {
        const rh = h.relative_humidity_2m?.[i];
        if (rh != null) { allHum += rh; allHumCount++; }

        if (hour === null) continue;
        // "2005-12-25T23:00" -> 23. Timestamps come back local to the point
        // (timezone=auto), so no conversion is needed or wanted.
        if (parseInt(h.time[i].slice(11, 13), 10) !== hour) continue;

        const t = h.temperature_2m?.[i];
        if (t == null) continue;
        hTemp += t;
        hHum += rh ?? 0;
        hWind += h.wind_speed_10m?.[i] ?? 0;
        hGust += h.wind_gusts_10m?.[i] ?? 0;
        if ((h.precipitation?.[i] ?? 0) >= WET_THRESHOLD_IN) hWet++;
        hCount++;
      }
    }
  }

  if (dayCount === 0 && hCount === 0) return null;

  const useHour = hour !== null && hCount > 0;

  return {
    tempF: useHour
      ? Math.round(hTemp / hCount)
      : Math.round((totalHighTemp / dayCount + totalLowTemp / dayCount) / 2),
    highTempF: dayCount ? Math.round(totalHighTemp / dayCount) : null,
    lowTempF: dayCount ? Math.round(totalLowTemp / dayCount) : null,
    windSpeedMph: useHour ? Math.round(hWind / hCount) : Math.round(totalWind / dayCount),
    windGustMph: useHour ? Math.round(hGust / hCount) : Math.round(totalGust / dayCount),
    humidity: useHour
      ? Math.round(hHum / hCount)
      : (allHumCount > 0 ? Math.round(allHum / allHumCount) : 50),
    // At an hour: share of that hour across the sampled years with measurable
    // precip. Day-level: share of DAYS with any — a much larger number, which is
    // one reason the two must never be mixed.
    precipProbability: useHour
      ? Math.round((hWet / hCount) * 100)
      : Math.round((precipDaysCount / dayCount) * 100),
    hourResolved: useHour,
    hourUsed: useHour ? hour : null,
    yearsUsed: results.filter(r => r?.daily || r?.hourly).length,
    daysSampled: dayCount,
    hourSamples: hCount,
  };
}
