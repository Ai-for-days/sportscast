import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { ForecastResponse } from '../src/lib/types';
import {
  cacheKey,
  getRedisCacheStats,
  resetRedisCacheStats,
} from '../src/lib/redis-cache-utils';

/**
 * Create a mock forecast response
 */
function mockForecast(id: string): ForecastResponse {
  return {
    location: {
      lat: 40.7128,
      lon: -74.0060,
      name: 'New York',
      displayName: 'New York, NY',
      state: 'NY',
      country: 'US',
      zip: '10001',
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
    _testId: id, // For testing
  } as any;
}

test('redis-cache-utils', async (t) => {
  await t.test('cacheKey formats coordinates correctly', () => {
    const key = cacheKey(40.7128, -74.0060, 15);
    assert.equal(key, 'open-meteo:40.713:-74.006:15');

    // Test rounding to 3 decimal places
    const key2 = cacheKey(40.71284, -74.00604, 7);
    assert.equal(key2, 'open-meteo:40.713:-74.006:7');
  });

  await t.test('different coordinates generate different keys', () => {
    const key1 = cacheKey(40.7128, -74.0060, 15);
    const key2 = cacheKey(34.0522, -118.2437, 15);
    assert.notEqual(key1, key2);
  });

  await t.test('different days generate different keys', () => {
    const key1 = cacheKey(40.7128, -74.0060, 7);
    const key2 = cacheKey(40.7128, -74.0060, 15);
    assert.notEqual(key1, key2);
  });

  await t.test('coordinates with ~100m variance use same cache key', () => {
    const lat1 = 40.71280;
    const lon1 = -74.00600;
    const lat2 = 40.71284; // ~0.4m different
    const lon2 = -74.00604; // ~0.4m different

    const key1 = cacheKey(lat1, lon1, 15);
    const key2 = cacheKey(lat2, lon2, 15);

    assert.equal(key1, key2, 'Nearby coordinates should round to same key');
  });

  await t.test('resetRedisCacheStats clears statistics', () => {
    resetRedisCacheStats();
    let stats = getRedisCacheStats();
    assert.equal(stats.hits, 0);
    assert.equal(stats.misses, 0);
    assert.equal(stats.setsAttempted, 0);
    assert.equal(stats.setsFailed, 0);
  });

  await t.test('getRedisCacheStats returns current state', () => {
    resetRedisCacheStats();
    const stats1 = getRedisCacheStats();
    const stats2 = getRedisCacheStats();
    // Stats should be independent objects
    assert.notEqual(stats1, stats2);
    assert.deepEqual(stats1, stats2);
  });

  await t.test('negative coordinates work correctly', () => {
    const key1 = cacheKey(40.7128, -74.0060, 15);
    const key2 = cacheKey(-33.8688, 151.2093, 15); // Sydney

    assert.notEqual(key1, key2);
    assert.match(key1, /open-meteo:40\.713:-74\.006:15/);
    assert.match(key2, /open-meteo:-33\.869:151\.209:15/);
  });

  await t.test('key format is consistent and parseable', () => {
    const key = cacheKey(40.7128, -74.0060, 15);
    const parts = key.split(':');
    assert.equal(parts.length, 4);
    assert.equal(parts[0], 'open-meteo');
    // lat, lon, days should be present
    assert.match(parts[1], /^-?\d+\.\d{3}$/);
    assert.match(parts[2], /^-?\d+\.\d{3}$/);
    assert.equal(parts[3], '15');
  });

  await t.test('zero coordinates produce valid keys', () => {
    const key = cacheKey(0, 0, 15);
    assert.equal(key, 'open-meteo:0.000:0.000:15');
  });

  await t.test('single-digit days work correctly', () => {
    const key1 = cacheKey(40.7128, -74.0060, 1);
    const key2 = cacheKey(40.7128, -74.0060, 7);
    const key3 = cacheKey(40.7128, -74.0060, 15);

    assert.notEqual(key1, key2);
    assert.notEqual(key2, key3);
    assert.match(key1, /:1$/);
    assert.match(key2, /:7$/);
    assert.match(key3, /:15$/);
  });

  await t.test('large day values work correctly', () => {
    const key1 = cacheKey(40.7128, -74.0060, 90);
    const key2 = cacheKey(40.7128, -74.0060, 365);

    assert.notEqual(key1, key2);
    assert.match(key1, /:90$/);
    assert.match(key2, /:365$/);
  });
});
