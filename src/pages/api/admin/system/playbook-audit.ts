import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { buildAudit } from '../../../../lib/playbook-audit';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const audit = await withTiming(
      'playbook-audit:build',
      'quant-review',
      () => cached('playbook-audit:v1', () => buildAudit(), 30_000),
    );
    return jsonResponse({ audit });
  } catch (err: any) {
    return jsonResponse({ error: 'playbook_audit_failed', message: err?.message ?? String(err) }, 500);
  }
};
