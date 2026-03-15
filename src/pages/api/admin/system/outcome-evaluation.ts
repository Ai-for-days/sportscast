import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getRedis } from '../../../../lib/redis';

export const prerender = false;

interface OutcomeRecord {
  source: string;
  candidateId?: string;
  ticker?: string;
  side?: string;
  expectedEdge?: number;
  confidence?: string;
  status?: string;
  pnlCents?: number;
  resolved: boolean;
}

async function buildOutcomeEvaluation() {
  const redis = getRedis();

  /* ================================================================ */
  /*  Gather data from execution + settlement                         */
  /* ================================================================ */

  // Demo orders
  const demoCount = await redis.zcard('kalshi:demo:orders');
  const demoIds = demoCount > 0 ? await redis.zrange('kalshi:demo:orders', 0, Math.min(demoCount, 200) - 1, { rev: true }) : [];
  const demoOrders: any[] = [];
  for (const id of demoIds) {
    const raw = await redis.get(`kalshi:demo:order:${id}`);
    if (raw) demoOrders.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }

  // Live orders
  const liveCount = await redis.zcard('kalshi:live:orders');
  const liveIds = liveCount > 0 ? await redis.zrange('kalshi:live:orders', 0, Math.min(liveCount, 200) - 1, { rev: true }) : [];
  const liveOrders: any[] = [];
  for (const id of liveIds) {
    const raw = await redis.get(`kalshi:live:order:${id}`);
    if (raw) liveOrders.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }

  // Candidates (for edge/confidence linkage)
  const candCount = await redis.zcard('exec:candidates:all');
  const candIds = candCount > 0 ? await redis.zrange('exec:candidates:all', 0, Math.min(candCount, 200) - 1, { rev: true }) : [];
  const candidateMap: Record<string, any> = {};
  for (const id of candIds) {
    const raw = await redis.get(`exec:candidate:${id}`);
    if (raw) {
      const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
      candidateMap[c.id] = c;
    }
  }

  // Settlements
  const settCount = await redis.zcard('settlements:all');
  const settIds = settCount > 0 ? await redis.zrange('settlements:all', 0, Math.min(settCount, 200) - 1, { rev: true }) : [];
  const settlements: any[] = [];
  for (const id of settIds) {
    const raw = await redis.get(`settlement:${id}`);
    if (raw) settlements.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }

  /* ================================================================ */
  /*  Build outcome records                                            */
  /* ================================================================ */

  const allOrders = [
    ...demoOrders.map(o => ({ ...o, orderSource: 'demo' })),
    ...liveOrders.map(o => ({ ...o, orderSource: 'live' })),
  ];

  const resolvedStatuses = ['filled', 'cancelled', 'failed'];
  const resolvedOrders = allOrders.filter(o => resolvedStatuses.includes(o.status));
  const filledOrders = allOrders.filter(o => o.status === 'filled');

  // Link orders to candidates for edge data
  const outcomeRecords: OutcomeRecord[] = allOrders.map(o => {
    const cand = o.candidateId ? candidateMap[o.candidateId] : null;
    const sett = settlements.find(s => s.orderId === o.id);
    return {
      source: o.orderSource,
      candidateId: o.candidateId,
      ticker: o.ticker,
      side: o.side,
      expectedEdge: cand?.edge,
      confidence: cand?.confidence,
      status: o.status,
      pnlCents: sett?.netPnlCents,
      resolved: resolvedStatuses.includes(o.status),
    };
  });

  /* ================================================================ */
  /*  Compute metrics                                                  */
  /* ================================================================ */

  const totalOrders = allOrders.length;
  const totalResolved = resolvedOrders.length;
  const totalFilled = filledOrders.length;
  const totalCancelled = allOrders.filter(o => o.status === 'cancelled').length;
  const totalFailed = allOrders.filter(o => o.status === 'failed').length;
  const totalOpen = allOrders.filter(o => o.status === 'open' || o.status === 'pending').length;

  // Win/loss from settlements
  const withPnl = outcomeRecords.filter(o => o.pnlCents != null);
  const wins = withPnl.filter(o => (o.pnlCents as number) > 0).length;
  const losses = withPnl.filter(o => (o.pnlCents as number) < 0).length;
  const pushes = withPnl.filter(o => (o.pnlCents as number) === 0).length;
  const totalPnlCents = withPnl.reduce((s, o) => s + (o.pnlCents as number), 0);
  const avgPnlCents = withPnl.length > 0 ? Math.round(totalPnlCents / withPnl.length) : null;

  // Edge buckets
  const withEdge = outcomeRecords.filter(o => o.expectedEdge != null);
  const edgeBuckets = [
    { label: '<2%', min: 0, max: 0.02 },
    { label: '2–5%', min: 0.02, max: 0.05 },
    { label: '5–10%', min: 0.05, max: 0.10 },
    { label: '>10%', min: 0.10, max: Infinity },
  ].map(b => {
    const inBucket = withEdge.filter(o => {
      const e = Math.abs(o.expectedEdge as number);
      return e >= b.min && e < b.max;
    });
    const bucketPnl = inBucket.filter(o => o.pnlCents != null);
    const bucketWins = bucketPnl.filter(o => (o.pnlCents as number) > 0).length;
    return {
      bucket: b.label,
      count: inBucket.length,
      resolved: inBucket.filter(o => o.resolved).length,
      withPnl: bucketPnl.length,
      wins: bucketWins,
      hitRate: bucketPnl.length > 0 ? Math.round(bucketWins / bucketPnl.length * 100) : null,
      avgPnlCents: bucketPnl.length > 0 ? Math.round(bucketPnl.reduce((s, o) => s + (o.pnlCents as number), 0) / bucketPnl.length) : null,
      evidenceLevel: bucketPnl.length >= 10 ? 'sufficient' : bucketPnl.length >= 3 ? 'limited' : 'insufficient',
    };
  });

  // Confidence buckets
  const confBuckets = ['low', 'medium', 'high'].map(c => {
    const inBucket = outcomeRecords.filter(o => o.confidence === c);
    const bucketPnl = inBucket.filter(o => o.pnlCents != null);
    const bucketWins = bucketPnl.filter(o => (o.pnlCents as number) > 0).length;
    return {
      confidence: c,
      count: inBucket.length,
      withPnl: bucketPnl.length,
      wins: bucketWins,
      hitRate: bucketPnl.length > 0 ? Math.round(bucketWins / bucketPnl.length * 100) : null,
      evidenceLevel: bucketPnl.length >= 10 ? 'sufficient' : bucketPnl.length >= 3 ? 'limited' : 'insufficient',
    };
  });

  // Funnel
  const signalCount = await redis.zcard('kalshi-signals:all');
  const funnel = {
    signals: signalCount,
    candidates: candCount,
    executions: totalOrders,
    filled: totalFilled,
    settled: withPnl.length,
  };

  /* ================================================================ */
  /*  Assessments                                                      */
  /* ================================================================ */

  const whatThisProves = [
    withPnl.length > 0 ? `${withPnl.length} order(s) have settlement P&L data, enabling basic win/loss analysis.` : 'No settled P&L data available — cannot compute win/loss rates.',
    withEdge.length > 0 ? `${withEdge.length} orders linked to candidates with expected edge values.` : 'No edge linkage — cannot compare expected vs realized performance.',
    totalOrders > 0 ? `${totalOrders} total orders (${demoOrders.length} demo, ${liveOrders.length} live) provide execution history.` : 'No execution history available.',
    withPnl.length >= 20 ? 'Sample size may be approaching minimum for basic statistical observations.' : withPnl.length > 0 ? 'Sample size is too small for statistical confidence. Treat all metrics as preliminary.' : 'No resolved data — all metrics are unavailable.',
  ];

  const whatRemains = [
    'Realized slippage vs expected edge (requires tracking execution price vs signal price at time of generation)',
    'Out-of-sample monitoring windows (requires time-partitioned evaluation)',
    'Calibration of confidence scoring (requires sufficient resolved outcomes per confidence level)',
    'Market-type performance breakdown (requires market categorization in outcome records)',
    'True ROI computation (requires cost basis tracking per position)',
  ];

  const nextTests = [
    { test: 'Hit rate by edge bucket', requirement: '10+ resolved outcomes per bucket', currentStatus: edgeBuckets.some(b => b.withPnl >= 10) ? 'approaching' : 'insufficient data' },
    { test: 'Realized ROI by edge bucket', requirement: 'Cost basis + settlement P&L per trade', currentStatus: 'not yet trackable' },
    { test: 'Confidence scoring calibration', requirement: '20+ outcomes per confidence level', currentStatus: confBuckets.some(b => b.withPnl >= 20) ? 'approaching' : 'insufficient data' },
    { test: 'Realized slippage analysis', requirement: 'Signal generation price vs execution fill price', currentStatus: 'not tracked in current schema' },
    { test: 'Out-of-sample monitoring', requirement: 'Time-windowed performance evaluation', currentStatus: 'not yet implemented' },
  ];

  return {
    summary: {
      totalOrders, demoOrders: demoOrders.length, liveOrders: liveOrders.length,
      totalResolved, totalFilled, totalCancelled, totalFailed, totalOpen,
      settledWithPnl: withPnl.length, wins, losses, pushes,
      totalPnlCents, avgPnlCents,
      overallEvidence: withPnl.length >= 20 ? 'limited' : withPnl.length > 0 ? 'insufficient' : 'none',
    },
    edgeBuckets,
    confBuckets,
    funnel,
    whatThisProves,
    whatRemains,
    nextTests,
  };
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const evaluation = await buildOutcomeEvaluation();
    return new Response(JSON.stringify(evaluation), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
