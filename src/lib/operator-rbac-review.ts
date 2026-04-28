// ── Step 94: Manual certification ↔ RBAC review linkage ─────────────────────
//
// Read-only / advisory governance bridge between Step 93 operator
// certification and the existing RBAC store. Generates review records that
// tell a human reviewer to look at an operator's access vs their cert
// status. NEVER grants, revokes, or modifies RBAC. NEVER enables trading,
// creates execution candidates, changes live/demo execution, or changes
// risk settings. The only Redis writes are to rbac-review:* and the audit
// log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import {
  listOperatorReadiness,
  getOperatorReadiness,
  type OperatorReadiness,
  type CertificationRecord,
} from './operator-certification';
import { listUserRoles, getUserRole, type UserRole } from './security-store';
import { getRolePermissions, type Role, type Permission } from './rbac';

// ── Types ───────────────────────────────────────────────────────────────────

export type RbacRecommendation =
  | 'no_action'
  | 'review_recommended'
  | 'access_review_due'
  | 'certification_missing'
  | 'certification_expired'
  | 'certification_revoked'
  | 'excessive_access_warning';

export type RbacSeverity = 'info' | 'warning' | 'critical';

export interface RbacAccessSummary {
  accessDataAvailable: boolean;
  roles: string[];
  permissions: string[];
  elevatedAccess: boolean;
  /** Where the access summary came from: "security-store" | "unavailable" */
  source: string;
}

export interface OperatorRbacReview {
  id: string;
  operatorId: string;
  generatedAt: string;
  generatedBy: string;
  certificationStatus: string;
  certificationExpiresAt?: string | null;
  activeCertificationId?: string | null;
  currentAccessSummary: RbacAccessSummary;
  recommendation: RbacRecommendation;
  severity: RbacSeverity;
  reasons: string[];
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  notes: string[];
}

export interface RbacReviewSummary {
  totalReviews: number;
  byRecommendation: Record<RbacRecommendation, number>;
  bySeverity: Record<RbacSeverity, number>;
  acknowledged: number;
  unacknowledged: number;
  accessDataUnavailable: number;
  /** Latest review per operator. */
  perOperator: { operatorId: string; review: OperatorRbacReview }[];
}

export class RbacReviewError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ─────────────────────────────────────────────────────

const REVIEW_PREFIX = 'rbac-review:';
const REVIEWS_SET = 'rbac-reviews:all';
const LATEST_BY_OPERATOR_PREFIX = 'rbac-review:operator:';
const MAX_REVIEWS = 1000;
const EXPIRING_SOON_DAYS = 30;

// ── Definition of "elevated access" ─────────────────────────────────────────

/**
 * Permissions whose presence signals elevated access for review purposes.
 * (Read-only; we only inspect, never grant/revoke.)
 */
const ELEVATED_PERMISSIONS = new Set<Permission>([
  'submit_live_orders',
  'enable_live_mode',
  'manage_users_and_roles',
  'approve_requests',
  'cancel_live_orders',
  'toggle_kill_switch',
  'manage_settlement',
]);

/** Roles that are elevated regardless of individual permission set. */
const ELEVATED_ROLES = new Set<Role>(['admin', 'super_admin']);

/**
 * Permission count threshold above which we consider access "unusually broad"
 * relative to the base trading roles. Tuned against rbac.ts ROLE_PERMISSIONS.
 */
const BROAD_PERMISSION_COUNT = 16;

// ── ID helpers ──────────────────────────────────────────────────────────────

