import test from 'node:test';
import assert from 'node:assert/strict';

import { geocodePostalCode } from '../src/lib/slug-utils';

// Step 188 (follow-up) — the local ZIP dataset is now the sole authority
// for US postal codes. Nominatim previously fuzzy-matched nonsense
// 5-digit numbers (99999, 88888) to a real-world place, handing out live
// HTTP 200s for fake ZIP-shaped URLs. These tests pin: a known ZIP
// resolves from local data, an unknown ZIP-shaped value resolves to null
// WITHOUT ever calling fetch (i.e. without ever reaching Nominatim), and
// non-US codes are unaffected (no local dataset exists for those).

test('a known US ZIP resolves from the local dataset', async () => {
  const result = await geocodePostalCode('45221', 'us');
  assert.ok(result);
  assert.equal(result.city, 'Cincinnati');
  assert.equal(result.zip, '45221');
  assert.equal(result.countryCode, 'us');
});

test('an unknown US ZIP-shaped value resolves to null, not a fuzzy match', async () => {
  for (const fakeZip of ['99999', '88888', '00001', '55555']) {
    const result = await geocodePostalCode(fakeZip, 'us');
    assert.equal(result, null, `${fakeZip} is not in the dataset and must resolve to null`);
  }
});

test('an unknown US ZIP never calls fetch (no Nominatim fallback)', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (...args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    return originalFetch(...args);
  };
  try {
    const result = await geocodePostalCode('99999', 'us');
    assert.equal(result, null);
    assert.equal(fetchCalls, 0, 'geocodePostalCode must not call fetch for a US ZIP miss — that would be the Nominatim fallback');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a known US ZIP also never calls fetch (local lookup short-circuits entirely)', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (...args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    return originalFetch(...args);
  };
  try {
    const result = await geocodePostalCode('45221', 'us');
    assert.ok(result);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('non-US postal codes are unaffected — no local dataset exists for them, so Nominatim is still attempted', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    // Don't actually hit the network in the unit test — short-circuit with an empty result.
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  }) as typeof fetch;
  try {
    await geocodePostalCode('M5V 3L9', 'ca');
    assert.equal(fetchCalls, 1, 'non-US codes have no local dataset and must still try Nominatim');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
