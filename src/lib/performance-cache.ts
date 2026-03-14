/* ------------------------------------------------------------------ */
/*  Lightweight in-memory TTL cache for expensive summaries            */
/*  Server-side only — never bypasses permissions                      */
/* ------------------------------------------------------------------ */

interface CacheEntry<T = any> {
  key: string;
  value: T;
  expiresAt: number;
  createdAt: number;
  hits: number;
  misses: number;
}

const store = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 30_000; // 30 seconds

/* ------------------------------------------------------------------ */
/*  Core API                                                           */
/* ------------------------------------------------------------------ */

export function cacheGet<T = any>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  entry.hits += 1;
  return entry.value as T;
}

export function cacheSet<T = any>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  const existing = store.get(key);
  store.set(key, {
    key,
    value,
    expiresAt: Date.now() + ttlMs,
    createdAt: Date.now(),
    hits: existing ? existing.hits : 0,
    misses: existing ? existing.misses : 0,
  });
}

/** Get-or-compute helper */
export async function cached<T>(key: string, fn: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;

  // Track miss
  const existing = store.get(key);
  if (existing) {
    existing.misses += 1;
  } else {
    store.set(key, { key, value: null, expiresAt: 0, createdAt: Date.now(), hits: 0, misses: 1 });
  }

  const value = await fn();
  cacheSet(key, value, ttlMs);
  return value;
}

export function cacheInvalidate(key: string): boolean {
  return store.delete(key);
}

export function cacheInvalidateAll(): number {
  const count = store.size;
  store.clear();
  return count;
}

/* ------------------------------------------------------------------ */
/*  Introspection                                                      */
/* ------------------------------------------------------------------ */

export interface CacheSummary {
  key: string;
  ttlRemaining: number;
  expiresAt: string;
  createdAt: string;
  hits: number;
  misses: number;
  expired: boolean;
}

export function listCacheEntries(): CacheSummary[] {
  const now = Date.now();
  const results: CacheSummary[] = [];
  for (const entry of store.values()) {
    results.push({
      key: entry.key,
      ttlRemaining: Math.max(0, entry.expiresAt - now),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      createdAt: new Date(entry.createdAt).toISOString(),
      hits: entry.hits,
      misses: entry.misses,
      expired: now > entry.expiresAt,
    });
  }
  return results;
}

export function getCacheStats(): { totalKeys: number; activeKeys: number; expiredKeys: number; totalHits: number; totalMisses: number } {
  const now = Date.now();
  let active = 0;
  let expired = 0;
  let totalHits = 0;
  let totalMisses = 0;
  for (const entry of store.values()) {
    if (now > entry.expiresAt) expired++;
    else active++;
    totalHits += entry.hits;
    totalMisses += entry.misses;
  }
  return { totalKeys: store.size, activeKeys: active, expiredKeys: expired, totalHits, totalMisses };
}
