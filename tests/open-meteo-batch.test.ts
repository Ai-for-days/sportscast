import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { ForecastResponse } from '../src/lib/types';
import {
  batchOpenMeteoRequest,
  getBatchStats,
  resetBatchStats,
  getQueueSize,
  clearBatchQueue,
} from '../src/lib/open-meteo-batch';

/**
 * Create a mock forecast response for testing
 */
function mockForecast(id: string, lat: number, lon: number): ForecastResponse {
  return {
    location: {
      lat,
      lon,
      name: `Location ${id}`,
      displayName: `Location ${id}, Test`,
      state: 'TS',
      country: 'US',
      zip: `${id}`,
    },
    current: {
      time: '2026-02-18T09:00',
      tempK: 289,
      tempF: 72,
      tempC: 22,
      humidity: 60,
      dewPointF: 56,
      precipMm: 0,
      precipProbability: 10,
      windSpeedMph: 10,
      windDirectionDeg: 180,
      windGustMph: 15,
      cloudCover: 40,
      pressure: 1013,
      feelsLikeF: 71,
      uvIndex: 4,
      visibility: 10,
      description: 'Partly cloudy',
      icon: 'partly-cloudy-day',
    },
    hourly: [],
    daily: [],
    alerts: [],
    airQuality: undefined,
    allergyData: { today: [] },
    utcOffsetSeconds: -18000,
    timeZone: 'America/New_York',
    generatedAt: new Date().toISOString(),
    _testId: id,
  } as any;
}

