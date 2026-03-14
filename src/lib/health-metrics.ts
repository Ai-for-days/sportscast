import { getRedis } from './redis';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MetricEvent {
  id: string;
  timestamp: string;
  operation: string;
  subsystem: string;
  durationMs: number;
  status: 'success' | 'error';
  metadata?: any;
}

export interface SubsystemHealth {
  subsystem: string;
  operation: string;
  lastRuntime: number | null;
  avgRuntime: number;
  p95Runtime: number;
  errorCount: number;
  totalCount: number;
  lastSuccess: string | null;
  lastRun: string | null;
  status: 'healthy' | 'degraded' | 'slow' | 'error' | 'no_data';
}

const METRIC_SET = 'metrics:events';
const METRIC_PREFIX = 'metrics:event:';
const MAX_EVENTS = 1000;

/* ------------------------------------------------------------------ */
/*  Record metrics                                                     */
/* ------------------------------------------------------------------ */

export async function recordMetric(
  operation: string,
  subsystem: string,
  durationMs: number,
  status: 'success' | 'error' = 'success',
  metadata?: any,
): Promise<MetricEvent> {
  const redis = getRedis();
  const id = `met-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const event: MetricEvent = {
    id,
    timestamp: new Date().toISOString(),
    operation,
    subsystem,
    durationMs,
    status,
    metadata,
  };

  await redis.set(`${METRIC_PREFIX}${id}`, JSON.stringify(event));
  await redis.zadd(METRIC_SET, { score: Date.now(), member: id });

  // Auto-trim
  const count = await redis.zcard(METRIC_SET);
  if (count > MAX_EVENTS) {
    const toRemove = await redis.zrange(METRIC_SET, 0, count - MAX_EVENTS - 1);
    for (const rid of toRemove) { await redis.del(`${METRIC_PREFIX}${rid}`); }
    await redis.zremrangebyrank(METRIC_SET, 0, count - MAX_EVENTS - 1);
  }

  return event;
}

/**
 * Wrap an async operation with metric recording.
 */
export async function withMetric<T>(
  operation: string,
  subsystem: string,
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    await recordMetric(operation, subsystem, durationMs, 'success').catch(() => {});
    return { result, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    await recordMetric(operation, subsystem, durationMs, 'error', { error: (err as any).message }).catch(() => {});
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  Query metrics                                                      */
/* ------------------------------------------------------------------ */

export async function listMetricEvents(limit = 100): Promise<MetricEvent[]> {
  const redis = getRedis();
  const ids = await redis.zrange(METRIC_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const sliced = ids.slice(0, limit);
  const events: MetricEvent[] = [];
  for (const id of sliced) {
    const raw = await redis.get(`${METRIC_PREFIX}${id}`);
    if (raw) { events.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as MetricEvent); }
  }
  return events;
}

/* ------------------------------------------------------------------ */
/*  Subsystem definitions                                              */
/* ------------------------------------------------------------------ */

const SUBSYSTEM_OPS: Array<{ subsystem: string; operation: string; label: string; slowThresholdMs: number }> = [
  // Forecasting
  { subsystem: 'forecasting', operation: 'forecast_ingestion', label: 'Forecast Ingestion', slowThresholdMs: 5000 },
  { subsystem: 'forecasting', operation: 'verification', label: 'Verification', slowThresholdMs: 5000 },
  { subsystem: 'forecasting', operation: 'consensus_generation', label: 'Consensus Generation', slowThresholdMs: 5000 },
  // Markets
  { subsystem: 'markets', operation: 'pricing_engine', label: 'Pricing Engine', slowThresholdMs: 3000 },
  { subsystem: 'markets', operation: 'market_generation', label: 'Market Generation', slowThresholdMs: 3000 },
  // Signals
  { subsystem: 'signals', operation: 'signal_generation', label: 'Signal Generation', slowThresholdMs: 5000 },
  { subsystem: 'signals', operation: 'candidate_creation', label: 'Candidate Creation', slowThresholdMs: 3000 },
  // Execution
  { subsystem: 'execution', operation: 'demo_execution', label: 'Demo Execution', slowThresholdMs: 10000 },
  { subsystem: 'execution', operation: 'live_execution', label: 'Live Execution', slowThresholdMs: 10000 },
  // Accounting
  { subsystem: 'accounting', operation: 'reconciliation', label: 'Reconciliation', slowThresholdMs: 10000 },
  { subsystem: 'accounting', operation: 'settlement', label: 'Settlement', slowThresholdMs: 10000 },
  // System
  { subsystem: 'system', operation: 'redis_query', label: 'Redis Query', slowThresholdMs: 500 },
  { subsystem: 'system', operation: 'api_request', label: 'API Request', slowThresholdMs: 2000 },
  { subsystem: 'system', operation: 'validation_scan', label: 'Validation Scan', slowThresholdMs: 10000 },
  { subsystem: 'system', operation: 'integrity_scan', label: 'Integrity Scan', slowThresholdMs: 15000 },
];

export function getSubsystemDefinitions() {
  return SUBSYSTEM_OPS;
}

export const SUBSYSTEM_LABELS: Record<string, string> = {
  forecasting: 'Forecasting',
  markets: 'Markets',
  signals: 'Signals',
  execution: 'Execution',
  accounting: 'Accounting',
  system: 'System',
};

/* ------------------------------------------------------------------ */
/*  Compute health                                                     */
/* ------------------------------------------------------------------ */

export async function computeSubsystemHealth(): Promise<SubsystemHealth[]> {
  const events = await listMetricEvents(500);
  const results: SubsystemHealth[] = [];

  for (const def of SUBSYSTEM_OPS) {
    const opEvents = events.filter(e => e.operation === def.operation);

    if (opEvents.length === 0) {
      results.push({
        subsystem: def.subsystem,
        operation: def.operation,
        lastRuntime: null,
        avgRuntime: 0,
        p95Runtime: 0,
        errorCount: 0,
        totalCount: 0,
        lastSuccess: null,
        lastRun: null,
        status: 'no_data',
      });
      continue;
    }

    const durations = opEvents.map(e => e.durationMs).sort((a, b) => a - b);
    const avg = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);
    const p95Idx = Math.min(Math.floor(durations.length * 0.95), durations.length - 1);
    const p95 = durations[p95Idx];
    const errors = opEvents.filter(e => e.status === 'error').length;
    const lastEvent = opEvents[0];
    const lastSuccess = opEvents.find(e => e.status === 'success');

    let status: SubsystemHealth['status'] = 'healthy';
    if (errors > 0 && errors / opEvents.length > 0.5) status = 'error';
    else if (errors > 0) status = 'degraded';
    else if (p95 > def.slowThresholdMs) status = 'slow';

    results.push({
      subsystem: def.subsystem,
      operation: def.operation,
      lastRuntime: lastEvent.durationMs,
      avgRuntime: avg,
      p95Runtime: p95,
      errorCount: errors,
      totalCount: opEvents.length,
      lastSuccess: lastSuccess?.timestamp || null,
      lastRun: lastEvent.timestamp,
      status,
    });
  }

  return results;
}

export async function getHealthSummary() {
  const health = await computeSubsystemHealth();
  const events = await listMetricEvents(100);
  const totalErrors = events.filter(e => e.status === 'error').length;
  const allDurations = events.map(e => e.durationMs);
  const avgLatency = allDurations.length > 0 ? Math.round(allDurations.reduce((s, d) => s + d, 0) / allDurations.length) : 0;
  const slowOps = health.filter(h => h.status === 'slow' || h.status === 'degraded').length;

  return {
    totalErrors,
    avgLatency,
    slowOperations: slowOps,
    recentEvents: events.length,
    subsystems: health,
  };
}
