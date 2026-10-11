// Admin Alert Log API (2026-10-11, per Derek: "put something in the admin that
// logs everything and I can check it"). Backs /admin/system/alert-log and the
// unread badge on the admin quick-links bar.
//
//   GET  ?count=1  -> { unread }               (cheap; every admin page asks)
//   GET            -> notices, summaries, sources, full alert history
//   POST {action:'mark-read'} -> clears the unread count

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { listAlertsSince } from '../../../lib/alerts';
import {
  alertEmailConfigured, groupAlertsForDigest, listAlertNotices, markNoticesRead, unreadNoticeCount,
} from '../../../lib/alert-email';
import { getDataSourceHealth } from '../../../lib/data-source-health';
import { getOpenMeteoUsage } from '../../../lib/open-meteo-usage';

export const prerender = false;

const DAY_MS = 24 * 3600 * 1000;
const HISTORY_DAYS = 7;
const HISTORY_MAX = 2000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  if (url.searchParams.get('count') === '1') return json({ unread: await unreadNoticeCount() });

  const now = Date.now();
  const [notices, unread, sources, week, openMeteoUsage] = await Promise.all([
    listAlertNotices(200),
    unreadNoticeCount(),
    getDataSourceHealth(),
    listAlertsSince(now - HISTORY_DAYS * DAY_MS),
    getOpenMeteoUsage(24),
  ]);
  const day = week.filter((a) => Date.parse(a.createdAt) >= now - DAY_MS);
  const history = [...week].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({
    emailConfigured: alertEmailConfigured(),
    unread,
    sources,
    notices,
    last24h: { total: day.length, groups: groupAlertsForDigest(day) },
    last7d: { total: week.length, groups: groupAlertsForDigest(week) },
    openMeteoUsage,
    history: history.slice(0, HISTORY_MAX),
    historyTruncated: history.length > HISTORY_MAX,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  if (body?.action !== 'mark-read') return json({ error: 'Unknown action' }, 400);
  await markNoticesRead();
  return json({ ok: true });
};