function newReviewId(): string {
  return `rbacrev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isCertEffectivelyExpired(c: CertificationRecord, now = Date.now()): boolean {
  if (!c.expiresAt) return false;
  const exp = new Date(c.expiresAt).getTime();
  return Number.isFinite(exp) && exp < now;
}

function isExpiringSoon(c: CertificationRecord, now = Date.now()): boolean {
  if (!c.expiresAt) return false;
  const exp = new Date(c.expiresAt).getTime();
  if (!Number.isFinite(exp)) return false;
  const ms = exp - now;
  return ms > 0 && ms <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;
}

// ── Access summary (read-only) ──────────────────────────────────────────────

async function buildAccessSummary(operatorId: string): Promise<RbacAccessSummary> {
  // Try the security-store. If it throws or returns null, fall back to
  // "unavailable" — never assume permissions we can't verify.
  let userRole: UserRole | null = null;
  try {
    userRole = await getUserRole(operatorId);
  } catch {
    return {
      accessDataAvailable: false,
      roles: [],
      permissions: [],
      elevatedAccess: false,
      source: 'unavailable',
    };
  }

  if (!userRole) {
    return {
      accessDataAvailable: false,
      roles: [],
      permissions: [],
      elevatedAccess: false,
      source: 'unavailable',
    };
  }

  const roles = [userRole.role];
  const permissions = getRolePermissions(userRole.role) as string[];
  const elevated =
    ELEVATED_ROLES.has(userRole.role) ||
    permissions.some(p => ELEVATED_PERMISSIONS.has(p as Permission));

  return {
    accessDataAvailable: true,
    roles,
    permissions,
    elevatedAccess: elevated,
    source: 'security-store',
  };
}

// ── Rule engine ─────────────────────────────────────────────────────────────

interface RuleInput {
  operatorId: string;
  readiness: OperatorReadiness;
  access: RbacAccessSummary;
  latestCert: CertificationRecord | null;
}

interface RuleOutput {
  recommendation: RbacRecommendation;
  severity: RbacSeverity;
  reasons: string[];
}

function evaluateRules(input: RuleInput): RuleOutput {
  const { readiness, access, latestCert } = input;
  const reasons: string[] = [];
  const now = Date.now();

  // 1. Revoked certification → critical
  if (latestCert?.status === 'revoked') {
    reasons.push(`Last certification (${latestCert.id}) is revoked${latestCert.reason ? ` — ${latestCert.reason}` : ''}.`);
    if (access.accessDataAvailable && access.elevatedAccess) {
      reasons.push('Operator currently holds elevated access — manual RBAC review strongly recommended.');
    }
    return { recommendation: 'certification_revoked', severity: 'critical', reasons };
  }

  // 2. Expired certification (effective)
  const certExpired = latestCert && (latestCert.status === 'expired' || (latestCert.status === 'certified' && isCertEffectivelyExpired(latestCert, now)));
  if (certExpired && latestCert) {
    reasons.push(`Last certification expired${latestCert.expiresAt ? ` on ${latestCert.expiresAt.slice(0, 10)}` : ''}.`);
    if (access.accessDataAvailable && access.elevatedAccess) {
      reasons.push('Operator currently holds elevated access — schedule re-certification or scope-reduction review.');
    }
    return { recommendation: 'certification_expired', severity: 'warning', reasons };
  }

  // 3. No active cert + elevated access
  if (!readiness.activeCertification && access.accessDataAvailable && access.elevatedAccess) {
    reasons.push('Operator has no active certification but holds elevated access permissions.');
    reasons.push(`Roles: ${access.roles.join(', ') || '(none)'}; permissions: ${access.permissions.length}.`);
    return { recommendation: 'certification_missing', severity: 'warning', reasons };
  }

  // 4. Access data unavailable
  if (!access.accessDataAvailable) {
    reasons.push('No RBAC record found for this operator (security-store returned null).');
    reasons.push('Verify the operator id, or assign a role through the Security page if appropriate.');
    return { recommendation: 'review_recommended', severity: 'warning', reasons };
  }

  // 5. Active cert expiring within 30 days + elevated access
  if (readiness.activeCertification && isExpiringSoon(readiness.activeCertification, now) && access.elevatedAccess) {
    reasons.push(`Active certification ${readiness.activeCertification.id} expires ${readiness.activeCertification.expiresAt?.slice(0, 10)} (within ${EXPIRING_SOON_DAYS} days).`);
    reasons.push('Schedule a re-certification review before expiry to avoid lapsed elevated access.');
    return { recommendation: 'access_review_due', severity: 'warning', reasons };
  }

  // 6. Certified + unusually broad/elevated access (super_admin or very wide perm set)
  if (readiness.activeCertification) {
    const isSuperAdmin = access.roles.includes('super_admin');
    const isBroad = access.permissions.length >= BROAD_PERMISSION_COUNT;
    if (isSuperAdmin || isBroad) {
      reasons.push(`Operator is certified but holds unusually broad access${isSuperAdmin ? ' (super_admin)' : ` (${access.permissions.length} permissions)`}.`);
      reasons.push('Review whether the role is still appropriate or should be scoped down.');
      return { recommendation: 'excessive_access_warning', severity: 'warning', reasons };
    }
    reasons.push(`Active certification ${readiness.activeCertification.id} (expires ${readiness.activeCertification.expiresAt?.slice(0, 10) ?? '—'}).`);
    reasons.push(`Role: ${access.roles.join(', ')}; permissions: ${access.permissions.length}; access classified as ${access.elevatedAccess ? 'elevated' : 'normal'}.`);
    return { recommendation: 'no_action', severity: 'info', reasons };
  }

  // 7. No active cert + non-elevated access — info, no immediate action.
  reasons.push('No active certification; current access is not classified as elevated.');
  reasons.push(`Role: ${access.roles.join(', ') || '(none)'}; permissions: ${access.permissions.length}.`);
  return { recommendation: 'no_action', severity: 'info', reasons };
}

// ── Persistence (rbac-review:* only) ────────────────────────────────────────

async function saveReview(review: OperatorRbacReview): Promise<void> {
  const redis = getRedis();
  await redis.set(`${REVIEW_PREFIX}${review.id}`, JSON.stringify(review));
}

export async function getOperatorRbacReview(reviewId: string): Promise<OperatorRbacReview | null> {
  const redis = getRedis();
  const raw = await redis.get(`${REVIEW_PREFIX}${reviewId}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as OperatorRbacReview);
}

