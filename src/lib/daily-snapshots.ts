import { getRedis } from './redis';
import { writeSnapshot, type SnapshotFamily } from './research-store';
import { logAuditEvent } from './audit-log';
import { getActiveVersions } from './model-registry';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function zsetSummary(setKey: string, prefix: string, limit = 200): Promise<{ count: number; sample: any[] }> {
  const redis = getRedis();
  const ids = await redis.zrange(setKey, 0, limit - 1, { rev: true }) || [];
  const sample: any[] = [];
  for (const id of ids.slice(0, 5)) {
    const raw = await redis.get(`${prefix}${id}`);
    if (raw) sample.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return { count: ids.length, sample };
}

/* ------------------------------------------------------------------ */
/*  Family snapshot builders                                            */
/* ------------------------------------------------------------------ */

async function buildSignals(): Promise<any> {
  return zsetSummary('kalshi-signals:all', 'kalshi-signal:');
}

async function buildPortfolio(): Promise<any> {
  return zsetSummary('exec-candidates:all', 'exec-candidate:');
}

async function buildDemoOrders(): Promise<any> {
  return zsetSummary('demo-orders:all', 'demo-order:');
}

async function buildLiveOrders(): Promise<any> {
  return zsetSummary('live-orders:all', 'live-order:');
}

async function buildSettlements(): Promise<any> {
  return zsetSummary('settlements:all', 'settlement:');
}

async function buildPositions(): Promise<any> {
  return zsetSummary('positions:all', 'position:');
}

async function buildPnl(): Promise<any> {
  const redis = getRedis();
  const ids = await redis.zrange('pnl:entries', 0, -1, { rev: true }) || [];
  let realized = 0, unrealized = 0, count = ids.length;
  for (const id of ids.slice(0, 500)) {
    const raw = await redis.get(`pnl:entry:${id}`);
    if (!raw) continue;
    const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (entry.realized) realized += entry.amountCents ?? 0;
    else unrealized += entry.amountCents ?? 0;
  }
  return { count, realizedCents: realized, unrealizedCents: unrealized };
}

async function buildHealthAlerts(): Promise<any> {
  const redis = getRedis();
  const alertIds = await redis.zrange('alerts:all', 0, 50, { rev: true }) || [];
  let openCritical = 0, openWarnings = 0, total = alertIds.length;
  for (const id of alertIds) {
    const raw = await redis.get(`alert:${id}`);
    if (!raw) continue;
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (a.status === 'open' && a.severity === 'critical') openCritical++;
    if (a.status === 'open' && a.severity === 'warning') openWarnings++;
  }
  return { total, openCritical, openWarnings };
}

async function buildOperatorDaily(): Promise<any> {
  const redis = getRedis();
  // Grab today's operator tasks
  const date = today();
  const taskKeys = await redis.zrange('operator:tasks:all', 0, -1) || [];
  let done = 0, pending = 0;
  for (const key of taskKeys.slice(0, 20)) {
    const raw = await redis.get(`operator:task:${date}:${key}`);
    if (raw) {
      const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (t.status === 'done') done++; else pending++;
    }
  }
  return { date, tasksDone: done, tasksPending: pending };
}

async function buildActiveModels(): Promise<any> {
  try {
    const actives = await getActiveVersions();
    const result: Record<string, any> = {};
    for (const [family, model] of Object.entries(actives)) {
      result[family] = model ? { id: model.id, version: model.version, name: model.name } : null;
    }
    return result;
  } catch {
    return {};
  }
}

async function buildForecasts(): Promise<any> {
  return zsetSummary('forecasts:all', 'forecast:');
}

async function buildForecastVerification(): Promise<any> {
  return zsetSummary('verifications:all', 'verification:');
}

async function buildConsensus(): Promise<any> {
  return zsetSummary('consensus:all', 'consensus:');
}

async function buildPricing(): Promise<any> {
  // Summarize wagers with pricing snapshots
  const redis = getRedis();
  const wagerIds = await redis.zrange('wagers:all', 0, 50, { rev: true }) || [];
  let withSnapshot = 0;
  for (const id of wagerIds) {
    const raw = await redis.get(`wager:${id}`);
    if (!raw) continue;
    const w = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (w.pricingSnapshot) withSnapshot++;
  }
  return { totalWagers: wagerIds.length, withPricingSnapshot: withSnapshot };
}

async function buildExecutionCandidates(): Promise<any> {
  return zsetSummary('exec-candidates:all', 'exec-candidate:');
}

/* ------------------------------------------------------------------ */
/*  Build all families                                                  */
/* ------------------------------------------------------------------ */

const BUILDERS: Record<SnapshotFamily, () => Promise<any>> = {
  forecasts: buildForecasts,
  forecast_verification: buildForecastVerification,
  consensus: buildConsensus,
  pricing: buildPricing,
  signals: buildSignals,
  portfolio: buildPortfolio,
  execution_candidates: buildExecutionCandidates,
  demo_orders: buildDemoOrders,
  live_orders: buildLiveOrders,
  settlements: buildSettlements,
  positions: buildPositions,
  pnl: buildPnl,
  health_alerts: buildHealthAlerts,
  operator_daily: buildOperatorDaily,
  active_models: buildActiveModels,
};

export async function buildFamilySnapshot(family: SnapshotFamily): Promise<any> {
  const builder = BUILDERS[family];
  if (!builder) throw new Error(`Unknown family: ${family}`);
  const payload = await builder();
  const modelTags = await buildActiveModels();
  const snap = await writeSnapshot(family, today(), payload, { modelTags });
  return snap;
}

export async function buildDailySnapshot(): Promise<{ count: number; families: string[] }> {
  const date = today();
  const modelTags = await buildActiveModels();
  const families: string[] = [];

  for (const [family, builder] of Object.entries(BUILDERS)) {
    try {
      const payload = await builder();
      await writeSnapshot(family as SnapshotFamily, date, payload, { modelTags });
      families.push(family);
    } catch { /* skip failed families */ }
  }

  await logAuditEvent({
    actor: 'admin',
    eventType: 'daily_snapshot_built',
    targetType: 'system',
    targetId: 'research-store',
    summary: `Daily snapshot built: ${families.length} families for ${date}`,
  });

  return { count: families.length, families };
}
