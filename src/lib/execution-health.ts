import { getRedis } from './redis';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type HealthCategory = 'api' | 'data' | 'execution' | 'storage' | 'research' | 'ops';
export type HealthStatus = 'healthy' | 'warning' | 'critical';

export interface HealthCheck {
  key: string;
  label: string;
  category: HealthCategory;
  status: HealthStatus;
  message: string;
  checkedAt: string;
  latencyMs?: number;
}

export interface HealthOverview {
  healthy: number;
  warning: number;
  critical: number;
  stale: number;
  lastCheckedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Freshness thresholds (configurable)                                 */
/* ------------------------------------------------------------------ */

export const FRESHNESS_THRESHOLDS = {
  RECONCILIATION_WARNING_MIN: 30,
  RECONCILIATION_CRITICAL_MIN: 60,
  INGESTION_WARNING_MIN: 15,
  INGESTION_CRITICAL_MIN: 45,
  POSITION_REBUILD_WARNING_MIN: 60,
  POSITION_REBUILD_CRITICAL_MIN: 180,
  LEDGER_REBUILD_WARNING_MIN: 60,
  LEDGER_REBUILD_CRITICAL_MIN: 180,
  ORDER_REFRESH_WARNING_MIN: 15,
  ORDER_REFRESH_CRITICAL_MIN: 60,
  PREFLIGHT_WARNING_MIN: 120,
  PREFLIGHT_CRITICAL_MIN: 240,
  READINESS_WARNING_MIN: 30,
  READINESS_CRITICAL_MIN: 120,
  AUDIT_LOG_WARNING_MIN: 60,
  AUDIT_LOG_CRITICAL_MIN: 240,
};

/* ------------------------------------------------------------------ */
/*  Individual check helpers                                            */
/* ------------------------------------------------------------------ */

async function checkRedis(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const redis = getRedis();
    const testKey = `health:ping:${Date.now()}`;
    await redis.set(testKey, 'pong', { ex: 10 });
    const val = await redis.get(testKey);
    const latency = Date.now() - start;
    if (val === 'pong') {
      return { key: 'redis', label: 'Redis Read/Write', category: 'storage', status: latency > 500 ? 'warning' : 'healthy', message: `OK (${latency}ms)`, checkedAt: new Date().toISOString(), latencyMs: latency };
    }
    return { key: 'redis', label: 'Redis Read/Write', category: 'storage', status: 'critical', message: 'Read mismatch', checkedAt: new Date().toISOString(), latencyMs: latency };
  } catch (e: any) {
    return { key: 'redis', label: 'Redis Read/Write', category: 'storage', status: 'critical', message: e.message, checkedAt: new Date().toISOString(), latencyMs: Date.now() - start };
  }
}

async function checkFreshness(
  key: string,
  label: string,
  category: HealthCategory,
  redisKey: string,
  warningMin: number,
  criticalMin: number,
): Promise<HealthCheck> {
  try {
    const redis = getRedis();
    const raw = await redis.get(redisKey);
    if (!raw) {
      return { key, label, category, status: 'warning', message: 'No data found', checkedAt: new Date().toISOString() };
    }
    let timestamp: string | null = null;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        timestamp = parsed.checkedAt || parsed.updatedAt || parsed.createdAt || parsed.completedAt || parsed.timestamp;
      } catch {
        timestamp = raw;
      }
    }
    if (!timestamp) {
      return { key, label, category, status: 'warning', message: 'No timestamp', checkedAt: new Date().toISOString() };
    }
    const ageMin = (Date.now() - new Date(timestamp).getTime()) / 60000;
    if (ageMin >= criticalMin) {
      return { key, label, category, status: 'critical', message: `Stale: ${Math.round(ageMin)}m ago`, checkedAt: new Date().toISOString() };
    }
    if (ageMin >= warningMin) {
      return { key, label, category, status: 'warning', message: `${Math.round(ageMin)}m since last update`, checkedAt: new Date().toISOString() };
    }
    return { key, label, category, status: 'healthy', message: `Fresh (${Math.round(ageMin)}m ago)`, checkedAt: new Date().toISOString() };
  } catch (e: any) {
    return { key, label, category, status: 'critical', message: e.message, checkedAt: new Date().toISOString() };
  }
}

