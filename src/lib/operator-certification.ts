// ── Step 93: Operator certification + readiness tracking ────────────────────
//
// Reads Step 92 training sessions and reports per-operator readiness, plus a
// manual certification ledger. Certification is advisory and operator-driven:
// nothing here grants RBAC roles, enables live execution, submits orders,
// creates execution candidates, or auto-promotes anything. RBAC and live-
// execution gating remain authoritative wherever they're enforced.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import {
  listSessions, type TrainingSession, type ScenarioType,
} from './operator-training';

// ── Types ───────────────────────────────────────────────────────────────────

export type CertStatus =
  | 'not_started'
  | 'in_training'
  | 'certification_ready'
  | 'certified'
  | 'expired'
  | 'revoked';

export type ReadinessVerdict =
  | 'not_ready'
  | 'needs_practice'
  | 'certification_ready'
  | 'certified'
  | 'expired';

export interface CertificationRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  operatorId: string;
  status: CertStatus;
  certifiedAt?: string;
  expiresAt?: string;
  certifiedBy?: string;
  revokedAt?: string;
  revokedBy?: string;
  expiredAt?: string;
  reason?: string;
  /** Frozen readiness metrics at the moment of certification (or revoke). */
  metricsSnapshot: Record<string, any>;
  notes: string[];
}

export interface ScenarioCoverage {
  scenarioType: ScenarioType;
  completedCount: number;
  bestScore: number | null;
  passed: boolean; // bestScore != null && bestScore >= MIN_PASSING_SCORE
}

export interface OperatorReadiness {
  operatorId: string;
  /** Number of completed training sessions. */
  completedSessions: number;
  averageScore: number | null;
  /** Per scenario_type best score + coverage flag. */
  scenarioCoverage: ScenarioCoverage[];
  /** Number of REQUIRED_TYPES with completedCount > 0. */
  coverageCount: number;
  /** True iff every covered type's bestScore >= MIN_PASSING_SCORE. */
  allCoveredPass: boolean;
  /** Last completedAt (ISO) across all completed sessions. */
  lastCompletedAt: string | null;
  /** Days since lastCompletedAt (or null if none). */
  daysSinceLast: number | null;
  /** Active certification (status === 'certified' AND not effectively expired). */
  activeCertification: CertificationRecord | null;
  /** Effective verdict considering both training metrics and active cert. */
  verdict: ReadinessVerdict;
  /** Human-readable reasons that drove the verdict. */
  reasons: string[];
  /** Score trend (chronological series of completed scores). */
  scoreTrend: { completedAt: string; score: number; scenarioType: ScenarioType }[];
}

export interface CertSummary {
  totalOperators: number;
  byVerdict: Record<ReadinessVerdict, number>;
  byCertStatus: Record<CertStatus, number>;
  expiringSoonCount: number;       // certified + expires within 30d
  averageScoreAcrossAll: number | null;
}

export class CertError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Constants ───────────────────────────────────────────────────────────────

export const REQUIRED_TYPES: ScenarioType[] = [
  'signal_review', 'risk_review', 'pilot_review', 'execution_playbook', 'incident_response',
];

const MIN_COMPLETED_SESSIONS = 5;
const MIN_AVG_SCORE = 80;
const MIN_PASSING_SCORE = 70;
const RECENCY_DAYS = 30;
const DEFAULT_VALIDITY_DAYS = 90;
const EXPIRING_SOON_DAYS = 30;

const CERT_PREFIX = 'cert:';
const CERTS_SET = 'certs:all';
const ACTIVE_PREFIX = 'cert:active:';
const MAX_CERTS = 1000;

// ── ID helpers ──────────────────────────────────────────────────────────────

function newCertId(): string {
  return `cert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function daysBetween(a: number, b: number): number {
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function isCertEffectivelyExpired(c: CertificationRecord, now = Date.now()): boolean {
  if (!c.expiresAt) return false;
  const exp = new Date(c.expiresAt).getTime();
  return Number.isFinite(exp) && exp < now;
}

// ── Persistence ─────────────────────────────────────────────────────────────

export async function saveCert(c: CertificationRecord): Promise<void> {
  const redis = getRedis();
  await redis.set(`${CERT_PREFIX}${c.id}`, JSON.stringify(c));
}

export async function getCert(id: string): Promise<CertificationRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(`${CERT_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as CertificationRecord);
}

