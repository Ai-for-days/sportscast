import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lon = parseFloat(url.searchParams.get('lon') || '');
  const month = parseInt(url.searchParams.get('month') || '');
  const day = parseInt(url.searchParams.get('day') || '');

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return new Response(JSON.stringify({ error: 'Invalid lat/lon' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (isNaN(month) || month < 1 || month > 12 || isNaN(day) || day < 1 || day > 31) {
    return new Response(JSON.stringify({ error: 'Invalid month/day' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Query Open-Meteo archive for 1980-2024 daily max/min temps
    const omUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=1980-01-01&end_date=2024-12-31&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto`;
    const res = await fetch(omUrl);
    if (!res.ok) {
      throw new Error(`Open-Meteo archive returned ${res.status}`);
    }

    const data = await res.json();
    const dates: string[] = data.daily?.time ?? [];
    const maxTemps: (number | null)[] = data.daily?.temperature_2m_max ?? [];
    const minTemps: (number | null)[] = data.daily?.temperature_2m_min ?? [];

    // Pad month/day for comparison
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const target = `-${mm}-${dd}`;

    let recordHigh = -Infinity;
    let recordHighYear = '';
    let recordLow = Infinity;
    let recordLowYear = '';
    let sumHigh = 0;
    let sumLow = 0;
    let count = 0;

    for (let i = 0; i < dates.length; i++) {
      if (!dates[i].endsWith(target)) continue;
      const hi = maxTemps[i];
      const lo = minTemps[i];
      if (hi == null || lo == null) continue;

      count++;
      sumHigh += hi;
      sumLow += lo;

      if (hi > recordHigh) {
        recordHigh = hi;
        recordHighYear = dates[i].slice(0, 4);
      }
      if (lo < recordLow) {
        recordLow = lo;
        recordLowYear = dates[i].slice(0, 4);
      }
    }

    if (count === 0) {
      return new Response(JSON.stringify({ error: 'No historical data found for this date' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = {
      recordHigh: Math.round(recordHigh),
      recordHighYear,
      recordLow: Math.round(recordLow),
      recordLowYear,
      avgHigh: Math.round(sumHigh / count),
      avgLow: Math.round(sumLow / count),
      yearsOfData: count,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('Records API error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch historical records' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