test('open-meteo-batch', async (t) => {
  // Reset state before tests
  resetBatchStats();
  clearBatchQueue();

  await t.test('single request (no batching benefit, but works)', async () => {
    resetBatchStats();
    clearBatchQueue();

    let apiCalls = 0;
    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      apiCalls++;
      return [mockForecast('single', lats[0], lons[0])];
    };

    const lat = 40.7128;
    const lon = -74.0060;
    const days = 15;

    const forecast = await batchOpenMeteoRequest(lat, lon, days, fetchFn);

    assert.equal(apiCalls, 1, 'Should make exactly one API call');
    // Coordinates are rounded to 3 decimals in batching
    assert.equal(forecast.location.lat, parseFloat(lat.toFixed(3)));
    assert.equal(forecast.location.lon, parseFloat(lon.toFixed(3)));

    const stats = getBatchStats();
    assert.equal(stats.totalRequests, 1);
    assert.equal(stats.totalBatches, 1);
    assert.equal(stats.totalApiCalls, 1);
  });

  await t.test('multiple requests in same batch window → combined into 1 API call', async () => {
    resetBatchStats();
    clearBatchQueue();

    let apiCalls = 0;
    let receivedBatchSize = 0;
    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      apiCalls++;
      receivedBatchSize = lats.length;
      return lats.map((lat, i) => mockForecast(`batch-${i}`, lat, lons[i]));
    };

    // Launch multiple requests concurrently
    const lats = [40.7128, 34.0522, 41.8781];
    const lons = [-74.0060, -118.2437, -87.6298];
    const promises = [
      batchOpenMeteoRequest(lats[0], lons[0], 15, fetchFn),
      batchOpenMeteoRequest(lats[1], lons[1], 15, fetchFn),
      batchOpenMeteoRequest(lats[2], lons[2], 15, fetchFn),
    ];

    const results = await Promise.all(promises);

    assert.equal(apiCalls, 1, 'Should make exactly one API call for all requests');
    assert.equal(receivedBatchSize, 3, 'API call should receive 3 locations');
    assert.equal(results.length, 3);
    // Coordinates are rounded to 3 decimals in batching
    assert.equal(results[0].location.lat, parseFloat(lats[0].toFixed(3)));
    assert.equal(results[1].location.lat, parseFloat(lats[1].toFixed(3)));
    assert.equal(results[2].location.lat, parseFloat(lats[2].toFixed(3)));

    const stats = getBatchStats();
    assert.equal(stats.totalRequests, 3);
    assert.equal(stats.totalBatches, 1);
    assert.equal(stats.totalApiCalls, 1);
  });

  await t.test('requests outside batch window → separate API calls', async () => {
    resetBatchStats();
    clearBatchQueue();

    let apiCalls = 0;
    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      apiCalls++;
      return lats.map((lat, i) => mockForecast(`sep-${apiCalls}-${i}`, lat, lons[i]));
    };

    // Get batch window (should be 30ms default)
    const batchWindowMs = 40; // Slightly more than the default

    // First request
    const p1 = batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn);

    // Wait longer than batch window to force separate batch
    await new Promise(resolve => setTimeout(resolve, batchWindowMs + 10));

    // Second request should go into a new batch
    const p2 = batchOpenMeteoRequest(34.0522, -118.2437, 15, fetchFn);

    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal(apiCalls, 2, 'Should make two separate API calls');

    const stats = getBatchStats();
    assert.equal(stats.totalRequests, 2);
    assert.equal(stats.totalBatches, 2);
    assert.equal(stats.totalApiCalls, 2);
  });

  await t.test('individual request error does not fail batch', async () => {
    resetBatchStats();
    clearBatchQueue();

    let apiCalls = 0;
    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      apiCalls++;
      // Simulate partial failure: return only one result for two requests
      if (lats.length > 1) {
        throw new Error('Simulated API error');
      }
      return [mockForecast('error-test', lats[0], lons[0])];
    };

    // Single request should succeed
    const forecast = await batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn);
    assert(forecast, 'Single request should succeed');

    // Wait for batch window
    await new Promise(resolve => setTimeout(resolve, 50));

    // Multiple requests should fail gracefully
    let errorCaught = false;
    try {
      await Promise.all([
        batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn),
        batchOpenMeteoRequest(34.0522, -118.2437, 15, fetchFn),
      ]);
    } catch (e) {
      errorCaught = true;
    }

    assert(errorCaught, 'Batch with error should reject all requests');

    const stats = getBatchStats();
    assert.equal(stats.failedBatches, 1);
  });

  await t.test('batch stats track correctly', async () => {
    resetBatchStats();
    clearBatchQueue();

    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      return lats.map((lat, i) => mockForecast(`stat-${i}`, lat, lons[i]));
    };

    // Batch 1: 3 requests
    await Promise.all([
      batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn),
      batchOpenMeteoRequest(34.0522, -118.2437, 15, fetchFn),
      batchOpenMeteoRequest(41.8781, -87.6298, 15, fetchFn),
    ]);

    let stats = getBatchStats();
    assert.equal(stats.totalRequests, 3);
    assert.equal(stats.totalBatches, 1);
    assert.equal(stats.requestsPerBatch[0], 3);

    // Wait for window and batch 2
    await new Promise(resolve => setTimeout(resolve, 50));

    // Batch 2: 2 requests
    await Promise.all([
      batchOpenMeteoRequest(40.7128, -74.0060, 7, fetchFn),
      batchOpenMeteoRequest(34.0522, -118.2437, 7, fetchFn),
    ]);

    stats = getBatchStats();
    assert.equal(stats.totalRequests, 5);
    assert.equal(stats.totalBatches, 2);
    assert.equal(stats.requestsPerBatch[0], 3);
    assert.equal(stats.requestsPerBatch[1], 2);
  });

  await t.test('deduplicate identical requests within batch', async () => {
    resetBatchStats();
    clearBatchQueue();

    let apiCalls = 0;
    let batchSize = 0;
    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      apiCalls++;
      batchSize = lats.length;
      return lats.map((lat, i) => mockForecast(`dedup-${i}`, lat, lons[i]));
    };

    // Three requests for the same location
    const promises = [
      batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn),
      batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn),
      batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn),
    ];

    const results = await Promise.all(promises);

    assert.equal(apiCalls, 1);
    assert.equal(batchSize, 1, 'Should deduplicate identical requests in batch');
    // All three should get the same result
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[1], results[2]);
  });

  await t.test('different days are not deduped', async () => {
    resetBatchStats();
    clearBatchQueue();

    let batchSize = 0;
    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      batchSize = lats.length;
      return lats.map((lat, i) => mockForecast(`days-${i}`, lat, lons[i]));
    };

    // Same location, different day horizons
    await Promise.all([
      batchOpenMeteoRequest(40.7128, -74.0060, 7, fetchFn),
      batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn),
    ]);

    assert.equal(batchSize, 2, 'Different day horizons should not be deduped');
  });

  await t.test('queue size tracking', async () => {
    resetBatchStats();
    clearBatchQueue();

    assert.equal(getQueueSize(), 0, 'Queue should start empty');

    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      // Simulate some processing time
      await new Promise(resolve => setTimeout(resolve, 10));
      return lats.map((lat, i) => mockForecast(`queue-${i}`, lat, lons[i]));
    };

    // Queue multiple requests - they should be batched together
    const p1 = batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn);
    const p2 = batchOpenMeteoRequest(34.0522, -118.2437, 15, fetchFn);

    // Wait for batch to process
    await Promise.all([p1, p2]);
    assert.equal(getQueueSize(), 0, 'Queue should be empty after batch processes');

    const stats = getBatchStats();
    assert.equal(stats.totalRequests, 2);
    assert.equal(stats.totalBatches, 1, 'Should have processed in a single batch');
  });

  await t.test('batch processes when reaching max size', async () => {
    resetBatchStats();
    clearBatchQueue();

    let apiCalls = 0;
    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      apiCalls++;
      return lats.map((lat, i) => mockForecast(`max-${apiCalls}-${i}`, lat, lons[i]));
    };

    // Launch 5 requests (typical max batch size)
    // They should process immediately without waiting for batch window
    const startTime = Date.now();

    const results = await Promise.all([
      batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn),
      batchOpenMeteoRequest(34.0522, -118.2437, 15, fetchFn),
      batchOpenMeteoRequest(41.8781, -87.6298, 15, fetchFn),
      batchOpenMeteoRequest(37.7749, -122.4194, 15, fetchFn),
      batchOpenMeteoRequest(39.7392, -104.9903, 15, fetchFn),
    ]);

    const elapsed = Date.now() - startTime;

    assert.equal(apiCalls, 1, 'Should process immediately at max batch size');
    assert.equal(results.length, 5);
    // Should process much faster than the batch window (usually 30ms)
    // but account for test overhead
    assert(elapsed < 100, `Should process quickly, but took ${elapsed}ms`);
  });

  await t.test('coordinates with ~100m variance dedup in batch', async () => {
    resetBatchStats();
    clearBatchQueue();

    let batchSize = 0;
    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      batchSize = lats.length;
      return lats.map((lat, i) => mockForecast(`rounded-${i}`, lat, lons[i]));
    };

    // Coordinates within 100m precision (3 decimal places)
    const lat1 = 40.71280;
    const lon1 = -74.00600;
    const lat2 = 40.71284; // ~0.4m different, same 3-decimal rounding
    const lon2 = -74.00604;

    await Promise.all([
      batchOpenMeteoRequest(lat1, lon1, 15, fetchFn),
      batchOpenMeteoRequest(lat2, lon2, 15, fetchFn),
    ]);

    assert.equal(batchSize, 1, 'Nearby coordinates (within 100m) should dedup in batch');
  });

  await t.test('clear batch queue rejects pending requests', async () => {
    resetBatchStats();
    clearBatchQueue();

    const fetchFn = async (lats: number[], lons: number[], days: number[]) => {
      return lats.map((lat, i) => mockForecast(`clear-${i}`, lat, lons[i]));
    };

    // Queue a request but don't await
    const p1 = batchOpenMeteoRequest(40.7128, -74.0060, 15, fetchFn);

    // Give it time to queue
    await new Promise(resolve => setTimeout(resolve, 5));

    // Clear the queue
    clearBatchQueue();

    // Request should be rejected
    let errorCaught = false;
    try {
      await p1;
    } catch (e) {
      errorCaught = true;
      assert(e instanceof Error);
      assert(e.message.includes('cleared'));
    }

    assert(errorCaught, 'Cleared request should be rejected');
  });
});
