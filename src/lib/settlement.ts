import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type SettlementSource = 'sportsbook' | 'kalshi-demo' | 'kalshi-live';
export type SettlementStatus = 'pending' | 'resolved' | 'settled' | 'disputed';

export interface SettlementRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: SettlementSource;
  marketId?: string;
  orderId?: string;
  positionId?: string;
  ticker?: string;
  title?: string;
  status: SettlementStatus;
  resolutionValue?: any;
  grossPnlCents: number;
  feesCents: number;
  netPnlCents: number;
  slippageCents: number;
  notes?: string;
}

export type PositionCloseStatus = 'open' | 'partially_closed' | 'closed' | 'disputed';

export interface EnhancedPosition {
  id: string;
  source: string;
  ticker: string;
  title: string;
  side: string;
  contractsOpen: number;
  contractsClosed: number;
  contractsTotal: number;
  avgEntryPrice: number;
  avgExitPrice: number;
  closeStatus: PositionCloseStatus;
  grossRealizedPnlCents: number;
  feesCents: number;
  netRealizedPnlCents: number;
  unrealizedPnlCents: number;
  unrealizedMethod: 'market_price' | 'entry_price' | 'conservative';
  openedAt: string;
  closedAt?: string;
}

export type DiscrepancyResolution = 'reviewed' | 'resolved' | 'disputed' | 'ignored';

export interface DiscrepancyRecord {
  id: string;
  reconRecordId: string;
  orderId: string;
  ticker: string;
  issue: string;
  severity: string;
  mode: string;
  resolution: DiscrepancyResolution;
  resolvedAt?: string;
  notes?: string;
}

export interface SettlementOverview {
  pending: number;
  resolved: number;
  settled: number;
  disputed: number;
  grossPnlCents: number;
  totalFeesCents: number;
  netPnlCents: number;
  openPositions: number;
  closedPositions: number;
  partialPositions: number;
}

/* ------------------------------------------------------------------ */
/*  Redis keys                                                          */
/* ------------------------------------------------------------------ */

const SETTLE_PREFIX = 'settlement:';
const SETTLE_SET = 'settlements:all';
const EPOS_PREFIX = 'eposition:';
const EPOS_SET = 'epositions:all';
const DISC_PREFIX = 'discrepancy:';
const DISC_SET = 'discrepancies:all';

/* ------------------------------------------------------------------ */
/*  Settlement CRUD                                                     */
/* ------------------------------------------------------------------ */

async function saveSettlement(rec: SettlementRecord): Promise<void> {
  const redis = getRedis();
  await redis.set(`${SETTLE_PREFIX}${rec.id}`, JSON.stringify(rec));
  await redis.zadd(SETTLE_SET, { score: Date.now(), member: rec.id });
}

export async function getSettlement(id: string): Promise<SettlementRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(`${SETTLE_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as SettlementRecord;
}

export async function listSettlements(limit = 200): Promise<SettlementRecord[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SETTLE_SET, 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const records: SettlementRecord[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${SETTLE_PREFIX}${id}`);
    if (raw) records.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as SettlementRecord);
  }
  return records;
}

/* ------------------------------------------------------------------ */
/*  Enhanced Position CRUD                                              */
/* ------------------------------------------------------------------ */

async function saveEnhancedPosition(pos: EnhancedPosition): Promise<void> {
  const redis = getRedis();
  await redis.set(`${EPOS_PREFIX}${pos.id}`, JSON.stringify(pos));
  await redis.zadd(EPOS_SET, { score: Date.now(), member: pos.id });
}

