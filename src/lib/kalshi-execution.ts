import { getExecutionConfig } from './execution-config';
import { runPreTradeRiskChecks, type PreTradeInput } from './pretrade-risk';
import { logAuditEvent } from './audit-log';
import { getRedis } from './redis';
import type { ExecutionCandidate } from './order-builder';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const KALSHI_DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';

function getCredentials(): { keyId: string; privateKey: string } | null {
  const keyId = import.meta.env.KALSHI_API_KEY_ID;
  const privateKey = import.meta.env.KALSHI_PRIVATE_KEY;
  if (!keyId || !privateKey) return null;
  return { keyId, privateKey };
}

/* ------------------------------------------------------------------ */
/*  Auth — RSA-PSS request signing for Kalshi API v2                   */
/* ------------------------------------------------------------------ */

async function signRequest(
  method: string,
  path: string,
  timestamp: number,
  privateKeyPem: string
): Promise<string> {
  // Message = timestamp + method + path
  const message = `${timestamp}${method}${path}`;
  const encoder = new TextEncoder();
  const msgBytes = encoder.encode(message);

  // Import private key
  const pemBody = privateKeyPem
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer,
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    cryptoKey,
    msgBytes
  );

  // Base64 encode
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/* ------------------------------------------------------------------ */
/*  Authenticated fetch                                                */
/* ------------------------------------------------------------------ */

