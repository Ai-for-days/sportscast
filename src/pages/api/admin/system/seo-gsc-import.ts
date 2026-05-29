// ── Step 177: /api/admin/system/seo-gsc-import ─────────────────────────
//
// Admin-gated POST endpoint that accepts two Search Console CSV
// exports — the Page indexing CSV and the Performance CSV — and
// returns a reconciled report. **Read-only.** Does NOT persist the
// upload. Does NOT call the Search Console API. Operators paste
// fresh CSVs every time they want a new snapshot.

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { buildGscReconciliationReport } from '../../../../lib/seo/gsc-import';
import { listShardManifest } from '../../../../lib/seo/sitemap-shards';
import { buildSeoHealthSnapshot } from '../../../../lib/seo/seo-health';

export const prerender = false;

const MAX_PAYLOAD_BYTES = 6 * 1024 * 1024; // 6 MiB safety cap

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  let body: { indexingCsv?: string; performanceCsv?: string } = {};
  try {
    const raw = await request.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return json({ ok: false, error: 'payload_too_large' }, 413);
    }
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  const indexingCsv = typeof body.indexingCsv === 'string' ? body.indexingCsv : '';
  const performanceCsv = typeof body.performanceCsv === 'string' ? body.performanceCsv : '';
  if (!indexingCsv && !performanceCsv) {
    return json({ ok: false, error: 'no_csv_provided' }, 400);
  }

  let report;
  try {
    report = buildGscReconciliationReport({ indexingCsv, performanceCsv });
  } catch (err) {
    return json({ ok: false, error: 'reconciliation_failed', detail: (err as Error)?.message?.slice(0, 240) }, 500);
  }

  // Populate per-shard "urlsInShard" counts from the live SEO health
  // snapshot so the dashboard can show "seen in GSC vs declared in
  // sitemap" deltas without doing the work twice on the client.
  try {
    const snapshot = buildSeoHealthSnapshot();
    const urlsByShard = new Map<string, number>();
    for (const s of snapshot.shards) urlsByShard.set(s.url, s.urlCount);
    report.byShard = report.byShard.map((s) => ({
      ...s,
      urlsInShard: urlsByShard.get(s.sitemapUrl) ?? 0,
    }));
  } catch {
    // Best-effort — leave urlsInShard at 0 if snapshot fails.
  }

  // Make the live shard manifest available to the panel even when the
  // CSVs are sparse and don't cover every shard.
  const manifest = listShardManifest();

  return json({ ok: true, report, shardManifest: manifest });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
