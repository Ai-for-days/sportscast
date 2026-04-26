import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { reverifyBatch } from '../../../../lib/forecast-tracker-store';

// Step 75: keep reverify under Vercel's 10s function timeout. Returns partial
// results (with nextCursor) when the deadline fires mid-batch so the client can
// resume without re-processing entries that were already updated.
const DEFAULT_BATCH_SIZE = 15;
const MAX_BATCH_SIZE = 30;
const SOFT_DEADLINE_MS = 9_000; // exit work loop ~1s before Vercel kills us

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handle(request: Request, url: URL): Promise<Response> {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Accept params from JSON body OR query string. Body wins if both are present.
  let cursor = parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0;
  let batchSize = parseInt(url.searchParams.get('limit') ?? `${DEFAULT_BATCH_SIZE}`, 10) || DEFAULT_BATCH_SIZE;

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (typeof body.cursor === 'number') cursor = body.cursor;
      if (typeof body.batchSize === 'number') batchSize = body.batchSize;
      if (typeof body.limit === 'number') batchSize = body.limit;
    } catch {
      // No JSON body — keep query-string defaults
    }
  }
  batchSize = Math.max(1, Math.min(batchSize, MAX_BATCH_SIZE));

  const startedAt = Date.now();
  const deadlineMs = startedAt + SOFT_DEADLINE_MS;

  try {
    const result = await reverifyBatch(cursor, batchSize, deadlineMs);
    const durationMs = Date.now() - startedAt;
    // Structured log — visible in Vercel function logs
    console.log('[reverify] complete', JSON.stringify({
      cursor, batchSize, total: result.total, processed: result.processed,
      errors: result.errors.length, timedOut: !!result.timedOut, durationMs,
    }));
    return jsonResponse({ ...result, durationMs });
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    console.error('[reverify] error', JSON.stringify({ cursor, batchSize, durationMs, message: err?.message ?? String(err) }));
    // Always JSON, even on unexpected failure — never let Vercel return a raw 504
    return jsonResponse({
      error: 'reverification_failed',
      message: err?.message ?? 'Unexpected error',
      cursor,
      batchSize,
      durationMs,
    }, 500);
  }
}

export const POST: APIRoute = async ({ request, url }) => handle(request, url);

// Step 75: mirror as GET for easy progress polling / curl debugging.
// Same auth + JSON-safe handling.
export const GET: APIRoute = async ({ request, url }) => handle(request, url);
