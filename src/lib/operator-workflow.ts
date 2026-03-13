import { getRedis } from './redis';
import { getExecutionConfig } from './execution-config';
import { listReconRecords } from './reconciliation';
import { listPositions, computePositionSummary } from './positions';
import { listLedgerEntries, computeLedgerSummary } from './pnl-ledger';
import { listDemoOrders, listLiveOrders } from './kalshi-execution';
import { listCandidates } from './order-builder';
import { generateRankedSignals } from './signal-ranking';
import { generateHedgingRecommendations } from './exposure-hedging';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface OperatorTask {
  id: string;
  category: 'safety' | 'risk' | 'pricing' | 'execution' | 'reconciliation' | 'review';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  link?: string;
  status: 'open' | 'done';
}

export interface RepriceItem {
  id: string;
  title: string;
  type: string;
  liability: number;
  modelDrift: string;
  lopsidedPct: number;
  suggestedAction: string;
}

export interface HedgeItem {
  id: string;
  title: string;
  ticker?: string;
  source: string;
  exposureCents: number;
  riskLevel: string;
  suggestedAction: string;
}

export interface ReconcileItem {
  orderId: string;
  ticker: string;
  issue: string;
  severity: 'low' | 'medium' | 'high';
  lastChecked: string;
  link: string;
  mode: string;
}

export interface DailySummary {
  signalsToday: number;
  candidatesToday: number;
  ordersToday: number;
  fillsToday: number;
  realizedPnlToday: number;
  unresolvedDiscrepancies: number;
  openPositions: number;
  topWins: { ticker: string; pnlCents: number }[];
  topLosses: { ticker: string; pnlCents: number }[];
}

