import type { APIRoute } from 'astro';

/**
 * Fetches historical weather averages from Open-Meteo Archive API.
 * Queries ±10 days around target date from the past 30 years, averages the results.
 * Each year is queried individually (small ~21-day window) for reliability.
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
    // Query 30 years of data — each year individually with a ~21-day window
    const years: number[] = [];
    for (let y = currentYear - 1; y >= currentYear - 30; y--) {
      years.push(y);
    }

    // Build individual year fetches (each ~21-day window is tiny and reliable)
    // Batch in groups of 10 to avoid rate limiting
    const results: any[] = [];
    for (let i = 0; i < years.length; i += 10) {
      const batch = years.slice(i, i + 10);
      const batchResults = await Promise.all(batch.map(year => {
        const target = new Date(year, month - 1, day);
        const start = new Date(target);
        start.setDate(start.getDate() - 10);
        const end = new Date(target);
        end.setDate(end.getDate() + 10);

        const startStr = start.toISOString().split('T')[0];
        const endStr = end.toISOString().split('T')[0];

        const apiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startStr}&end_date=${endStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max&hourly=relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

        return fetch(apiUrl).then(r => r.ok ? r.json() : null).catch(() => null);
      }));
      results.push(...batchResults);
    }

    // Aggregate all daily data
    let totalHighTemp = 0, totalLowTemp = 0, totalWind = 0, totalGust = 0;
    let totalHumidity = 0;
    let dayCount = 0, humidityCount = 0;
    let precipDaysCount = 0;

    for (const data of results) {
      if (!data?.daily) continue;
      const d = data.daily;
      for (let i = 0; i < (d.temperature_2m_max?.length || 0); i++) {
        if (d.temperature_2m_max[i] != null) {
          totalHighTemp += d.temperature_2m_max[i];
          totalLowTemp += d.temperature_2m_min[i];
          totalWind += d.wind_speed_10m_max[i] || 0;
          totalGust += d.wind_gusts_10m_max[i] || 0;
          dayCount++;

          if ((d.precipitation_sum[i] || 0) >= 0.01) {
            precipDaysCount++;
          }
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
    const precipProb = Math.round((precipDaysCount / dayCount) * 100);

    const successYears = results.filter(r => r?.daily).length;

    const response = {
      tempF: Math.round(avgTemp),
      highTempF: Math.round(totalHighTemp / dayCount),
      lowTempF: Math.round(totalLowTemp / dayCount),
      windSpeedMph: Math.round(totalWind / dayCount),
      windGustMph: Math.round(totalGust / dayCount),
      humidity: humidityCount > 0 ? Math.round(totalHumidity / humidityCount) : 50,
      precipProbability: precipProb,
      source: 'historical_average',
      yearsUsed: successYears,
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
