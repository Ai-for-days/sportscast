// ── Tests: Kalshi market data is public and credential-free (WOW-011, K1) ──
//
// Written from the WOW-011 spec before the code. Fixtures are the two
// unauthenticated public GET bodies captured under WOW-011 1(b)
// (tests/fixtures/kalshi-public-markets.json, kalshi-public-orderbook.json).
// No network: globalThis.fetch and kalshiFetchDeps are stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listMarkets, getMarket, getOrderbook, listSeries, kalshiPublicGet, KALSHI_PUBLIC_BASE } from '../src/lib/kalshi-client';
import { testKalshiConnectivity } from '../src/lib/kalshi-market-data';
import { fetchKalshiWeatherMarkets } from '../src/lib/kalshi';
import { kalshiLiveFetch, kalshiDemoFetch, kalshiFetchDeps, KALSHI_ACCOUNT_DISABLED } from '../src/lib/kalshi-execution';

const marketsFixture = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'kalshi-public-markets.json'), 'utf8');
const orderbookFixture = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'kalshi-public-orderbook.json'), 'utf8');

const KALSHI_VARS = ['KALSHI_API_KEY_ID', 'KALSHI_PRIVATE_KEY', 'KALSHI_PRIVATE_KEY_BASE64', 'KALSHI_ENV', 'KALSHI_MODE', 'KALSHI_READ_ONLY', 'KALSHI_API_KEY'];

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of KALSHI_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  return fn().finally(() => {
    for (const k of KALSHI_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
}

const DUMMY = {
  KALSHI_API_KEY_ID: 'dummy-key-id-for-tests',
  KALSHI_PRIVATE_KEY_BASE64: Buffer.from('not-a-real-key').toString('base64'),
  KALSHI_PRIVATE_KEY: 'not-a-real-key',
  KALSHI_ENV: 'demo',
  KALSHI_MODE: 'disabled',
  KALSHI_READ_ONLY: 'false',
};

interface Call { url: string; method: string; headers: Record<string, string> }
function spyFetch(respond: (url: string) => Response) {
  const saved = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const h: Record<string, string> = {};
    const raw = init?.headers ?? {};
    if (raw instanceof Headers) raw.forEach((v, k) => { h[k] = v; });
    else for (const [k, v] of Object.entries(raw as Record<string, string>)) h[k] = String(v);
    calls.push({ url: String(input), method: init?.method ?? 'GET', headers: h });
    return respond(String(input));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = saved; } };
}

