// POST /api/odds/ingest: the scraper on Derek's machine pushes sportsbook odds here (2026-10-13).
//
// Auth: `Authorization: Bearer <BOVADA_INGEST_TOKEN>`. The token lives only in
// the Vercel environment and in push_config.json on the scraper machine, never
// in the repo. Fails closed: with no token configured every push is refused.
//
// Body: JSON, normally gzip-compressed (detected by its magic bytes, so it
// works whether or not anything in front of us decompressed it). Capped at
// MAX_BODY_BYTES compressed and MAX_JSON_BYTES decompressed, then validated by
// parseFeedPayload before anything is stored.
//
// Cheap per request on purpose: the live pusher calls this every ~20 seconds
// while games are on. Nothing here renders a page or rebuilds anything.

import type { APIRoute } from 'astro';
import { createHash, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseFeedPayload } from '../../../lib/odds-feed';
import { ingestFeed } from '../../../lib/odds-feed-store';
import { recordSourceSuccess } from '../../../lib/data-source-health';

export const prerender = false;

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_JSON_BYTES = 40 * 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function readEnv(name: string): string | undefined {
  const v = (import.meta as any).env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Constant-time token check (compares digests, so lengths never leak). */
function tokenMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export const POST: APIRoute = async ({ request }) => {
  const expected = readEnv('BOVADA_INGEST_TOKEN');
  if (!expected) return json({ error: 'ingest not configured' }, 503);
  const auth = request.headers.get('authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!given || !tokenMatches(given, expected)) return json({ error: 'unauthorized' }, 401);

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413);
  let buf = Buffer.from(await request.arrayBuffer());
  if (buf.length > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413);
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = gunzipSync(buf, { maxOutputLength: MAX_JSON_BYTES });
    } catch {
      return json({ error: 'could not decompress body (or it is too large)' }, 400);
    }
  }
  let raw: unknown;
  try {
    raw = JSON.parse(buf.toString('utf8'));
  } catch {
    return json({ error: 'body is not valid JSON' }, 400);
  }

  const parsed = parseFeedPayload(raw);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { payload, dropped } = parsed.value;

  try {
    const result = await ingestFeed(payload);
    void recordSourceSuccess('odds-feed');
    return json({ ok: true, stored: result.stored, moved: result.moved, rejected: [...dropped, ...result.rejected] });
  } catch (e) {
    console.error('[odds-ingest] store failed', e);
    return json({ error: 'store failed' }, 500);
  }
};
