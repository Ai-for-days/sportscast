import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type ReleaseStatus = 'planned' | 'deployed' | 'rolled_back';

export interface Release {
  id: string;
  createdAt: string;
  versionLabel: string;
  status: ReleaseStatus;
  title: string;
  summary: string;
  relatedChangeIds: string[];
  notes?: string;
  deployedBy?: string;
  rolledBackBy?: string;
}

const REL_PREFIX = 'release:';
const REL_SET = 'releases:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

async function saveRelease(r: Release): Promise<void> {
  const redis = getRedis();
  await redis.set(`${REL_PREFIX}${r.id}`, JSON.stringify(r));
  await redis.zadd(REL_SET, { score: Date.now(), member: r.id });
}

export async function getRelease(id: string): Promise<Release | null> {
  const redis = getRedis();
  const raw = await redis.get(`${REL_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as Release;
}

export async function listReleases(limit = 50): Promise<Release[]> {
  const redis = getRedis();
  const ids = await redis.zrange(REL_SET, 0, limit - 1, { rev: true }) || [];
  const results: Release[] = [];
  for (const id of ids) {
    const r = await getRelease(id);
    if (r) results.push(r);
  }
  return results;
}

export async function createRelease(input: {
  versionLabel: string;
  title: string;
  summary: string;
  relatedChangeIds?: string[];
  notes?: string;
}): Promise<Release> {
  const r: Release = {
    id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    versionLabel: input.versionLabel,
    status: 'planned',
    title: input.title,
    summary: input.summary,
    relatedChangeIds: input.relatedChangeIds || [],
    notes: input.notes,
  };
  await saveRelease(r);
  await logAuditEvent({
    actor: 'admin',
    eventType: 'release_created',
    targetType: 'release',
    targetId: r.id,
    summary: `Release ${r.versionLabel}: ${r.title}`,
  });
  return r;
}

export async function updateReleaseStatus(id: string, status: ReleaseStatus, actor: string): Promise<Release | null> {
  const r = await getRelease(id);
  if (!r) return null;
  r.status = status;
  if (status === 'deployed') r.deployedBy = actor;
  if (status === 'rolled_back') r.rolledBackBy = actor;
  await saveRelease(r);
  await logAuditEvent({
    actor,
    eventType: status === 'deployed' ? 'release_deployed' : 'release_rolled_back',
    targetType: 'release',
    targetId: r.id,
    summary: `Release ${r.versionLabel} → ${status}`,
  });
  return r;
}

export async function addChangeToRelease(releaseId: string, changeId: string): Promise<Release | null> {
  const r = await getRelease(releaseId);
  if (!r) return null;
  if (!r.relatedChangeIds.includes(changeId)) {
    r.relatedChangeIds.push(changeId);
    await saveRelease(r);
  }
  return r;
}
