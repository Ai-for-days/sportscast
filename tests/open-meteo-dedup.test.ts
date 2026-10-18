import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  dedupOpenMeteoRequest,
  getDedupStats,
  resetDedupStats,
  getCacheSize,
  clearDedupCache,
} from '../src/lib/open-meteo-dedup-cache';

test('open-meteo-dedup-cache', async (t) => {
  // Reset state before tests
  resetDedupStats();
  clearDedupCache();

  await t.test('deduplicates concurrent identical requests', async () => {
    let callCount = 0;
    const factory = async () => {
      callCount++;
      // Simulate a slow API call
      await new Promise(resolve => setTimeout(resolve, 10));
      return { id: 'forecast-1' } as any;
    };

    const lat = 40.7128;
    const lon = -74.0060;
    const days = 15;

    // Launch multiple concurrent requests
    const promises = [
      dedupOpenMeteoRequest(lat, lon, days, factory),
      dedupOpenMeteoRequest(lat, lon, days, factory),
      dedupOpenMeteoRequest(lat, lon, days, factory),
    ];

    const results = await Promise.all(promises);

    // All three should return the same result
    assert.equal(results.length, 3);
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[1], results[2]);

    // But the factory should have been called only once
    assert.equal(callCount, 1, 'Factory should be called only once for identical requests');

    // Stats should reflect deduplication
    const stats = getDedupStats();
    assert.equal(stats.totalRequests, 3, 'Should count all 3 requests');
    assert.equal(stats.dedupedRequests, 2, 'Should count 2 as deduped');
  });

  await t.test('cleanup completed requests from cache', async () => {
    resetDedupStats();
    clearDedupCache();

    const factory = async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return { id: 'forecast-2' } as any;
    };

    const lat = 40.7128;
    const lon = -74.0060;
    const days = 15;

    // First request
    assert.equal(getCacheSize(), 0, 'Cache should start empty');
    const p1 = dedupOpenMeteoRequest(lat, lon, days, factory);
    assert.equal(getCacheSize(), 1, 'Cache should have 1 entry after request');

    // Wait for completion
    await p1;

    // Cache should auto-cleanup
    assert.equal(getCacheSize(), 0, 'Cache should be cleaned up after request completes');
  });

  await t.test('handles different locations separately', async () => {
    resetDedupStats();
    clearDedupCache();

    let callCount = 0;
    const factory = async () => {
      callCount++;
      return { id: `forecast-${callCount}` } as any;
    };

    // Same days, different locations
    const p1 = dedupOpenMeteoRequest(40.7128, -74.0060, 15, factory);
    const p2 = dedupOpenMeteoRequest(34.0522, -118.2437, 15, factory);

    const [r1, r2] = await Promise.all([p1, p2]);

    // Each location gets its own API call
    assert.equal(callCount, 2, 'Different locations should make separate calls');
    assert.notDeepEqual(r1, r2, 'Different locations should get different results');
  });

  await t.test('handles different days separately', async () => {
    resetDedupStats();
    clearDedupCache();

    let callCount = 0;
    const factory = async () => {
      callCount++;
      return { id: `forecast-${callCount}` } as any;
    };

    const lat = 40.7128;
    const lon = -74.0060;

    // Same location, different day horizons
    const p1 = dedupOpenMeteoRequest(lat, lon, 7, factory);
    const p2 = dedupOpenMeteoRequest(lat, lon, 15, factory);

    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal(callCount, 2, 'Different day horizons should make separate calls');
    assert.notDeepEqual(r1, r2, 'Different days should get different results');
  });

  await t.test('treats rounded coordinates equally', async () => {
    resetDedupStats();
    clearDedupCache();

    let callCount = 0;
    const factory = async () => {
      callCount++;
      return { id: 'forecast-same-location' } as any;
    };

    // Coordinates within 100m precision (3 decimal places)
    const lat1 = 40.71280;
    const lon1 = -74.00600;
    const lat2 = 40.71284; // ~0.4m different
    const lon2 = -74.00604; // ~0.4m different

    const [r1, r2] = await Promise.all([
      dedupOpenMeteoRequest(lat1, lon1, 15, factory),
      dedupOpenMeteoRequest(lat2, lon2, 15, factory),
    ]);

    // Should share the same factory call due to rounding to 3 decimal places
    assert.equal(callCount, 1, 'Nearby coordinates (within 100m) should share cache');
    assert.deepEqual(r1, r2, 'Should return same result for rounded coordinates');
  });

  await t.test('allows new requests after first completes', async () => {
    resetDedupStats();
    clearDedupCache();

    let callCount = 0;
    const factory = async () => {
      callCount++;
      return { id: `forecast-${callCount}` } as any;
    };

    const lat = 40.7128;
    const lon = -74.0060;
    const days = 15;

    // First batch
    const r1 = await dedupOpenMeteoRequest(lat, lon, days, factory);
    assert.equal(callCount, 1);

    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(getCacheSize(), 0);

    // Second batch - should create a new cache entry
    const r2 = await dedupOpenMeteoRequest(lat, lon, days, factory);
    assert.equal(callCount, 2, 'After first completes, new request should trigger new call');
    assert.notDeepEqual(r1, r2, 'Should get different result on second fetch');
  });

  await t.test('stats accumulate correctly', async () => {
    resetDedupStats();
    clearDedupCache();

    const factory = async () => {
      return { id: 'test' } as any;
    };

    // Batch 1: 3 concurrent identical requests
    await Promise.all([
      dedupOpenMeteoRequest(40.7128, -74.0060, 15, factory),
      dedupOpenMeteoRequest(40.7128, -74.0060, 15, factory),
      dedupOpenMeteoRequest(40.7128, -74.0060, 15, factory),
    ]);

    let stats = getDedupStats();
    assert.equal(stats.totalRequests, 3);
    assert.equal(stats.dedupedRequests, 2);

    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 15));

    // Batch 2: 2 different requests
    await Promise.all([
      dedupOpenMeteoRequest(40.7128, -74.0060, 7, factory),
      dedupOpenMeteoRequest(34.0522, -118.2437, 15, factory),
    ]);

    stats = getDedupStats();
    assert.equal(stats.totalRequests, 5);
    assert.equal(stats.dedupedRequests, 2, 'Still only 2 deduped from first batch');
  });
});
