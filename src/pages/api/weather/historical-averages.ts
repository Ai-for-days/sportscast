import type { APIRoute } from 'astro';
import { aggregateHistorical, type ArchiveYear } from '../../../lib/historical-averages';

/**
 * Historical weather averages from the Open-Meteo Archive API.
 * Queries ±5 days around the target date across the past 20 years.
 * Each year is fetched individually (a small ~11-day window) for reliability.
 *
 * The window and year count were trimmed from ±10 days / 30 years when hourly
 * variables were added: five hourly series over 21 days x 30 years made the
 * endpoint slow enough to risk the serverless timeout. ±5 days x 20 years still
 * yields ~220 samples for a single hour-of-day, which is ample for climatology.
 *
 * Query params: lat, lon, month (1-12), day (1-31), hour (0-23, optional)
 *
 * WHY `hour` EXISTS (added 2026-07-30): without it this endpoint returned only
 * day-level figures — tempF was the midpoint of the average high and low, wind
 * was the daily MAXIMUM, and humidity averaged all 24 hours. So the game-day
 * impact card showed identical conditions for noon and 11pm on the same date,
 * which is what Derek reported. When `hour` is supplied we average the archive's
 * HOURLY series bucketed by hour-of-day instead, so 11pm on Christmas is the
 * cold, calm, damp hour it actually is rather than the day's midpoint.
 *
 * This is climatology, not a forecast. It answers "what is this hour typically
 * like here" — callers must label it that way and never present it as a
 * prediction for a specific future date.
 */
export const GET: APIRoute = async ({ url }) => {
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lon = parseFloat(url.searchParams.get('lon') || '');
  const month = parseInt(url.searchParams.get('month') || '', 10);
  const day = parseInt(url.searchParams.get('day') || '', 10);
  const hourRaw = url.searchParams.get('hour');
  const hour = hourRaw === null ? null : parseInt(hourRaw, 10);

  if (isNaN(lat) || isNaN(lon) || isNaN(month) || isNaN(day)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid lat, lon, month, day params' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (hour !== null && (isNaN(hour) || hour < 0 || hour > 23)) {
    return new Response(JSON.stringify({ error: 'hour must be an integer 0-23' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const currentYear = new Date().getFullYear();
    const YEARS_BACK = 20;
    const WINDOW_DAYS = 5;
    const years: number[] = [];
    for (let y = currentYear - 1; y >= currentYear - YEARS_BACK; y--) {
      years.push(y);
    }

    // Batch in groups of 10 to avoid rate limiting.
    const results: any[] = [];
    for (let i = 0; i < years.length; i += 10) {
      const batch = years.slice(i, i + 10);
      const batchResults = await Promise.all(batch.map(year => {
        const target = new Date(year, month - 1, day);
        const start = new Date(target);
        start.setDate(start.getDate() - WINDOW_DAYS);
        const end = new Date(target);
        end.setDate(end.getDate() + WINDOW_DAYS);

        const startStr = start.toISOString().split('T')[0];
        const endStr = end.toISOString().split('T')[0];

        // timezone=auto means the hourly timestamps come back LOCAL to the
        // point, so bucketing on the hour in the string needs no conversion.
        const apiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
          + `&start_date=${startStr}&end_date=${endStr}`
          + `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max`
          + `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation`
          + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

        return fetch(apiUrl).then(r => r.ok ? r.json() : null).catch(() => null);
      }));
      results.push(...batchResults);
    }

    const agg = aggregateHistorical(results as ArchiveYear[], hour);
    if (!agg) {
      return new Response(JSON.stringify({ error: 'No historical data available' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const response = { ...agg, source: 'historical_average' as const };

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
