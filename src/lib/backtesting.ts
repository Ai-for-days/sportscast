import { listJournalEntries, type JournalEntry } from './trade-journal';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BacktestConfig {
  minEdge: number;           // e.g. 0.05
  confidenceFilter?: string; // 'high' | 'medium' | 'low' | null for all
  sourceFilter?: string;     // 'sportsbook' | 'kalshi' | null for all
  sizingTierFilter?: string; // 'large' | 'medium' | 'small' | null for all
  maxTradeSizeCents?: number;
  dateFrom?: string;         // ISO date
  dateTo?: string;           // ISO date
}

export interface BacktestBucket {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnlCents: number;
  avgPnlCents: number | null;
}

export interface BacktestResult {
  config: BacktestConfig;
  summary: {
    totalEntries: number;
    filteredEntries: number;
    settledEntries: number;
    tradesTaken: number;
    wins: number;
    losses: number;
    winRate: number | null;
    avgEdge: number | null;
    totalPnlCents: number;
    avgPnlPerTrade: number | null;
    bestTradePnl: number | null;
    worstTradePnl: number | null;
  };
  bySource: BacktestBucket[];
  byConfidence: BacktestBucket[];
  bySizingTier: BacktestBucket[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function bucket(key: string, entries: JournalEntry[]): BacktestBucket {
  const settled = entries.filter(e => e.outcome.status === 'settled');
  const wins = settled.filter(e => (e.outcome.pnlCents || 0) > 0);
  const losses = settled.filter(e => (e.outcome.pnlCents || 0) <= 0);
  const totalPnl = settled.reduce((s, e) => s + (e.outcome.pnlCents || 0), 0);

  return {
    key,
    trades: entries.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length > 0 ? wins.length / settled.length : null,
    totalPnlCents: totalPnl,
    avgPnlCents: settled.length > 0 ? totalPnl / settled.length : null,
  };
}

function groupBucket(entries: JournalEntry[], keyFn: (e: JournalEntry) => string): BacktestBucket[] {
  const map = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const k = keyFn(e);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(e);
  }
  return Array.from(map.entries())
    .map(([key, items]) => bucket(key, items))
    .sort((a, b) => b.totalPnlCents - a.totalPnlCents);
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const allEntries = await listJournalEntries();

  // Apply filters
  let filtered = allEntries;

  // Edge filter
  filtered = filtered.filter(e => {
    const edge = e.model.edge != null ? Math.abs(e.model.edge) : 0;
    return edge >= config.minEdge;
  });

  // Confidence filter
  if (config.confidenceFilter) {
    filtered = filtered.filter(e => e.model.confidence === config.confidenceFilter);
  }

  // Source filter
  if (config.sourceFilter) {
    filtered = filtered.filter(e => e.source === config.sourceFilter);
  }

  // Sizing tier filter
  if (config.sizingTierFilter) {
    filtered = filtered.filter(e => e.model.sizingTier === config.sizingTierFilter);
  }

  // Date range filter
  if (config.dateFrom) {
    filtered = filtered.filter(e => (e.targetDate || e.createdAt) >= config.dateFrom!);
  }
  if (config.dateTo) {
    filtered = filtered.filter(e => (e.targetDate || e.createdAt) <= config.dateTo!);
  }

  // Max trade size filter
  if (config.maxTradeSizeCents) {
    filtered = filtered.filter(e => {
      const price = e.entry.entryPrice;
      if (!price) return true; // include if no price info
      return price <= config.maxTradeSizeCents!;
    });
  }

  // Compute summary
  const settled = filtered.filter(e => e.outcome.status === 'settled');
  const wins = settled.filter(e => (e.outcome.pnlCents || 0) > 0);
  const losses = settled.filter(e => (e.outcome.pnlCents || 0) <= 0);
  const totalPnl = settled.reduce((s, e) => s + (e.outcome.pnlCents || 0), 0);
  const edges = filtered.filter(e => e.model.edge != null).map(e => Math.abs(e.model.edge!));
  const pnls = settled.map(e => e.outcome.pnlCents || 0);

  const summary = {
    totalEntries: allEntries.length,
    filteredEntries: filtered.length,
    settledEntries: settled.length,
    tradesTaken: filtered.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length > 0 ? wins.length / settled.length : null,
    avgEdge: edges.length > 0 ? edges.reduce((a, b) => a + b, 0) / edges.length : null,
    totalPnlCents: totalPnl,
    avgPnlPerTrade: settled.length > 0 ? totalPnl / settled.length : null,
    bestTradePnl: pnls.length > 0 ? Math.max(...pnls) : null,
    worstTradePnl: pnls.length > 0 ? Math.min(...pnls) : null,
  };

  const bySource = groupBucket(filtered, e => e.source);
  const byConfidence = groupBucket(filtered, e => e.model.confidence || 'unknown');
  const bySizingTier = groupBucket(filtered, e => e.model.sizingTier || 'unknown');

  return { config, summary, bySource, byConfidence, bySizingTier };
}
