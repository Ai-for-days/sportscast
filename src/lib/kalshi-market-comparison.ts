// ── Step 119: Kalshi vs WagerOnWeather comparison (server-only) ─────────────
//
// Advisory-only diff between an internal WagerOnWeather wager and the
// public Kalshi market data already captured by Step 118 snapshots. This
// module never mutates wagers, never changes pricing, never places trades,
// and never auto-creates internal markets. All comparisons are recorded
// as advisory artifacts for the operator.
//
// Kalshi is treated as an external market / competitor venue; the output
// here is internal bookmaking intelligence only.

import { getRedis } from './redis';
import { getWager } from './wager-store';
import type { Wager, OddsWager, OverUnderWager, PointspreadWager } from './wager-types';
import {
  listMarketSnapshots,
  getMarketSnapshot,
  type KalshiMarketSnapshot,
  type KalshiMarketSummary,
} from './kalshi-market-data';
import { listSnapshots as listExposureSnapshots } from './house-exposure';

if (typeof window !== 'undefined') {
  throw new Error(
    'kalshi-market-comparison is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export type ComparisonConfidence = 'low' | 'medium' | 'high';

export type ComparisonVerdict =
  | 'no_match'
  | 'watch'
  | 'possible_pricing_gap'
  | 'hedge_review_recommended'
  | 'manual_review_required';

export interface MatchedKalshiMarket {
  ticker: string;
  title?: string;
  status?: string;
  closeTime?: string;
  yesBid?: number;
  yesAsk?: number;
  lastPrice?: number;
  volume?: number;
  openInterest?: number;
  matchReason: string;
  confidence: ComparisonConfidence;
  /** Mid-implied probability (0..1) when bids/asks/lastPrice are available. */
  externalImpliedProbability?: number;
}

export interface InternalPricingRow {
  label: string;
  americanOdds: number;
  impliedProbability: number;
}

export interface WagerPricingSummary {
  kind: Wager['kind'];
  metric: string;
  targetDate: string;
  rows: InternalPricingRow[];
}

export interface ExternalPricingSummary {
  marketsConsidered: number;
  highestConfidence: ComparisonConfidence | null;
  midProbabilities: { ticker: string; impliedProbability: number }[];
}

export interface PricingGapNote {
  ticker: string;
  internalLabel: string;
  internalImplied: number;
  externalImplied: number;
  gapPp: number;
  note: string;
}

export interface KalshiComparison {
  id: string;
  createdAt: string;
  createdBy: string;
  wagerId: string;
  wagerTitle: string;
  kalshiSnapshotId?: string;
  matchedKalshiMarkets: MatchedKalshiMarket[];
  wagerPricingSummary: WagerPricingSummary;
  externalPricingSummary: ExternalPricingSummary;
  pricingGapNotes: PricingGapNote[];
  hedgeReviewNotes: string[];
  warnings: string[];
  recommendations: string[];
  verdict: ComparisonVerdict;
  status: 'advisory_only';
}

export class KalshiComparisonError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

// ── Redis keys ──────────────────────────────────────────────────────────────

const KEY = {
  comparison: (id: string) => `kalshi-comparison:${id}`,
  all: 'kalshi-comparisons:all',
  byWager: (wagerId: string) => `kalshi-comparison:wager:${wagerId}`,
};
const MAX_COMPARISONS = 200;
/** Worst-case house loss (cents) above which "manual hedge review" is suggested. */
const HEDGE_REVIEW_LOSS_THRESHOLD_CENTS = 100_000;
const PRICING_GAP_THRESHOLD_PP = 5;

// ── Pricing helpers ─────────────────────────────────────────────────────────

function americanToImplied(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function externalImplied(m: KalshiMarketSummary): number | undefined {
  // Kalshi quotes are in cents (0..100) representing probability.
  const mid =
    m.yesBid != null && m.yesAsk != null
      ? (m.yesBid + m.yesAsk) / 2
      : m.lastPrice ?? m.yesAsk ?? m.yesBid;
  if (mid == null || !Number.isFinite(mid)) return undefined;
  return Math.max(0, Math.min(1, mid / 100));
}

function buildWagerPricingSummary(w: Wager): WagerPricingSummary {
  const rows: InternalPricingRow[] = [];
  if (w.kind === 'odds') {
    const ow = w as OddsWager;
    for (const o of ow.outcomes ?? []) {
      rows.push({
        label: o.label,
        americanOdds: o.odds,
        impliedProbability: americanToImplied(o.odds),
      });
    }
  } else if (w.kind === 'over-under') {
    const ouw = w as OverUnderWager;
    rows.push({
      label: `Over ${ouw.line}`,
      americanOdds: ouw.over?.odds ?? 0,
      impliedProbability: americanToImplied(ouw.over?.odds ?? 0),
    });
    rows.push({
      label: `Under ${ouw.line}`,
      americanOdds: ouw.under?.odds ?? 0,
      impliedProbability: americanToImplied(ouw.under?.odds ?? 0),
    });
  } else if (w.kind === 'pointspread') {
    const psw = w as PointspreadWager;
    rows.push({
      label: `${psw.locationA?.name ?? 'A'} ${psw.spread > 0 ? `+${psw.spread}` : psw.spread}`,
      americanOdds: psw.locationAOdds ?? 0,
      impliedProbability: americanToImplied(psw.locationAOdds ?? 0),
    });
    rows.push({
      label: `${psw.locationB?.name ?? 'B'} ${psw.spread > 0 ? `-${psw.spread}` : Math.abs(psw.spread)}`,
      americanOdds: psw.locationBOdds ?? 0,
      impliedProbability: americanToImplied(psw.locationBOdds ?? 0),
    });
  }
  return {
    kind: w.kind,
    metric: w.metric,
    targetDate: w.targetDate,
    rows,
  };
}

// ── Matching ────────────────────────────────────────────────────────────────

const METRIC_KEYWORDS: Record<string, string[]> = {
  actual_temp: ['temperature', 'temp'],
  high_temp: ['temperature', 'temp', 'high'],
  low_temp: ['temperature', 'temp', 'low'],
  actual_wind: ['wind', 'gust'],
  actual_gust: ['wind', 'gust'],
};

const GENERAL_WEATHER_TERMS = [
  'weather',
  'temperature',
  'temp',
  'high',
  'low',
  'wind',
  'gust',
  'rain',
  'rainfall',
  'snow',
  'snowfall',
  'precip',
];

function tokenize(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function extractLocationTokens(w: Wager): string[] {
  const out: string[] = [];
  if (w.kind === 'pointspread') {
    const psw = w as PointspreadWager;
    out.push(...tokenize(psw.locationA?.name));
    out.push(...tokenize(psw.locationB?.name));
  } else {
    const loc = (w as OddsWager | OverUnderWager).location;
    out.push(...tokenize(loc?.name));
  }
  return out;
}

interface MatchScore {
  score: number;
  reasons: string[];
  confidence: ComparisonConfidence;
}

function scoreMatch(w: Wager, m: KalshiMarketSummary): MatchScore {
  const reasons: string[] = [];
  let score = 0;

  const marketTokens = new Set(
    [
      ...tokenize(m.title),
      ...tokenize(m.category),
      ...tokenize(m.ticker),
    ],
  );

  const metricKeywords = METRIC_KEYWORDS[w.metric] ?? [];
  const matchedMetric = metricKeywords.filter((k) => marketTokens.has(k));
  if (matchedMetric.length > 0) {
    score += 3;
    reasons.push(`metric keywords matched: ${matchedMetric.join(', ')}`);
  }

  const locationTokens = extractLocationTokens(w);
  const matchedLocation = locationTokens.filter((t) => marketTokens.has(t));
  if (matchedLocation.length > 0) {
    score += 2;
    reasons.push(`location tokens matched: ${matchedLocation.join(', ')}`);
  }

  // Match target date — try YYYY-MM-DD then year-month then year
  const targetDate = w.targetDate ?? '';
  const yyyy = targetDate.slice(0, 4);
  const yyyymm = targetDate.slice(0, 7);
  const titleLower = (m.title ?? '').toLowerCase();
  if (targetDate && titleLower.includes(targetDate)) {
    score += 2;
    reasons.push('exact target date in title');
  } else if (yyyymm && titleLower.includes(yyyymm)) {
    score += 1;
    reasons.push('target year-month in title');
  } else if (yyyy && titleLower.includes(yyyy)) {
    score += 1;
    reasons.push('target year in title');
  }

  const generalMatches = GENERAL_WEATHER_TERMS.filter((t) => marketTokens.has(t));
  if (generalMatches.length > 0 && matchedMetric.length === 0) {
    score += 1;
    reasons.push(`general weather terms: ${generalMatches.slice(0, 3).join(', ')}`);
  }

  let confidence: ComparisonConfidence;
  if (score >= 5) confidence = 'high';
  else if (score >= 3) confidence = 'medium';
  else confidence = 'low';

  return { score, reasons, confidence };
}

function matchKalshiMarkets(
  w: Wager,
  snapshot: KalshiMarketSnapshot,
  cap = 20,
): MatchedKalshiMarket[] {
  const ranked: Array<{ m: KalshiMarketSummary; s: MatchScore }> = [];
  for (const m of snapshot.markets) {
    const s = scoreMatch(w, m);
    if (s.score <= 0) continue;
    ranked.push({ m, s });
  }
  ranked.sort((a, b) => b.s.score - a.s.score);
  return ranked.slice(0, cap).map(({ m, s }) => ({
    ticker: m.ticker,
    title: m.title,
    status: m.status,
    closeTime: m.closeTime,
    yesBid: m.yesBid,
    yesAsk: m.yesAsk,
    lastPrice: m.lastPrice,
    volume: m.volume,
    openInterest: m.openInterest,
    matchReason: s.reasons.join('; '),
    confidence: s.confidence,
    externalImpliedProbability: externalImplied(m),
  }));
}

// ── Verdict ─────────────────────────────────────────────────────────────────

function computeVerdict(args: {
  matched: MatchedKalshiMarket[];
  pricingGaps: PricingGapNote[];
  hedgeReviewNotes: string[];
}): ComparisonVerdict {
  if (args.matched.length === 0) return 'no_match';
  if (args.hedgeReviewNotes.length > 0) return 'hedge_review_recommended';
  if (args.pricingGaps.length > 0) return 'possible_pricing_gap';
  const hasNonLow = args.matched.some((m) => m.confidence !== 'low');
  if (!hasNonLow) return 'watch';
  return 'manual_review_required';
}

// ── Comparison generation ───────────────────────────────────────────────────

async function pickSnapshot(
  snapshotId?: string,
): Promise<{ snapshot: KalshiMarketSnapshot | null; warning?: string }> {
  if (snapshotId) {
    const s = await getMarketSnapshot(snapshotId);
    if (!s) return { snapshot: null, warning: `Snapshot ${snapshotId} not found.` };
    return { snapshot: s };
  }
  const recent = await listMarketSnapshots(1);
  if (recent.length === 0) {
    return {
      snapshot: null,
      warning: 'No Kalshi snapshots exist yet. Visit Kalshi Market Data and fetch markets first.',
    };
  }
  return { snapshot: recent[0] };
}

async function maybeBuildHedgeReview(
  w: Wager,
  matched: MatchedKalshiMarket[],
): Promise<{ notes: string[]; warnings: string[] }> {
  const notes: string[] = [];
  const warnings: string[] = [];
  if (matched.length === 0) return { notes, warnings };

  let exposureEntry:
    | { worstCaseHouseLoss: number; potentialPayout: number; totalStake: number }
    | undefined;
  try {
    const recent = await listExposureSnapshots(1);
    if (recent.length > 0) {
      const found = recent[0].topRiskMarkets.find((r) => r.wagerId === w.id);
      if (found) {
        exposureEntry = {
          worstCaseHouseLoss: found.worstCaseHouseLoss,
          potentialPayout: found.potentialPayout,
          totalStake: found.totalStake,
        };
      }
    } else {
      warnings.push(
        'No house exposure snapshot available; hedge review skipped. Generate a snapshot in House Exposure to enable.',
      );
    }
  } catch {
    warnings.push('Failed to read house exposure snapshot; hedge review skipped.');
  }

  if (
    exposureEntry &&
    exposureEntry.worstCaseHouseLoss >= HEDGE_REVIEW_LOSS_THRESHOLD_CENTS
  ) {
    const usableMatch = matched.find((m) => m.confidence !== 'low');
    if (usableMatch) {
      const pretty = (cents: number) => `$${(cents / 100).toLocaleString()}`;
      notes.push(
        `Manual hedge review recommended: worst-case house loss for this market is ${pretty(exposureEntry.worstCaseHouseLoss)} and external venue Kalshi has at least one ${usableMatch.confidence}-confidence match (${usableMatch.ticker}). Operator should evaluate hedging externally — this tool does not place hedge orders.`,
      );
    }
  }

  return { notes, warnings };
}

function computePricingGaps(
  internal: WagerPricingSummary,
  matched: MatchedKalshiMarket[],
): PricingGapNote[] {
  const out: PricingGapNote[] = [];
  // Only high-confidence external matches with concrete external pricing
  // qualify; we never claim a gap on speculative matches.
  const usable = matched.filter(
    (m) => m.confidence === 'high' && m.externalImpliedProbability != null,
  );
  if (usable.length === 0) return out;
  // Compare each internal row against each high-confidence external market.
  // We do not claim arbitrage — only "possible pricing gap".
  for (const row of internal.rows) {
    for (const ext of usable) {
      const extProb = ext.externalImpliedProbability!;
      const gap = (row.impliedProbability - extProb) * 100;
      if (Math.abs(gap) >= PRICING_GAP_THRESHOLD_PP) {
        out.push({
          ticker: ext.ticker,
          internalLabel: row.label,
          internalImplied: row.impliedProbability,
          externalImplied: extProb,
          gapPp: Number(gap.toFixed(2)),
          note: `Possible pricing gap: internal "${row.label}" implies ${(row.impliedProbability * 100).toFixed(1)}% vs external ${ext.ticker} at ${(extProb * 100).toFixed(1)}% (${gap > 0 ? '+' : ''}${gap.toFixed(1)}pp). Advisory only — verify the markets are truly comparable before acting.`,
        });
      }
    }
  }
  return out;
}

function newComparisonId(): string {
  return `kcmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface GenerateInput {
  wagerId: string;
  snapshotId?: string;
}

export async function generateComparison(
  input: GenerateInput,
  createdBy: string,
): Promise<KalshiComparison> {
  if (!input.wagerId) {
    throw new KalshiComparisonError('wagerId is required.', 'wager_id_required');
  }
  const wager = await getWager(input.wagerId);
  if (!wager) {
    throw new KalshiComparisonError(
      `Wager ${input.wagerId} not found.`,
      'wager_not_found',
    );
  }

  const warnings: string[] = [];
  const recommendations: string[] = [];

  const { snapshot, warning: snapshotWarn } = await pickSnapshot(input.snapshotId);
  if (snapshotWarn) warnings.push(snapshotWarn);

  const matched = snapshot ? matchKalshiMarkets(wager, snapshot) : [];
  if (snapshot && matched.length === 0) {
    warnings.push(
      'No Kalshi markets in the selected snapshot matched this wager. Try a broader snapshot or refine the matching keywords.',
    );
  }

  const wagerPricingSummary = buildWagerPricingSummary(wager);

  const externalProbs = matched
    .filter((m) => m.externalImpliedProbability != null)
    .map((m) => ({ ticker: m.ticker, impliedProbability: m.externalImpliedProbability! }));
  const externalPricingSummary: ExternalPricingSummary = {
    marketsConsidered: matched.length,
    highestConfidence:
      matched.length === 0
        ? null
        : matched.some((m) => m.confidence === 'high')
          ? 'high'
          : matched.some((m) => m.confidence === 'medium')
            ? 'medium'
            : 'low',
    midProbabilities: externalProbs,
  };

  const pricingGaps = computePricingGaps(wagerPricingSummary, matched);
  if (pricingGaps.length > 0) {
    recommendations.push(
      'Review the pricing gap rows; advisory only. Do not act on a gap until you have manually confirmed the external market resolves on comparable terms.',
    );
  }

  const { notes: hedgeReviewNotes, warnings: hedgeWarnings } = await maybeBuildHedgeReview(
    wager,
    matched,
  );
  warnings.push(...hedgeWarnings);
  if (hedgeReviewNotes.length > 0) {
    recommendations.push(
      'Operator may consider an external manual hedge. This tool does not place or stage hedge orders.',
    );
  }

  if (matched.some((m) => m.confidence === 'low') && matched.every((m) => m.confidence === 'low')) {
    recommendations.push(
      'Only low-confidence matches were found; treat as a watchlist signal and verify manually.',
    );
  }

  const verdict = computeVerdict({ matched, pricingGaps, hedgeReviewNotes });

  const comparison: KalshiComparison = {
    id: newComparisonId(),
    createdAt: new Date().toISOString(),
    createdBy,
    wagerId: wager.id,
    wagerTitle: wager.title,
    kalshiSnapshotId: snapshot?.id,
    matchedKalshiMarkets: matched,
    wagerPricingSummary,
    externalPricingSummary,
    pricingGapNotes: pricingGaps,
    hedgeReviewNotes,
    warnings,
    recommendations,
    verdict,
    status: 'advisory_only',
  };

  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.set(KEY.comparison(comparison.id), JSON.stringify(comparison));
  pipe.zadd(KEY.all, {
    score: Date.parse(comparison.createdAt),
    member: comparison.id,
  });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_COMPARISONS - 1);
  pipe.zadd(KEY.byWager(comparison.wagerId), {
    score: Date.parse(comparison.createdAt),
    member: comparison.id,
  });
  await pipe.exec();

  return comparison;
}

// ── Read helpers ────────────────────────────────────────────────────────────

export async function listComparisons(limit = 50): Promise<KalshiComparison[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_COMPARISONS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, safe - 1, { rev: true })) as string[];
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.comparison(id));
  const rows = (await pipe.exec()) as Array<string | null>;
  return rows
    .filter((r): r is string => typeof r === 'string')
    .map((r) => JSON.parse(r) as KalshiComparison);
}

export async function getComparison(id: string): Promise<KalshiComparison | null> {
  const redis = getRedis();
  const raw = (await redis.get(KEY.comparison(id))) as string | null;
  if (!raw) return null;
  return JSON.parse(raw) as KalshiComparison;
}

export async function getComparisonsByWager(
  wagerId: string,
  limit = 50,
): Promise<KalshiComparison[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_COMPARISONS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.byWager(wagerId), 0, safe - 1, { rev: true })) as string[];
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.comparison(id));
  const rows = (await pipe.exec()) as Array<string | null>;
  return rows
    .filter((r): r is string => typeof r === 'string')
    .map((r) => JSON.parse(r) as KalshiComparison);
}

export interface ComparisonSummary {
  totalComparisons: number;
  latestComparison: KalshiComparison | null;
  verdictCounts: Record<ComparisonVerdict, number>;
}

export async function getComparisonSummary(): Promise<ComparisonSummary> {
  const recent = await listComparisons(100);
  const verdictCounts: Record<ComparisonVerdict, number> = {
    no_match: 0,
    watch: 0,
    possible_pricing_gap: 0,
    hedge_review_recommended: 0,
    manual_review_required: 0,
  };
  for (const c of recent) verdictCounts[c.verdict] = (verdictCounts[c.verdict] ?? 0) + 1;
  return {
    totalComparisons: recent.length,
    latestComparison: recent[0] ?? null,
    verdictCounts,
  };
}
