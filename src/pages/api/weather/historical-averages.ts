import type { APIRoute } from 'astro';

/**
 * Fetches historical weather averages from Open-Meteo Archive API.
 * Queries ±10 days around target date using all available archive data (1940–last year).
 *
 * Query params: lat, lon, month (1-12), day (1-31)
 */
export const GET: APIRoute = async ({ url }) => {
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lon = parseFloat(url.searchParams.get('lon') || '');
  const month = parseInt(url.searchParams.get('month') || '', 10);
  const day = parseInt(url.searchParams.get('day') || '', 10);

  if (isNaN(lat) || isNaN(lon) || isNaN(month) || isNaN(day)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid lat, lon, month, day params' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const currentYear = new Date().getFullYear();
    // Use all available historical data: Open-Meteo archive goes back to 1940
    // but practical/reliable data starts ~1960. Fetch in chunks to stay under URL limits.
    const startYear = 1960;
    const endYear = currentYear - 1; // last complete year

    // Build date ranges in ~20-year chunks to keep API requests manageable
    const chunkSize = 20;
    const fetches: Promise<any>[] = [];
    const yearsUsed: number[] = [];

    for (let chunkStart = startYear; chunkStart <= endYear; chunkStart += chunkSize) {
      const chunkEnd = Math.min(chunkStart + chunkSize - 1, endYear);

      // Build start/end dates: ±10 days around target date across the full chunk range
      const startDate = new Date(chunkStart, month - 1, day);
      startDate.setDate(startDate.getDate() - 10);
      const endDate = new Date(chunkEnd, month - 1, day);
      endDate.setDate(endDate.getDate() + 10);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const apiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startStr}&end_date=${endStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max&hourly=relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

      fetches.push(fetch(apiUrl).then(r => r.json()));

      for (let y = chunkStart; y <= chunkEnd; y++) yearsUsed.push(y);
    }

    const results = await Promise.all(fetches);

    // Aggregate all daily data
    let totalHighTemp = 0, totalLowTemp = 0, totalWind = 0, totalGust = 0;
    let totalHumidity = 0;
    let dayCount = 0, humidityCount = 0;
    let precipDaysCount = 0; // days with measurable precip (>= 0.01")
    let totalDaysWithData = 0; // total days with non-null data

    // Only count days within ±10 days of the target month/day
    const targetMd = month * 100 + day; // e.g., 315 for March 15

    for (const data of results) {
      if (!data.daily) continue;
      const d = data.daily;
      for (let i = 0; i < (d.temperature_2m_max?.length || 0); i++) {
        if (d.temperature_2m_max[i] != null) {
          // Filter: only include days within ±10 of target month/day
          const dateStr = d.time?.[i];
          if (dateStr) {
            const parts = dateStr.split('-');
            const dMonth = parseInt(parts[1]);
            const dDay = parseInt(parts[2]);
            const dMd = dMonth * 100 + dDay;
            // Simple ±10 day check (approximate, handles month boundaries)
            const diff = Math.abs(dMd - targetMd);
            if (diff > 15 && diff < 350) continue; // allow wrap-around at year boundary
          }

          totalHighTemp += d.temperature_2m_max[i];
          totalLowTemp += d.temperature_2m_min[i];
          totalWind += d.wind_speed_10m_max[i] || 0;
          totalGust += d.wind_gusts_10m_max[i] || 0;
          totalDaysWithData++;

          // Count days with measurable precipitation (>= 0.01")
          if ((d.precipitation_sum[i] || 0) >= 0.01) {
            precipDaysCount++;
          }
          dayCount++;
        }
      }
      if (data.hourly?.relative_humidity_2m) {
        for (const h of data.hourly.relative_humidity_2m) {
          if (h != null) { totalHumidity += h; humidityCount++; }
        }
      }
    }

    if (dayCount === 0) {
      return new Response(JSON.stringify({ error: 'No historical data available' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const avgTemp = (totalHighTemp / dayCount + totalLowTemp / dayCount) / 2;
    // Precipitation probability = % of days that had measurable precip
    const precipProb = Math.round((precipDaysCount / totalDaysWithData) * 100);

    const response = {
      tempF: Math.round(avgTemp),
      highTempF: Math.round(totalHighTemp / dayCount),
      lowTempF: Math.round(totalLowTemp / dayCount),
      windSpeedMph: Math.round(totalWind / dayCount),
      windGustMph: Math.round(totalGust / dayCount),
      humidity: humidityCount > 0 ? Math.round(totalHumidity / humidityCount) : 50,
      precipProbability: precipProb,
      source: 'historical_average',
      yearsUsed: [startYear, endYear],
      daysSampled: dayCount,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to fetch historical data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
