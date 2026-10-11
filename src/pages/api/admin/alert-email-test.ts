// Admin-only: send one test alert email, to confirm Resend delivery after the
// keys are set (2026-10-11). Reports which setting is missing rather than
// failing silently.

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { alertEmailConfigured, sendAlertEmail } from '../../../lib/alert-email';

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  if (!alertEmailConfigured()) {
    return json({ sent: false, reason: 'RESEND_API_KEY and ALERT_EMAIL_TO must both be set in Vercel, then redeploy' });
  }
  const sent = await sendAlertEmail(
    '[Wager on Weather] Test alert email',
    'Alert email delivery is working. Critical alerts arrive here as they happen (at most one per problem per 24 hours), plus an 8am ET digest on any day something alerted.',
  );
  return json({ sent, reason: sent ? undefined : 'Resend refused the request; see the Resend row on /admin/system/health for its error' });
};
