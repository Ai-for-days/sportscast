import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getRedis } from '../../../../lib/redis';

export const prerender = false;

async function buildExecutionEconomics() {
  const redis = getRedis();

  // Gather orders
  const demoIds = await redis.zrange('kalshi:demo:orders', 0, 199, { rev: true }) || [];
  const liveIds = await redis.zrange('kalshi:live:orders', 0, 199, { rev: true }) || [];
  const demoOrders: any[] = [];
  for (const id of demoIds) { const r = await redis.get(`kalshi:demo:order:${id}`); if (r) demoOrders.push(typeof r === 'string' ? JSON.parse(r) : r); }
  const liveOrders: any[] = [];
  for (const id of liveIds) { const r = await redis.get(`kalshi:live:order:${id}`); if (r) liveOrders.push(typeof r === 'string' ? JSON.parse(r) : r); }

  // Gather candidates
  const candIds = await redis.zrange('exec:candidates:all', 0, 199, { rev: true }) || [];
  const candMap: Record<string, any> = {};
  for (const id of candIds) { const r = await redis.get(`exec:candidate:${id}`); if (r) { const c = typeof r === 'string' ? JSON.parse(r) : r; candMap[c.id] = c; } }

  // Gather settlements
  const settIds = await redis.zrange('settlements:all', 0, 199, { rev: true }) || [];
  const settlements: any[] = [];
  for (const id of settIds) { const r = await redis.get(`settlement:${id}`); if (r) settlements.push(typeof r === 'string' ? JSON.parse(r) : r); }

  // Build linked records
  const allOrders = [
    ...demoOrders.map(o => ({ ...o, orderSource: 'demo' })),
    ...liveOrders.map(o => ({ ...o, orderSource: 'live' })),
  ];

  const records = allOrders.map(o => {
    const cand = o.candidateId ? candMap[o.candidateId] : null;
    const sett = settlements.find(s => s.orderId === o.id);

    // Cost basis: prefer direct field (Step 66), fall back to inferred
    const directCostBasis = o.costBasisCents;
    const inferredCostBasis = (o.price != null && o.quantity != null) ? Math.round(o.price * o.quantity * 100) : null;
    const costBasisCents = directCostBasis || inferredCostBasis;
    const costBasisSource = directCostBasis ? 'direct' : inferredCostBasis ? 'inferred' : 'unavailable';
    const stakeCents = cand?.recommendedStakeCents || costBasisCents;
    const hasDirectFillPrice = o.fillPriceCents != null;
    const hasMarketSnapshot = !!cand?.marketSnapshot;
    const netPnlCents = sett?.netPnlCents;
    const feesCents = sett?.feesCents || 0;

    // Proxy ROI: netPnl / stake
    const proxyRoi = (netPnlCents != null && stakeCents && stakeCents > 0)
      ? Math.round(netPnlCents / stakeCents * 10000) / 100  // percentage
      : null;

    // Proxy slippage: expected edge - (realized pnl / stake)
    // This is approximate because expected edge is probability-based and realized is dollar-based
    const expectedEdge = cand?.edge != null ? Math.abs(cand.edge) : null;
    const realizedEdgeProxy = proxyRoi != null ? proxyRoi / 100 : null;
    const slippageProxy = (expectedEdge != null && realizedEdgeProxy != null)
      ? Math.round((expectedEdge - realizedEdgeProxy) * 10000) / 100  // percentage points
      : null;

    return {
      orderId: o.id,
      orderSource: o.orderSource,
      ticker: o.ticker,
      side: o.side,
      status: o.status,
      confidence: cand?.confidence,
      expectedEdge,
      orderPrice: o.price,
      quantity: o.quantity,
      costBasisCents,
      stakeCents,
      feesCents,
      netPnlCents,
      proxyRoi,
      slippageProxy,
      resolved: ['filled', 'cancelled', 'failed'].includes(o.status),
      hasSettlement: !!sett,
      hasCandidateLink: !!cand,
      costBasisSource,
      hasDirectFillPrice,
      hasMarketSnapshot,
      fillPriceCents: o.fillPriceCents,
      submittedPriceCents: o.submittedPriceCents,
    };
  });

  const withPnl = records.filter(r => r.netPnlCents != null);
  const withEdge = records.filter(r => r.expectedEdge != null);
  const withRoi = records.filter(r => r.proxyRoi != null);
  const withSlippage = records.filter(r => r.slippageProxy != null);

  // Aggregates
  const avgExpectedEdge = withEdge.length > 0 ? Math.round(withEdge.reduce((s, r) => s + (r.expectedEdge as number), 0) / withEdge.length * 10000) / 100 : null;
  const avgProxyRoi = withRoi.length > 0 ? Math.round(withRoi.reduce((s, r) => s + (r.proxyRoi as number), 0) / withRoi.length * 100) / 100 : null;
  const avgSlippage = withSlippage.length > 0 ? Math.round(withSlippage.reduce((s, r) => s + (r.slippageProxy as number), 0) / withSlippage.length * 100) / 100 : null;
  const totalFees = withPnl.reduce((s, r) => s + (r.feesCents || 0), 0);

  // Edge buckets
  const edgeBuckets = [
    { label: '<2%', min: 0, max: 0.02 },
    { label: '2–5%', min: 0.02, max: 0.05 },
    { label: '5–10%', min: 0.05, max: 0.10 },
    { label: '>10%', min: 0.10, max: Infinity },
  ].map(b => {
    const inBucket = withEdge.filter(r => (r.expectedEdge as number) >= b.min && (r.expectedEdge as number) < b.max);
    const bucketRoi = inBucket.filter(r => r.proxyRoi != null);
    return {
      bucket: b.label,
      count: inBucket.length,
      avgEdge: inBucket.length > 0 ? `${(inBucket.reduce((s, r) => s + (r.expectedEdge as number), 0) / inBucket.length * 100).toFixed(1)}%` : '—',
      avgRoi: bucketRoi.length > 0 ? `${(bucketRoi.reduce((s, r) => s + (r.proxyRoi as number), 0) / bucketRoi.length).toFixed(1)}%` : '—',
      withPnl: bucketRoi.length,
      evidence: bucketRoi.length >= 10 ? 'sufficient' : bucketRoi.length >= 3 ? 'limited' : 'insufficient',
    };
  });

  // Demo vs live
  const modeBreakdown = ['demo', 'live'].map(mode => {
    const modeRecords = records.filter(r => r.orderSource === mode);
    const modeRoi = modeRecords.filter(r => r.proxyRoi != null);
    return {
      mode,
      count: modeRecords.length,
      resolved: modeRecords.filter(r => r.resolved).length,
      withPnl: modeRoi.length,
      avgRoi: modeRoi.length > 0 ? `${(modeRoi.reduce((s, r) => s + (r.proxyRoi as number), 0) / modeRoi.length).toFixed(1)}%` : '—',
    };
  });

  // Expected vs Realized
  const expectedVsRealized = {
    avgExpectedEdge: avgExpectedEdge != null ? `${avgExpectedEdge.toFixed(1)}%` : 'Not measurable',
    avgRealizedRoi: avgProxyRoi != null ? `${avgProxyRoi.toFixed(1)}%` : 'Not measurable',
    avgSlippageProxy: avgSlippage != null ? `${avgSlippage.toFixed(1)} pp` : 'Not measurable',
    totalFeesCents: totalFees,
    sampleSize: withRoi.length,
    assessment: withRoi.length >= 20
      ? 'Limited evidence — proxy ROI and slippage estimates available but based on inferred cost basis, not direct fill-price data.'
      : withRoi.length > 0
        ? 'Insufficient evidence — too few resolved trades for meaningful comparison. Treat all figures as preliminary.'
        : 'No resolved data — expected vs realized comparison not yet possible.',
  };

  // Schema gaps
  const schemaGaps = [
    { field: 'Signal-time market snapshot', description: 'The market price at the moment a signal is generated is not stored. Cannot compute true signal-to-execution price drift.', impact: 'Prevents direct slippage measurement' },
    { field: 'Execution fill price', description: 'Kalshi fill data may be present in fillData but is not consistently extracted into a normalized fill-price field.', impact: 'Cost basis is inferred from order price × quantity, not actual fill' },
    { field: 'Per-trade cost basis field', description: 'No explicit cost-basis field exists on order records. Inferred from order price and quantity.', impact: 'ROI is a proxy, not exact' },
    { field: 'Slippage baseline', description: 'No stored reference price to measure slippage against. Expected edge is probability-based; realized P&L is dollar-based.', impact: 'Slippage is approximated as edge minus realized ROI — not true price slippage' },
    { field: 'Out-of-sample run tagging', description: 'No mechanism to tag evaluation runs as in-sample vs out-of-sample.', impact: 'Cannot distinguish training-period data from genuine forward evaluation' },
  ];

  return {
    summary: {
      totalOrders: records.length,
      withCandidateLink: records.filter(r => r.hasCandidateLink).length,
      withSettlement: records.filter(r => r.hasSettlement).length,
      withEdgeData: withEdge.length,
      withRoiData: withRoi.length,
      withSlippageData: withSlippage.length,
      overallEvidence: withRoi.length >= 20 ? 'limited' : withRoi.length > 0 ? 'insufficient' : 'none',
    },
    expectedVsRealized,
    edgeBuckets,
    modeBreakdown,
    schemaGaps,
    schemaCoverage: {
      totalOrders: records.length,
      withDirectCostBasis: records.filter(r => r.costBasisSource === 'direct').length,
      withInferredCostBasis: records.filter(r => r.costBasisSource === 'inferred').length,
      withDirectFillPrice: records.filter(r => r.hasDirectFillPrice).length,
      withMarketSnapshot: records.filter(r => r.hasMarketSnapshot).length,
      trueSlippageMeasurable: records.filter(r => r.hasDirectFillPrice && r.submittedPriceCents != null).length,
      note: 'Schema v2 fields (Step 66) are populated for new orders going forward. Historical orders use inferred values.',
    },
  };
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  try {
    const data = await buildExecutionEconomics();
    return new Response(JSON.stringify(data), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
