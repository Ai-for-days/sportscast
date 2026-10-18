/**
 * In-memory request deduplication cache for Open-Meteo API calls.
 *
 * When multiple requests for the same (lat, lon, days) forecast arrive
 * concurrently, they all receive the same promise instead of making
 * duplicate API calls. This is the Phase 1.1 critical optimization to
 * reduce Open-Meteo calls from 10k/day to ~200-300/day.
 *
 * Automatic cleanup: completed/errored promises are removed from the cache
 * after their result settles.
 */

import type { ForecastResponse } from './types';

/** Track in-flight requests by (lat, lon, days) key. */
const dedupCache = new Map<string, Promise<ForecastResponse>>();

/** Track dedup stats: how many duplicate requests were skipped. */
let dedupStats = {
  totalRequests: 0,
  dedupedRequests: 0,
  cacheHits: 0,
};

/**
 * Generate a cache key from coordinates and days.
 * Rounds to 3 decimal places (~100m precision) to match the forecast
 * cache key granularity in weather-queries.ts.
 */
function makeDedupKey(lat: number, lon: number, days: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}:${days}`;
}

/**
 * Get or create a promise for the given forecast request.
 * If an identical request is already in flight, return that promise instead.
 * Otherwise, call the factory function to create a new promise and cache it.
 *
 * The returned promise is automatically removed from the cache when it settles
 * (succeeds or fails), allowing new requests after the first completes.
 */
export function dedupOpenMeteoRequest<T extends ForecastResponse>(
  lat: number,
  lon: number,
  days: number,
  factory: () => Promise<T>,
): Promise<T> {
  dedupStats.totalRequests++;

  const key = makeDedupKey(lat, lon, days);
  const inFlight = dedupCache.get(key) as Promise<T> | undefined;

  if (inFlight) {
    dedupStats.dedupedRequests++;
    if (process.env.DEBUG_DEDUP === 'true') {
      console.log(`[open-meteo-dedup] Cache hit for ${key} (deduped ${dedupStats.dedupedRequests} so far)`);
    }
    return inFlight;
  }

  // Not in cache — create a new promise
  const promise = factory();

  // Store it in the cache
  dedupCache.set(key, promise);

  // Auto-cleanup: remove from cache when the promise settles (success or error)
  // Use finally to avoid re-throwing and interfering with error propagation
  promise.finally(() => {
    dedupCache.delete(key);
    if (process.env.DEBUG_DEDUP === 'true') {
      console.log(`[open-meteo-dedup] Cleaned up cache entry ${key}`);
    }
  });

  return promise;
}

/**
 * Get deduplication stats.
 * Useful for debugging and monitoring effectiveness.
 */
export function getDedupStats(): typeof dedupStats {
  return { ...dedupStats };
}

/**
 * Reset deduplication stats.
 * Primarily for testing.
 */
export function resetDedupStats(): void {
  dedupStats = {
    totalRequests: 0,
    dedupedRequests: 0,
    cacheHits: 0,
  };
}

/**
 * Get the size of the in-flight cache.
 * Used for monitoring and debugging.
 */
export function getCacheSize(): number {
  return dedupCache.size;
}

/**
 * Clear the entire dedup cache.
 * Use with caution; primarily for testing.
 */
export function clearDedupCache(): void {
  dedupCache.clear();
}
