import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { listDemoOrders, listLiveOrders } from './kalshi-execution';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LedgerEntry {
  id: string;
  createdAt: string;
  source: 'demo' | 'live' | 'paper';
  type: 'fill' | 'mark' | 'settlement' | 'cancel' | 'adjustment';
  orderId?: string;
  positionId?: string;
  ticker?: string;
  side?: string;
  amountCents: number;
  realized: boolean;
  notes?: string;
}

const LEDGER_PREFIX = 'pnl:entry:';
const LEDGER_SET = 'pnl:entries';

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

export async function saveLedgerEntry(entry: LedgerEntry): Promise<void> {
  const redis = getRedis();
  await redis.set(`${LEDGER_PREFIX}${entry.id}`, JSON.stringify(entry));
  await redis.zadd(LEDGER_SET, { score: Date.now(), member: entry.id });
}

export async function listLedgerEntries(limit = 100): Promise<LedgerEntry[]> {
  const redis = getRedis();
  const ids = await redis.zrange(LEDGER_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];

  const sliced = ids.slice(0, limit);
  const entries: LedgerEntry[] = [];
  for (const id of sliced) {
    const raw = await redis.get(`${LEDGER_PREFIX}${id}`);
    if (raw) {
      entries.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as LedgerEntry);
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/*  Build ledger from orders                                           */
/* ------------------------------------------------------------------ */

export async function rebuildLedger(): Promise<LedgerEntry[]> {
  const [demoOrders, liveOrders] = await Promise.all([
    listDemoOrders(),
    listLiveOrders(),
  ]);

  // Track existing entries to avoid duplicates
  const existing = await listLedgerEntries(500);
  const existingOrderIds = new Set(existing.map(e => e.orderId).filter(Boolean));

  const newEntries: LedgerEntry[] = [];

  const processOrder = (order: any, source: 'demo' | 'live') => {
    // Skip if already in ledger
    if (existingOrderIds.has(order.id)) return;

    if (order.status === 'filled') {
      const entry: LedgerEntry = {
        id: `pnl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: order.updatedAt || order.createdAt,
        source,
        type: 'fill',
        orderId: order.id,
        ticker: order.ticker,
        side: order.side,
        amountCents: -(order.price * order.quantity), // Cost of entry (negative = money out)
        realized: false,
        notes: `Fill: ${order.side} ${order.quantity}x @ ${order.price}¢`,
      };
      newEntries.push(entry);

      // If there's settlement data, add a settlement entry
      if (order.fillData?.settled_price != null) {
        const settledPrice = order.fillData.settled_price;
        const payout = order.side === 'yes'
          ? settledPrice * order.quantity
          : (100 - settledPrice) * order.quantity;
        const settlementEntry: LedgerEntry = {
          id: `pnl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: order.updatedAt || order.createdAt,
          source,
          type: 'settlement',
          orderId: order.id,
          ticker: order.ticker,
          side: order.side,
          amountCents: payout, // Settlement payout (positive = money in)
          realized: true,
          notes: `Settlement @ ${settledPrice}¢ → payout ${payout}¢`,
        };
        newEntries.push(settlementEntry);
      }
    }

    if (order.status === 'cancelled' && order.kalshiOrderId) {
      const entry: LedgerEntry = {
        id: `pnl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: order.updatedAt || order.createdAt,
        source,
        type: 'cancel',
        orderId: order.id,
        ticker: order.ticker,
        side: order.side,
        amountCents: 0,
        realized: false,
        notes: `Order cancelled`,
      };
      newEntries.push(entry);
    }
  };

  for (const o of demoOrders) processOrder(o, 'demo');
  for (const o of liveOrders) processOrder(o, 'live');

  // Save new entries
  for (const entry of newEntries) {
    await saveLedgerEntry(entry);
  }

  if (newEntries.length > 0) {
    await logAuditEvent({
      actor: 'system',
      eventType: 'pnl_ledger_entries_created',
      targetType: 'pnl-ledger',
      summary: `${newEntries.length} new ledger entries created`,
      details: { count: newEntries.length },
    });
  }

  // Return all entries
  return listLedgerEntries(200);
}

/* ------------------------------------------------------------------ */
/*  Summary                                                            */
/* ------------------------------------------------------------------ */

export interface LedgerSummary {
  totalEntries: number;
  realizedPnlCents: number;
  unrealizedCostCents: number;
  netPnlCents: number;
  bySource: Record<string, { entries: number; totalCents: number }>;
}

export function computeLedgerSummary(entries: LedgerEntry[]): LedgerSummary {
  const bySource: Record<string, { entries: number; totalCents: number }> = {};

  let realizedPnlCents = 0;
  let unrealizedCostCents = 0;

  for (const e of entries) {
    if (e.realized) {
      realizedPnlCents += e.amountCents;
    } else if (e.type === 'fill') {
      unrealizedCostCents += e.amountCents;
    }

    if (!bySource[e.source]) bySource[e.source] = { entries: 0, totalCents: 0 };
    bySource[e.source].entries++;
    bySource[e.source].totalCents += e.amountCents;
  }

  return {
    totalEntries: entries.length,
    realizedPnlCents,
    unrealizedCostCents,
    netPnlCents: realizedPnlCents + unrealizedCostCents,
    bySource,
  };
}
