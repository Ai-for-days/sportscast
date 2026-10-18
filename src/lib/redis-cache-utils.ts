/**
 * Redis caching utilities for Open-Meteo forecasts.
 *
 * This is Phase 1.2: cross-request caching with Redis.
 * Wraps the in-memory dedup layer (Phase 1.1) to cache results across
 * different requests with a 60-second TTL.
 *
 * Expected impact (combined with Phase 1.1):
 * - In-process concurrent dedup: 3-10x reduction during bursts
 * - Cross-request caching (60s): Additional 50-80% reduction for page refreshes/tabs
 * - Total: From ~10k API calls/day to ~200-300/day
 */

import type { ForecastResponse } from './types';
import { getRedis } from './redis';

/** Track Redis cache statistics */
let redisCacheStats = {
  hits: 0,
  misses: 0,
  errors: 0,
  setsAttempted: 0,
  setsFailed: 0,
};

/**
 * TTL for cached forecasts in seconds.
 * Configurable via OPENMETEO_CACHE_TTL env var, defaults to 60 seconds.
 */
function getCacheTTL(): number {
  const ttl = import.meta.env.OPENMETEO_CACHE_TTL;
  return ttl ? parseInt(ttl, 10) : 60;
}

/**
 * Generate a Redis cache key from coordinates and days.
 * Format: open-meteo:{lat}:{lon}:{days}
 * Coordinates rounded to 3 decimal places (~100m precision).
 */
export function cacheKey(lat: number, lon: number, days: number): string {
  const latStr = lat.toFixed(3);
  const lonStr = lon.toFixed(3);
  return `open-meteo:${latStr}:${lonStr}:${days}`;
}

/**
 * Retrieve a cached forecast from Redis.
 * Handles deserialization of both string and object returns from Upstash.
 * Returns null if not found or on error; errors are silently caught.
 */
export async function getCachedForecast(lat: number, lon: number, days: number): Promise<ForecastResponse | null> {
  const key = cacheKey(lat, lon, days);
  try {
    const redis = getRedis();
    const cached = await redis.get(key);

    if (!cached) {
      redisCacheStats.misses++;
      return null;
    }

    // Upstash Redis returns values as strings or objects depending on the client
    const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
    redisCacheStats.hits++;

    if (process.env.DEBUG_REDIS_CACHE === 'true') {
      console.log(`[redis-cache] Cache hit for ${key}`);
    }

    return parsed as ForecastResponse;
  } catch (err) {
    redisCacheStats.errors++;
    if (process.env.DEBUG_REDIS_CACHE === 'true') {
      console.error(`[redis-cache] Error reading ${key}:`, err);
    }
    // Fall through to dedup → API on error
    return null;
  }
}

/**
 * Store a forecast in Redis with the configured TTL.
 * Silently fails on error; caching is best-effort and must never block a response.
 */
export async function setCachedForecast(lat: number, lon: number, days: number, forecast: ForecastResponse): Promise<void> {
  const key = cacheKey(lat, lon, days);
  redisCacheStats.setsAttempted++;

  try {
    const redis = getRedis();
    const ttl = getCacheTTL();
    await redis.set(key, JSON.stringify(forecast), { ex: ttl });

    if (process.env.DEBUG_REDIS_CACHE === 'true') {
      console.log(`[redis-cache] Cached forecast for ${key} with TTL ${ttl}s`);
    }
  } catch (err) {
    redisCacheStats.setsFailed++;
    if (process.env.DEBUG_REDIS_CACHE === 'true') {
      console.error(`[redis-cache] Error writing ${key}:`, err);
    }
    // Best-effort: don't let cache failures break the response
  }
}

/**
 * Get Redis cache statistics.
 * Useful for monitoring cache effectiveness and debugging.
 */
export function getRedisCacheStats(): typeof redisCacheStats {
  return { ...redisCacheStats };
}

/**
 * Reset cache statistics.
 * Primarily for testing.
 */
export function resetRedisCacheStats(): void {
  redisCacheStats = {
    hits: 0,
    misses: 0,
    errors: 0,
    setsAttempted: 0,
    setsFailed: 0,
  };
}
