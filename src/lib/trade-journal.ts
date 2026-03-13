import { getRedis } from './redis';
import type { RankedSignal, SizingTier } from './signal-ranking';
import type { PaperTrade } from './kalshi-signals';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface JournalEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: 'sportsbook' | 'kalshi';
  signalId?: string;
  relatedWagerId?: string;
  relatedPaperTradeId?: string;

  title: string;
  locationName?: string;
  metric?: string;
  targetDate?: string;
  targetTime?: string | null;

  side?: string;
  marketType: string;

  entry: {
    entryType: 'posted-market' | 'paper-trade' | 'market-observation';
    entryLine?: number;
    entryOdds?: any;
    entryProb?: number;
    entryPrice?: number;
  };

  model: {
    modelProb?: number;
    marketProb?: number;
    edge?: number;
    signalScore?: number;
    confidence?: string;
    sizingTier?: string;
  };

  context: {
    handle?: number;
    liability?: number;
    riskLevel?: string;
    modelDrift?: number;
    moveCount?: number;
    lopsidedPct?: number;
  };

  outcome: {
    status: 'open' | 'settled' | 'cancelled';
    closingLine?: number;
    closingProb?: number;
    closingPrice?: number;
    settledResult?: string;
    pnlCents?: number;
  };

  notes?: string;
  thesis?: string;
  postmortem?: string;
}

const JOURNAL_KEY_PREFIX = 'trade-journal:entry:';
const JOURNAL_SORTED_SET = 'trade-journal:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

export async function createJournalEntry(
  partial: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>
): Promise<JournalEntry> {
  const redis = getRedis();
  const id = `tj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const entry: JournalEntry = {
    id,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };

  await redis.set(`${JOURNAL_KEY_PREFIX}${id}`, JSON.stringify(entry));
  await redis.zadd(JOURNAL_SORTED_SET, { score: Date.now(), member: id });
  return entry;
}

export async function getJournalEntry(id: string): Promise<JournalEntry | null> {
  const redis = getRedis();
  const raw = await redis.get(`${JOURNAL_KEY_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as JournalEntry;
}

export async function updateJournalEntry(
  id: string,
  updates: Partial<Pick<JournalEntry, 'outcome' | 'notes' | 'thesis' | 'postmortem'>>
): Promise<JournalEntry | null> {
  const entry = await getJournalEntry(id);
  if (!entry) return null;

  const redis = getRedis();
  const updated: JournalEntry = {
    ...entry,
    ...updates,
    outcome: updates.outcome ? { ...entry.outcome, ...updates.outcome } : entry.outcome,
    updatedAt: new Date().toISOString(),
  };

  await redis.set(`${JOURNAL_KEY_PREFIX}${id}`, JSON.stringify(updated));
  return updated;
}

export async function listJournalEntries(): Promise<JournalEntry[]> {
  const redis = getRedis();
  const ids = await redis.zrange(JOURNAL_SORTED_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];

  const entries: JournalEntry[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${JOURNAL_KEY_PREFIX}${id}`);
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as JournalEntry;
      entries.push(parsed);
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/*  Auto-journal from Kalshi paper trade                               */
/* ------------------------------------------------------------------ */

export function buildJournalFromPaperTrade(
  trade: PaperTrade,
  signal?: RankedSignal | null
): Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    source: 'kalshi',
    relatedPaperTradeId: trade.id,
    signalId: signal?.id,
    title: trade.title,
    locationName: signal?.locationName,
    metric: signal?.metric,
    targetDate: signal?.targetDate,
    targetTime: signal?.targetTime,
    side: trade.side,
    marketType: 'kalshi-weather',
    entry: {
      entryType: 'paper-trade',
      entryPrice: trade.entryPrice,
      entryProb: trade.marketProb,
    },
    model: {
      modelProb: trade.modelProb,
      marketProb: trade.marketProb,
      edge: trade.edge,
      signalScore: signal?.signalScore,
      confidence: trade.confidence || signal?.confidence,
      sizingTier: signal?.sizingTier,
    },
    context: {},
    outcome: {
      status: 'open',
    },
    notes: trade.notes,
  };
}

/* ------------------------------------------------------------------ */
/*  Auto-journal from sportsbook signal                                */
/* ------------------------------------------------------------------ */

export function buildJournalFromSignal(
  signal: RankedSignal,
  opts?: { thesis?: string; notes?: string }
): Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    source: signal.source,
    signalId: signal.id,
    title: signal.title,
    locationName: signal.locationName,
    metric: signal.metric,
    targetDate: signal.targetDate,
    targetTime: signal.targetTime,
    marketType: signal.marketType,
    entry: {
      entryType: signal.source === 'kalshi' ? 'paper-trade' : 'market-observation',
    },
    model: {
      edge: signal.edge,
      signalScore: signal.signalScore,
      confidence: signal.confidence,
      sizingTier: signal.sizingTier,
    },
    context: {
      handle: signal.handle,
      liability: signal.liability,
      riskLevel: signal.riskLevel,
    },
    outcome: {
      status: 'open',
    },
    thesis: opts?.thesis,
    notes: opts?.notes,
  };
}

/* ------------------------------------------------------------------ */
/*  Settle journal entry                                               */
/* ------------------------------------------------------------------ */

export async function settleJournalEntry(
  id: string,
  result: string,
  pnlCents: number,
  postmortem?: string
): Promise<JournalEntry | null> {
  return updateJournalEntry(id, {
    outcome: {
      status: 'settled',
      settledResult: result,
      pnlCents,
    },
    postmortem,
  });
}

/* ------------------------------------------------------------------ */
/*  Journal summary stats                                              */
/* ------------------------------------------------------------------ */

export interface JournalSummary {
  total: number;
  open: number;
  settled: number;
  cancelled: number;
  totalPnlCents: number;
  avgEdge: number;
  avgSignalScore: number;
  winCount: number;
  lossCount: number;
  winRate: number | null;
}

export async function getJournalSummary(): Promise<JournalSummary> {
  const entries = await listJournalEntries();
  const settled = entries.filter(e => e.outcome.status === 'settled');
  const open = entries.filter(e => e.outcome.status === 'open');
  const cancelled = entries.filter(e => e.outcome.status === 'cancelled');

  const totalPnl = settled.reduce((s, e) => s + (e.outcome.pnlCents || 0), 0);
  const edges = entries.filter(e => e.model.edge != null).map(e => e.model.edge!);
  const scores = entries.filter(e => e.model.signalScore != null).map(e => e.model.signalScore!);
  const wins = settled.filter(e => (e.outcome.pnlCents || 0) > 0);
  const losses = settled.filter(e => (e.outcome.pnlCents || 0) <= 0);

  return {
    total: entries.length,
    open: open.length,
    settled: settled.length,
    cancelled: cancelled.length,
    totalPnlCents: totalPnl,
    avgEdge: edges.length > 0 ? edges.reduce((a, b) => a + b, 0) / edges.length : 0,
    avgSignalScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: settled.length > 0 ? wins.length / settled.length : null,
  };
}