export async function listCertifications(limit = 500): Promise<CertificationRecord[]> {
  const redis = getRedis();
  const total = await redis.zcard(CERTS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(CERTS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: CertificationRecord[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${CERT_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

async function getActiveCertId(operatorId: string): Promise<string | null> {
  const redis = getRedis();
  const raw = await redis.get(`${ACTIVE_PREFIX}${operatorId}`);
  if (!raw) return null;
  const id = typeof raw === 'string' ? raw : (raw as any);
  return id || null;
}

async function setActiveCertId(operatorId: string, id: string): Promise<void> {
  const redis = getRedis();
  await redis.set(`${ACTIVE_PREFIX}${operatorId}`, id);
}

async function clearActiveCertId(operatorId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`${ACTIVE_PREFIX}${operatorId}`);
}

async function getActiveCertForOperator(operatorId: string): Promise<CertificationRecord | null> {
  const id = await getActiveCertId(operatorId);
  if (!id) return null;
  const cert = await getCert(id);
  if (!cert) return null;
  if (cert.status !== 'certified') return null;
  return cert;
}

// ── Readiness computation ───────────────────────────────────────────────────

function computeOperatorReadinessFromSessions(operatorId: string, sessions: TrainingSession[], activeCert: CertificationRecord | null, now = Date.now()): OperatorReadiness {
  const completed = sessions.filter(s => s.status === 'completed' && !!s.score);

  // Score trend
  const scoreTrend = completed
    .filter(s => !!s.completedAt)
    .map(s => ({ completedAt: s.completedAt!, score: s.score!.score, scenarioType: s.scenarioType }))
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  // Average score (across completed)
  const averageScore = completed.length === 0
    ? null
    : Math.round(completed.reduce((sum, s) => sum + s.score!.score, 0) / completed.length);

  // Scenario coverage
  const scenarioCoverage: ScenarioCoverage[] = REQUIRED_TYPES.map(t => {
    const matching = completed.filter(s => s.scenarioType === t);
    const bestScore = matching.length === 0 ? null : Math.max(...matching.map(s => s.score!.score));
    return {
      scenarioType: t,
      completedCount: matching.length,
      bestScore,
      passed: bestScore != null && bestScore >= MIN_PASSING_SCORE,
    };
  });
  const coverageCount = scenarioCoverage.filter(c => c.completedCount > 0).length;
  const allCoveredPass = scenarioCoverage.filter(c => c.completedCount > 0).every(c => c.passed);

  // Recency
  const lastCompletedAt = completed.length === 0 ? null : completed.reduce((acc, s) => {
    const t = s.completedAt ?? s.updatedAt;
    return t > acc ? t : acc;
  }, '');
  const daysSinceLast = lastCompletedAt ? daysBetween(new Date(lastCompletedAt).getTime(), now) : null;

  // Verdict
  const reasons: string[] = [];
  let verdict: ReadinessVerdict;

  // Apply effective expiry / revoke check on active cert
  let effectiveActive: CertificationRecord | null = activeCert;
  if (effectiveActive && (effectiveActive.status !== 'certified' || isCertEffectivelyExpired(effectiveActive, now))) {
    effectiveActive = null;
  }

  if (effectiveActive) {
    verdict = 'certified';
    reasons.push(`Certified by ${effectiveActive.certifiedBy ?? 'unknown'} on ${effectiveActive.certifiedAt?.slice(0, 10) ?? '?'}`);
    if (effectiveActive.expiresAt) reasons.push(`Expires ${effectiveActive.expiresAt.slice(0, 10)}`);
  } else if (activeCert && (activeCert.status !== 'certified' || isCertEffectivelyExpired(activeCert, now))) {
    verdict = 'expired';
    if (activeCert.status === 'revoked') reasons.push(`Last certification revoked${activeCert.reason ? ` — ${activeCert.reason}` : ''}`);
    else reasons.push(`Certification expired${activeCert.expiresAt ? ` on ${activeCert.expiresAt.slice(0, 10)}` : ''}`);
  } else {
    // No active certification — compute from training metrics
    const meets: string[] = [];
    const fails: string[] = [];

    if (completed.length >= MIN_COMPLETED_SESSIONS) meets.push(`${completed.length} completed sessions (min ${MIN_COMPLETED_SESSIONS})`);
    else fails.push(`only ${completed.length}/${MIN_COMPLETED_SESSIONS} completed sessions`);

    if (averageScore != null && averageScore >= MIN_AVG_SCORE) meets.push(`average score ${averageScore} ≥ ${MIN_AVG_SCORE}`);
    else if (averageScore != null) fails.push(`average score ${averageScore} < ${MIN_AVG_SCORE}`);
    else fails.push('no completed sessions yet');

    if (coverageCount === REQUIRED_TYPES.length) meets.push(`covered all ${REQUIRED_TYPES.length} required scenario types`);
    else fails.push(`covered ${coverageCount}/${REQUIRED_TYPES.length} required scenario types`);

    if (allCoveredPass) meets.push(`all covered types pass (best ≥ ${MIN_PASSING_SCORE})`);
    else fails.push(`a covered type has best score below ${MIN_PASSING_SCORE}`);

    if (daysSinceLast != null && daysSinceLast <= RECENCY_DAYS) meets.push(`last training ${daysSinceLast}d ago (within ${RECENCY_DAYS}d)`);
    else if (daysSinceLast != null) fails.push(`last training ${daysSinceLast}d ago — exceeds ${RECENCY_DAYS}d`);
    else fails.push('no completed sessions yet');

    reasons.push(...meets.map(s => `✓ ${s}`));
    reasons.push(...fails.map(s => `✗ ${s}`));

    if (fails.length === 0) verdict = 'certification_ready';
    else if (completed.length === 0) verdict = 'not_ready';
    else if (completed.length >= MIN_COMPLETED_SESSIONS && coverageCount >= 3) verdict = 'needs_practice';
    else verdict = 'not_ready';
  }

  return {
    operatorId,
    completedSessions: completed.length,
    averageScore,
    scenarioCoverage,
    coverageCount,
    allCoveredPass,
    lastCompletedAt: lastCompletedAt || null,
    daysSinceLast,
    activeCertification: effectiveActive,
    verdict,
    reasons,
    scoreTrend,
  };
}

// ── Public readiness API ────────────────────────────────────────────────────

export async function getOperatorReadiness(operatorId: string): Promise<OperatorReadiness> {
  if (!operatorId) throw new CertError('operatorId is required', 'operator_required');
  const [allSessions, activeCert] = await Promise.all([
    listSessions(500),
    getActiveCertForOperator(operatorId),
  ]);
  const operatorSessions = allSessions.filter(s => s.operatorId === operatorId);
  return computeOperatorReadinessFromSessions(operatorId, operatorSessions, activeCert);
}

export async function listOperatorReadiness(): Promise<OperatorReadiness[]> {
  const [allSessions, allCerts] = await Promise.all([
    listSessions(500),
    listCertifications(500),
  ]);

  // Collect operator IDs from sessions and certs
  const operatorIds = new Set<string>();
  for (const s of allSessions) if (s.operatorId) operatorIds.add(s.operatorId);
  for (const c of allCerts) if (c.operatorId) operatorIds.add(c.operatorId);

  // Build active cert lookup: most recent 'certified' cert per operator that is not effectively expired
  const now = Date.now();
  const activeByOp = new Map<string, CertificationRecord>();
  for (const c of allCerts) {
    if (c.status !== 'certified') continue;
    if (isCertEffectivelyExpired(c, now)) continue;
    const existing = activeByOp.get(c.operatorId);
    if (!existing || (c.certifiedAt ?? c.createdAt) > (existing.certifiedAt ?? existing.createdAt)) {
      activeByOp.set(c.operatorId, c);
    }
  }
  // Latest cert (any status) for verdict-fallback to expired/revoked
  const latestByOp = new Map<string, CertificationRecord>();
  for (const c of allCerts) {
    const existing = latestByOp.get(c.operatorId);
    if (!existing || c.createdAt > existing.createdAt) latestByOp.set(c.operatorId, c);
  }

  const out: OperatorReadiness[] = [];
  for (const opId of operatorIds) {
    const ops = allSessions.filter(s => s.operatorId === opId);
    const active = activeByOp.get(opId) ?? null;
    const fallback = active ?? latestByOp.get(opId) ?? null;
    out.push(computeOperatorReadinessFromSessions(opId, ops, fallback, now));
  }

  // Sort by verdict severity (certification_ready first, then needs_practice, etc.)
  const verdictRank: Record<ReadinessVerdict, number> = {
    certification_ready: 5, certified: 4, needs_practice: 3, expired: 2, not_ready: 1,
  };
  out.sort((a, b) => verdictRank[b.verdict] - verdictRank[a.verdict]);
  return out;
}

// ── Mutations (manual; never auto) ──────────────────────────────────────────

export async function generateReadiness(operatorId: string, actor: string): Promise<OperatorReadiness> {
  // Pure read; we still audit-log because operators may want to record they
  // looked, especially before certifying someone.
  const r = await getOperatorReadiness(operatorId);
  await logAuditEvent({
    actor,
    eventType: 'operator_readiness_generated',
    targetType: 'operator',
    targetId: operatorId,
    summary: `Readiness generated for ${operatorId}: verdict=${r.verdict}`,
    details: { operatorId, verdict: r.verdict, completedSessions: r.completedSessions, averageScore: r.averageScore, coverageCount: r.coverageCount },
  });
  return r;
}

export async function certifyOperator(input: { operatorId: string; certifiedBy: string; validityDays?: number; note?: string }): Promise<CertificationRecord> {
  if (!input.operatorId) throw new CertError('operatorId is required', 'operator_required');
  if (!input.certifiedBy) throw new CertError('certifiedBy is required', 'certifier_required');
  if (input.certifiedBy === input.operatorId) {
    throw new CertError('Operators cannot certify themselves', 'self_certification_forbidden');
  }

  const validityDays = input.validityDays ?? DEFAULT_VALIDITY_DAYS;
  if (!Number.isFinite(validityDays) || validityDays <= 0) {
    throw new CertError('validityDays must be a positive number', 'invalid_validity');
  }

  // Snapshot current readiness (informational only — we DO NOT block certification on metrics).
  const readiness = await getOperatorReadiness(input.operatorId);

  // Revoke any existing active certification for this operator to keep one-active-at-a-time
  const existingId = await getActiveCertId(input.operatorId);
  if (existingId) {
    const existing = await getCert(existingId);
    if (existing && existing.status === 'certified') {
      const now = new Date().toISOString();
      const superseded: CertificationRecord = {
        ...existing,
        status: 'revoked',
        revokedAt: now,
        revokedBy: input.certifiedBy,
        reason: 'superseded by new certification',
        updatedAt: now,
      };
      await saveCert(superseded);
    }
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString();
  const id = newCertId();
  const record: CertificationRecord = {
    id,
    createdAt: now,
    updatedAt: now,
    operatorId: input.operatorId,
    status: 'certified',
    certifiedAt: now,
    expiresAt,
    certifiedBy: input.certifiedBy,
    metricsSnapshot: {
      completedSessions: readiness.completedSessions,
      averageScore: readiness.averageScore,
      coverageCount: readiness.coverageCount,
      allCoveredPass: readiness.allCoveredPass,
      verdictAtCertification: readiness.verdict,
      lastCompletedAt: readiness.lastCompletedAt,
      validityDays,
    },
    notes: input.note?.trim() ? [`[${now}] ${input.certifiedBy}: ${input.note.trim()}`] : [],
  };

  await saveCert(record);
  const redis = getRedis();
  await redis.zadd(CERTS_SET, { score: Date.now(), member: id });
  await trimToCap(redis, CERTS_SET, CERT_PREFIX, MAX_CERTS);
  await setActiveCertId(input.operatorId, id);

  await logAuditEvent({
    actor: input.certifiedBy,
    eventType: 'operator_certified',
    targetType: 'operator',
    targetId: input.operatorId,
    summary: `Operator ${input.operatorId} certified by ${input.certifiedBy} (valid ${validityDays}d)`,
    details: { certId: id, operatorId: input.operatorId, certifiedBy: input.certifiedBy, validityDays, expiresAt, snapshot: record.metricsSnapshot },
  });

  return record;
}

export async function revokeCertification(certId: string, actor: string, reason: string): Promise<CertificationRecord> {
  if (!reason?.trim()) throw new CertError('reason is required', 'reason_required');
  const cert = await getCert(certId);
  if (!cert) throw new CertError('Certification not found', 'cert_not_found');
  if (cert.status === 'revoked') throw new CertError('Certification already revoked', 'already_revoked');

  const now = new Date().toISOString();
  const updated: CertificationRecord = {
    ...cert,
    status: 'revoked',
    revokedAt: now,
    revokedBy: actor,
    reason: reason.trim(),
    updatedAt: now,
    notes: [...(cert.notes ?? []), `[${now}] ${actor}: revoked — ${reason.trim()}`],
  };
  await saveCert(updated);

  // Clear active pointer if it pointed at this cert
  const activeId = await getActiveCertId(cert.operatorId);
  if (activeId === certId) await clearActiveCertId(cert.operatorId);

  await logAuditEvent({
    actor,
    eventType: 'operator_certification_revoked',
    targetType: 'operator',
    targetId: cert.operatorId,
    summary: `Certification ${certId} revoked: ${reason.trim()}`,
    details: { certId, operatorId: cert.operatorId, reason: reason.trim() },
  });

  return updated;
}

export async function expireCertification(certId: string, actor: string): Promise<CertificationRecord> {
  const cert = await getCert(certId);
  if (!cert) throw new CertError('Certification not found', 'cert_not_found');
  if (cert.status !== 'certified') throw new CertError(`Cannot expire a ${cert.status} certification`, 'illegal_transition');

  const now = new Date().toISOString();
  const updated: CertificationRecord = {
    ...cert,
    status: 'expired',
    expiredAt: now,
    updatedAt: now,
    notes: [...(cert.notes ?? []), `[${now}] ${actor}: marked expired`],
  };
  await saveCert(updated);

  const activeId = await getActiveCertId(cert.operatorId);
  if (activeId === certId) await clearActiveCertId(cert.operatorId);

  await logAuditEvent({
    actor,
    eventType: 'operator_certification_expired',
    targetType: 'operator',
    targetId: cert.operatorId,
    summary: `Certification ${certId} marked expired`,
    details: { certId, operatorId: cert.operatorId },
  });

  return updated;
}

export async function addNote(certId: string, note: string, actor: string): Promise<CertificationRecord> {
  if (!note?.trim()) throw new CertError('note is required', 'note_required');
  const cert = await getCert(certId);
  if (!cert) throw new CertError('Certification not found', 'cert_not_found');
  const stamped = `[${new Date().toISOString()}] ${actor}: ${note.trim()}`;
  const updated: CertificationRecord = {
    ...cert,
    notes: [...(cert.notes ?? []), stamped].slice(-200),
    updatedAt: new Date().toISOString(),
  };
  await saveCert(updated);
  return updated;
}

// ── Summary ─────────────────────────────────────────────────────────────────

export async function buildCertSummary(): Promise<{
  summary: CertSummary;
  operators: OperatorReadiness[];
  certifications: CertificationRecord[];
}> {
  const [operators, certifications] = await Promise.all([
    listOperatorReadiness(),
    listCertifications(500),
  ]);

  const byVerdict: Record<ReadinessVerdict, number> = {
    not_ready: 0, needs_practice: 0, certification_ready: 0, certified: 0, expired: 0,
  };
  let scoreSum = 0;
  let scoreCount = 0;
  for (const r of operators) {
    byVerdict[r.verdict]++;
    if (r.averageScore != null) { scoreSum += r.averageScore; scoreCount++; }
  }

  const byCertStatus: Record<CertStatus, number> = {
    not_started: 0, in_training: 0, certification_ready: 0, certified: 0, expired: 0, revoked: 0,
  };
  for (const c of certifications) byCertStatus[c.status] = (byCertStatus[c.status] ?? 0) + 1;

  // Expiring soon: certified + expiresAt within 30d
  const now = Date.now();
  const expiringSoon = certifications.filter(c => {
    if (c.status !== 'certified' || !c.expiresAt) return false;
    const exp = new Date(c.expiresAt).getTime();
    return Number.isFinite(exp) && exp - now > 0 && exp - now <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;
  });

  return {
    summary: {
      totalOperators: operators.length,
      byVerdict,
      byCertStatus,
      expiringSoonCount: expiringSoon.length,
      averageScoreAcrossAll: scoreCount === 0 ? null : Math.round(scoreSum / scoreCount),
    },
    operators,
    certifications,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function trimToCap(redis: any, setKey: string, keyPrefix: string, cap: number) {
  const total = await redis.zcard(setKey);
  if (total <= cap) return;
  const overflow = total - cap;
  const oldest = await redis.zrange(setKey, 0, overflow - 1);
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(setKey, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${keyPrefix}${oldId}`);
  }
}
