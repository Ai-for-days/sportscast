import { listCandidates } from './order-builder';
import { listDemoOrders, listLiveOrders } from './kalshi-execution';
import { listPositions, computePositionSummary } from './positions';
import { listLedgerEntries, computeLedgerSummary } from './pnl-ledger';
import { listJournalEntries } from './trade-journal';
import { generateRankedSignals } from './signal-ranking';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BucketBreakdown {
  key: string;
  count: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnlCents: number;
  avgEdge: number;
  avgSignalScore: number;
}

export interface StrategyAnalytics {
  signals: { total: number; avgScore: number; avgEdge: number };
  candidates: { total: number; approved: number; blocked: number; sent: number };
  orders: {
    demoTotal: number; demoFilled: number; demoFillRate: number;
    liveTotal: number; liveFilled: number; liveFillRate: number;
  };
  pnl: {
    realizedCents: number; unrealizedCostCents: number; netCents: number;
    winCount: number; lossCount: number; winRate: number;
  };
  averages: {
    edgeAtEntry: number; signalScoreAtEntry: number;
  };
  bySource: BucketBreakdown[];
  byConfidence: BucketBreakdown[];
  bySizingTier: BucketBreakdown[];
  byMode: BucketBreakdown[];
}

/* ------------------------------------------------------------------ */
/*  Generate                                                           */
/* ------------------------------------------------------------------ */

export async function generateStrategyAnalytics(): Promise<StrategyAnalytics> {
  const [signals, candidates, demoOrders, liveOrders, positions, ledgerEntries, journalEntries] = await Promise.all([
    generateRankedSignals().catch(() => []),
    listCandidates().catch(() => []),
    listDemoOrders().catch(() => []),
    listLiveOrders().catch(() => []),
    listPositions().catch(() => []),
    listLedgerEntries(500).catch(() => []),
    listJournalEntries().catch(() => []),
  ]);

  // Signals
  const avgScore = signals.length > 0
    ? signals.reduce((s, sig) => s + (sig.compositeScore || 0), 0) / signals.length : 0;
  const avgEdge = signals.length > 0
    ? signals.reduce((s, sig) => s + Math.abs(sig.edge || 0), 0) / signals.length : 0;

  // Candidates
  const approved = candidates.filter(c => c.state === 'approved').length;
  const blocked = candidates.filter(c => c.state === 'blocked').length;
  const sent = candidates.filter(c => c.state === 'sent').length;

  // Orders
  const demoFilled = demoOrders.filter(o => o.status === 'filled').length;
  const liveFilled = liveOrders.filter(o => o.status === 'filled').length;

  // P&L from ledger
  const ledgerSummary = computeLedgerSummary(ledgerEntries);

  // Win/loss from journal
  const settled = journalEntries.filter(e => e.outcome?.settled);
  const wins = settled.filter(e => (e.outcome?.pnlCents || 0) > 0).length;
  const losses = settled.filter(e => (e.outcome?.pnlCents || 0) < 0).length;
  const winRate = settled.length > 0 ? wins / settled.length : 0;

  // Averages from candidates
  const sentOrApproved = candidates.filter(c => c.state === 'approved' || c.state === 'sent');
  const avgEntryEdge = sentOrApproved.length > 0
    ? sentOrApproved.reduce((s, c) => s + Math.abs(c.edge), 0) / sentOrApproved.length : 0;
  const avgEntryScore = sentOrApproved.length > 0
    ? sentOrApproved.reduce((s, c) => s + c.signalScore, 0) / sentOrApproved.length : 0;

  // Breakdowns
  const bySource = buildBreakdown(candidates, c => c.source, journalEntries);
  const byConfidence = buildBreakdown(candidates, c => c.confidence, journalEntries);
  const bySizingTier = buildBreakdown(candidates, c => c.sizingTier, journalEntries);

  // By mode breakdown from orders
  const byMode: BucketBreakdown[] = [];
  if (demoOrders.length > 0) {
    byMode.push({
      key: 'demo', count: demoOrders.length,
      winCount: 0, lossCount: 0, winRate: 0,
      totalPnlCents: 0,
      avgEdge: 0, avgSignalScore: 0,
    });
  }
  if (liveOrders.length > 0) {
    byMode.push({
      key: 'live', count: liveOrders.length,
      winCount: 0, lossCount: 0, winRate: 0,
      totalPnlCents: 0,
      avgEdge: 0, avgSignalScore: 0,
    });
  }

  return {
    signals: { total: signals.length, avgScore, avgEdge },
    candidates: { total: candidates.length, approved, blocked, sent },
    orders: {
      demoTotal: demoOrders.length, demoFilled, demoFillRate: demoOrders.length > 0 ? demoFilled / demoOrders.length : 0,
      liveTotal: liveOrders.length, liveFilled, liveFillRate: liveOrders.length > 0 ? liveFilled / liveOrders.length : 0,
    },
    pnl: {
      realizedCents: ledgerSummary.realizedPnlCents,
      unrealizedCostCents: ledgerSummary.unrealizedCostCents,
      netCents: ledgerSummary.netPnlCents,
      winCount: wins, lossCount: losses, winRate,
    },
    averages: { edgeAtEntry: avgEntryEdge, signalScoreAtEntry: avgEntryScore },
    bySource, byConfidence, bySizingTier, byMode,
  };
}

function buildBreakdown(
  candidates: any[],
  keyFn: (c: any) => string,
  journalEntries: any[],
): BucketBreakdown[] {
  const map = new Map<string, { count: number; edges: number[]; scores: number[] }>();
  for (const c of candidates) {
    const key = keyFn(c) || 'unknown';
    if (!map.has(key)) map.set(key, { count: 0, edges: [], scores: [] });
    const b = map.get(key)!;
    b.count++;
    b.edges.push(Math.abs(c.edge));
    b.scores.push(c.signalScore);
  }

  return Array.from(map.entries()).map(([key, b]) => ({
    key,
    count: b.count,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
    totalPnlCents: 0,
    avgEdge: b.edges.length > 0 ? b.edges.reduce((s, e) => s + e, 0) / b.edges.length : 0,
    avgSignalScore: b.scores.length > 0 ? b.scores.reduce((s, e) => s + e, 0) / b.scores.length : 0,
  }));
}
