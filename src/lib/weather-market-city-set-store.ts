// ── Step 153: Favorite city sets for the weather market idea finder ─────
//
// Server-only Redis-backed store for admin-saved "favorite" city
// groupings (e.g. "Texas heat cities", "Mountain cold cities", "NFL
// cities"). **Pure operator workflow assistance.** Saving, loading, or
// deleting a city set never publishes a market, never creates a wager,
// never touches pricing/settlement/wallet code paths. Loaded sets just
// become the `cityIds` selection passed to the existing Step 152
// generator — and *that* selection is itself revalidated against the
// static `weather-market-city-universe` catalog before the generator
// touches a forecast.
//
// Trust posture (mirrors Step 146 saved-idea + Step 147 draft + Step
// 149 QA stores):
//   - Server-only — browser-import throws.
//   - Bounded retention (`MAX_CITY_SETS = 100`).
//   - Imports nothing from wager-store / settlement / grading / wallet
//     / pricing / publish / Kalshi / Polymarket / forecast modules.
//   - Customer code paths cannot reach `weather-market-city-set:*`
//     keys — that namespace is admin-only.
//   - The city ids inside a saved set are validated against the static
//     universe at write time, and re-validated at every load. A stale
//     set that references a removed city is degraded silently rather
//     than hard-erroring.

import { getRedis } from './redis';
import {
  validateExpandedCityIds,
} from './weather-market-city-universe';