const fixtureResponder = (url: string) => {
  if (/\/orderbook(\?|$)/.test(url)) return new Response(orderbookFixture, { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (/\/series(\?|$)/.test(url)) return new Response(JSON.stringify({ series: [{ ticker: 'KXHIGHNY' }] }), { status: 200 });
  if (/\/markets\/[^/?]+(\?|$)/.test(url)) {
    const first = JSON.parse(marketsFixture).markets[0];
    return new Response(JSON.stringify({ market: first }), { status: 200 });
  }
  return new Response(marketsFixture, { status: 200, headers: { 'Content-Type': 'application/json' } });
};

function assertPublic(c: Call) {
  assert.equal(c.method, 'GET');
  assert.ok(c.url.startsWith('https://external-api.kalshi.com/trade-api/v2/'), `host: ${c.url}`);
  for (const k of Object.keys(c.headers)) assert.ok(!/^kalshi-access-/i.test(k), `auth header sent: ${k}`);
}

// ── t1 ─────────────────────────────────────────────────────────────────────
test('t1: the public GET goes to external-api.kalshi.com with method GET and no KALSHI-ACCESS-* header, with and without credentials', async () => {
  assert.equal(KALSHI_PUBLIC_BASE, 'https://external-api.kalshi.com/trade-api/v2');
  for (const vars of [DUMMY, {}]) {
    await withEnv(vars, async () => {
      const s = spyFetch(fixtureResponder);
      try {
        const r = await listMarkets({ series_ticker: 'KXHIGHNY', status: 'open', limit: 3 });
        assert.equal(r.ok, true);
        assert.equal(s.calls.length, 1);
        assertPublic(s.calls[0]);
        assert.ok(s.calls[0].url.includes('/markets?'), s.calls[0].url);
      } finally { s.restore(); }
    });
  }
});

// ── t2 ─────────────────────────────────────────────────────────────────────
test('t2: with every KALSHI_* var unset, each market-data function issues its fetch and parses the fixture', async () => {
  await withEnv({}, async () => {
    const s = spyFetch(fixtureResponder);
    try {
      const lm = await listMarkets({ series_ticker: 'KXHIGHNY', status: 'open', limit: 3 });
      assert.equal(lm.ok, true);
      assert.equal(lm.data?.markets.length, 3);
      assert.equal(lm.data?.markets[0].ticker, 'KXHIGHNY-26NOV14-T53');

      const gm = await getMarket('KXHIGHNY-26NOV14-T53');
      assert.equal(gm.ok, true);
      assert.equal(gm.data?.market.ticker, 'KXHIGHNY-26NOV14-T53');

      const ob = await getOrderbook('KXHIGHNY-26NOV14-T53');
      assert.equal(ob.ok, true);
      assert.ok((ob.data as any)?.orderbook_fp, 'orderbook_fp present in the public response');

      const ls = await listSeries({ limit: 10 });
      assert.equal(ls.ok, true);
      assert.equal(ls.data?.series[0].ticker, 'KXHIGHNY');

      const conn = await testKalshiConnectivity();
      assert.equal(conn.ok, true, `connectivity: ${conn.code} ${conn.message}`);
      assert.equal(conn.code, 'ok');
      assert.equal(conn.marketsReturned, 3);

      const weather = await fetchKalshiWeatherMarkets();
      assert.equal(weather.length, 3, 'weather markets parsed from the fixture');

      assert.ok(s.calls.length >= 6);
      s.calls.forEach(assertPublic);
    } finally { s.restore(); }
  });
});

// ── t3 ─────────────────────────────────────────────────────────────────────
test('t3: with dummy credentials set, every authenticated Kalshi function returns KALSHI_ACCOUNT_DISABLED and calls fetch zero times', async () => {
  await withEnv(DUMMY, async () => {
    const savedDeps = { ...kalshiFetchDeps };
    let depFetches = 0, credReads = 0;
    Object.assign(kalshiFetchDeps, {
      getCredentials: () => { credReads++; return { keyId: 'k', privateKey: 'p' }; },
      signRequest: async () => 'sig',
      fetch: async () => { depFetches++; return new Response('{}', { status: 200 }); },
    });
    const s = spyFetch(() => new Response('{}', { status: 200 }));
    try {
      assert.equal(KALSHI_ACCOUNT_DISABLED.code, 'KALSHI_ACCOUNT_DISABLED');
      assert.equal(KALSHI_ACCOUNT_DISABLED.message, 'Not available: practice-only site, no Kalshi account connected (WOW-011).');
      for (const helper of [kalshiLiveFetch, kalshiDemoFetch]) {
        for (const [method, p] of [['GET', '/portfolio/orders/abc'], ['DELETE', '/portfolio/orders/abc'], ['GET', '/portfolio/balance'], ['GET', '/portfolio/positions'], ['POST', '/portfolio/orders']] as const) {
          const r = await helper(method, p);
          assert.equal(r.ok, false);
          assert.equal(r.data?.code, 'KALSHI_ACCOUNT_DISABLED', `${method} ${p}`);
          assert.equal(r.data?.error, KALSHI_ACCOUNT_DISABLED.message);
        }
      }
      assert.equal(depFetches, 0);
      assert.equal(credReads, 0);
      assert.equal(s.calls.length, 0);
    } finally { s.restore(); Object.assign(kalshiFetchDeps, savedDeps); }
  });
});

// ── t4 ─────────────────────────────────────────────────────────────────────
test('t4: /portfolio/* and any path outside the allowlist are refused with zero fetches', async () => {
  await withEnv(DUMMY, async () => {
    const s = spyFetch(fixtureResponder);
    try {
      for (const p of ['/portfolio/balance', '/portfolio/orders', '/portfolio/positions', '/exchange/status', '/markets/X/orders', '/events/../portfolio/balance', '/marketsfoo']) {
        const r = await kalshiPublicGet({ path: p });
        assert.equal(r.ok, false, p);
        assert.equal(r.data, null, p);
        assert.match(r.errorMessage ?? '', /not an allowed public Kalshi path/, p);
      }
      assert.equal(s.calls.length, 0);
      // And the allowed shapes do go out.
      for (const p of ['/markets', '/markets/KXHIGHNY-26NOV14-T53', '/markets/KXHIGHNY-26NOV14-T53/orderbook', '/series', '/events', '/events/KXHIGHNY-26NOV14']) {
        await kalshiPublicGet({ path: p });
      }
      assert.equal(s.calls.length, 6);
    } finally { s.restore(); }
  });
});

// ── t5 ─────────────────────────────────────────────────────────────────────
test('t5: a 429 or 500 gives the unavailable state with no numbers', async () => {
  for (const status of [429, 500]) {
    await withEnv({}, async () => {
      const s = spyFetch(() => new Response(JSON.stringify({ error: 'busy', markets: [{ ticker: 'KXHIGHNY-X', yes_bid: 50 }] }), { status }));
      try {
        const lm = await listMarkets({ limit: 3 });
        assert.equal(lm.ok, false);
        assert.equal(lm.status, status);
        assert.equal(lm.data, null, 'no body numbers passed through on failure');
        const conn = await testKalshiConnectivity();
        assert.equal(conn.ok, false);
        assert.equal(conn.marketsReturned, 0);
        const weather = await fetchKalshiWeatherMarkets();
        assert.deepEqual(weather, [], 'no invented (demo) markets on failure');
      } finally { s.restore(); }
    });
  }
});

// ── t6 ─────────────────────────────────────────────────────────────────────
test('t6: no file under src other than kalshi-execution.ts contains KALSHI-ACCESS-', () => {
  const root = path.join(import.meta.dirname, '..', 'src');
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|astro|js|mjs)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('KALSHI-ACCESS-')) hits.push(path.relative(root, p).replace(/\\/g, '/'));
    }
  };
  walk(root);
  assert.deepEqual(hits, ['lib/kalshi-execution.ts']);
});