export interface OperatorDashboardData {
  tasks: OperatorTask[];
  repriceQueue: RepriceItem[];
  hedgeQueue: HedgeItem[];
  reconcileQueue: ReconcileItem[];
  dailySummary: DailySummary;
  overview: {
    openTasks: number;
    criticalTasks: number;
    openPositions: number;
    unreconciledItems: number;
    todayRealizedPnl: number;
    todayOrders: number;
    topSignals: number;
    marketsNeedingReprice: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Task persistence                                                   */
/* ------------------------------------------------------------------ */

const TASK_STATUS_PREFIX = 'operator:task:';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getTaskStatus(taskId: string): Promise<'open' | 'done'> {
  const redis = getRedis();
  const raw = await redis.get(`${TASK_STATUS_PREFIX}${todayKey()}:${taskId}`);
  return raw === 'done' ? 'done' : 'open';
}

export async function markTaskDone(taskId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(`${TASK_STATUS_PREFIX}${todayKey()}:${taskId}`, 'done');
  // Expire after 48 hours
  await redis.expire(`${TASK_STATUS_PREFIX}${todayKey()}:${taskId}`, 172800);

  await logAuditEvent({
    actor: 'admin',
    eventType: 'operator_task_completed',
    targetType: 'operator-task',
    targetId: taskId,
    summary: `Operator task completed: ${taskId}`,
  });
}

export async function resetDailyTasks(): Promise<void> {
  // Tasks auto-reset via date-keyed Redis keys; this is a manual override
  await logAuditEvent({
    actor: 'admin',
    eventType: 'operator_daily_reset',
    targetType: 'operator-workflow',
    summary: 'Operator daily tasks reset',
  });
}

/* ------------------------------------------------------------------ */
/*  Generate morning checklist                                         */
/* ------------------------------------------------------------------ */

async function generateMorningChecklist(): Promise<OperatorTask[]> {
  const config = await getExecutionConfig();
  const reconRecords = await listReconRecords();
  const positions = await listPositions();
  const posSummary = computePositionSummary(positions);
  const unreconciled = reconRecords.filter(r => !r.reconciled && !r.reviewed);

  let signals: any[] = [];
  try { signals = await generateRankedSignals(); } catch {}

  const tasks: OperatorTask[] = [];

  // Safety tasks
  tasks.push({
    id: 'check-execution-mode',
    category: 'safety',
    priority: 'critical',
    title: 'Check execution mode',
    description: `Current mode: ${config.mode}. Confirm this is correct for today's operations.`,
    link: '/admin/execution-control',
    status: 'open',
  });

  tasks.push({
    id: 'confirm-kill-switch',
    category: 'safety',
    priority: 'critical',
    title: 'Confirm kill switch status',
    description: `Kill switch is ${config.killSwitchEnabled ? 'ACTIVE — all execution blocked' : 'OFF'}.`,
    link: '/admin/execution-control',
    status: 'open',
  });

  tasks.push({
    id: 'review-live-readiness',
    category: 'safety',
    priority: 'high',
    title: 'Review live readiness / config',
    description: `Live trading: ${config.liveTradingEnabled ? 'enabled' : 'disabled'}. Approval required: ${config.requireApproval ? 'yes' : 'no'}.`,
    link: '/admin/live-readiness',
    status: 'open',
  });

  // Reconciliation tasks
  if (unreconciled.length > 0) {
    tasks.push({
      id: 'review-unreconciled',
      category: 'reconciliation',
      priority: 'high',
      title: `Review ${unreconciled.length} unreconciled order(s)`,
      description: `There are ${unreconciled.length} orders with status discrepancies or missing data.`,
      link: '/admin/reconciliation',
      status: 'open',
    });
  }

  // Position tasks
  if (posSummary.openPositions > 0) {
    tasks.push({
      id: 'review-open-positions',
      category: 'risk',
      priority: 'high',
      title: `Review ${posSummary.openPositions} open position(s)`,
      description: `Open notional: $${(posSummary.totalNotionalCents / 100).toFixed(2)}.`,
      link: '/admin/reconciliation',
      status: 'open',
    });
  }

  // Signal review
  if (signals.length > 0) {
    const topSignals = signals.filter(s => s.compositeScore >= 70);
    tasks.push({
      id: 'review-top-signals',
      category: 'execution',
      priority: topSignals.length > 0 ? 'high' : 'medium',
      title: `Review top ranked signals (${topSignals.length} strong)`,
      description: `${signals.length} total signals, ${topSignals.length} with score >= 70.`,
      link: '/admin/signals',
      status: 'open',
    });

    const edgeOpps = signals.filter(s => Math.abs(s.edge) >= 0.05);
    if (edgeOpps.length > 0) {
      tasks.push({
        id: 'review-edge-opportunities',
        category: 'execution',
        priority: 'medium',
        title: `Review ${edgeOpps.length} Kalshi edge opportunity(ies)`,
        description: `Signals with >= 5% edge available.`,
        link: '/admin/signals',
        status: 'open',
      });
    }
  }

  // Exposure review
  tasks.push({
    id: 'review-largest-exposures',
    category: 'risk',
    priority: 'medium',
    title: 'Review largest exposures',
    description: 'Check exposure dashboard for concentration risk.',
    link: '/admin/trading-desk',
    status: 'open',
  });

  tasks.push({
    id: 'review-high-risk-markets',
    category: 'risk',
    priority: 'medium',
    title: 'Review high-risk markets',
    description: 'Check hedging recommendations for markets needing attention.',
    link: '/admin/trading-desk',
    status: 'open',
  });

  // Pricing tasks
  tasks.push({
    id: 'review-stale-markets',
    category: 'pricing',
    priority: 'low',
    title: 'Review stale open sportsbook markets',
    description: 'Check for open markets missing pricing snapshots or nearing lock time.',
    link: '/admin/trading-desk',
    status: 'open',
  });

  // Apply persisted status
  for (const task of tasks) {
    task.status = await getTaskStatus(task.id);
  }

  return tasks;
}

/* ------------------------------------------------------------------ */
/*  Generate reprice queue                                             */
/* ------------------------------------------------------------------ */

async function generateRepriceQueue(): Promise<RepriceItem[]> {
  let hedgeRecs: any[] = [];
  try { hedgeRecs = await generateHedgingRecommendations(); } catch {}

  return hedgeRecs
    .filter(r => r.recommendedAction === 'move_line' || r.recommendedAction === 'move_odds')
    .map(r => ({
      id: r.marketId || r.id || `reprice-${Math.random().toString(36).slice(2, 6)}`,
      title: r.title || r.ticketNumber || 'Unknown',
      type: r.kind || 'market',
      liability: r.maxLiability || 0,
      modelDrift: r.modelVsPosted || 'N/A',
      lopsidedPct: r.lopsidedPct || 0,
      suggestedAction: r.recommendedAction === 'move_line' ? 'Adjust line' : 'Adjust odds',
    }));
}

/* ------------------------------------------------------------------ */
/*  Generate hedge queue                                               */
/* ------------------------------------------------------------------ */

async function generateHedgeQueue(): Promise<HedgeItem[]> {
  let hedgeRecs: any[] = [];
  try { hedgeRecs = await generateHedgingRecommendations(); } catch {}

  const positions = await listPositions();
  const items: HedgeItem[] = [];

  // From hedging recommendations
  for (const r of hedgeRecs.filter(h => h.riskLevel === 'high' || h.riskLevel === 'critical')) {
    items.push({
      id: r.marketId || r.id || `hedge-${Math.random().toString(36).slice(2, 6)}`,
      title: r.title || r.ticketNumber || 'Unknown',
      source: 'sportsbook',
      exposureCents: r.maxLiability || 0,
      riskLevel: r.riskLevel,
      suggestedAction: r.recommendedAction || 'review',
    });
  }

  // From open positions with significant notional
  for (const p of positions.filter(p => p.status === 'open' && p.notionalCents > 5000)) {
    items.push({
      id: p.id,
      title: p.title,
      ticker: p.ticker,
      source: p.source,
      exposureCents: p.notionalCents,
      riskLevel: p.notionalCents > 10000 ? 'high' : 'medium',
      suggestedAction: 'Monitor or hedge',
    });
  }

  return items;
}

/* ------------------------------------------------------------------ */
/*  Generate reconcile queue                                           */
/* ------------------------------------------------------------------ */

async function generateReconcileQueue(): Promise<ReconcileItem[]> {
  const reconRecords = await listReconRecords();
  return reconRecords
    .filter(r => !r.reconciled && !r.reviewed)
    .map(r => ({
      orderId: r.orderId,
      ticker: r.ticker,
      issue: r.discrepancies.join('; ') || 'Unreconciled',
      severity: (r.discrepancies.some(d => d.includes('not found') || d.includes('mismatch'))
        ? 'high' : 'medium') as 'low' | 'medium' | 'high',
      lastChecked: r.checkedAt,
      link: '/admin/reconciliation',
      mode: r.mode,
    }));
}

/* ------------------------------------------------------------------ */
/*  Generate daily summary                                             */
/* ------------------------------------------------------------------ */

async function generateDailySummary(): Promise<DailySummary> {
  const today = new Date().toISOString().slice(0, 10);

  const [demoOrders, liveOrders, positions, ledgerEntries, reconRecords] = await Promise.all([
    listDemoOrders().catch(() => []),
    listLiveOrders().catch(() => []),
    listPositions().catch(() => []),
    listLedgerEntries(200).catch(() => []),
    listReconRecords().catch(() => []),
  ]);

  let signals: any[] = [];
  try { signals = await generateRankedSignals(); } catch {}

  let candidates: any[] = [];
  try { candidates = await listCandidates(); } catch {}

  const allOrders = [...demoOrders, ...liveOrders];
  const todayOrders = allOrders.filter(o => o.createdAt?.startsWith(today));
  const todayFills = allOrders.filter(o => o.status === 'filled' && o.updatedAt?.startsWith(today));

  const todayLedger = ledgerEntries.filter(e => e.createdAt?.startsWith(today));
  const todayRealized = todayLedger
    .filter(e => e.realized)
    .reduce((s, e) => s + e.amountCents, 0);

  const todayCandidates = candidates.filter(c => c.createdAt?.startsWith(today));
  const unresolved = reconRecords.filter(r => !r.reconciled && !r.reviewed);
  const openPos = positions.filter(p => p.status === 'open');

  // Top wins/losses from ledger
  const settlements = todayLedger.filter(e => e.type === 'settlement' && e.realized);
  const wins = settlements.filter(e => e.amountCents > 0).sort((a, b) => b.amountCents - a.amountCents).slice(0, 3);
  const losses = settlements.filter(e => e.amountCents < 0).sort((a, b) => a.amountCents - b.amountCents).slice(0, 3);

  return {
    signalsToday: signals.length, // Current signals (generated fresh)
    candidatesToday: todayCandidates.length,
    ordersToday: todayOrders.length,
    fillsToday: todayFills.length,
    realizedPnlToday: todayRealized,
    unresolvedDiscrepancies: unresolved.length,
    openPositions: openPos.length,
    topWins: wins.map(e => ({ ticker: e.ticker || '?', pnlCents: e.amountCents })),
    topLosses: losses.map(e => ({ ticker: e.ticker || '?', pnlCents: e.amountCents })),
  };
}

/* ------------------------------------------------------------------ */
/*  Full dashboard data                                                */
/* ------------------------------------------------------------------ */

export async function generateOperatorDashboard(): Promise<OperatorDashboardData> {
  const [tasks, repriceQueue, hedgeQueue, reconcileQueue, dailySummary] = await Promise.all([
    generateMorningChecklist(),
    generateRepriceQueue(),
    generateHedgeQueue(),
    generateReconcileQueue(),
    generateDailySummary(),
  ]);

  const openTasks = tasks.filter(t => t.status === 'open').length;
  const criticalTasks = tasks.filter(t => t.status === 'open' && t.priority === 'critical').length;

  return {
    tasks,
    repriceQueue,
    hedgeQueue,
    reconcileQueue,
    dailySummary,
    overview: {
      openTasks,
      criticalTasks,
      openPositions: dailySummary.openPositions,
      unreconciledItems: dailySummary.unresolvedDiscrepancies,
      todayRealizedPnl: dailySummary.realizedPnlToday,
      todayOrders: dailySummary.ordersToday,
      topSignals: dailySummary.signalsToday,
      marketsNeedingReprice: repriceQueue.length,
    },
  };
}
