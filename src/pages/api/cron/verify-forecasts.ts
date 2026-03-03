import type { APIRoute } from 'astro';
import { verifyPendingEntries } from '../../../lib/forecast-tracker-store';

export const GET: APIRoute = async ({ request }) => {
  // Verify cron secret (Vercel sends this as Authorization header)
  const authHeader = request.headers.get('authorization');
  const cronSecret = import.meta.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await verifyPendingEntries();

    return new Response(JSON.stringify({
      ok: true,
      verified: result.verified,
      skipped: result.skipped,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
