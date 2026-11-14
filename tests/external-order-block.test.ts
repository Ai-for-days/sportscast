// ── Tests: no order ever leaves this site for Kalshi (WOW-005 Slice 1-S) ──
//
// WagerOnWeather is practice only. submitLiveOrder / submitDemoOrder must
// refuse as their first statement, and the Kalshi fetch helpers must refuse
// any method other than GET and DELETE before reading credentials.
//
// How "zero Redis writes" and "no config read" are shown: this test runs under
// tsx with no Vite env, so any Redis access (getRedis, logAuditEvent,
// saveLiveOrder, getExecutionConfig) throws "Missing KV_REST_API_URL" or a
// TypeError on import.meta.env. A submit call that RESOLVES with the refusal
// therefore touched none of them, whatever the live config would have said.
// Network is shown directly with a spy on every fetch path.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  submitLiveOrder,
  submitDemoOrder,
  kalshiLiveFetch,
  kalshiDemoFetch,
  kalshiFetchDeps,
  EXTERNAL_ORDER_SUBMISSION_DISABLED,
  EXTERNAL_ORDER_REFUSAL,
  KALSHI_ACCOUNT_DISABLED,
} from '../src/lib/kalshi-execution';
import type { ExecutionCandidate } from '../src/lib/order-builder';

// An approved candidate, as the live path would receive after every gate
// (mode live, liveTradingEnabled, approval, dry run) had passed.
const candidate = {
  id: 'cand-1',
  ticker: 'kalshi-HIGHNY-26NOV15-B60',
  title: 'NYC high above 60F',
  side: 'yes',
  status: 'approved',
  recommendedStakeCents: 500,
  dryRunOrder: { price: 40 },
} as unknown as ExecutionCandidate;

function spyNetwork() {
  const saved = { ...kalshiFetchDeps };
  const savedGlobal = globalThis.fetch;
  const calls: { via: string; url: string; method?: string }[] = [];
  let credReads = 0;
  Object.assign(kalshiFetchDeps, {
    getCredentials: () => { credReads++; return { keyId: 'test-key-id', privateKey: 'test-key' }; },
    signRequest: async () => 'test-signature',
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ via: 'kalshiFetchDeps', url, method: init?.method });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    calls.push({ via: 'globalThis', url: String(input), method: init?.method });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return {
    calls,
    credReads: () => credReads,
    restore: () => { Object.assign(kalshiFetchDeps, saved); globalThis.fetch = savedGlobal; },
  };
}

test('the block is hard-coded on', () => {
  assert.equal(EXTERNAL_ORDER_SUBMISSION_DISABLED, true);
});

test('s1: submitLiveOrder refuses with zero network calls, zero credential reads and no Redis access', async () => {
  const s = spyNetwork();
  try {
    const order = await submitLiveOrder(candidate);
    assert.equal(order.status, 'failed');
    assert.equal(order.errorMessage, EXTERNAL_ORDER_REFUSAL);
    assert.equal(order.mode, 'live');
    assert.equal(order.quantity, 0);
    assert.deepEqual(s.calls, []);
    assert.equal(s.credReads(), 0);
  } finally { s.restore(); }
});

test('s2: submitDemoOrder refuses with zero network calls, zero credential reads and no Redis access', async () => {
  const s = spyNetwork();
  try {
    const order = await submitDemoOrder(candidate);
    assert.equal(order.status, 'failed');
    assert.equal(order.errorMessage, EXTERNAL_ORDER_REFUSAL);
    assert.equal(order.mode, 'demo');
    assert.deepEqual(s.calls, []);
    assert.equal(s.credReads(), 0);
  } finally { s.restore(); }
});

test('s3: a POST (or PUT/PATCH) through either helper makes zero fetch calls and reads no credentials', async () => {
  const s = spyNetwork();
  try {
    for (const helper of [kalshiLiveFetch, kalshiDemoFetch]) {
      for (const method of ['POST', 'post', 'PUT', 'PATCH']) {
        const r = await helper(method, '/portfolio/orders', { count: 1 });
        assert.equal(r.ok, false);
        // Since WOW-011 the account-disabled choke point answers first; the
        // WOW-005 method guard behind it would give EXTERNAL_ORDER_REFUSAL.
        assert.ok([EXTERNAL_ORDER_REFUSAL, KALSHI_ACCOUNT_DISABLED.message].includes(r.data?.error), String(r.data?.error));
      }
    }
    assert.deepEqual(s.calls, []);
    assert.equal(s.credReads(), 0);
  } finally { s.restore(); }
});

test('s4 (changed by WOW-011): GET and DELETE are now refused too; no Kalshi account call reaches fetch', async () => {
  const s = spyNetwork();
  try {
    for (const [helper, method] of [[kalshiLiveFetch, 'GET'], [kalshiLiveFetch, 'DELETE'], [kalshiDemoFetch, 'GET'], [kalshiDemoFetch, 'DELETE']] as const) {
      const r = await helper(method, '/portfolio/orders/abc');
      assert.equal(r.ok, false);
      assert.equal(r.data?.code, 'KALSHI_ACCOUNT_DISABLED');
    }
    assert.deepEqual(s.calls, []);
    assert.equal(s.credReads(), 0);
  } finally { s.restore(); }
});
