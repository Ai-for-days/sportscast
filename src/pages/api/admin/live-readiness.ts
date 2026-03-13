import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import {
  runReadinessChecks,
  getLatestPreflight,
  submitPreflight,
  enableLiveMode,
  disableLiveMode,
  emergencyShutdown,
  getPreflightItems,
  LIVE_GUARDRAILS,
} from '../../../lib/live-readiness';
import { getExecutionConfig } from '../../../lib/execution-config';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const [readiness, config, preflight] = await Promise.all([
      runReadinessChecks(),
      getExecutionConfig(),
      getLatestPreflight(),
    ]);

    return new Response(JSON.stringify({
      readiness,
      config,
      preflight,
      preflightItems: getPreflightItems(),
      liveGuardrails: LIVE_GUARDRAILS,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'preflight') {
      const { confirmedItems, notes } = body;
      if (!confirmedItems || !Array.isArray(confirmedItems)) {
        return new Response(JSON.stringify({ error: 'Missing confirmedItems array' }), { status: 400 });
      }
      const result = await submitPreflight(confirmedItems, notes);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'enable-live') {
      const { confirmationPhrase } = body;
      if (!confirmationPhrase) {
        return new Response(JSON.stringify({ error: 'Missing confirmationPhrase' }), { status: 400 });
      }
      const result = await enableLiveMode(confirmationPhrase);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'disable-live') {
      const result = await disableLiveMode();
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'emergency-shutdown') {
      const { notes } = body;
      const result = await emergencyShutdown(notes);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};
