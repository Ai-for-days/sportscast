/**
 * Request batching for Open-Meteo API calls.
 *
 * This is Phase 1.3: combines multiple forecast requests into single API calls.
 * Sits between the Redis cache + in-memory dedup (Phases 1.1 & 1.2) and the API.
 *
 * When multiple requests arrive within a time window (30ms default), they are
 * combined into a single API call with multiple (lat, lon) tuples:
 *   GET /forecast?latitude=40.71,41.88&longitude=-74.01,-87.63&daily=...
 *
 * Each original request gets its matching response from the batch result.
 *
 * Expected impact (all three phases combined):
 * - Phase 1.1: 3-10x concurrent dedup
 * - Phase 1.2: 50-80% cross-request cache
 * - Phase 1.3: 5-10x batch reduction (50 requests → 5-10 API calls)
 * - **Total: ~10k API calls/day → ~50-100/day**
 */

import type { ForecastResponse } from './types';

/** Configuration from environment */
function getBatchWindowMs(): number {
  const ms = process.env.OPENMETEO_BATCH_WINDOW_MS || (import.meta.env?.OPENMETEO_BATCH_WINDOW_MS);
  return ms ? parseInt(ms, 10) : 30;
}

function getMaxBatchSize(): number {
  const size = process.env.OPENMETEO_MAX_BATCH_SIZE || (import.meta.env?.OPENMETEO_MAX_BATCH_SIZE);
  return size ? parseInt(size, 10) : 5;
}

/** A single request in the batch queue */
interface QueuedRequest {
  lat: number;
  lon: number;
  days: number;
  resolve: (forecast: ForecastResponse) => void;
  reject: (error: Error) => void;
}

/** Batching statistics */
interface BatchStats {
  totalRequests: number;
  totalBatches: number;
  totalApiCalls: number;
  requestsPerBatch: number[]; // Track batch sizes
  failedBatches: number;
}

let batchStats: BatchStats = {
  totalRequests: 0,
  totalBatches: 0,
  totalApiCalls: 0,
  requestsPerBatch: [],
  failedBatches: 0,
};

/** Current batch queue */
let batchQueue: QueuedRequest[] = [];

/** Timer for the current batch window */
let batchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Main entry point: queue a request for batching.
 * Returns a promise that resolves when the batch is processed.
 */
export async function batchOpenMeteoRequest(
  lat: number,
  lon: number,
  days: number,
  fetchFn: (latitudes: number[], longitudes: number[], daysList: number[]) => Promise<ForecastResponse[]>,
): Promise<ForecastResponse> {
  return new Promise((resolve, reject) => {
    batchStats.totalRequests++;

    const request: QueuedRequest = { lat, lon, days, resolve, reject };
    batchQueue.push(request);

    // If this is the first request, start a new batch window
    if (batchQueue.length === 1) {
      batchTimer = setTimeout(() => {
        processBatch(fetchFn).catch(() => {
          // Error handling is in processBatch
        });
      }, getBatchWindowMs());
    }

    // If we've hit the max batch size, process immediately
    if (batchQueue.length >= getMaxBatchSize()) {
      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = null;
      processBatch(fetchFn).catch(() => {
        // Error handling is in processBatch
      });
    }
  });
}

/**
 * Process the current batch: combine requests and call the API once.
 * Distributes results back to each original request.
 */
async function processBatch(
  fetchFn: (latitudes: number[], longitudes: number[], daysList: number[]) => Promise<ForecastResponse[]>,
): Promise<void> {
  if (batchQueue.length === 0) return;

  // Take a snapshot of the current queue and clear it for new requests
  const currentBatch = [...batchQueue];
  batchQueue = [];
  batchTimer = null;

  batchStats.totalBatches++;
  batchStats.requestsPerBatch.push(currentBatch.length);

  // Build arrays of unique (lat, lon, days) tuples
  // We'll track the mapping back to requests
  const requestsByKey = new Map<string, QueuedRequest[]>();

  for (const req of currentBatch) {
    const key = `${req.lat.toFixed(3)},${req.lon.toFixed(3)}:${req.days}`;
    if (!requestsByKey.has(key)) {
      requestsByKey.set(key, []);
    }
    requestsByKey.get(key)!.push(req);
  }

  const latitudes: number[] = [];
  const longitudes: number[] = [];
  const daysList: number[] = [];
  const keys: string[] = [];

  for (const [key, reqs] of requestsByKey) {
    const [latStr, rest] = key.split(',');
    const [lonStr, daysStr] = rest.split(':');
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    const days = parseInt(daysStr, 10);

    latitudes.push(lat);
    longitudes.push(lon);
    daysList.push(days);
    keys.push(key);
  }

  // Call the API once with all tuples
  try {
    batchStats.totalApiCalls++;
    const results = await fetchFn(latitudes, longitudes, daysList);

    if (process.env.DEBUG_BATCH === 'true') {
      console.log(
        `[open-meteo-batch] Processed batch: ${currentBatch.length} requests → ${keys.length} unique tuples → 1 API call`,
      );
    }

    // Distribute results back to requesting promises
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const forecast = results[i];
      const reqs = requestsByKey.get(key)!;

      for (const req of reqs) {
        req.resolve(forecast);
      }
    }
  } catch (error) {
    batchStats.failedBatches++;

    if (process.env.DEBUG_BATCH === 'true') {
      console.error('[open-meteo-batch] Batch failed:', error);
    }

    // Reject all requests in this batch
    for (const req of currentBatch) {
      req.reject(error instanceof Error ? error : new Error('Batch request failed'));
    }
  }
}

/**
 * Get current batching statistics.
 * Useful for monitoring and debugging.
 */
export function getBatchStats(): BatchStats {
  return {
    ...batchStats,
    requestsPerBatch: [...batchStats.requestsPerBatch],
  };
}

/**
 * Reset batching statistics.
 * Primarily for testing.
 */
export function resetBatchStats(): void {
  batchStats = {
    totalRequests: 0,
    totalBatches: 0,
    totalApiCalls: 0,
    requestsPerBatch: [],
    failedBatches: 0,
  };
}

/**
 * Get the current queue size.
 * Used for monitoring and debugging.
 */
export function getQueueSize(): number {
  return batchQueue.length;
}

/**
 * Clear the batch queue and cancel pending timer.
 * Primarily for testing. Requests will be rejected.
 */
export function clearBatchQueue(): void {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }

  // Reject all pending requests
  for (const req of batchQueue) {
    req.reject(new Error('Batch queue cleared'));
  }

  batchQueue = [];
}
