import type { APIRoute } from 'astro';
import { getRetentionPolicies, seedDefaultPolicies, updateRetentionPolicy } from '../../../lib/retention';
import {
  listEvidenceRecords, getEvidenceRecord, createEvidenceRecord,
  listEvidenceBundles, getEvidenceBundle, createEvidenceBundle,
  getEvidenceSummary,
} from '../../../lib/evidence';
import { logAuditEvent } from '../../../lib/audit-log';
import { cached } from '../../../lib/performance-cache';
import { withTiming } from '../../../lib/performance-metrics';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ url }) => {
  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'policies') {
      const policies = await getRetentionPolicies();
      return new Response(JSON.stringify({ policies }), { status: 200 });
    }

    if (action === 'evidence') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const { result: evidence, durationMs } = await withTiming('/api/admin/compliance?evidence', 'compliance', () => listEvidenceRecords(limit));
      return new Response(JSON.stringify({ evidence, _meta: { count: evidence.length, limit, durationMs } }), { status: 200 });
    }

    if (action === 'bundles') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const { result: bundles, durationMs } = await withTiming('/api/admin/compliance?bundles', 'compliance', () => listEvidenceBundles(limit));
      return new Response(JSON.stringify({ bundles, _meta: { count: bundles.length, limit, durationMs } }), { status: 200 });
    }

    if (action === 'export-evidence') {
      const id = url.searchParams.get('id') || '';
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
      const ev = await getEvidenceRecord(id);
      if (!ev) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      await logAuditEvent({ actor: 'admin', eventType: 'compliance_exported', targetType: 'evidence', targetId: id, summary: `Evidence exported: ${ev.evidenceType}` });
      return new Response(JSON.stringify(ev, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="evidence-${id}.json"` },
      });
    }

    if (action === 'export-bundle') {
      const id = url.searchParams.get('id') || '';
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
      const bundle = await getEvidenceBundle(id);
      if (!bundle) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      await logAuditEvent({ actor: 'admin', eventType: 'compliance_exported', targetType: 'evidence-bundle', targetId: id, summary: `Bundle exported: ${bundle.bundleType}` });
      return new Response(JSON.stringify(bundle, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="bundle-${id}.json"` },
      });
    }

    if (action === 'export-policies') {
      const policies = await getRetentionPolicies();
      await logAuditEvent({ actor: 'admin', eventType: 'compliance_exported', targetType: 'retention-policies', targetId: 'all', summary: 'Retention policies exported' });
      return new Response(JSON.stringify({ policies, exportedAt: new Date().toISOString() }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="retention-policies.json"' },
      });
    }

    // Default: overview (cached)
    const { result: overview, durationMs } = await withTiming('/api/admin/compliance?overview', 'compliance', () =>
      cached('compliance:overview', async () => {
        const [policies, summary, evidence, bundles] = await Promise.all([
          getRetentionPolicies(),
          getEvidenceSummary(),
          listEvidenceRecords(30),
          listEvidenceBundles(10),
        ]);
        return { policies, summary, evidence, bundles };
      }, 30_000)
    );

    return new Response(JSON.stringify({ ...overview, _meta: { durationMs, cached: true } }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/*  POST                                                                */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'seed-policies': {
        const count = await seedDefaultPolicies();
        return new Response(JSON.stringify({ ok: true, count, message: count > 0 ? `Seeded ${count} policies` : 'Policies already exist' }), { status: 200 });
      }

      case 'update-policy': {
        const policy = await updateRetentionPolicy(body.family, {
          retentionDays: body.retentionDays,
          immutable: body.immutable,
          exportable: body.exportable,
          notes: body.notes,
        });
        if (!policy) return new Response(JSON.stringify({ error: 'Policy not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, policy }), { status: 200 });
      }

      case 'create-evidence': {
        const ev = await createEvidenceRecord({
          evidenceType: body.evidenceType,
          title: body.title,
          relatedIds: body.relatedIds,
          metadata: body.metadata,
          payload: body.payload,
        });
        return new Response(JSON.stringify({ ok: true, evidence: ev }), { status: 200 });
      }

      case 'create-bundle': {
        const bundle = await createEvidenceBundle({
          bundleType: body.bundleType,
          targetType: body.targetType,
          targetId: body.targetId,
          records: body.records || [],
          summary: body.summary || {},
        });
        return new Response(JSON.stringify({ ok: true, bundle }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