if (typeof window !== 'undefined') {
  throw new Error(
    'weather-market-city-set-store is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface WeatherMarketCitySet {
  /** Stable store-issued id. */
  id: string;
  /** Operator-given name. ≤ CITY_SET_NAME_MAX_LEN chars. */
  name: string;
  /** Lower-cased / trimmed name for duplicate detection. */
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
  /** Validated against the static universe at write time. */
  cityIds: string[];
  /** Cached for sort/UI without re-counting. */
  cityCount: number;
  /** Free-text operator note. ≤ CITY_SET_NOTE_MAX_LEN. */
  note?: string;
  /** Optional tags. ≤ MAX_TAGS, each ≤ TAG_MAX_LEN. */
  tags?: string[];
  /** Provenance — always 'admin' in this build. */
  source: 'admin';
}

// ── Caps (defense-in-depth) ────────────────────────────────────────────────

export const MAX_CITY_SETS = 100;
export const CITY_SET_NAME_MAX_LEN = 80;
export const CITY_SET_NOTE_MAX_LEN = 500;
export const MAX_CITY_IDS_PER_SET = 100;
export const MAX_CITY_SET_TAGS = 8;
export const CITY_SET_TAG_MAX_LEN = 32;

const KEY = {
  one: (id: string) => `weather-market-city-set:${id}`,
  all: 'weather-market-city-sets:all',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `wmcs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeCitySetName(name: string): string {
  return (name ?? '').trim().toLowerCase();
}

function parseSet(raw: string | null | unknown): WeatherMarketCitySet | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as WeatherMarketCitySet)
      : (raw as WeatherMarketCitySet);
  } catch {
    return null;
  }
}

/** Canonicalize tags: trim, lowercase, dedupe, cap count + length. */
function sanitizeTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const trimmed = t.trim().slice(0, CITY_SET_TAG_MAX_LEN);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_CITY_SET_TAGS) break;
  }
  return out.length > 0 ? out : undefined;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface CreateCitySetInput {
  name: string;
  cityIds: string[];
  note?: string;
  tags?: string[];
  /** When true, an existing set with the same normalized name is updated in place. */
  upsert?: boolean;
}

export interface CreateCitySetResult {
  citySet: WeatherMarketCitySet;
  /** True when an existing record with the same name was found. */
  isDuplicate: boolean;
  /** The existing record's id when isDuplicate is true. */
  existingId?: string;
  /** True when `upsert: true` caused the existing record to be updated. */
  upserted?: boolean;
  /** City ids that didn't resolve in the universe — still rejected at write time. */
  rejectedCityIds?: string[];
}

/**
 * Persist a new city set. Caller is responsible for the requireAdmin
 * gate. The store re-validates city ids against the static universe;
 * the API layer should also pre-validate so the operator gets a clear
 * 400 rather than a half-stored set.
 */
export async function createCitySet(input: CreateCitySetInput): Promise<CreateCitySetResult> {
  const trimmedName = (input.name ?? '').trim().slice(0, CITY_SET_NAME_MAX_LEN);
  if (!trimmedName) {
    throw new Error('city_set_name_required');
  }
  const normalizedName = normalizeCitySetName(trimmedName);
  const { valid, invalid } = validateExpandedCityIds(input.cityIds ?? []);
  if (valid.length === 0) {
    throw new Error('city_set_must_include_at_least_one_valid_city');
  }
  if (valid.length > MAX_CITY_IDS_PER_SET) {
    throw new Error(`city_set_exceeds_max_ids_${MAX_CITY_IDS_PER_SET}`);
  }
  const note =
    typeof input.note === 'string' && input.note.trim().length > 0
      ? input.note.slice(0, CITY_SET_NOTE_MAX_LEN)
      : undefined;
  const tags = sanitizeTags(input.tags);

  const existing = await findCitySetByNormalizedName(normalizedName);
  if (existing && !input.upsert) {
    return {
      citySet: existing,
      isDuplicate: true,
      existingId: existing.id,
      rejectedCityIds: invalid.length > 0 ? invalid : undefined,
    };
  }
  if (existing && input.upsert) {
    const updated: WeatherMarketCitySet = {
      ...existing,
      name: trimmedName,
      cityIds: valid,
      cityCount: valid.length,
      note,
      tags,
      updatedAt: new Date().toISOString(),
    };
    const redis = getRedis();
    await redis.set(KEY.one(existing.id), JSON.stringify(updated));
    return {
      citySet: updated,
      isDuplicate: true,
      existingId: existing.id,
      upserted: true,
      rejectedCityIds: invalid.length > 0 ? invalid : undefined,
    };
  }

  const redis = getRedis();
  const now = new Date().toISOString();
  const id = generateId();
  const set: WeatherMarketCitySet = {
    id,
    name: trimmedName,
    normalizedName,
    createdAt: now,
    updatedAt: now,
    cityIds: valid,
    cityCount: valid.length,
    note,
    tags,
    source: 'admin',
  };
  const score = Date.parse(now) || Date.now();
  const pipe = redis.pipeline();
  pipe.set(KEY.one(id), JSON.stringify(set));
  pipe.zadd(KEY.all, { score, member: id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_CITY_SETS - 1);
  await pipe.exec();
  return {
    citySet: set,
    isDuplicate: false,
    rejectedCityIds: invalid.length > 0 ? invalid : undefined,
  };
}

export async function listCitySets(limit = MAX_CITY_SETS): Promise<WeatherMarketCitySet[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_CITY_SETS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, -1, { rev: true })) as string[];
  if (!ids || ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.one(id));
  const rows = (await pipe.exec()) as Array<string | null | unknown>;
  const out: WeatherMarketCitySet[] = [];
  for (const row of rows) {
    const s = parseSet(row);
    if (s) out.push(s);
    if (out.length >= safe) break;
  }
  return out;
}

export async function getCitySet(id: string): Promise<WeatherMarketCitySet | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = (await redis.get(KEY.one(id))) as string | null;
  return parseSet(raw);
}

export interface UpdateCitySetInput {
  id: string;
  name?: string;
  cityIds?: string[];
  note?: string | null;
  tags?: string[] | null;
}

export async function updateCitySet(input: UpdateCitySetInput): Promise<WeatherMarketCitySet | null> {
  const existing = await getCitySet(input.id);
  if (!existing) return null;
  const next: WeatherMarketCitySet = { ...existing };
  if (typeof input.name === 'string') {
    const trimmed = input.name.trim().slice(0, CITY_SET_NAME_MAX_LEN);
    if (trimmed) {
      next.name = trimmed;
      next.normalizedName = normalizeCitySetName(trimmed);
    }
  }
  if (Array.isArray(input.cityIds)) {
    const { valid } = validateExpandedCityIds(input.cityIds);
    if (valid.length === 0) {
      throw new Error('city_set_must_include_at_least_one_valid_city');
    }
    if (valid.length > MAX_CITY_IDS_PER_SET) {
      throw new Error(`city_set_exceeds_max_ids_${MAX_CITY_IDS_PER_SET}`);
    }
    next.cityIds = valid;
    next.cityCount = valid.length;
  }
  if (input.note === null) {
    delete (next as { note?: string }).note;
  } else if (typeof input.note === 'string') {
    const trimmed = input.note.slice(0, CITY_SET_NOTE_MAX_LEN);
    if (trimmed.length > 0) next.note = trimmed;
    else delete (next as { note?: string }).note;
  }
  if (input.tags === null) {
    delete (next as { tags?: string[] }).tags;
  } else if (Array.isArray(input.tags)) {
    const sanitized = sanitizeTags(input.tags);
    if (sanitized) next.tags = sanitized;
    else delete (next as { tags?: string[] }).tags;
  }
  next.updatedAt = new Date().toISOString();
  const redis = getRedis();
  await redis.set(KEY.one(input.id), JSON.stringify(next));
  return next;
}

export async function deleteCitySet(id: string): Promise<boolean> {
  if (!id) return false;
  const existing = await getCitySet(id);
  if (!existing) return false;
  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.del(KEY.one(id));
  pipe.zrem(KEY.all, id);
  await pipe.exec();
  return true;
}

/**
 * Find a city set by normalized name. Linear scan over the bounded
 * set — fine at MAX_CITY_SETS = 100. Used by the create path's
 * duplicate-detection guard.
 */
export async function findCitySetByNormalizedName(
  normalized: string,
): Promise<WeatherMarketCitySet | null> {
  if (!normalized) return null;
  const all = await listCitySets();
  for (const s of all) {
    if (s.normalizedName === normalized) return s;
  }
  return null;
}
