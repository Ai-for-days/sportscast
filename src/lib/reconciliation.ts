import { getRedis } from './redis';
import { listDemoOrders, getDemoOrder, saveDemoOrder, listLiveOrders, getLiveOrder, saveLiveOrder } from './kalshi-execution';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ReconciliationRecord {
  orderId: string;
  mode: 'demo' | 'live';
  ticker: string;
  title: string;
  localStatus: string;
  remoteStatus?: string;
  reconciled: boolean;
  discrepancies: string[];
  checkedAt: string;
  reviewed?: boolean;
}

const RECON_PREFIX = 'recon:record:';
const RECON_SET = 'recon:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

async function saveReconRecord(record: ReconciliationRecord): Promise<void> {
  const redis = getRedis();
  const key = `${record.mode}:${record.orderId}`;
  await redis.set(`${RECON_PREFIX}${key}`, JSON.stringify(record));
  await redis.zadd(RECON_SET, { score: Date.now(), member: key });
}

export async function listReconRecords(): Promise<ReconciliationRecord[]> {
  const redis = getRedis();
  const keys = await redis.zrange(RECON_SET, 0, -1, { rev: true });
  if (!keys || keys.length === 0) return [];

  const records: ReconciliationRecord[] = [];
  for (const k of keys) {
    const raw = await redis.get(`${RECON_PREFIX}${k}`);
    if (raw) {
      records.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ReconciliationRecord);
    }
  }
  return records;
}

/* ------------------------------------------------------------------ */
/*  Reconcile a single order against Kalshi                            */
/* ------------------------------------------------------------------ */

async function reconcileOrder(
  orderId: string,
  mode: 'demo' | 'live',
): Promise<ReconciliationRecord> {
  const discrepancies: string[] = [];

  // Fetch local order
  const order = mode === 'demo'
    ? await getDemoOrder(orderId)
    : await getLiveOrder(orderId);

  if (!order) {
    const record: ReconciliationRecord = {
      orderId, mode, ticker: '?', title: '?',
      localStatus: 'not_found', reconciled: false,
      discrepancies: ['Order not found locally'],
      checkedAt: new Date().toISOString(),
    };
    await saveReconRecord(record);
    return record;
  }

  const localStatus = order.status;
  let remoteStatus: string | undefined;

  // If we have a Kalshi order ID, check remote status
  if (order.kalshiOrderId) {
    try {
      // Use dynamic import to avoid circular deps — we call the refresh functions
      if (mode === 'demo') {
        const { refreshDemoOrderStatus } = await import('./kalshi-execution');
        const refreshed = await refreshDemoOrderStatus(orderId);
        if (refreshed) remoteStatus = refreshed.status;
      } else {
        const { refreshLiveOrderStatus } = await import('./kalshi-execution');
        const refreshed = await refreshLiveOrderStatus(orderId);
        if (refreshed) remoteStatus = refreshed.status;
      }
    } catch {
      discrepancies.push('Failed to fetch remote status');
    }
  } else if (localStatus !== 'failed' && localStatus !== 'cancelled') {
    discrepancies.push('No Kalshi order ID but order is not failed/cancelled');
  }

  // Compare statuses
  if (remoteStatus && localStatus !== remoteStatus) {
    // Re-read order since refresh may have updated it
    const updated = mode === 'demo'
      ? await getDemoOrder(orderId)
      : await getLiveOrder(orderId);
    if (updated && updated.status !== remoteStatus) {
      discrepancies.push(`Local status "${updated.status}" != remote "${remoteStatus}"`);
    }
  }

  // Check for missing linked data
  if (!order.candidateId) {
    discrepancies.push('Missing linked candidate ID');
  }

  const reconciled = discrepancies.length === 0;

  const record: ReconciliationRecord = {
    orderId, mode,
    ticker: order.ticker,
    title: order.title,
    localStatus: (await (mode === 'demo' ? getDemoOrder(orderId) : getLiveOrder(orderId)))?.status || localStatus,
    remoteStatus,
    reconciled,
    discrepancies,
    checkedAt: new Date().toISOString(),
  };

  await saveReconRecord(record);

  if (!reconciled) {
    await logAuditEvent({
      actor: 'system',
      eventType: 'reconciliation_mismatch_found',
      targetType: `${mode}-order`,
      targetId: orderId,
      summary: `Reconciliation mismatch: ${order.ticker} — ${discrepancies.join('; ')}`,
      details: { mode, localStatus: record.localStatus, remoteStatus, discrepancies },
    });
  }

  return record;
}

/* ------------------------------------------------------------------ */
/*  Reconcile all orders (safe — sequential, rate-limited)             */
/* ------------------------------------------------------------------ */

export async function reconcileAll(): Promise<ReconciliationRecord[]> {
  const [demoOrders, liveOrders] = await Promise.all([
    listDemoOrders(),
    listLiveOrders(),
  ]);

  const records: ReconciliationRecord[] = [];

  // Only reconcile active orders (not already terminal + reconciled)
  const activeDemos = demoOrders.filter(o =>
    o.status === 'pending' || o.status === 'open' || o.kalshiOrderId
  );
  const activeLives = liveOrders.filter(o =>
    o.status === 'pending' || o.status === 'open' ||
    o.status === 'partially-filled' || o.kalshiOrderId
  );

  for (const o of activeDemos) {
    records.push(await reconcileOrder(o.id, 'demo'));
  }
  for (const o of activeLives) {
    records.push(await reconcileOrder(o.id, 'live'));
  }

  await logAuditEvent({
    actor: 'admin',
    eventType: 'reconciliation_run',
    targetType: 'reconciliation',
    summary: `Reconciliation run: ${records.length} orders checked, ${records.filter(r => !r.reconciled).length} discrepancies`,
    details: { demoCount: activeDemos.length, liveCount: activeLives.length },
  });

  return records;
}

/* ------------------------------------------------------------------ */
/*  Reconcile single order (for manual refresh)                        */
/* ------------------------------------------------------------------ */

export async function reconcileSingleOrder(
  orderId: string,
  mode: 'demo' | 'live',
): Promise<ReconciliationRecord> {
  return reconcileOrder(orderId, mode);
}

/* ------------------------------------------------------------------ */
/*  Mark as reviewed                                                   */
/* ------------------------------------------------------------------ */

export async function markReviewed(orderId: string, mode: 'demo' | 'live'): Promise<void> {
  const redis = getRedis();
  const key = `${mode}:${orderId}`;
  const raw = await redis.get(`${RECON_PREFIX}${key}`);
  if (raw) {
    const record: ReconciliationRecord = typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ReconciliationRecord;
    record.reviewed = true;
    await redis.set(`${RECON_PREFIX}${key}`, JSON.stringify(record));

    await logAuditEvent({
      actor: 'admin',
      eventType: 'order_reconciled',
      targetType: `${mode}-order`,
      targetId: orderId,
      summary: `Order ${record.ticker} marked as reviewed`,
    });
  }
}
