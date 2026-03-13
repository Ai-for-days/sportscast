import type { APIRoute } from 'astro';
import { buildAttribution, type AttributionFilters } from '../../../lib/model-attribution';
import { MODEL_FAMILIES } from '../../../lib/model-registry';
import { logAuditEvent } from '../../../lib/audit-log';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ url }) => {
  try {
    const action = url.searchParams.get('action') || 'attribution';

    if (action === 'families') {
      return new Response(JSON.stringify({ families: [...MODEL_FAMILIES] }), { status: 200 });
    }

    if (action === 'compare') {
      const familyA = url.searchParams.get('familyA') || '';
      const familyB = url.searchParams.get('familyB') || '';
      const dateFrom = url.searchParams.get('dateFrom') || undefined;
      const dateTo = url.searchParams.get('dateTo') || undefined;
      const minSample = parseInt(url.searchParams.get('minSample') || '0', 10);

      const [resultA, resultB] = await Promise.all([
        buildAttribution({ family: familyA || undefined, dateFrom, dateTo, minSample }),
        familyB ? buildAttribution({ family: familyB, dateFrom, dateTo, minSample }) : Promise.resolve(null),
      ]);

      await logAuditEvent({
        actor: 'admin',
        eventType: 'model_attribution_compare_run',
        targetType: 'system',
        targetId: 'model-attribution',
        summary: `Compare: ${familyA || 'all'} vs ${familyB || 'N/A'}`,
      });

      return new Response(JSON.stringify({ a: resultA, b: resultB }), { status: 200 });
    }

    // Default: attribution with filters
    const filters: AttributionFilters = {};
    const family = url.searchParams.get('family');
    if (family) filters.family = family;
    const dateFrom = url.searchParams.get('dateFrom');
    if (dateFrom) filters.dateFrom = dateFrom;
    const dateTo = url.searchParams.get('dateTo');
    if (dateTo) filters.dateTo = dateTo;
    const source = url.searchParams.get('source');
    if (source) filters.source = source;
    const mode = url.searchParams.get('mode');
    if (mode) filters.mode = mode;
    const attributionMethod = url.searchParams.get('attributionMethod');
    if (attributionMethod === 'direct' || attributionMethod === 'inferred' || attributionMethod === 'unknown') {
      filters.attributionMethod = attributionMethod;
    }
    const minSample = url.searchParams.get('minSample');
    if (minSample) filters.minSample = parseInt(minSample, 10);

    const result = await buildAttribution(filters);
    return new Response(JSON.stringify({ ...result, families: [...MODEL_FAMILIES] }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
