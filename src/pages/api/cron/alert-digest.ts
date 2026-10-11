// Daily alert digest email, 12:00 UTC = 8am ET (2026-10-11, per Derek).
//
// Sends only when something alerted in the last 24 hours; a quiet day sends
// nothing. See src/lib/alert-email.ts for why delivery exists at all and why
// it is deliberately this quiet.

import type { APIRoute } from 'astro';
import { listAlertsSince } from '../../../lib/alerts';
import { buildDigest, deliverNotice, alertEmailConfigured } from '../../../lib/alert-email';
import { getDataSourceHealth } from '../../../lib/data-source-health';

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request }) => {
  // Same cron-secret check as the other cron routes.
  const cronSecret = import.meta.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const alerts = await listAlertsSince(Date.now() - 24 * 3600 * 1000);
  const digest = buildDigest(alerts, await getDataSourceHealth());
  if (!digest) return json({ logged: false, reason: 'no alerts in the last 24 hours', alerts: 0 });

  // Always logged to /admin/system/alert-log; also emailed once Resend is set up.
  const emailed = await deliverNotice('digest', digest.subject, digest.text);
  return json({ logged: true, emailed, emailConfigured: alertEmailConfigured(), alerts: alerts.length });
};
