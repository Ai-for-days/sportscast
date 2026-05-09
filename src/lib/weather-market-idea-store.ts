// ── Step 146: Saved weather-market-idea review queue ────────────────────
//
// Server-only Redis-backed store for the admin "save this idea for
// later" workflow on top of the Step 144 / Step 145 generator. **Pure
// admin workflow assistance.** Saving an idea does not create or
// publish anything: it only persists a snapshot of the generator's
// suggestion plus operator metadata so the admin can come back to it,
// note it, mark it reviewed/rejected/used, and (when ready) follow the
// existing prefilled "Use this idea →" link to the wager-create form.
//
// Trust posture:
//   - Server-only — browser-import throws.
//   - Bounded retention (MAX_SAVED_IDEAS = 300) so the queue can't grow
//     unboundedly on a heavy generator day.
//   - Imports nothing from wager / bet / wallet / settlement / grading
//     / pricing / publish / Kalshi / Polymarket modules.
//   - No public/customer surface reads or writes here. The companion
//     API route is admin-gated.
//   - No persistence of secrets or PII. The stored payload is the
//     compact `WeatherMarketIdea` from the generator (lat/lon + city
//     labels + temperatures + suggested spread/odds + warnings) plus
//     a small operator note string.
//
// See docs/weather-market-idea-generator.md for the workflow.

import { getRedis } from './redis';
import type { WeatherMarketIdea, MetricPairOption } from './weather-market-idea-generator';

