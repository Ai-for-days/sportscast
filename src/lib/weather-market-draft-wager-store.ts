// ── Step 147: Admin draft-wager store (admin-only, server-only) ─────────
//
// Persists prepared wager *inputs* derived from saved weather market
// ideas so an admin can review them before they ever touch the live
// wager store. **This is a deliberately separate Redis namespace.**
// Customer code paths (`/api/wagers`, `/api/wagers/[id]`, `getWager`,
// `listWagers`, `listPublicWagers`) read from `wager:<id>` and the
// `wagers:by-status:*` / `wagers:all` indices; this store writes to
// `weather-market-draft-wager:<id>` and `weather-market-draft-wagers:all`.
// Those keys are never indexed into the public surface, so a draft is
// physically unreachable by any non-admin path — there is no "filter
// out drafts" hot path that could be regressed by a future change.
//
// Trust posture:
//   - Server-only — browser-import throws.
//   - Bounded retention (`MAX_DRAFTS = 200`).
//   - Imports nothing from wager-store / settlement / grading / wallet
//     / pricing / publish / Kalshi / Polymarket. Persisting a draft is
//     a Redis write into `weather-market-draft-wager:<id>` and nothing
//     else. The publish path (a future step) will read this draft,
//     hand its `input` to `createWager`, and delete the draft.
//
// See docs/weather-market-idea-generator.md for the workflow.

import { getRedis } from './redis';
import type { CreateWagerInput, WagerKind, WagerMetric } from './wager-types';

if (typeof window !== 'undefined') {
  throw new Error(
    'weather-market-draft-wager-store is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface DraftWagerProvenance {
  /** The saved-idea record the draft was created from. */
  savedIdeaId: string;
  /** The generator-issued idea id at the time of save. */
  ideaId: string;
  /** Stable fingerprint copied from the saved idea — useful for the duplicate guard. */
  ideaFingerprint: string;
}

export interface DraftWagerSummary {
  /** Pre-rendered title the operator agreed to at create time. */
  title: string;
  description?: string;
  kind: WagerKind;
  metric: WagerMetric;
  metricA?: WagerMetric;
  metricB?: WagerMetric;
  targetDate: string;
  locationAName?: string;
  locationBName?: string;
  spread?: number;
  locationAOdds?: number;
  locationBOdds?: number;
  /** Operator-facing rules copy from the mapper. */
  rulesCopy: string;
  /** Free-text notes the mapper surfaced (cross-metric reminder, etc.). */
  warnings: string[];
}

export interface DraftWager {
  /** Stable store-issued id. Distinct from any live `Wager.id`. */
  id: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 'draft' before publish, 'published' after a successful publish action.
   * The store record is *kept* after publish (rather than deleted) so the
   * Drafts tab can show "Published → wager:..." with a link, the
   * duplicate-publish guard has trivial state to check, and the audit
   * trail across save → draft → publish is preserved for rollback.
   */
  status: 'draft' | 'published';
  /** Frozen `CreateWagerInput`. Hand this to `createWager` later to publish. */
  input: CreateWagerInput;
  summary: DraftWagerSummary;
  provenance: DraftWagerProvenance;
  /** Operator-friendly note attached at create time (optional). */
  operatorNote?: string;
  /** Step 148 — set when the draft has been promoted to a real wager. */
  publishedAt?: string;
  /** The id of the live `Wager` record produced by publish. */
  publishedWagerId?: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const MAX_DRAFTS = 200;
export const DRAFT_OPERATOR_NOTE_MAX_LEN = 1000;

const KEY = {
  one: (id: string) => `weather-market-draft-wager:${id}`,
  all: 'weather-market-draft-wagers:all',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `wmdraft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseDraft(raw: string | null | unknown): DraftWager | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as DraftWager) : (raw as DraftWager);
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface CreateDraftInput {
  input: CreateWagerInput;
  summary: DraftWagerSummary;
  provenance: DraftWagerProvenance;
  operatorNote?: string;
}

export async function createDraftWager(input: CreateDraftInput): Promise<DraftWager> {
  const redis = getRedis();
  const now = new Date().toISOString();
  const id = generateId();
  const note =
    typeof input.operatorNote === 'string' && input.operatorNote.trim().length > 0
      ? input.operatorNote.slice(0, DRAFT_OPERATOR_NOTE_MAX_LEN)
      : undefined;

  const draft: DraftWager = {
    id,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    input: input.input,
    summary: input.summary,
    provenance: input.provenance,
    operatorNote: note,
  };

  const score = Date.parse(now) || Date.now();
  const pipe = redis.pipeline();
  pipe.set(KEY.one(id), JSON.stringify(draft));
  pipe.zadd(KEY.all, { score, member: id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_DRAFTS - 1);
  await pipe.exec();

  return draft;
}

export async function listDraftWagers(limit = MAX_DRAFTS): Promise<DraftWager[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_DRAFTS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, -1, { rev: true })) as string[];
  if (!ids || ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.one(id));
  const rows = (await pipe.exec()) as Array<string | null | unknown>;
  const out: DraftWager[] = [];
  for (const row of rows) {
    const d = parseDraft(row);
    if (d) out.push(d);
    if (out.length >= safe) break;
  }
  return out;
}

export async function getDraftWager(id: string): Promise<DraftWager | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = (await redis.get(KEY.one(id))) as string | null;
  return parseDraft(raw);
}

export async function deleteDraftWager(id: string): Promise<boolean> {
  if (!id) return false;
  const existing = await getDraftWager(id);
  if (!existing) return false;
  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.del(KEY.one(id));
  pipe.zrem(KEY.all, id);
  await pipe.exec();
  return true;
}

/**
 * Find an existing draft created from the given saved-idea id, if any.
 * Used by the API layer to refuse a duplicate "Create Draft" click.
 * Linear scan over the bounded set — fine at MAX_DRAFTS = 200.
 */
export async function findDraftBySavedIdeaId(savedIdeaId: string): Promise<DraftWager | null> {
  if (!savedIdeaId) return null;
  const all = await listDraftWagers();
  for (const d of all) {
    if (d.provenance.savedIdeaId === savedIdeaId) return d;
  }
  return null;
}

/**
 * Step 148 — flip a draft to status='published' and record the live
 * wager id it produced. Returns the updated draft, or null if the draft
 * went missing between caller's lookup and this write (caller should
 * surface that as a warning since the live wager was already created).
 *
 * This is *only* called after a successful `createWager` — the store
 * itself never calls `createWager`, so there is no path here that can
 * accidentally publish.
 */
export async function markDraftPublished(
  id: string,
  publishedWagerId: string,
): Promise<DraftWager | null> {
  if (!id || !publishedWagerId) {
    throw new Error('markDraftPublished requires both draft id and publishedWagerId');
  }
  const existing = await getDraftWager(id);
  if (!existing) return null;
  const updated: DraftWager = {
    ...existing,
    status: 'published',
    publishedAt: existing.publishedAt ?? new Date().toISOString(),
    publishedWagerId: existing.publishedWagerId ?? publishedWagerId,
    updatedAt: new Date().toISOString(),
  };
  const redis = getRedis();
  await redis.set(KEY.one(id), JSON.stringify(updated));
  return updated;
}
