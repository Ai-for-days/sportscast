import { generateOperatorDashboard } from './operator-workflow';
import { generateStrategyAnalytics } from './strategy-analytics';
import { listLedgerEntries, computeLedgerSummary } from './pnl-ledger';
import { listPositions, computePositionSummary } from './positions';
import { listReconRecords } from './reconciliation';
import { listDemoOrders, listLiveOrders } from './kalshi-execution';
import { listCandidates } from './order-builder';
import { listJournalEntries } from './trade-journal';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ReportType = 'daily' | 'pnl' | 'reconciliation' | 'signal' | 'market';

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  source?: string;
  mode?: string;
  confidence?: string;
  sizingTier?: string;
  ticker?: string;
}

export interface ReportResult {
  reportType: ReportType;
  generatedAt: string;
  filters: ReportFilters;
  summary: Record<string, any>;
  rows: Record<string, any>[];
  sections?: Record<string, any>;
}

/* ------------------------------------------------------------------ */
/*  Date filter helper                                                 */
/* ------------------------------------------------------------------ */

function inDateRange(iso: string | undefined, from?: string, to?: string): boolean {
  if (!iso) return true;
  const d = iso.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Daily Operator Report                                              */
/* ------------------------------------------------------------------ */

async function generateDailyReport(filters: ReportFilters): Promise<ReportResult> {
  const dashboard = await generateOperatorDashboard();

  return {
    reportType: 'daily',
    generatedAt: new Date().toISOString(),
    filters,
    summary: {
      openTasks: dashboard.overview.openTasks,
      criticalTasks: dashboard.overview.criticalTasks,
      openPositions: dashboard.overview.openPositions,
      unreconciledItems: dashboard.overview.unreconciledItems,
      todayRealizedPnl: dashboard.overview.todayRealizedPnl,
      todayOrders: dashboard.overview.todayOrders,
      topSignals: dashboard.overview.topSignals,
      marketsNeedingReprice: dashboard.overview.marketsNeedingReprice,
      hedgeQueueCount: dashboard.hedgeQueue.length,
    },
    rows: dashboard.tasks.map(t => ({
      id: t.id,
      category: t.category,
      priority: t.priority,
      title: t.title,
      description: t.description,
      status: t.status,
      link: t.link || '',
    })),
    sections: {
      dailySummary: dashboard.dailySummary,
      repriceQueue: dashboard.repriceQueue,
      hedgeQueue: dashboard.hedgeQueue,
      reconcileQueue: dashboard.reconcileQueue,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  P&L Report                                                         */
/* ------------------------------------------------------------------ */

async function generatePnlReport(filters: ReportFilters): Promise<ReportResult> {
  const entries = await listLedgerEntries(500);
  const positions = await listPositions();

  // Apply filters
  let filtered = entries.filter(e => inDateRange(e.createdAt, filters.dateFrom, filters.dateTo));
  if (filters.source) filtered = filtered.filter(e => e.source === filters.source);
  if (filters.ticker) filtered = filtered.filter(e => e.ticker?.includes(filters.ticker!));
  if (filters.mode) {
    const modeMap: Record<string, string> = { demo: 'demo', live: 'live', paper: 'paper' };
    filtered = filtered.filter(e => e.source === modeMap[filters.mode!]);
  }

  const summary = computeLedgerSummary(filtered);
  const posSummary = computePositionSummary(positions);

  // By ticker
  const byTicker = new Map<string, number>();
  for (const e of filtered) {
    const t = e.ticker || 'unknown';
    byTicker.set(t, (byTicker.get(t) || 0) + e.amountCents);
  }

  // By day
  const byDay = new Map<string, number>();
  for (const e of filtered) {
    const day = e.createdAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + e.amountCents);
  }

  // Top winners/losers
  const settlements = filtered.filter(e => e.type === 'settlement' && e.realized);
  const sorted = [...settlements].sort((a, b) => b.amountCents - a.amountCents);
  const topWinners = sorted.slice(0, 5).filter(e => e.amountCents > 0);
  const topLosers = sorted.slice(-5).filter(e => e.amountCents < 0).reverse();

  return {
    reportType: 'pnl',
    generatedAt: new Date().toISOString(),
    filters,
    summary: {
      realizedPnlCents: summary.realizedPnlCents,
      unrealizedCostCents: summary.unrealizedCostCents,
      netPnlCents: summary.netPnlCents,
      totalEntries: summary.totalEntries,
      openPositions: posSummary.openPositions,
      closedPositions: posSummary.closedPositions,
      totalNotionalCents: posSummary.totalNotionalCents,
      bySource: summary.bySource,
    },
    rows: filtered.map(e => ({
      id: e.id,
      createdAt: e.createdAt,
      source: e.source,
      type: e.type,
      ticker: e.ticker || '',
      side: e.side || '',
      amountCents: e.amountCents,
      amountUSD: (e.amountCents / 100).toFixed(2),
      realized: e.realized,
      notes: e.notes || '',
    })),
    sections: {
      byTicker: Object.fromEntries(byTicker),
      byDay: Object.fromEntries(byDay),
      topWinners: topWinners.map(e => ({ ticker: e.ticker, amountCents: e.amountCents })),
      topLosers: topLosers.map(e => ({ ticker: e.ticker, amountCents: e.amountCents })),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Reconciliation Report                                              */
/* ------------------------------------------------------------------ */

async function generateReconciliationReport(filters: ReportFilters): Promise<ReportResult> {
  const records = await listReconRecords();

  let filtered = records.filter(r => inDateRange(r.checkedAt, filters.dateFrom, filters.dateTo));
  if (filters.mode) filtered = filtered.filter(r => r.mode === filters.mode);
  if (filters.ticker) filtered = filtered.filter(r => r.ticker?.includes(filters.ticker!));

  const reconciled = filtered.filter(r => r.reconciled);
  const unreconciled = filtered.filter(r => !r.reconciled);
  const reviewed = filtered.filter(r => r.reviewed);

  return {
    reportType: 'reconciliation',
    generatedAt: new Date().toISOString(),
    filters,
    summary: {
      totalRecords: filtered.length,
      reconciled: reconciled.length,
      unreconciled: unreconciled.length,
      reviewed: reviewed.length,
      discrepancyTypes: [...new Set(unreconciled.flatMap(r => r.discrepancies))],
    },
    rows: filtered.map(r => ({
      orderId: r.orderId,
      mode: r.mode,
      ticker: r.ticker,
      title: r.title,
      localStatus: r.localStatus,
      remoteStatus: r.remoteStatus || '',
      reconciled: r.reconciled,
      reviewed: r.reviewed || false,
      discrepancies: r.discrepancies.join('; '),
      checkedAt: r.checkedAt,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Signal / Strategy Report                                           */
/* ------------------------------------------------------------------ */

async function generateSignalReport(filters: ReportFilters): Promise<ReportResult> {
  const analytics = await generateStrategyAnalytics();
  const candidates = await listCandidates();

  let filtered = candidates;
  if (filters.source) filtered = filtered.filter(c => c.source === filters.source);
  if (filters.confidence) filtered = filtered.filter(c => c.confidence === filters.confidence);
  if (filters.sizingTier) filtered = filtered.filter(c => c.sizingTier === filters.sizingTier);
  if (filters.dateFrom || filters.dateTo) {
    filtered = filtered.filter(c => inDateRange(c.createdAt, filters.dateFrom, filters.dateTo));
  }

  const approved = filtered.filter(c => c.state === 'approved' || c.state === 'sent');
  const blocked = filtered.filter(c => c.state === 'blocked');

  return {
    reportType: 'signal',
    generatedAt: new Date().toISOString(),
    filters,
    summary: {
      totalSignals: analytics.signals.total,
      avgEdge: analytics.signals.avgEdge,
      avgScore: analytics.signals.avgScore,
      totalCandidates: filtered.length,
      approvedCandidates: approved.length,
      blockedCandidates: blocked.length,
      sentCandidates: filtered.filter(c => c.state === 'sent').length,
      demoFillRate: analytics.orders.demoFillRate,
      liveFillRate: analytics.orders.liveFillRate,
      winRate: analytics.pnl.winRate,
      avgEdgeAtEntry: analytics.averages.edgeAtEntry,
      avgScoreAtEntry: analytics.averages.signalScoreAtEntry,
    },
    rows: filtered.map(c => ({
      id: c.id,
      createdAt: c.createdAt,
      source: c.source,
      ticker: c.ticker,
      title: c.title,
      side: c.side,
      signalScore: c.signalScore,
      edge: c.edge,
      edgePct: (c.edge * 100).toFixed(1),
      confidence: c.confidence,
      sizingTier: c.sizingTier,
      stakeCents: c.recommendedStakeCents,
      stakeUSD: (c.recommendedStakeCents / 100).toFixed(2),
      state: c.state,
      riskPassed: c.riskResult?.allowed ? 'yes' : 'no',
    })),
    sections: {
      bySource: analytics.bySource,
      byConfidence: analytics.byConfidence,
      bySizingTier: analytics.bySizingTier,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Market Performance Report                                          */
/* ------------------------------------------------------------------ */

async function generateMarketReport(filters: ReportFilters): Promise<ReportResult> {
  // Pull from demo + live orders for market-level aggregation
  const [demoOrders, liveOrders, positions] = await Promise.all([
    listDemoOrders(),
    listLiveOrders(),
    listPositions(),
  ]);

  const allOrders = [
    ...demoOrders.map(o => ({ ...o, mode: 'demo' as const })),
    ...liveOrders.map(o => ({ ...o, mode: 'live' as const })),
  ];

  let filtered = allOrders;
  if (filters.dateFrom || filters.dateTo) {
    filtered = filtered.filter(o => inDateRange(o.createdAt, filters.dateFrom, filters.dateTo));
  }
  if (filters.mode) filtered = filtered.filter(o => o.mode === filters.mode);
  if (filters.ticker) filtered = filtered.filter(o => o.ticker?.includes(filters.ticker!));

  // By ticker aggregation
  const byTicker = new Map<string, { ticker: string; title: string; orders: number; filled: number; open: number; cancelled: number; failed: number }>();
  for (const o of filtered) {
    if (!byTicker.has(o.ticker)) {
      byTicker.set(o.ticker, { ticker: o.ticker, title: o.title, orders: 0, filled: 0, open: 0, cancelled: 0, failed: 0 });
    }
    const b = byTicker.get(o.ticker)!;
    b.orders++;
    if (o.status === 'filled') b.filled++;
    else if (o.status === 'open' || o.status === 'pending') b.open++;
    else if (o.status === 'cancelled') b.cancelled++;
    else if (o.status === 'failed') b.failed++;
  }

  return {
    reportType: 'market',
    generatedAt: new Date().toISOString(),
    filters,
    summary: {
      totalOrders: filtered.length,
      totalFilled: filtered.filter(o => o.status === 'filled').length,
      totalOpen: filtered.filter(o => o.status === 'open' || o.status === 'pending').length,
      totalCancelled: filtered.filter(o => o.status === 'cancelled').length,
      totalFailed: filtered.filter(o => o.status === 'failed').length,
      uniqueTickers: byTicker.size,
      openPositions: positions.filter(p => p.status === 'open').length,
    },
    rows: Array.from(byTicker.values()).map(b => ({
      ticker: b.ticker,
      title: b.title,
      orders: b.orders,
      filled: b.filled,
      open: b.open,
      cancelled: b.cancelled,
      failed: b.failed,
      fillRate: b.orders > 0 ? ((b.filled / b.orders) * 100).toFixed(0) + '%' : '0%',
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function generateReport(type: ReportType, filters: ReportFilters = {}): Promise<ReportResult> {
  let result: ReportResult;

  switch (type) {
    case 'daily': result = await generateDailyReport(filters); break;
    case 'pnl': result = await generatePnlReport(filters); break;
    case 'reconciliation': result = await generateReconciliationReport(filters); break;
    case 'signal': result = await generateSignalReport(filters); break;
    case 'market': result = await generateMarketReport(filters); break;
    default: throw new Error(`Unknown report type: ${type}`);
  }

  await logAuditEvent({
    actor: 'admin',
    eventType: 'report_preview_generated',
    targetType: 'report',
    summary: `Report generated: ${type}`,
    details: { filters },
  }).catch(() => {});

  return result;
}

/* ------------------------------------------------------------------ */
/*  CSV Export                                                         */
/* ------------------------------------------------------------------ */

export function reportToCSV(report: ReportResult): string {
  if (report.rows.length === 0) return '';

  const headers = Object.keys(report.rows[0]);
  const lines: string[] = [];

  // Header
  lines.push(headers.map(h => `"${h}"`).join(','));

  // Rows
  for (const row of report.rows) {
    const vals = headers.map(h => {
      const v = row[h];
      if (v == null) return '""';
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    });
    lines.push(vals.join(','));
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Report metadata                                                    */
/* ------------------------------------------------------------------ */

export const REPORT_TYPES: { key: ReportType; label: string; description: string }[] = [
  { key: 'daily', label: 'Daily Operator Report', description: 'Tasks, positions, P&L, signals, and queues for today.' },
  { key: 'pnl', label: 'P&L Report', description: 'Realized/unrealized P&L by source, ticker, and date.' },
  { key: 'reconciliation', label: 'Reconciliation Report', description: 'Order reconciliation status, discrepancies, and reviews.' },
  { key: 'signal', label: 'Signal / Strategy Report', description: 'Signal generation, candidates, fill rates, and breakdowns.' },
  { key: 'market', label: 'Market Performance Report', description: 'Order activity and fill rates by ticker.' },
];