if (typeof window !== 'undefined') {
  throw new Error(
    'weather-market-idea-store is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export type SavedIdeaStatus = 'saved' | 'reviewed' | 'rejected' | 'used';

export const SAVED_IDEA_STATUSES: readonly SavedIdeaStatus[] = [
  'saved',
  'reviewed',
  'rejected',
  'used',
] as const;

export interface SavedIdeaSearchContext {
  targetDifferenceF?: number;
  toleranceF?: number;
  dayOffset?: number;
  metricPair?: MetricPairOption;
}

export interface SavedWeatherMarketIdea {
  /**
   * Stable store-issued id. Distinct from the ephemeral `idea.id` the
   * generator hands out (which is timestamp+random and changes every
   * generation run). The store id is what the UI/API references.
   */
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SavedIdeaStatus;
  /** The frozen idea snapshot at save time. No re-fetching forecasts later. */
  idea: WeatherMarketIdea;
  /** Free-text admin note. Kept short by the API. */
  operatorNote?: string;
  source: 'generator';
  /** Echoes the search inputs that produced this idea, when available. */
  searchContext?: SavedIdeaSearchContext;
  /** Denormalized for UI convenience — the `idea.prefillQuery` is also here. */
  prefillQuery: string;
  /**
   * Pulled out of `idea.warnings` so the queue can render badges (e.g.
   * "cross-metric") without re-inferring. Empty array when none.
   */
  warningFlags: string[];
  /**
   * Deterministic identity for duplicate detection. Same target date,
   * same A/B locations, same per-side metrics, same suggested spread.
   * See `computeIdeaFingerprint`.
   */
  fingerprint: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Bounded retention: oldest get trimmed once we exceed this. */
export const MAX_SAVED_IDEAS = 300;

/** Note length cap so a runaway paste can't bloat Redis records. */
export const OPERATOR_NOTE_MAX_LEN = 1000;

const KEY = {
  one: (id: string) => `weather-market-idea:${id}`,
  all: 'weather-market-ideas:all',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `wmi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseSaved(raw: string | null | unknown): SavedWeatherMarketIdea | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as SavedWeatherMarketIdea)
      : (raw as SavedWeatherMarketIdea);
  } catch {
    return null;
  }
}

/**
 * Fingerprint two ideas as the same market. Intentionally conservative:
 * different spreads on the same pair count as different ideas (the
 * spread is what the operator is pricing). Stable across generator
 * runs because it doesn't include ephemeral fields like generatedAt or
 * forecast values.
 */
export function computeIdeaFingerprint(idea: WeatherMarketIdea): string {
  // Lower-case + sort the location pair so (A,B) and (B,A) are NOT
  // collapsed — direction matters for cross-metric markets and for
  // which side carries the negative spread, so keep them distinct.
  const a = idea.locationA.id;
  const b = idea.locationB.id;
  return [
    idea.targetDate,
    a,
    b,
    idea.metricA,
    idea.metricB,
    idea.suggestedSpread,
  ].join('|');
}

function extractWarningFlags(idea: WeatherMarketIdea): string[] {
  const flags: string[] = [];
  if (idea.metricA !== idea.metricB) flags.push('cross_metric');
  for (const w of idea.warnings ?? []) {
    if (w.toLowerCase().includes('beyond') && w.toLowerCase().includes('horizon')) {
      flags.push('beyond_horizon');
    }
  }
  // De-duplicate while keeping insertion order.
  return Array.from(new Set(flags));
}

function isValidStatus(s: unknown): s is SavedIdeaStatus {
  return typeof s === 'string' && (SAVED_IDEA_STATUSES as readonly string[]).includes(s);
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface SaveIdeaInput {
  idea: WeatherMarketIdea;
  operatorNote?: string;
  searchContext?: SavedIdeaSearchContext;
}

export interface SaveIdeaResult {
  savedIdea: SavedWeatherMarketIdea;
  isDuplicate: boolean;
  /** Set when isDuplicate=true. The id of the existing non-rejected record. */
  existingId?: string;
}

/**
 * Persist an idea. If an active (non-rejected) idea with the same
 * fingerprint already exists, do NOT create a second record — return
 * that existing record with isDuplicate=true so the UI can react.
 * Rejected duplicates are ignored (rejecting "clears" the slot for
 * re-saving the same shape).
 */
export async function saveIdea(input: SaveIdeaInput): Promise<SaveIdeaResult> {
  const fingerprint = computeIdeaFingerprint(input.idea);
  const existing = await findActiveDuplicateByFingerprint(fingerprint);
  if (existing) {
    return { savedIdea: existing, isDuplicate: true, existingId: existing.id };
  }

  const redis = getRedis();
  const now = new Date().toISOString();
  const id = generateId();
  const note = (input.operatorNote ?? '').slice(0, OPERATOR_NOTE_MAX_LEN) || undefined;

  const saved: SavedWeatherMarketIdea = {
    id,
    createdAt: now,
    updatedAt: now,
    status: 'saved',
    idea: input.idea,
    operatorNote: note,
    source: 'generator',
    searchContext: input.searchContext,
    prefillQuery: input.idea.prefillQuery,
    warningFlags: extractWarningFlags(input.idea),
    fingerprint,
  };

  const score = Date.parse(now) || Date.now();
  const pipe = redis.pipeline();
  pipe.set(KEY.one(id), JSON.stringify(saved));
  pipe.zadd(KEY.all, { score, member: id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_SAVED_IDEAS - 1);
  await pipe.exec();

  return { savedIdea: saved, isDuplicate: false };
}

export interface ListSavedIdeasOptions {
  status?: SavedIdeaStatus | SavedIdeaStatus[];
  limit?: number;
}

export async function listSavedIdeas(
  options: ListSavedIdeasOptions = {},
): Promise<SavedWeatherMarketIdea[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_SAVED_IDEAS, Math.max(1, options.limit ?? 100));
  const ids = (await redis.zrange(KEY.all, 0, -1, { rev: true })) as string[];
  if (!ids || ids.length === 0) return [];

  // Page in chunks via pipeline.
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.one(id));
  const rows = (await pipe.exec()) as Array<string | null | unknown>;

  const wantedStatuses = Array.isArray(options.status)
    ? new Set(options.status)
    : options.status
      ? new Set([options.status])
      : null;

  const out: SavedWeatherMarketIdea[] = [];
  for (const row of rows) {
    const s = parseSaved(row);
    if (!s) continue;
    if (wantedStatuses && !wantedStatuses.has(s.status)) continue;
    out.push(s);
    if (out.length >= safe) break;
  }
  return out;
}

export async function getSavedIdea(id: string): Promise<SavedWeatherMarketIdea | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = (await redis.get(KEY.one(id))) as string | null;
  return parseSaved(raw);
}

export async function updateSavedIdeaStatus(
  id: string,
  status: SavedIdeaStatus,
): Promise<SavedWeatherMarketIdea | null> {
  if (!isValidStatus(status)) {
    throw new Error(`invalid_status: ${String(status)}`);
  }
  const existing = await getSavedIdea(id);
  if (!existing) return null;
  if (existing.status === status) return existing;
  const updated: SavedWeatherMarketIdea = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
  };
  const redis = getRedis();
  await redis.set(KEY.one(id), JSON.stringify(updated));
  return updated;
}

export async function updateSavedIdeaNote(
  id: string,
  note: string,
): Promise<SavedWeatherMarketIdea | null> {
  if (typeof note !== 'string') throw new Error('invalid_note');
  const existing = await getSavedIdea(id);
  if (!existing) return null;
  const trimmed = note.slice(0, OPERATOR_NOTE_MAX_LEN);
  const updated: SavedWeatherMarketIdea = {
    ...existing,
    operatorNote: trimmed.length > 0 ? trimmed : undefined,
    updatedAt: new Date().toISOString(),
  };
  const redis = getRedis();
  await redis.set(KEY.one(id), JSON.stringify(updated));
  return updated;
}

export async function deleteSavedIdea(id: string): Promise<boolean> {
  if (!id) return false;
  const existing = await getSavedIdea(id);
  if (!existing) return false;
  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.del(KEY.one(id));
  pipe.zrem(KEY.all, id);
  await pipe.exec();
  return true;
}

/**
 * Returns the most-recently-updated active (non-rejected) saved idea
 * with the given fingerprint, or null. Linear scan over the bounded
 * set — fine at 300-record max.
 */
async function findActiveDuplicateByFingerprint(
  fingerprint: string,
): Promise<SavedWeatherMarketIdea | null> {
  const all = await listSavedIdeas({ limit: MAX_SAVED_IDEAS });
  for (const s of all) {
    if (s.status === 'rejected') continue;
    if (s.fingerprint === fingerprint) return s;
  }
  return null;
}