async function checkSetExists(
  key: string,
  label: string,
  category: HealthCategory,
  redisSetKey: string,
  minItems: number,
): Promise<HealthCheck> {
  try {
    const redis = getRedis();
    const count = await redis.zcard(redisSetKey);
    if (count >= minItems) {
      return { key, label, category, status: 'healthy', message: `${count} items`, checkedAt: new Date().toISOString() };
    }
    return { key, label, category, status: count === 0 ? 'warning' : 'healthy', message: `${count} items`, checkedAt: new Date().toISOString() };
  } catch (e: any) {
    return { key, label, category, status: 'critical', message: e.message, checkedAt: new Date().toISOString() };
  }
}

async function checkKillSwitch(): Promise<HealthCheck> {
  try {
    const redis = getRedis();
    const raw = await redis.get('kill-switch');
    let active = false;
    if (raw) {
      try { active = (typeof raw === 'string' ? JSON.parse(raw) : raw as any).active === true; } catch { /* ignore */ }
    }
    if (active) {
      return { key: 'kill_switch', label: 'Kill Switch', category: 'execution', status: 'critical', message: 'KILL SWITCH ACTIVE', checkedAt: new Date().toISOString() };
    }
    return { key: 'kill_switch', label: 'Kill Switch', category: 'execution', status: 'healthy', message: 'Inactive', checkedAt: new Date().toISOString() };
  } catch (e: any) {
    return { key: 'kill_switch', label: 'Kill Switch', category: 'execution', status: 'warning', message: e.message, checkedAt: new Date().toISOString() };
  }
}

async function checkLiveMode(): Promise<HealthCheck> {
  try {
    const redis = getRedis();
    const raw = await redis.get('live-trading-config');
    let enabled = false;
    if (raw) {
      try { enabled = (typeof raw === 'string' ? JSON.parse(raw) : raw as any).enabled === true; } catch { /* ignore */ }
    }
    return { key: 'live_mode', label: 'Live Trading Mode', category: 'execution', status: 'healthy', message: enabled ? 'ENABLED' : 'Disabled', checkedAt: new Date().toISOString() };
  } catch (e: any) {
    return { key: 'live_mode', label: 'Live Trading Mode', category: 'execution', status: 'warning', message: e.message, checkedAt: new Date().toISOString() };
  }
}

/* ------------------------------------------------------------------ */
/*  Run all health checks                                               */
/* ------------------------------------------------------------------ */

export async function runHealthChecks(): Promise<HealthCheck[]> {
  const T = FRESHNESS_THRESHOLDS;

  const checks = await Promise.all([
    // Storage
    checkRedis(),

    // API / Data
    checkSetExists('kalshi_markets', 'Kalshi Market Ingestion', 'data', 'kalshi-markets:all', 1),
    checkSetExists('kalshi_signals', 'Kalshi Signal Generation', 'data', 'kalshi-signals:all', 0),

    // Execution
    checkKillSwitch(),
    checkLiveMode(),
    checkSetExists('demo_orders', 'Demo Orders', 'execution', 'demo-orders:all', 0),
    checkSetExists('live_orders', 'Live Orders', 'execution', 'live-orders:all', 0),
    checkSetExists('exec_candidates', 'Execution Candidates', 'execution', 'exec-candidates:all', 0),

    // Ops
    checkSetExists('recon_records', 'Reconciliation Records', 'ops', 'recon:all', 0),
    checkSetExists('positions', 'Positions', 'ops', 'positions:all', 0),
    checkSetExists('pnl_entries', 'P&L Ledger Entries', 'ops', 'pnl:entries', 0),
    checkSetExists('audit_log', 'Audit Log', 'ops', 'audit-log:all', 0),

    // Research / Governance
    checkSetExists('model_versions', 'Model Registry', 'research', 'model:versions:all', 0),
    checkSetExists('experiments', 'Experiments', 'research', 'experiments:all', 0),
    checkSetExists('sandbox_runs', 'Sandbox Runs', 'research', 'sandbox:runs:all', 0),

    // Repricing
    checkSetExists('applied_reprices', 'Applied Reprices', 'ops', 'reprice:applied:all', 0),
  ]);

  // Save last check time
  try {
    const redis = getRedis();
    await redis.set('health:last-check', JSON.stringify({ checkedAt: new Date().toISOString(), total: checks.length }));
  } catch { /* ignore */ }

  return checks;
}

export function computeHealthOverview(checks: HealthCheck[]): HealthOverview {
  return {
    healthy: checks.filter(c => c.status === 'healthy').length,
    warning: checks.filter(c => c.status === 'warning').length,
    critical: checks.filter(c => c.status === 'critical').length,
    stale: checks.filter(c => c.message.includes('Stale')).length,
    lastCheckedAt: new Date().toISOString(),
  };
}