// ── t7 (WOW-012): no Kalshi price → no signal, never an invented 50¢ ─────────
test('t7: signals on real Kalshi markets with no readable price recommend nothing and never use 0.5', async () => {
  const { generateAllSignals, generateSignal, NO_KALSHI_PRICE_REASON } = await import('../src/lib/kalshi-signals');
  const s = spyFetch(fixtureResponder);
  try {
    const signals = await generateAllSignals();
    assert.ok(signals.length > 0, 'expected signals from the fixture markets');
    for (const sig of signals) {
      assert.equal(sig.recommendedSide, 'none', `${sig.ticker} recommended ${sig.recommendedSide}`);
      assert.notEqual(sig.marketProbYes, 0.5, `${sig.ticker} carries an invented 50¢ price`);
    }
    // Real Kalshi tickers (KXHIGHNY-26NOV14-T53 etc.) do not match the mapper's
    // expected format today, so every fixture market comes back unmapped and
    // never reaches the price check (reported to the Professor, WOW-012 deviation).
    // Each signal must therefore be either unmapped or price-less, never priced.
    for (const sig of signals) {
      assert.ok(
        sig.reason === NO_KALSHI_PRICE_REASON || sig.reason === 'Market could not be mapped to forecast system',
        `${sig.ticker}: unexpected reason ${sig.reason}`,
      );
    }
  } finally { s.restore(); }

  const direct = await generateSignal({
    ticker: 'KXHIGHNY-26NOV14-T53', title: 'NYC high', category: 'climate', marketType: 'binary' as any,
    mapped: true, locationName: 'New York', metric: 'high_temp', targetDate: '2026-11-14', threshold: 53,
  });
  assert.equal(direct.reason, NO_KALSHI_PRICE_REASON);
  assert.equal(direct.recommendedSide, 'none');
  assert.equal(direct.marketProbYes, 0);
});
