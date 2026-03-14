/* ------------------------------------------------------------------ */
/*  Performance timing instrumentation                                 */
/*  Stores recent endpoint performance samples in-memory               */
/* ------------------------------------------------------------------ */

export interface PerfSample {
  id: string;
  route: string;
  category: string;
  durationMs: number;
  success: boolean;
  rowCount?: number;
  createdAt: string;
}

interface RouteStats {
  route: string;
  category: string;
  totalHits: number;
  failures: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastSeen: string;
}

const MAX_SAMPLES = 500;
const samples: PerfSample[] = [];
const routeStats = new Map<string, RouteStats>();

/* ------------------------------------------------------------------ */
/*  Record a timing sample                                             */
/* ------------------------------------------------------------------ */

export function recordTiming(input: {
  route: string;
  category: string;
  durationMs: number;
  success?: boolean;
  rowCount?: number;
}): PerfSample {
  const sample: PerfSample = {
    id: `perf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    route: input.route,
    category: input.category,
    durationMs: input.durationMs,
    success: input.success !== false,
    rowCount: input.rowCount,
    createdAt: new Date().toISOString(),
  };

  samples.unshift(sample);
  if (samples.length > MAX_SAMPLES) samples.length = MAX_SAMPLES;

  // Update aggregated stats
  const existing = routeStats.get(input.route);
  if (existing) {
    existing.totalHits += 1;
    if (!sample.success) existing.failures += 1;
    existing.totalDurationMs += input.durationMs;
    existing.maxDurationMs = Math.max(existing.maxDurationMs, input.durationMs);
    existing.lastSeen = sample.createdAt;
  } else {
    routeStats.set(input.route, {
      route: input.route,
      category: input.category,
      totalHits: 1,
      failures: sample.success ? 0 : 1,
      totalDurationMs: input.durationMs,
      maxDurationMs: input.durationMs,
      lastSeen: sample.createdAt,
    });
  }

  return sample;
}

/* ------------------------------------------------------------------ */
/*  Timing helper — wraps an async function                            */
/* ------------------------------------------------------------------ */

export async function withTiming<T>(
  route: string,
  category: string,
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  let success = true;
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    recordTiming({ route, category, durationMs, success: true });
    return { result, durationMs };
  } catch (err) {
    success = false;
    const durationMs = Date.now() - start;
    recordTiming({ route, category, durationMs, success: false });
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  Query                                                              */
/* ------------------------------------------------------------------ */

export function getRecentSamples(limit = 50): PerfSample[] {
  return samples.slice(0, limit);
}

export function getRouteStats(): Array<RouteStats & { avgDurationMs: number }> {
  return Array.from(routeStats.values()).map(s => ({
    ...s,
    avgDurationMs: Math.round(s.totalDurationMs / s.totalHits),
  }));
}

export function getPerformanceSummary(): {
  totalRequests: number;
  avgDurationMs: number;
  slowEndpoints: number;
  recentFailures: number;
  trackedRoutes: number;
} {
  const stats = getRouteStats();
  const totalRequests = stats.reduce((s, r) => s + r.totalHits, 0);
  const totalDuration = stats.reduce((s, r) => s + r.totalDurationMs, 0);
  const slowThreshold = 500; // ms
  return {
    totalRequests,
    avgDurationMs: totalRequests > 0 ? Math.round(totalDuration / totalRequests) : 0,
    slowEndpoints: stats.filter(r => r.avgDurationMs > slowThreshold).length,
    recentFailures: samples.filter(s => !s.success).length,
    trackedRoutes: stats.length,
  };
}

export function resetMetrics(): { cleared: number } {
  const count = samples.length + routeStats.size;
  samples.length = 0;
  routeStats.clear();
  return { cleared: count };
}