async function kalshiDemoFetch(
  method: string,
  path: string,
  body?: any
): Promise<{ ok: boolean; status: number; data: any }> {
  const creds = getCredentials();
  if (!creds) {
    return { ok: false, status: 0, data: { error: 'Missing Kalshi API credentials' } };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const fullPath = `/trade-api/v2${path}`;

  let signature: string;
  try {
    signature = await signRequest(method.toUpperCase(), fullPath, timestamp, creds.privateKey);
  } catch (err: any) {
    return { ok: false, status: 0, data: { error: `Signing failed: ${err?.message}` } };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'KALSHI-ACCESS-KEY': creds.keyId,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': String(timestamp),
  };

  try {
    const res = await fetch(`${KALSHI_DEMO_BASE}${path}`, {
      method: method.toUpperCase(),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err: any) {
    return { ok: false, status: 0, data: { error: err?.message || 'Network error' } };
  }
}

/* ------------------------------------------------------------------ */
/*  Demo Order Types                                                   */
/* ------------------------------------------------------------------ */

export interface DemoOrder {
  id: string;
  candidateId: string;
  createdAt: string;
  updatedAt: string;
  source: 'kalshi';
  mode: 'demo';
  ticker: string;
  title: string;
  side: 'yes' | 'no';
  action: 'buy';
  price: number;
  quantity: number;
  orderType: 'limit';
  clientOrderId: string;
  kalshiOrderId?: string;
  status: 'pending' | 'open' | 'filled' | 'cancelled' | 'failed';
  responseRaw?: any;
  fillData?: any;
  errorMessage?: string;
}

const DEMO_ORDER_PREFIX = 'demo-order:';
const DEMO_ORDER_SET = 'demo-orders:all';

/* ------------------------------------------------------------------ */
/*  Demo Order CRUD                                                    */
/* ------------------------------------------------------------------ */

export async function saveDemoOrder(order: DemoOrder): Promise<void> {
  const redis = getRedis();
  await redis.set(`${DEMO_ORDER_PREFIX}${order.id}`, JSON.stringify(order));
  await redis.zadd(DEMO_ORDER_SET, { score: Date.now(), member: order.id });
}

export async function getDemoOrder(id: string): Promise<DemoOrder | null> {
  const redis = getRedis();
  const raw = await redis.get(`${DEMO_ORDER_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as DemoOrder;
}

export async function listDemoOrders(): Promise<DemoOrder[]> {
  const redis = getRedis();
  const ids = await redis.zrange(DEMO_ORDER_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];

  const orders: DemoOrder[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${DEMO_ORDER_PREFIX}${id}`);
    if (raw) {
      orders.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as DemoOrder);
    }
  }
  return orders;
}

/* ------------------------------------------------------------------ */
/*  Pre-submission checks                                              */
/* ------------------------------------------------------------------ */

export async function preSubmitChecks(
  candidate: ExecutionCandidate
): Promise<{ allowed: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  // 1. Execution config checks
  const config = await getExecutionConfig();
  if (config.killSwitchEnabled) reasons.push('Kill switch is active');
  if (config.mode !== 'demo') reasons.push(`Mode is "${config.mode}", not "demo"`);
  if (!config.demoTradingEnabled) reasons.push('Demo trading is not enabled');

  // 2. Candidate state check
  if (candidate.state !== 'approved') reasons.push(`Candidate state is "${candidate.state}", not "approved"`);

  // 3. Pre-trade risk check
  const riskInput: PreTradeInput = {
    orderSizeCents: candidate.recommendedStakeCents,
    edge: candidate.edge,
  };
  const riskResult = await runPreTradeRiskChecks(riskInput);
  if (!riskResult.allowed) {
    const failedChecks = riskResult.checks.filter(c => !c.passed).map(c => c.name);
    reasons.push(`Risk checks failed: ${failedChecks.join(', ')}`);
  }

  // 4. Credentials check
  const creds = getCredentials();
  if (!creds) reasons.push('Missing Kalshi API credentials');

  return { allowed: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------ */
/*  Submit demo order                                                  */
/* ------------------------------------------------------------------ */

export async function submitDemoOrder(
  candidate: ExecutionCandidate
): Promise<DemoOrder> {
  const now = new Date().toISOString();
  const clientOrderId = `wow-demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const orderId = `do-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Build order
  const order: DemoOrder = {
    id: orderId,
    candidateId: candidate.id,
    createdAt: now,
    updatedAt: now,
    source: 'kalshi',
    mode: 'demo',
    ticker: candidate.ticker,
    title: candidate.title,
    side: (candidate.side as 'yes' | 'no') || 'yes',
    action: 'buy',
    price: candidate.dryRunOrder?.price || 50,
    quantity: Math.max(1, Math.floor(candidate.recommendedStakeCents / (candidate.dryRunOrder?.price || 50))),
    orderType: 'limit',
    clientOrderId,
    status: 'pending',
  };

  // Pre-submit checks
  const checks = await preSubmitChecks(candidate);
  if (!checks.allowed) {
    order.status = 'failed';
    order.errorMessage = checks.reasons.join('; ');
    await saveDemoOrder(order);

    await logAuditEvent({
      actor: 'admin',
      eventType: 'demo_order_failed',
      targetType: 'demo-order',
      targetId: orderId,
      summary: `Demo order blocked: ${order.title} — ${order.errorMessage}`,
      details: { candidateId: candidate.id, reasons: checks.reasons },
    });

    return order;
  }

  // Submit to Kalshi demo API
  const payload = {
    ticker: candidate.ticker.replace(/^kalshi-/, ''),
    client_order_id: clientOrderId,
    side: candidate.side || 'yes',
    action: 'buy',
    count: order.quantity,
    type: 'limit',
    yes_price: order.side === 'yes' ? order.price : undefined,
    no_price: order.side === 'no' ? order.price : undefined,
  };

  const result = await kalshiDemoFetch('POST', '/portfolio/orders', payload);

  order.responseRaw = result.data;
  order.updatedAt = new Date().toISOString();

  if (result.ok) {
    order.kalshiOrderId = result.data?.order?.order_id || result.data?.order_id;
    order.status = 'open';

    await logAuditEvent({
      actor: 'admin',
      eventType: 'demo_order_submitted',
      targetType: 'demo-order',
      targetId: orderId,
      summary: `Demo order submitted: ${order.title} — ${order.side} @ ${order.price}¢ x${order.quantity}`,
      details: { candidateId: candidate.id, kalshiOrderId: order.kalshiOrderId, ticker: order.ticker },
    });
  } else {
    order.status = 'failed';
    order.errorMessage = result.data?.error || result.data?.message || `HTTP ${result.status}`;

    await logAuditEvent({
      actor: 'admin',
      eventType: 'demo_order_failed',
      targetType: 'demo-order',
      targetId: orderId,
      summary: `Demo order failed: ${order.title} — ${order.errorMessage}`,
      details: { candidateId: candidate.id, status: result.status, response: result.data },
    });
  }

  await saveDemoOrder(order);
  return order;
}

/* ------------------------------------------------------------------ */
/*  Refresh order status                                               */
/* ------------------------------------------------------------------ */

export async function refreshDemoOrderStatus(orderId: string): Promise<DemoOrder | null> {
  const order = await getDemoOrder(orderId);
  if (!order) return null;
  if (!order.kalshiOrderId) return order;
  if (order.status === 'filled' || order.status === 'cancelled') return order;

  const result = await kalshiDemoFetch('GET', `/portfolio/orders/${order.kalshiOrderId}`);

  if (result.ok) {
    const kalshiOrder = result.data?.order || result.data;
    const kalshiStatus = kalshiOrder?.status;

    if (kalshiStatus === 'resting') order.status = 'open';
    else if (kalshiStatus === 'executed') { order.status = 'filled'; order.fillData = kalshiOrder; }
    else if (kalshiStatus === 'canceled' || kalshiStatus === 'cancelled') order.status = 'cancelled';
    else if (kalshiStatus) order.status = kalshiStatus as any;

    order.responseRaw = result.data;
    order.updatedAt = new Date().toISOString();
    await saveDemoOrder(order);

    await logAuditEvent({
      actor: 'admin',
      eventType: order.status === 'filled' ? 'demo_order_filled' : 'demo_order_status_refreshed',
      targetType: 'demo-order',
      targetId: orderId,
      summary: `Demo order ${order.ticker} status: ${order.status}`,
    });
  }

  return order;
}

/* ------------------------------------------------------------------ */
/*  Cancel demo order                                                  */
/* ------------------------------------------------------------------ */

export async function cancelDemoOrder(orderId: string): Promise<DemoOrder | null> {
  const order = await getDemoOrder(orderId);
  if (!order) return null;
  if (!order.kalshiOrderId) {
    order.status = 'cancelled';
    order.updatedAt = new Date().toISOString();
    await saveDemoOrder(order);
    return order;
  }

  const result = await kalshiDemoFetch('DELETE', `/portfolio/orders/${order.kalshiOrderId}`);

  order.updatedAt = new Date().toISOString();
  if (result.ok) {
    order.status = 'cancelled';
  } else {
    order.errorMessage = result.data?.error || `Cancel failed: HTTP ${result.status}`;
  }
  await saveDemoOrder(order);

  await logAuditEvent({
    actor: 'admin',
    eventType: 'demo_order_cancelled',
    targetType: 'demo-order',
    targetId: orderId,
    summary: `Demo order ${order.ticker} cancelled`,
  });

  return order;
}
