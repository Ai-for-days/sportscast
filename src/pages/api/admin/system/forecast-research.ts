// ── Admin API: Forecast Market Research ─────────────────────────────────────
//
// Read-only operator diagnostics. Given a ZIP (or lat/lon), assembles the
// enriched forecast intelligence a trader uses to set markets: the four
// formerly-public cards (Outlook / Changes / History / Market Context) at
// full fidelity, plus multi-day outlook, hourly detail, per-day model
// volatility across captured snapshots, and suggested over/under lines.
//
// requireAdmin gate, action-based dispatch, no secrets, no public/customer
// reachability. Reuses the same revision-snapshot store the public ZIP pages
// populate, so the volatility history reflects real traffic.

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { geocodePostalCode } from '../../../../lib/slug-utils';
import { getForecast } from '../../../../lib/weather-queries';
import { buildForecastIntelligence } from '../../../../lib/forecast-intelligence';
import {
  captureRevision,
  listSnapshots,
  locationKey,
} from '../../../../lib/forecast-revision-store';
import { buildRevisionSummary } from '../../../../lib/forecast-revision-analysis';
import { buildForecastTimeline } from '../../../../lib/forecast-timeline';
import { buildWeatherMarketContext } from '../../../../lib/weather-market-context';
import { buildMarketResearch } from '../../../../lib/forecast-market-research';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'research';
    if (action !== 'research') {
      return jsonResponse({ error: 'unknown_action' }, 400);
    }

    const zipRaw = (url.searchParams.get('zip') ?? '').trim();
    const country = (url.searchParams.get('country') ?? 'us').trim().toLowerCase() || 'us';
    const latRaw = url.searchParams.get('lat');
    const lonRaw = url.searchParams.get('lon');

    let geo: { lat: number; lon: number; city: string; state: string; zip: string; countryCode: string } | null = null;

    if (zipRaw) {
      geo = await geocodePostalCode(zipRaw, country);
      if (!geo) return jsonResponse({ error: 'zip_not_found', zip: zipRaw }, 404);
    } else if (latRaw && lonRaw) {
      const lat = Number(latRaw);
      const lon = Number(lonRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return jsonResponse({ error: 'invalid_coordinates' }, 400);
      }
      geo = { lat, lon, city: '', state: '', zip: '', countryCode: country };
    } else {
      return jsonResponse({ error: 'zip_or_coords_required' }, 400);
    }

    const { lat, lon } = geo;
    const forecast = await getForecast(lat, lon, 15);

    const label =
      geo.city && geo.state
        ? `${geo.city}, ${geo.state}${geo.zip ? ` ${geo.zip}` : ''}`
        : geo.city || geo.state || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;

    const intelligence = buildForecastIntelligence(forecast);

    const locKey = locationKey({ zip: geo.zip, countryCode: geo.countryCode, lat, lon });

    // Capture a fresh snapshot (deduped by generatedAt) and read the chain so
    // the volatility history reflects every prior run we've recorded.
    let revision = {
      priorCapturedAt: null,
      comparedLabel: null,
      generatedAtUnchanged: false,
      isInitial: true,
      isUnchanged: false,
      changes: [],
      headline: null,
    } as ReturnType<typeof buildRevisionSummary>;
    let snapshots = [] as Awaited<ReturnType<typeof listSnapshots>>;
    let timeline = buildForecastTimeline([]);
    try {
      const { prior, current } = await captureRevision(forecast, locKey, intelligence);
      revision = buildRevisionSummary(prior, current);
      snapshots = await listSnapshots(locKey, 20);
      timeline = buildForecastTimeline(snapshots, { skipMostRecentPair: true });
    } catch (err) {
      console.warn('[forecast-research] revision capture failed:', err);
    }

    const marketContext = buildWeatherMarketContext({ intelligence, revision, timeline });

    const research = buildMarketResearch({
      forecast,
      snapshots,
      intelligence,
      revision,
      timeline,
      marketContext,
      location: { label, zip: geo.zip, city: geo.city, state: geo.state, lat, lon },
      generatedAt: new Date().toISOString(),
    });

    return jsonResponse({ research });
  } catch (err) {
    console.error('[forecast-research] error:', err);
    return jsonResponse({ error: 'internal_error', message: String(err) }, 500);
  }
};
