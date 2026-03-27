import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import {
  createForecastEntry,
  listForecastEntries,
  deleteForecastEntry,
} from '../../../lib/forecast-tracker-store';
import type { ForecastMetric } from '../../../lib/forecast-tracker-types';

const VALID_METRICS: ForecastMetric[] = ['actual_temp', 'high_temp', 'low_temp', 'wind_speed', 'wind_gust'];

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { locationName, lat, lon, metric, targetDate, targetTime, forecastValue, source } = body;

    if (!locationName || typeof locationName !== 'string') {
      return new Response(JSON.stringify({ error: 'locationName is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!VALID_METRICS.includes(metric)) {
      return new Response(JSON.stringify({ error: `metric must be one of: ${VALID_METRICS.join(', ')}` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return new Response(JSON.stringify({ error: 'targetDate (YYYY-MM-DD) is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (typeof forecastValue !== 'number') {
      return new Response(JSON.stringify({ error: 'forecastValue (number) is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const entry = await createForecastEntry({
      locationName: locationName.trim(),
      lat: typeof lat === 'number' ? lat : undefined,
      lon: typeof lon === 'number' ? lon : undefined,
      metric,
      targetDate,
      targetTime: targetTime || undefined,
      forecastValue,
      source: Array.isArray(source) && source.length > 0 ? source : ['wageronweather'],
    });

    return new Response(JSON.stringify(entry), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const entries = await listForecastEntries();
    return new Response(JSON.stringify({ entries }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return new Response(JSON.stringify({ error: 'id is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    await deleteForecastEntry(id);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
