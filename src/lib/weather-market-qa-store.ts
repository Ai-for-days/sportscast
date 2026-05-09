// ── Step 149: Post-publish market QA store (admin-only, server-only) ────
//
// Tracks an admin checklist for every wager produced by the
// idea-generator → draft → publish workflow. **Pure operator-tracking
// state.** Marking checklist items, changing QA status, or deleting a
// QA record never publishes, unpublishes, edits, voids, or settles a
// live wager. The QA record sits next to the live wager but in its
// own Redis namespace, deliberately invisible to customer code paths.
//
// Trust posture (mirrors Steps 146/147 stores):
//   - Server-only — browser-import throws.
//   - Bounded retention (`MAX_QA_RECORDS = 300`).
//   - Imports nothing from wager-store / settlement / grading / wallet
//     / pricing / publish / Kalshi / Polymarket.
//   - No public/customer surface reads or writes here.
//   - PublicWagerView allow-list does not include any QA fields, so
//     even if a future caller accidentally merged a QA shape onto a
//     wager response the serializer would drop it.

import { getRedis } from './redis';

if (typeof window !== 'undefined') {
  throw new Error(
    'weather-market-qa-store is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export type MarketQAStatus = 'pending' | 'passed' | 'needs_changes' | 'rejected';

export const MARKET_QA_STATUSES: readonly MarketQAStatus[] = [
  'pending',
  'passed',
  'needs_changes',
  'rejected',
] as const;

/**
 * Nine-item checklist. Booleans only — the operator either has or
 * hasn't reviewed each axis. UI copy lives client-side so the wording
 * is easy to revise without bumping the schema.
 */
export interface MarketQAChecklist {
  titleReviewed: boolean;
  locationsReviewed: boolean;
  metricsReviewed: boolean;
  spreadReviewed: boolean;
  oddsReviewed: boolean;
  rulesReviewed: boolean;
  resolutionSourceReviewed: boolean;
  publicPageReviewed: boolean;
  mobileDisplayReviewed: boolean;
}

export const MARKET_QA_CHECKLIST_KEYS: readonly (keyof MarketQAChecklist)[] = [
  'titleReviewed',
  'locationsReviewed',
  'metricsReviewed',
  'spreadReviewed',
  'oddsReviewed',
  'rulesReviewed',
  'resolutionSourceReviewed',
  'publicPageReviewed',
  'mobileDisplayReviewed',
] as const;

/**
 * Snapshot fields the UI wants to render without round-tripping to the
 * wager store. Keeps the QA tab usable even if a published wager is
 * later voided or its title edited — the snapshot reflects what the
 * operator was looking at when the QA record was born.
 */
export interface MarketQASnapshot {
  title: string;
  targetDate: string;
  metric: string;
  metricA?: string;
  metricB?: string;
  locationAName?: string;
  locationBName?: string;
  spread?: number;
  locationAOdds?: number;
  locationBOdds?: number;
}

export interface MarketQA {
  /** Stable store-issued id. Distinct from the `wagerId`. */
  id: string;
  /** Live wager id this QA record is reviewing. */
  wagerId: string;
  /** The draft that produced the wager (Step 147). */
  sourceDraftId: string;
  /** The saved idea that produced the draft (Step 146). */
  sourceIdeaId: string;
  createdAt: string;
  updatedAt: string;
  status: MarketQAStatus;
  checklist: MarketQAChecklist;
  /** Frozen at create time so the queue stays usable post-edit. */
  snapshot: MarketQASnapshot;
  operatorNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const MAX_QA_RECORDS = 300;
export const QA_OPERATOR_NOTE_MAX_LEN = 1000;

const KEY = {
  one: (id: string) => `weather-market-qa:${id}`,
  all: 'weather-market-qas:all',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `wmqa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseQA(raw: string | null | unknown): MarketQA | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as MarketQA) : (raw as MarketQA);
  } catch {
    return null;
  }
}

export function emptyChecklist(): MarketQAChecklist {
  return {
    titleReviewed: false,
    locationsReviewed: false,
    metricsReviewed: false,
    spreadReviewed: false,
    oddsReviewed: false,
    rulesReviewed: false,
    resolutionSourceReviewed: false,
    publicPageReviewed: false,
    mobileDisplayReviewed: false,
  };
}

function isValidStatus(s: unknown): s is MarketQAStatus {
  return typeof s === 'string' && (MARKET_QA_STATUSES as readonly string[]).includes(s);
}

/** Sanitize an arbitrary client payload into a fully-defaulted checklist. */
export function sanitizeChecklist(raw: unknown): MarketQAChecklist {
  const out = emptyChecklist();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const k of MARKET_QA_CHECKLIST_KEYS) {
    if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  }
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface CreateQAInput {
  wagerId: string;
  sourceDraftId: string;
  sourceIdeaId: string;
  snapshot: MarketQASnapshot;
}

export async function createMarketQA(input: CreateQAInput): Promise<MarketQA> {
  const redis = getRedis();
  const now = new Date().toISOString();
  const id = generateId();

  const qa: MarketQA = {
    id,
    wagerId: input.wagerId,
    sourceDraftId: input.sourceDraftId,
    sourceIdeaId: input.sourceIdeaId,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    checklist: emptyChecklist(),
    snapshot: input.snapshot,
  };

  const score = Date.parse(now) || Date.now();
  const pipe = redis.pipeline();
  pipe.set(KEY.one(id), JSON.stringify(qa));
  pipe.zadd(KEY.all, { score, member: id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_QA_RECORDS - 1);
  await pipe.exec();
  return qa;
}

export interface ListQAOptions {
  status?: MarketQAStatus | MarketQAStatus[];
  limit?: number;
}

export async function listMarketQA(options: ListQAOptions = {}): Promise<MarketQA[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_QA_RECORDS, Math.max(1, options.limit ?? 100));
  const ids = (await redis.zrange(KEY.all, 0, -1, { rev: true })) as string[];
  if (!ids || ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.one(id));
  const rows = (await pipe.exec()) as Array<string | null | unknown>;

  const wantedStatuses = Array.isArray(options.status)
    ? new Set(options.status)
    : options.status
      ? new Set([options.status])
      : null;

  const out: MarketQA[] = [];
  for (const row of rows) {
    const q = parseQA(row);
    if (!q) continue;
    if (wantedStatuses && !wantedStatuses.has(q.status)) continue;
    out.push(q);
    if (out.length >= safe) break;
  }
  return out;
}

export async function getMarketQA(id: string): Promise<MarketQA | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = (await redis.get(KEY.one(id))) as string | null;
  return parseQA(raw);
}

/**
 * Find the QA record for a given live wager id. Linear scan over the
 * bounded set — fine at MAX_QA_RECORDS = 300. Used by the API layer
 * to refuse duplicate auto-creation and to surface a wager's QA from
 * the wager-detail link in the UI.
 */
export async function getMarketQAByWagerId(wagerId: string): Promise<MarketQA | null> {
  if (!wagerId) return null;
  const all = await listMarketQA({ limit: MAX_QA_RECORDS });
  for (const q of all) {
    if (q.wagerId === wagerId) return q;
  }
  return null;
}

export interface UpdateQAChecklistInput {
  id: string;
  checklist: MarketQAChecklist;
  operatorNote?: string;
  reviewedBy?: string;
}

export async function updateMarketQAChecklist(
  input: UpdateQAChecklistInput,
): Promise<MarketQA | null> {
  const existing = await getMarketQA(input.id);
  if (!existing) return null;
  const note = input.operatorNote !== undefined
    ? input.operatorNote.slice(0, QA_OPERATOR_NOTE_MAX_LEN)
    : existing.operatorNote;
  const updated: MarketQA = {
    ...existing,
    checklist: input.checklist,
    operatorNote: note && note.length > 0 ? note : undefined,
    reviewedBy: input.reviewedBy ?? existing.reviewedBy,
    reviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const redis = getRedis();
  await redis.set(KEY.one(input.id), JSON.stringify(updated));
  return updated;
}

export async function updateMarketQAStatus(
  id: string,
  status: MarketQAStatus,
  reviewedBy?: string,
): Promise<MarketQA | null> {
  if (!isValidStatus(status)) {
    throw new Error(`invalid_qa_status: ${String(status)}`);
  }
  const existing = await getMarketQA(id);
  if (!existing) return null;
  if (existing.status === status) return existing;
  const updated: MarketQA = {
    ...existing,
    status,
    reviewedBy: reviewedBy ?? existing.reviewedBy,
    reviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const redis = getRedis();
  await redis.set(KEY.one(id), JSON.stringify(updated));
  return updated;
}

export async function deleteMarketQA(id: string): Promise<boolean> {
  if (!id) return false;
  const existing = await getMarketQA(id);
  if (!existing) return false;
  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.del(KEY.one(id));
  pipe.zrem(KEY.all, id);
  await pipe.exec();
  return true;
}
