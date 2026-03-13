import { getRedis } from './redis';
import { listDemoOrders, listLiveOrders } from './kalshi-execution';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Position {
  id: string;
  source: 'kalshi-demo' | 'kalshi-live' | 'paper';
  ticker: string;
  title: string;
  side: 'yes' | 'no';
  contracts: number;
  avgEntryPrice: number;
  notionalCents: number;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
  orderIds: string[];
  realizedPnlCents: number;
  unrealizedPnlCents: number;
}

const POSITION_PREFIX = 'position:';
const POSITION_SET = 'positions:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

async function savePosition(pos: Position): Promise<void> {
  const redis = getRedis();
  await redis.set(`${POSITION_PREFIX}${pos.id}`, JSON.stringify(pos));
  await redis.zadd(POSITION_SET, { score: Date.now(), member: pos.id });
}

export async function getPosition(id: string): Promise<Position | null> {
  const redis = getRedis();
  const raw = await redis.get(`${POSITION_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Position;
}

export async function listPositions(): Promise<Position[]> {
  const redis = getRedis();
  const ids = await redis.zrange(POSITION_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];

  const positions: Position[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${POSITION_PREFIX}${id}`);
    if (raw) {
      positions.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Position);
    }
  }
  return positions;
}

/* ------------------------------------------------------------------ */
/*  Build positions from orders                                        */
/* ------------------------------------------------------------------ */

export async function rebuildPositions(): Promise<Position[]> {
  const [demoOrders, liveOrders] = await Promise.all([
    listDemoOrders(),
    listLiveOrders(),
  ]);

  // Group by ticker+source+side
  const posMap = new Map<string, Position>();

  const processOrder = (
    order: any,
    source: 'kalshi-demo' | 'kalshi-live',
  ) => {
    // Only process filled or open orders
    if (!['filled', 'open', 'partially-filled'].includes(order.status)) return;

    const key = `${source}:${order.ticker}:${order.side}`;
    let pos = posMap.get(key);

    if (!pos) {
      pos = {
        id: `pos-${source}-${order.ticker}-${order.side}`.replace(/[^a-zA-Z0-9-]/g, '_'),
        source,
        ticker: order.ticker,
        title: order.title,
        side: order.side,
        contracts: 0,
        avgEntryPrice: 0,
        notionalCents: 0,
        status: 'open',
        openedAt: order.createdAt,
        orderIds: [],
        realizedPnlCents: 0,
        unrealizedPnlCents: 0,
      };
      posMap.set(key, pos);
    }

    const qty = order.quantity || 1;
    const price = order.price || 50;

    // Weighted average entry price
    const totalContracts = pos.contracts + qty;
    if (totalContracts > 0) {
      pos.avgEntryPrice = Math.round(
        (pos.avgEntryPrice * pos.contracts + price * qty) / totalContracts
      );
    }
    pos.contracts = totalContracts;
    pos.notionalCents = pos.contracts * pos.avgEntryPrice;
    pos.orderIds.push(order.id);

    // Determine status
    if (order.status === 'filled') {
      // If the order's fillData indicates settlement, compute realized P&L
      if (order.fillData?.settled_price != null) {
        const settledPrice = order.fillData.settled_price;
        // For "yes" side: profit = (settledPrice - entryPrice) * contracts
        // For "no" side: profit = ((100 - settledPrice) - entryPrice) * contracts (reversed)
        const pnl = order.side === 'yes'
          ? (settledPrice - price) * qty
          : ((100 - settledPrice) - price) * qty;
        pos.realizedPnlCents += pnl;
        pos.status = 'closed';
        pos.closedAt = order.updatedAt || order.createdAt;
      }
    }

    // Simple unrealized P&L approximation: assume 50¢ mid if no market data
    if (pos.status === 'open') {
      // Mark-to-market approximation: assume current value is entry (conservative)
      // Real mark-to-market would require fetching current market price
      pos.unrealizedPnlCents = 0;
    }

    if (order.createdAt < pos.openedAt) {
      pos.openedAt = order.createdAt;
    }
  };

  for (const o of demoOrders) processOrder(o, 'kalshi-demo');
  for (const o of liveOrders) processOrder(o, 'kalshi-live');

  // Save all positions
  const positions = Array.from(posMap.values());
  for (const pos of positions) {
    await savePosition(pos);
  }

  // Log
  const openCount = positions.filter(p => p.status === 'open').length;
  if (positions.length > 0) {
    await logAuditEvent({
      actor: 'system',
      eventType: 'positions_rebuilt',
      targetType: 'position',
      summary: `Positions rebuilt: ${positions.length} total, ${openCount} open`,
    });
  }

  return positions;
}

/* ------------------------------------------------------------------ */
/*  Summary                                                            */
/* ------------------------------------------------------------------ */

export interface PositionSummary {
  totalPositions: number;
  openPositions: number;
  closedPositions: number;
  totalRealizedPnlCents: number;
  totalUnrealizedPnlCents: number;
  totalNotionalCents: number;
}

export function computePositionSummary(positions: Position[]): PositionSummary {
  return {
    totalPositions: positions.length,
    openPositions: positions.filter(p => p.status === 'open').length,
    closedPositions: positions.filter(p => p.status === 'closed').length,
    totalRealizedPnlCents: positions.reduce((s, p) => s + p.realizedPnlCents, 0),
    totalUnrealizedPnlCents: positions.reduce((s, p) => s + p.unrealizedPnlCents, 0),
    totalNotionalCents: positions.filter(p => p.status === 'open').reduce((s, p) => s + p.notionalCents, 0),
  };
}
