// ── Tests: Kalshi Market Data page works without credentials (WOW-015, K1c) ──
//
// After the Kalshi key was revoked and the KALSHI_* variables removed, the
// admin page still disabled Run test / Fetch climate markets / Fetch with form
// filters because the client required credentials. The server path is public
// and unauthenticated (K1), so the buttons must depend only on `busy`.
// No network: these are pure-function and source-scan tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fetchButtonsEnabled, KALSHI_PUBLIC_SOURCE_LABEL } from '../src/lib/kalshi-ui';
import { KALSHI_SERIES_DISCOVERY_MAX_PAGES, KALSHI_CLIMATE_MAX_PROBED_SERIES } from '../src/lib/kalshi-market-data';

const root = path.join(import.meta.dirname, '..');
const component = fs.readFileSync(path.join(root, 'src', 'components', 'admin', 'KalshiMarketDataCenter.tsx'), 'utf8');
const marketData = fs.readFileSync(path.join(root, 'src', 'lib', 'kalshi-market-data.ts'), 'utf8');

test('k1c-1: buttons are enabled with no credentials configured', () => {
  assert.equal(fetchButtonsEnabled({ apiKeyIdConfigured: false, privateKeyPresent: false }, null), true);
  assert.equal(fetchButtonsEnabled(null, null), true);
  assert.equal(fetchButtonsEnabled(undefined, undefined), true);
});

test('k1c-2: buttons are disabled only while an action is in flight', () => {
  assert.equal(fetchButtonsEnabled({ apiKeyIdConfigured: false, privateKeyPresent: false }, 'fetch-climate'), false);
  assert.equal(fetchButtonsEnabled({ apiKeyIdConfigured: true, privateKeyPresent: true }, 'test'), false);
  assert.equal(fetchButtonsEnabled({ apiKeyIdConfigured: true, privateKeyPresent: true }, null), true);
});

test('k1c-3: the component no longer gates on or asks for credentials', () => {
  assert.ok(!component.includes('credsReady'), 'credsReady must be gone');
  assert.ok(!component.includes('KALSHI_API_KEY_ID'), 'no KALSHI_API_KEY_ID text');
  assert.ok(!component.includes('KALSHI_PRIVATE_KEY_BASE64'), 'no KALSHI_PRIVATE_KEY_BASE64 text');
  assert.ok(!component.includes('Credentials are not configured'), 'no credentials banner');
  assert.ok(!/apiKeyIdConfigured\s*&&/.test(component), 'no credential condition on buttons');
  assert.equal((component.match(/disabled=\{!buttonsEnabled\}/g) ?? []).length, 3, 'all three buttons gated only on buttonsEnabled');
});

test('k1c-4: page shows the public source, not a demo/live environment', () => {
  assert.ok(component.includes('PUBLIC · READ-ONLY'));
  assert.ok(component.includes('KALSHI_PUBLIC_SOURCE_LABEL'));
  assert.equal(KALSHI_PUBLIC_SOURCE_LABEL, 'public (external-api.kalshi.com)');
  assert.ok(component.includes('Public market data from Kalshi. No account or key is used.'));
  assert.ok(!component.includes('configured environment'));
  assert.ok(!component.includes('config.env.toUpperCase()'));
});

test('k1c-5: one climate click has a fixed request bound', () => {
  assert.ok(KALSHI_SERIES_DISCOVERY_MAX_PAGES <= 5);
  assert.ok(KALSHI_CLIMATE_MAX_PROBED_SERIES <= 150);
  assert.ok(/page < KALSHI_SERIES_DISCOVERY_MAX_PAGES/.test(marketData), 'series discovery loop uses the cap');
  assert.ok(/slice\(0, KALSHI_CLIMATE_MAX_PROBED_SERIES\)/.test(marketData), 'probe list is capped');
});