export async function listOperatorRbacReviews(limit = 500): Promise<OperatorRbacReview[]> {
  const redis = getRedis();
  const total = await redis.zcard(REVIEWS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(REVIEWS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: OperatorRbacReview[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${REVIEW_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function getLatestOperatorRbacReview(operatorId: string): Promise<OperatorRbacReview | null> {
  if (!operatorId) throw new RbacReviewError('operatorId is required', 'operator_required');
  const redis = getRedis();
  const raw = await redis.get(`${LATEST_BY_OPERATOR_PREFIX}${operatorId}`);
  if (!raw) return null;
  const id = typeof raw === 'string' ? raw : (raw as any);
  if (!id) return null;
  return getOperatorRbacReview(id);
}

// ── Generate / acknowledge / note ───────────────────────────────────────────

export async function generateOperatorRbacReview(operatorId: string, actor: string): Promise<OperatorRbacReview> {
  if (!operatorId) throw new RbacReviewError('operatorId is required', 'operator_required');
  if (!actor) throw new RbacReviewError('actor is required', 'actor_required');

  const [readiness, access] = await Promise.all([
    getOperatorReadiness(operatorId),
    buildAccessSummary(operatorId),
  ]);

  // Resolve "latest cert" — use active if present; otherwise look at the most
  // recent record overall to detect revoked/expired states.
  const latestCert = readiness.activeCertification ?? null;

  const ruleOut = evaluateRules({ operatorId, readiness, access, latestCert });

  const id = newReviewId();
  const now = new Date().toISOString();
  const review: OperatorRbacReview = {
    id,
    operatorId,
    generatedAt: now,
    generatedBy: actor,
    certificationStatus: readiness.activeCertification?.status
      ?? (readiness.verdict === 'expired' ? 'expired' : (readiness.verdict === 'certification_ready' ? 'certification_ready' : 'not_started')),
    certificationExpiresAt: readiness.activeCertification?.expiresAt ?? null,
    activeCertificationId: readiness.activeCertification?.id ?? null,
    currentAccessSummary: access,
    recommendation: ruleOut.recommendation,
    severity: ruleOut.severity,
    reasons: ruleOut.reasons,
    notes: [],
  };

  await saveReview(review);
  const redis = getRedis();
  await redis.zadd(REVIEWS_SET, { score: Date.now(), member: id });
  await redis.set(`${LATEST_BY_OPERATOR_PREFIX}${operatorId}`, id);
  await trimToCap(redis, REVIEWS_SET, REVIEW_PREFIX, MAX_REVIEWS);

  await logAuditEvent({
    actor,
    eventType: 'operator_rbac_review_generated',
    targetType: 'operator',
    targetId: operatorId,
    summary: `RBAC review ${id} generated for ${operatorId}: ${ruleOut.recommendation} (${ruleOut.severity})`,
    details: {
      reviewId: id, operatorId, recommendation: ruleOut.recommendation, severity: ruleOut.severity,
      certificationStatus: review.certificationStatus, accessDataAvailable: access.accessDataAvailable,
      elevatedAccess: access.elevatedAccess, roles: access.roles, permissionCount: access.permissions.length,
    },
  });

  return review;
}

export async function acknowledgeOperatorRbacReview(reviewId: string, actor: string, note?: string): Promise<OperatorRbacReview> {
  if (!reviewId) throw new RbacReviewError('reviewId is required', 'review_required');
  if (!actor) throw new RbacReviewError('actor is required', 'actor_required');
  const existing = await getOperatorRbacReview(reviewId);
  if (!existing) throw new RbacReviewError('Review not found', 'review_not_found');
  if (existing.acknowledgedAt) throw new RbacReviewError('Review already acknowledged', 'already_acknowledged');

  const now = new Date().toISOString();
  const updated: OperatorRbacReview = {
    ...existing,
    acknowledgedAt: now,
    acknowledgedBy: actor,
    notes: note?.trim()
      ? [...existing.notes, `[${now}] ${actor}: acknowledged — ${note.trim()}`]
      : [...existing.notes, `[${now}] ${actor}: acknowledged`],
  };
  await saveReview(updated);

  await logAuditEvent({
    actor,
    eventType: 'operator_rbac_review_acknowledged',
    targetType: 'operator',
    targetId: existing.operatorId,
    summary: `RBAC review ${reviewId} acknowledged by ${actor}`,
    details: { reviewId, operatorId: existing.operatorId, recommendation: existing.recommendation },
  });

  return updated;
}

export async function addOperatorRbacReviewNote(reviewId: string, actor: string, note: string): Promise<OperatorRbacReview> {
  if (!reviewId) throw new RbacReviewError('reviewId is required', 'review_required');
  if (!actor) throw new RbacReviewError('actor is required', 'actor_required');
  if (!note?.trim()) throw new RbacReviewError('note is required', 'note_required');

  const existing = await getOperatorRbacReview(reviewId);
  if (!existing) throw new RbacReviewError('Review not found', 'review_not_found');

  const now = new Date().toISOString();
  const updated: OperatorRbacReview = {
    ...existing,
    notes: [...(existing.notes ?? []), `[${now}] ${actor}: ${note.trim()}`].slice(-200),
  };
  await saveReview(updated);

  await logAuditEvent({
    actor,
    eventType: 'operator_rbac_review_note_added',
    targetType: 'operator',
    targetId: existing.operatorId,
    summary: `Note added to RBAC review ${reviewId}`,
    details: { reviewId, operatorId: existing.operatorId },
  });

  return updated;
}

// ── Summary builder ─────────────────────────────────────────────────────────

export async function getOperatorRbacReviewSummary(): Promise<RbacReviewSummary> {
  const reviews = await listOperatorRbacReviews(500);

  const byRecommendation: Record<RbacRecommendation, number> = {
    no_action: 0, review_recommended: 0, access_review_due: 0,
    certification_missing: 0, certification_expired: 0, certification_revoked: 0,
    excessive_access_warning: 0,
  };
  const bySeverity: Record<RbacSeverity, number> = { info: 0, warning: 0, critical: 0 };
  let acknowledged = 0;
  let unacknowledged = 0;
  let accessDataUnavailable = 0;

  for (const r of reviews) {
    byRecommendation[r.recommendation]++;
    bySeverity[r.severity]++;
    if (r.acknowledgedAt) acknowledged++;
    else unacknowledged++;
    if (!r.currentAccessSummary.accessDataAvailable) accessDataUnavailable++;
  }

  // Latest per operator
  const latestByOp = new Map<string, OperatorRbacReview>();
  for (const r of reviews) {
    const existing = latestByOp.get(r.operatorId);
    if (!existing || r.generatedAt > existing.generatedAt) latestByOp.set(r.operatorId, r);
  }
  const perOperator = Array.from(latestByOp.entries()).map(([operatorId, review]) => ({ operatorId, review }));

  return {
    totalReviews: reviews.length,
    byRecommendation,
    bySeverity,
    acknowledged,
    unacknowledged,
    accessDataUnavailable,
    perOperator,
  };
}

// ── Convenience: list all known operators (for the picker) ──────────────────

export async function listKnownOperators(): Promise<{ operatorId: string; source: string[] }[]> {
  const sources = new Map<string, Set<string>>();
  const add = (op: string, src: string) => {
    if (!sources.has(op)) sources.set(op, new Set());
    sources.get(op)!.add(src);
  };

  // From RBAC store
  try {
    const users = await listUserRoles();
    for (const u of users) if (u.userId) add(u.userId, 'security-store');
  } catch { /* ignore — see below */ }

  // From training/cert readiness
  try {
    const readinesses = await listOperatorReadiness();
    for (const r of readinesses) add(r.operatorId, 'training');
  } catch { /* ignore */ }

  return Array.from(sources.entries()).map(([operatorId, srcSet]) => ({ operatorId, source: Array.from(srcSet) }))
    .sort((a, b) => a.operatorId.localeCompare(b.operatorId));
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
