import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  buildCertSummary, listCertifications, getCert,
  getOperatorReadiness, generateReadiness,
  certifyOperator, revokeCertification, expireCertification, addNote,
  CertError,
} from '../../../../lib/operator-certification';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'summary';

    if (action === 'summary') {
      const data = await withTiming(
        'operator-certification:summary',
        'quant-review',
        () => cached('operator-certification:summary', () => buildCertSummary(), 30_000),
      );
      return jsonResponse(data);
    }

    if (action === 'list-operators') {
      const data = await buildCertSummary();
      return jsonResponse({ operators: data.operators, summary: data.summary });
    }

    if (action === 'get-readiness') {
      const operatorId = url.searchParams.get('operatorId');
      if (!operatorId) return jsonResponse({ error: 'operatorId required' }, 400);
      const r = await getOperatorReadiness(operatorId);
      return jsonResponse({ readiness: r });
    }

    if (action === 'list-certifications') {
      const certs = await listCertifications(500);
      return jsonResponse({ certifications: certs });
    }

    if (action === 'get-certification') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const c = await getCert(id);
      if (!c) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ certification: c });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'operator_certification_failed', message: err?.message ?? String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const sessionCookie = await requireAdmin(request);
  if (!sessionCookie) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const action = body.action as string | undefined;
  if (!action) return jsonResponse({ error: 'Missing action' }, 400);

  try {
    const actor = await getOperatorId(sessionCookie ?? '');

    if (action === 'generate-readiness') {
      if (!body.operatorId) return jsonResponse({ error: 'operatorId required' }, 400);
      const r = await generateReadiness(body.operatorId, actor);
      return jsonResponse({ readiness: r });
    }

    if (action === 'certify-operator') {
      const c = await certifyOperator({
        operatorId: body.operatorId,
        certifiedBy: actor,
        validityDays: body.validityDays,
        note: body.note,
      });
      return jsonResponse({ certification: c });
    }

    if (action === 'revoke-certification') {
      if (!body.certId) return jsonResponse({ error: 'certId required' }, 400);
      const c = await revokeCertification(body.certId, actor, body.reason);
      return jsonResponse({ certification: c });
    }

    if (action === 'expire-certification') {
      if (!body.certId) return jsonResponse({ error: 'certId required' }, 400);
      const c = await expireCertification(body.certId, actor);
      return jsonResponse({ certification: c });
    }

    if (action === 'add-note') {
      if (!body.certId || !body.note) return jsonResponse({ error: 'certId and note required' }, 400);
      const c = await addNote(body.certId, body.note, actor);
      return jsonResponse({ certification: c });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof CertError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'operator_certification_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
