import { listJournalEntries, type JournalEntry } from './trade-journal';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BucketStats {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnlCents: number;
  avgPnlCents: number | null;
  avgEdge: number | null;
  avgSignalScore: number | null;
}

export interface AttributionSummary {
  overall: BucketStats;
  bySource: BucketStats[];
  byConfidence: BucketStats[];
  bySizingTier: BucketStats[];
  byLocation: BucketStats[];
  byMetric: BucketStats[];
  edgeCorrelation: { bucket: string; winRate: number | null; avgPnlCents: number | null; count: number }[];
  scoreCorrelation: { bucket: string; winRate: number | null; avgPnlCents: number | null; count: number }[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildBucket(key: string, entries: JournalEntry[]): BucketStats {
  const settled = entries.filter(e => e.outcome.status === 'settled');
  const wins = settled.filter(e => (e.outcome.pnlCents || 0) > 0);
  const losses = settled.filter(e => (e.outcome.pnlCents || 0) <= 0);
  const totalPnl = settled.reduce((s, e) => s + (e.outcome.pnlCents || 0), 0);
  const edges = entries.filter(e => e.model.edge != null).map(e => e.model.edge!);
  const scores = entries.filter(e => e.model.signalScore != null).map(e => e.model.signalScore!);

  return {
    key,
    trades: entries.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length > 0 ? wins.length / settled.length : null,
    totalPnlCents: totalPnl,
    avgPnlCents: settled.length > 0 ? totalPnl / settled.length : null,
    avgEdge: edges.length > 0 ? edges.reduce((a, b) => a + b, 0) / edges.length : null,
    avgSignalScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
  };
}

function groupBy(entries: JournalEntry[], keyFn: (e: JournalEntry) => string): BucketStats[] {
  const map = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const k = keyFn(e);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(e);
  }
  return Array.from(map.entries())
    .map(([key, items]) => buildBucket(key, items))
    .sort((a, b) => b.totalPnlCents - a.totalPnlCents);
}

function correlationBuckets(
  entries: JournalEntry[],
  valueFn: (e: JournalEntry) => number | undefined,
  buckets: { label: string; min: number; max: number }[]
) {
  return buckets.map(b => {
    const matching = entries.filter(e => {
      const v = valueFn(e);
      return v != null && v >= b.min && v < b.max;
    });
    const settled = matching.filter(e => e.outcome.status === 'settled');
    const wins = settled.filter(e => (e.outcome.pnlCents || 0) > 0);
    const totalPnl = settled.reduce((s, e) => s + (e.outcome.pnlCents || 0), 0);

    return {
      bucket: b.label,
      winRate: settled.length > 0 ? wins.length / settled.length : null,
      avgPnlCents: settled.length > 0 ? totalPnl / settled.length : null,
      count: matching.length,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export async function generateAttribution(): Promise<AttributionSummary> {
  const entries = await listJournalEntries();

  const overall = buildBucket('overall', entries);

  const bySource = groupBy(entries, e => e.source);
  const byConfidence = groupBy(entries, e => e.model.confidence || 'unknown');
  const bySizingTier = groupBy(entries, e => e.model.sizingTier || 'unknown');
  const byLocation = groupBy(entries, e => e.locationName || 'unknown');
  const byMetric = groupBy(entries, e => e.metric || 'unknown');

  const edgeCorrelation = correlationBuckets(
    entries,
    e => e.model.edge != null ? Math.abs(e.model.edge) : undefined,
    [
      { label: '0-3%', min: 0, max: 0.03 },
      { label: '3-5%', min: 0.03, max: 0.05 },
      { label: '5-10%', min: 0.05, max: 0.10 },
      { label: '10-15%', min: 0.10, max: 0.15 },
      { label: '15%+', min: 0.15, max: Infinity },
    ]
  );

  const scoreCorrelation = correlationBuckets(
    entries,
    e => e.model.signalScore ?? undefined,
    [
      { label: '0-30', min: 0, max: 30 },
      { label: '30-50', min: 30, max: 50 },
      { label: '50-75', min: 50, max: 75 },
      { label: '75-100', min: 75, max: 101 },
    ]
  );

  return {
    overall,
    bySource,
    byConfidence,
    bySizingTier,
    byLocation,
    byMetric,
    edgeCorrelation,
    scoreCorrelation,
  };
}
