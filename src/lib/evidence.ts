import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface EvidenceRecord {
  id: string;
  createdAt: string;
  evidenceType: string;
  title: string;
  relatedIds?: string[];
  metadata?: any;
  payload: any;
  immutable: true;
}

export interface EvidenceBundle {
  id: string;
  createdAt: string;
  bundleType: string;
  targetType: string;
  targetId: string;
  records: any[];
  summary: any;
}

const EV_PREFIX = 'evidence:';
const EV_SET = 'evidence:all';
const BUNDLE_PREFIX = 'evbundle:';
const BUNDLE_SET = 'evbundles:all';

/* ------------------------------------------------------------------ */
/*  Evidence Record CRUD (append-only)                                  */
/* ------------------------------------------------------------------ */

export async function createEvidenceRecord(input: {
  evidenceType: string;
  title: string;
  relatedIds?: string[];
  metadata?: any;
  payload: any;
}): Promise<EvidenceRecord> {
  const redis = getRedis();
  const ev: EvidenceRecord = {
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    evidenceType: input.evidenceType,
    title: input.title,
    relatedIds: input.relatedIds,
    metadata: input.metadata,
    payload: input.payload,
    immutable: true,
  };
  await redis.set(`${EV_PREFIX}${ev.id}`, JSON.stringify(ev));
  await redis.zadd(EV_SET, { score: Date.now(), member: ev.id });
  await logAuditEvent({
    actor: 'system',
    eventType: 'evidence_record_created',
    targetType: 'evidence',
    targetId: ev.id,
    summary: `Evidence: ${ev.evidenceType} — ${ev.title}`,
  });
  return ev;
}

export async function getEvidenceRecord(id: string): Promise<EvidenceRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(`${EV_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as EvidenceRecord;
}

export async function listEvidenceRecords(limit = 100): Promise<EvidenceRecord[]> {
  const redis = getRedis();
  const ids = await redis.zrange(EV_SET, 0, limit - 1, { rev: true }) || [];
  const results: EvidenceRecord[] = [];
  for (const id of ids) {
    const ev = await getEvidenceRecord(id);
    if (ev) results.push(ev);
  }
  return results;
}

/* ------------------------------------------------------------------ */
/*  Evidence Bundle CRUD (append-only)                                  */
/* ------------------------------------------------------------------ */

export async function createEvidenceBundle(input: {
  bundleType: string;
  targetType: string;
  targetId: string;
  records: any[];
  summary: any;
}): Promise<EvidenceBundle> {
  const redis = getRedis();
  const bundle: EvidenceBundle = {
    id: `evb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    bundleType: input.bundleType,
    targetType: input.targetType,
    targetId: input.targetId,
    records: input.records,
    summary: input.summary,
  };
  await redis.set(`${BUNDLE_PREFIX}${bundle.id}`, JSON.stringify(bundle));
  await redis.zadd(BUNDLE_SET, { score: Date.now(), member: bundle.id });
  await logAuditEvent({
    actor: 'admin',
    eventType: 'evidence_bundle_created',
    targetType: 'evidence-bundle',
    targetId: bundle.id,
    summary: `Bundle: ${bundle.bundleType} for ${bundle.targetType}:${bundle.targetId} (${bundle.records.length} records)`,
  });
  return bundle;
}

export async function getEvidenceBundle(id: string): Promise<EvidenceBundle | null> {
  const redis = getRedis();
  const raw = await redis.get(`${BUNDLE_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as EvidenceBundle;
}

export async function listEvidenceBundles(limit = 50): Promise<EvidenceBundle[]> {
  const redis = getRedis();
  const ids = await redis.zrange(BUNDLE_SET, 0, limit - 1, { rev: true }) || [];
  const results: EvidenceBundle[] = [];
  for (const id of ids) {
    const b = await getEvidenceBundle(id);
    if (b) results.push(b);
  }
  return results;
}

/* ------------------------------------------------------------------ */
/*  Summary                                                             */
/* ------------------------------------------------------------------ */

export async function getEvidenceSummary(): Promise<{
  total: number; today: number;
  byType: Record<string, number>;
  bundles: number;
}> {
  const all = await listEvidenceRecords(500);
  const todayStr = new Date().toISOString().slice(0, 10);
  const byType: Record<string, number> = {};
  for (const ev of all) {
    byType[ev.evidenceType] = (byType[ev.evidenceType] || 0) + 1;
  }
  const bundles = await listEvidenceBundles(500);
  return {
    total: all.length,
    today: all.filter(e => e.createdAt.startsWith(todayStr)).length,
    byType,
    bundles: bundles.length,
  };
}