export async function listEnhancedPositions(limit = 200): Promise<EnhancedPosition[]> {
  const redis = getRedis();
  const ids = await redis.zrange(EPOS_SET, 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const positions: EnhancedPosition[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${EPOS_PREFIX}${id}`);
    if (raw) positions.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as EnhancedPosition);
  }
  return positions;
}

/* ------------------------------------------------------------------ */
/*  Discrepancy CRUD                                                    */
/* ------------------------------------------------------------------ */

async function saveDiscrepancy(disc: DiscrepancyRecord): Promise<void> {
  const redis = getRedis();
  await redis.set(`${DISC_PREFIX}${disc.id}`, JSON.stringify(disc));
  await redis.zadd(DISC_SET, { score: Date.now(), member: disc.id });
}

export async function getDiscrepancy(id: string): Promise<DiscrepancyRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(`${DISC_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as DiscrepancyRecord;
}

export async function listDiscrepancies(limit = 200): Promise<DiscrepancyRecord[]> {
  const redis = getRedis();
  const ids = await redis.zrange(DISC_SET, 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const records: DiscrepancyRecord[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${DISC_PREFIX}${id}`);
    if (raw) records.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as DiscrepancyRecord);
  }
  return records;
}

/* ------------------------------------------------------------------ */
/*  Rebuild settlements from orders                                     */
/* ------------------------------------------------------------------ */

export async function rebuildSettlements(): Promise<{ count: number }> {
  const redis = getRedis();
  const existingIds = new Set((await listSettlements(1000)).map(s => s.orderId || s.marketId));

  let count = 0;

  // Process demo orders
  const demoIds = await redis.zrange('demo-orders:all', 0, -1) || [];
  for (const oid of demoIds) {
    if (existingIds.has(oid)) continue;
    const raw = await redis.get(`demo-order:${oid}`);
    if (!raw) continue;
    const order = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!['filled', 'canceled', 'cancelled'].includes(order.status)) continue;

    const pnl = order.realizedPnlCents ?? order.pnlCents ?? 0;
    const rec: SettlementRecord = {
      id: `stl-demo-${oid}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'kalshi-demo',
      orderId: oid,
      ticker: order.ticker || '',
      title: order.title || order.ticker || '',
      status: order.status === 'filled' ? 'settled' : 'resolved',
      resolutionValue: order.status,
      grossPnlCents: pnl,
      feesCents: 0,
      netPnlCents: pnl,
      slippageCents: 0,
    };
    await saveSettlement(rec);
    count++;
  }

  // Process live orders
  const liveIds = await redis.zrange('live-orders:all', 0, -1) || [];
  for (const oid of liveIds) {
    if (existingIds.has(oid)) continue;
    const raw = await redis.get(`live-order:${oid}`);
    if (!raw) continue;
    const order = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!['filled', 'canceled', 'cancelled'].includes(order.status)) continue;

    const pnl = order.realizedPnlCents ?? order.pnlCents ?? 0;
    const fees = order.feesCents ?? 0;
    const rec: SettlementRecord = {
      id: `stl-live-${oid}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'kalshi-live',
      orderId: oid,
      ticker: order.ticker || '',
      title: order.title || order.ticker || '',
      status: order.status === 'filled' ? 'settled' : 'resolved',
      resolutionValue: order.status,
      grossPnlCents: pnl,
      feesCents: fees,
      netPnlCents: pnl - fees,
      slippageCents: 0,
    };
    await saveSettlement(rec);
    count++;
  }

  // Process sportsbook graded wagers
  const wagerIds = await redis.zrange('wagers:by-status:graded', 0, -1) || [];
  for (const wid of wagerIds) {
    if (existingIds.has(wid)) continue;
    const raw = await redis.get(`wager:${wid}`);
    if (!raw) continue;
    const wager = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const rec: SettlementRecord = {
      id: `stl-sb-${wid}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'sportsbook',
      marketId: wid,
      ticker: wager.ticketNumber || wid,
      title: wager.title || '',
      status: 'settled',
      resolutionValue: wager.result || wager.winningOutcome,
      grossPnlCents: wager.housePnlCents ?? 0,
      feesCents: 0,
      netPnlCents: wager.housePnlCents ?? 0,
      slippageCents: 0,
    };
    await saveSettlement(rec);
    count++;
  }

  await logAuditEvent({
    actor: 'admin',
    eventType: 'settlement_rebuilt',
    targetType: 'system',
    targetId: 'settlements',
    summary: `Settlements rebuilt: ${count} new records`,
  });

  return { count };
}

/* ------------------------------------------------------------------ */
/*  Rebuild enhanced positions                                          */
/* ------------------------------------------------------------------ */

export async function rebuildEnhancedPositions(): Promise<{ count: number }> {
  const redis = getRedis();
  let count = 0;

  // Get existing positions
  const posIds = await redis.zrange('positions:all', 0, -1) || [];
  for (const pid of posIds) {
    const raw = await redis.get(`position:${pid}`);
    if (!raw) continue;
    const pos = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const contracts = pos.contracts ?? 0;
    const closedContracts = pos.closedContracts ?? 0;
    const openContracts = contracts - closedContracts;

    let closeStatus: PositionCloseStatus = 'open';
    if (pos.status === 'closed' || openContracts <= 0) closeStatus = 'closed';
    else if (closedContracts > 0) closeStatus = 'partially_closed';

    const grossPnl = pos.realizedPnlCents ?? 0;
    const fees = pos.feesCents ?? 0;

    // Unrealized P&L estimation
    let unrealized = pos.unrealizedPnlCents ?? 0;
    let unrealizedMethod: EnhancedPosition['unrealizedMethod'] = 'conservative';

    // Try to get latest market price from Kalshi ingestion
    if (openContracts > 0 && pos.ticker) {
      const marketRaw = await redis.get(`kalshi-market:${pos.ticker}`);
      if (marketRaw) {
        const market = typeof marketRaw === 'string' ? JSON.parse(marketRaw) : marketRaw;
        const lastPrice = market.last_price ?? market.yes_bid ?? market.yes_ask;
        if (lastPrice != null) {
          const entryPrice = pos.avgEntryPrice ?? 0;
          const side = pos.side || 'yes';
          const priceDiff = side === 'yes' ? (lastPrice - entryPrice) : (entryPrice - lastPrice);
          unrealized = Math.round(priceDiff * openContracts * 100);
          unrealizedMethod = 'market_price';
        }
      }
    }

    const epos: EnhancedPosition = {
      id: pid,
      source: pos.source || 'kalshi-demo',
      ticker: pos.ticker || '',
      title: pos.title || pos.ticker || '',
      side: pos.side || 'yes',
      contractsOpen: Math.max(openContracts, 0),
      contractsClosed: closedContracts,
      contractsTotal: contracts,
      avgEntryPrice: pos.avgEntryPrice ?? 0,
      avgExitPrice: pos.avgExitPrice ?? 0,
      closeStatus,
      grossRealizedPnlCents: grossPnl,
      feesCents: fees,
      netRealizedPnlCents: grossPnl - fees,
      unrealizedPnlCents: unrealized,
      unrealizedMethod,
      openedAt: pos.openedAt || pos.createdAt || new Date().toISOString(),
      closedAt: closeStatus === 'closed' ? (pos.closedAt || new Date().toISOString()) : undefined,
    };

    await saveEnhancedPosition(epos);
    count++;
  }

  await logAuditEvent({
    actor: 'admin',
    eventType: 'positions_rebuilt',
    targetType: 'system',
    targetId: 'positions',
    summary: `Enhanced positions rebuilt: ${count} records`,
  });

  return { count };
}

/* ------------------------------------------------------------------ */
/*  Rebuild unrealized P&L                                              */
/* ------------------------------------------------------------------ */

export async function rebuildUnrealizedPnl(): Promise<{ updated: number }> {
  const positions = await listEnhancedPositions(500);
  const redis = getRedis();
  let updated = 0;

  for (const pos of positions) {
    if (pos.closeStatus === 'closed') continue;
    if (!pos.ticker || pos.contractsOpen <= 0) continue;

    const marketRaw = await redis.get(`kalshi-market:${pos.ticker}`);
    if (!marketRaw) continue;
    const market = typeof marketRaw === 'string' ? JSON.parse(marketRaw) : marketRaw;
    const lastPrice = market.last_price ?? market.yes_bid ?? market.yes_ask;
    if (lastPrice == null) continue;

    const priceDiff = pos.side === 'yes'
      ? (lastPrice - pos.avgEntryPrice)
      : (pos.avgEntryPrice - lastPrice);
    const newUnrealized = Math.round(priceDiff * pos.contractsOpen * 100);

    if (newUnrealized !== pos.unrealizedPnlCents) {
      pos.unrealizedPnlCents = newUnrealized;
      pos.unrealizedMethod = 'market_price';
      await saveEnhancedPosition(pos);
      updated++;
    }
  }

  await logAuditEvent({
    actor: 'admin',
    eventType: 'unrealized_pnl_rebuilt',
    targetType: 'system',
    targetId: 'positions',
    summary: `Unrealized P&L updated: ${updated} positions`,
  });

  return { updated };
}

/* ------------------------------------------------------------------ */
/*  Rebuild discrepancies from reconciliation                           */
/* ------------------------------------------------------------------ */

export async function rebuildDiscrepancies(): Promise<{ count: number }> {
  const redis = getRedis();
  const reconIds = await redis.zrange('recon:all', 0, -1) || [];
  const existingIds = new Set((await listDiscrepancies(1000)).map(d => d.reconRecordId));
  let count = 0;

  for (const rid of reconIds) {
    if (existingIds.has(rid)) continue;

    // Try both keying patterns
    let raw = await redis.get(`recon:record:${rid}`);
    if (!raw) raw = await redis.get(`recon:record:demo:${rid}`);
    if (!raw) raw = await redis.get(`recon:record:live:${rid}`);
    if (!raw) continue;

    const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!rec.discrepancy && rec.status !== 'mismatch') continue;

    const disc: DiscrepancyRecord = {
      id: `disc-${rid}`,
      reconRecordId: rid,
      orderId: rec.orderId || rid,
      ticker: rec.ticker || '',
      issue: rec.discrepancy || rec.issue || 'Status mismatch',
      severity: rec.severity || 'medium',
      mode: rec.mode || 'demo',
      resolution: 'reviewed',
      notes: undefined,
    };
    await saveDiscrepancy(disc);
    count++;
  }

  return { count };
}

/* ------------------------------------------------------------------ */
/*  Discrepancy actions                                                 */
/* ------------------------------------------------------------------ */

export async function updateDiscrepancyResolution(
  id: string,
  resolution: DiscrepancyResolution,
  notes?: string,
): Promise<DiscrepancyRecord | null> {
  const disc = await getDiscrepancy(id);
  if (!disc) return null;

  disc.resolution = resolution;
  disc.resolvedAt = new Date().toISOString();
  if (notes) disc.notes = notes;
  await saveDiscrepancy(disc);

  const eventMap: Record<string, string> = {
    reviewed: 'discrepancy_reviewed',
    resolved: 'discrepancy_resolved',
    disputed: 'discrepancy_disputed',
    ignored: 'discrepancy_resolved',
  };

  await logAuditEvent({
    actor: 'admin',
    eventType: eventMap[resolution] || 'discrepancy_resolved',
    targetType: 'discrepancy',
    targetId: id,
    summary: `Discrepancy ${resolution}: ${disc.ticker} — ${disc.issue}`,
    details: { notes },
  });

  return disc;
}

/* ------------------------------------------------------------------ */
/*  Overview                                                            */
/* ------------------------------------------------------------------ */

export async function getSettlementOverview(): Promise<SettlementOverview> {
  const [settlements, positions] = await Promise.all([
    listSettlements(500),
    listEnhancedPositions(500),
  ]);

  const pending = settlements.filter(s => s.status === 'pending').length;
  const resolved = settlements.filter(s => s.status === 'resolved').length;
  const settled = settlements.filter(s => s.status === 'settled').length;
  const disputed = settlements.filter(s => s.status === 'disputed').length;
  const grossPnl = settlements.reduce((a, s) => a + s.grossPnlCents, 0);
  const fees = settlements.reduce((a, s) => a + s.feesCents, 0);
  const netPnl = settlements.reduce((a, s) => a + s.netPnlCents, 0);

  return {
    pending,
    resolved,
    settled,
    disputed,
    grossPnlCents: grossPnl,
    totalFeesCents: fees,
    netPnlCents: netPnl,
    openPositions: positions.filter(p => p.closeStatus === 'open').length,
    closedPositions: positions.filter(p => p.closeStatus === 'closed').length,
    partialPositions: positions.filter(p => p.closeStatus === 'partially_closed').length,
  };
}
