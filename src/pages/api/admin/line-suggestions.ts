import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { suggestPricing } from '../../../lib/bookmaker-pricing';
import { listForecastEntries } from '../../../lib/forecast-tracker-store';

function normalizeDate(input: string): string {
  if (input.includes('/')) {
    const [mm, dd, yyyy] = input.split('/');
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return input;
}

/**
 * Build a helpful 404 message when there are no forecasts matching the
 * exact location+metric+date the operator typed. Surfaces:
 *   - a clear "add forecasts first" hint with the right admin link
 *   - up to 5 forecast entries whose location matches (case-insensitive)
 *     so the operator can spot a metric/date mismatch at a glance
 */
async function buildNoMatchHint(
  locationName: string,
  metric: string,
  targetDate: string,
  targetTime: string | undefined,
): Promise<string> {
  const locLower = locationName.toLowerCase().trim();
  let entries: Array<{ locationName: string; metric: string; targetDate: string; targetTime?: string; source: string }> = [];
  try {
    entries = (await listForecastEntries(500)) as any;
  } catch {
    /* swallow — fall through with the basic hint */
  }
  const sameLocation = entries.filter(
    (e) => e.locationName?.toLowerCase().trim() === locLower,
  );
  const base =
    `No forecasts have been tracked yet for location="${locationName}", metric="${metric}", date=${targetDate}` +
    (targetTime ? `, time=${targetTime}` : '') +
    `. Add forecast entries from your sources (e.g. NWS, WoW) at /admin/forecasts before generating suggested lines.`;
  if (sameLocation.length === 0) {
    return `${base} (No forecasts found for that location at all yet.)`;
  }
  const sample = sameLocation
    .slice(0, 5)
    .map(
      (e) =>
        `${e.metric} for ${e.targetDate}${e.targetTime ? `@${e.targetTime}` : ''} from ${e.source}`,
    );
  return `${base} Existing entries for that location: ${sample.join(' · ')}${sameLocation.length > 5 ? ` (+${sameLocation.length - 5} more)` : ''}.`;
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const locationName = url.searchParams.get('locationName');
  const metric = url.searchParams.get('metric');
  const targetDate = url.searchParams.get('targetDate');
  const targetTime = url.searchParams.get('targetTime') || undefined;

  if (!locationName || !metric || !targetDate) {
    return new Response(JSON.stringify({ error: 'locationName, metric, and targetDate are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const targetDateISO = normalizeDate(targetDate);

  try {
    const result = await suggestPricing({ locationName, metric, targetDate: targetDateISO, targetTime });

    if (!result) {
      const hint = await buildNoMatchHint(locationName, metric, targetDateISO, targetTime);
      return new Response(
        JSON.stringify({
          error: hint,
          forecastTrackerUrl: '/admin/forecasts',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
