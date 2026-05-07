// ── Step 119B Part B: Manual Hedge Review (server-only) ─────────────────────
//
// Documentation-only workflow for reviewing whether high WagerOnWeather
// exposure should be manually hedged externally. This module never calls
// Kalshi order endpoints, never stages tickets, never marks an external
// trade as executed. Status changes are advisory ledger entries.

import { getRedis } from './redis';
import { getWager } from './wager-store';
import { listSnapshots as listExposureSnapshots } from './house-exposure';
import {
  getComparisonsByWager,
  type KalshiComparison,
} from './kalshi-market-comparison';

if (typeof window !== 'undefined') {
  throw new Error(
    'manual-hedge-review is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export type HedgeReviewStatus =
  | 'draft'
  | 'under_review'
  | 'hedge_recommended'
  | 'no_hedge_recommended'
  | 'manually_hedged_elsewhere'
  | 'closed';

export type RecommendedAction =
  | 'watch'
  | 'reduce_exposure'
  | 'manual_external_hedge_review'
  | 'do_not_hedge';

export interface HedgeExposureSummary {
  hasSnapshot: boolean;
  snapshotId?: string;
  totalStakeCents?: number;
  potentialPayoutCents?: number;
  worstCaseHouseLossCents?: number;
  realizedHouseResultCents?: number;
  topUserPctOfMarket?: number;
  concentrationWarning?: boolean;
}

export interface HedgeExternalSummary {
  hasComparison: boolean;
  comparisonId?: string;
  comparisonVerdict?: KalshiComparison['verdict'];
  matchedMarketCount: number;
  highestConfidence: KalshiComparison['externalPricingSummary']['highestConfidence'];
  pricingGapCount: number;
}

export interface HedgeDecisionAction {
  at: string;
  actor: string;
  action: string;
  details?: Record<string, unknown>;
}

export interface HedgeReview {
  id: string;
  createdAt: string;
  createdBy: string;
  relatedWagerId: string;
  wagerTitle: string;
  relatedHouseExposureSnapshotId?: string;
  relatedKalshiComparisonId?: string;
  status: HedgeReviewStatus;
  exposureSummary: HedgeExposureSummary;
  externalMarketSummary: HedgeExternalSummary;
  hedgeRationale: string;
  recommendedAction: RecommendedAction;
  suggestedManualHedgeNotes: string[];
  risks: string[];
  decisionNotes: string[];
  history: HedgeDecisionAction[];
  closedAt?: string;
  closedBy?: string;
}

export class HedgeReviewError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

// ── Redis keys ──────────────────────────────────────────────────────────────

const KEY = {
  review: (id: string) => `hedge-review:${id}`,
  all: 'hedge-reviews:all',
  byWager: (wagerId: string) => `hedge-review:wager:${wagerId}`,
};
const MAX_REVIEWS = 200;
const HEDGE_REVIEW_LOSS_THRESHOLD_CENTS = 100_000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function newId(): string {
  return `hr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readReview(id: string): Promise<HedgeReview | null> {
  const redis = getRedis();
  const raw = (await redis.get(KEY.review(id))) as string | null;
  if (!raw) return null;
  return JSON.parse(raw) as HedgeReview;
}

async function writeReview(review: HedgeReview): Promise<void> {
  const redis = getRedis();
  await redis.set(KEY.review(review.id), JSON.stringify(review));
}

// ── Status transition rules ─────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<HedgeReviewStatus, HedgeReviewStatus[]> = {
  draft: ['under_review', 'closed'],
  under_review: [
    'hedge_recommended',
    'no_hedge_recommended',
    'manually_hedged_elsewhere',
    'closed',
  ],
  hedge_recommended: ['manually_hedged_elsewhere', 'no_hedge_recommended', 'closed'],
  no_hedge_recommended: ['hedge_recommended', 'closed'],
  manually_hedged_elsewhere: ['closed'],
  closed: [],
};

function assertTransition(from: HedgeReviewStatus, to: HedgeReviewStatus): void {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new HedgeReviewError(
      `Invalid status transition: ${from} → ${to}.`,
      'invalid_transition',
    );
  }
}

// ── Summary builders ────────────────────────────────────────────────────────

async function buildExposureSummary(wagerId: string): Promise<HedgeExposureSummary> {
  try {
    const recent = await listExposureSnapshots(1);
    if (recent.length === 0) return { hasSnapshot: false };
    const snap = recent[0];
    const entry = snap.topRiskMarkets.find((r) => r.wagerId === wagerId);
    if (!entry) return { hasSnapshot: true, snapshotId: snap.id };
    return {
      hasSnapshot: true,
      snapshotId: snap.id,
      totalStakeCents: entry.totalStake,
      potentialPayoutCents: entry.potentialPayout,
      worstCaseHouseLossCents: entry.worstCaseHouseLoss,
      realizedHouseResultCents: entry.realizedHouseResult,
      topUserPctOfMarket: entry.topUserPctOfMarket,
      concentrationWarning: entry.concentrationWarning,
    };
  } catch {
    return { hasSnapshot: false };
  }
}

async function buildExternalSummary(
  wagerId: string,
  preferredComparisonId?: string,
): Promise<{ summary: HedgeExternalSummary; comparison: KalshiComparison | null }> {
  const comparisons = await getComparisonsByWager(wagerId, 10);
  if (comparisons.length === 0) {
    return {
      summary: {
        hasComparison: false,
        matchedMarketCount: 0,
        highestConfidence: null,
        pricingGapCount: 0,
      },
      comparison: null,
    };
  }
  const chosen =
    (preferredComparisonId && comparisons.find((c) => c.id === preferredComparisonId)) ||
    comparisons[0];
  return {
    summary: {
      hasComparison: true,
      comparisonId: chosen.id,
      comparisonVerdict: chosen.verdict,
      matchedMarketCount: chosen.matchedKalshiMarkets.length,
      highestConfidence: chosen.externalPricingSummary.highestConfidence,
      pricingGapCount: chosen.pricingGapNotes.length,
    },
    comparison: chosen,
  };
}

function deriveRecommendation(
  exp: HedgeExposureSummary,
  ext: HedgeExternalSummary,
): { action: RecommendedAction; rationale: string; risks: string[]; notes: string[] } {
  const risks: string[] = [];
  const notes: string[] = [];

  if (!exp.hasSnapshot) {
    risks.push(
      'No house-exposure snapshot available. Generate one in House Exposure before deciding.',
    );
  }
  if (!ext.hasComparison) {
    risks.push(
      'No Kalshi comparison available for this wager. Generate one in Kalshi Comparison before deciding.',
    );
  }

  if (!exp.hasSnapshot && !ext.hasComparison) {
    return {
      action: 'watch',
      rationale: 'Insufficient data — generate exposure snapshot and Kalshi comparison first.',
      risks,
      notes,
    };
  }

  const worst = exp.worstCaseHouseLossCents ?? 0;
  const highExposure = worst >= HEDGE_REVIEW_LOSS_THRESHOLD_CENTS;
  const usableMatch =
    ext.hasComparison &&
    (ext.highestConfidence === 'medium' || ext.highestConfidence === 'high');

  if (highExposure && usableMatch) {
    notes.push(
      `Worst-case projected loss is $${(worst / 100).toLocaleString()} and Kalshi shows at least one ${ext.highestConfidence}-confidence match (${ext.matchedMarketCount} matched).`,
    );
    notes.push(
      'Operator may consider an external manual hedge. Use Kalshi Comparison and Kalshi Market Data to identify the venue and ticker, then execute outside this system.',
    );
    return {
      action: 'manual_external_hedge_review',
      rationale: 'High projected loss with at least one non-low-confidence external match.',
      risks,
      notes,
    };
  }

  if (highExposure && !usableMatch) {
    return {
      action: 'reduce_exposure',
      rationale:
        'High projected loss with no usable external match — consider reducing exposure (lower limits, suspend creation, or operator-managed line move) instead of hedging externally.',
      risks,
      notes,
    };
  }

  if (!highExposure && ext.comparisonVerdict === 'possible_pricing_gap') {
    return {
      action: 'watch',
      rationale:
        'Pricing gap noted by Kalshi Comparison but exposure is below the hedge-review threshold. Watch for changes.',
      risks,
      notes,
    };
  }

  return {
    action: 'do_not_hedge',
    rationale:
      'Projected loss is below the hedge-review threshold. No external action recommended.',
    risks,
    notes,
  };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export interface CreateReviewInput {
  wagerId: string;
  comparisonId?: string;
}

export async function createHedgeReview(
  input: CreateReviewInput,
  createdBy: string,
): Promise<HedgeReview> {
  if (!input.wagerId) {
    throw new HedgeReviewError('wagerId is required.', 'wager_id_required');
  }
  const wager = await getWager(input.wagerId);
  if (!wager) {
    throw new HedgeReviewError(`Wager ${input.wagerId} not found.`, 'wager_not_found');
  }

  const exposureSummary = await buildExposureSummary(input.wagerId);
  const { summary: externalMarketSummary } = await buildExternalSummary(
    input.wagerId,
    input.comparisonId,
  );
  const { action, rationale, risks, notes } = deriveRecommendation(
    exposureSummary,
    externalMarketSummary,
  );

  const now = new Date().toISOString();
  const review: HedgeReview = {
    id: newId(),
    createdAt: now,
    createdBy,
    relatedWagerId: wager.id,
    wagerTitle: wager.title,
    relatedHouseExposureSnapshotId: exposureSummary.snapshotId,
    relatedKalshiComparisonId: externalMarketSummary.comparisonId,
    status: 'draft',
    exposureSummary,
    externalMarketSummary,
    hedgeRationale: rationale,
    recommendedAction: action,
    suggestedManualHedgeNotes: notes,
    risks,
    decisionNotes: [],
    history: [
      {
        at: now,
        actor: createdBy,
        action: 'review_created',
        details: { recommendedAction: action },
      },
    ],
  };

  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.set(KEY.review(review.id), JSON.stringify(review));
  pipe.zadd(KEY.all, { score: Date.parse(now), member: review.id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_REVIEWS - 1);
  pipe.zadd(KEY.byWager(review.relatedWagerId), {
    score: Date.parse(now),
    member: review.id,
  });
  await pipe.exec();
  return review;
}

export async function addDecisionNote(
  id: string,
  note: string,
  actor: string,
): Promise<HedgeReview> {
  if (!note.trim()) {
    throw new HedgeReviewError('Note text is required.', 'note_required');
  }
  const review = await readReview(id);
  if (!review) throw new HedgeReviewError(`Review ${id} not found.`, 'not_found');
  if (review.status === 'closed') {
    throw new HedgeReviewError('Cannot add a note to a closed review.', 'review_closed');
  }
  const now = new Date().toISOString();
  review.decisionNotes.push(note.trim());
  review.history.push({
    at: now,
    actor,
    action: 'decision_note_added',
    details: { note: note.trim() },
  });
  await writeReview(review);
  return review;
}

export async function changeReviewStatus(
  id: string,
  to: HedgeReviewStatus,
  actor: string,
  reason?: string,
): Promise<HedgeReview> {
  const review = await readReview(id);
  if (!review) throw new HedgeReviewError(`Review ${id} not found.`, 'not_found');
  assertTransition(review.status, to);
  const now = new Date().toISOString();
  const from = review.status;
  review.status = to;
  if (to === 'closed') {
    review.closedAt = now;
    review.closedBy = actor;
  }
  review.history.push({
    at: now,
    actor,
    action: 'status_changed',
    details: { from, to, reason },
  });
  await writeReview(review);
  return review;
}

export async function closeReview(
  id: string,
  actor: string,
  reason?: string,
): Promise<HedgeReview> {
  const review = await readReview(id);
  if (!review) throw new HedgeReviewError(`Review ${id} not found.`, 'not_found');
  if (review.status === 'closed') return review;
  return changeReviewStatus(id, 'closed', actor, reason);
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listHedgeReviews(limit = 50): Promise<HedgeReview[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_REVIEWS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, safe - 1, { rev: true })) as string[];
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.review(id));
  const rows = (await pipe.exec()) as Array<string | null>;
  return rows
    .filter((r): r is string => typeof r === 'string')
    .map((r) => JSON.parse(r) as HedgeReview);
}

export async function getHedgeReview(id: string): Promise<HedgeReview | null> {
  return readReview(id);
}

export async function getHedgeReviewsByWager(
  wagerId: string,
  limit = 50,
): Promise<HedgeReview[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_REVIEWS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.byWager(wagerId), 0, safe - 1, { rev: true })) as string[];
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.review(id));
  const rows = (await pipe.exec()) as Array<string | null>;
  return rows
    .filter((r): r is string => typeof r === 'string')
    .map((r) => JSON.parse(r) as HedgeReview);
}

export interface HedgeReviewSummary {
  total: number;
  byStatus: Record<HedgeReviewStatus, number>;
  byRecommendation: Record<RecommendedAction, number>;
  latest: HedgeReview | null;
}

// ── Step 120 Part G: Hedge watchlist candidates ─────────────────────────────
//
// Surfaces high-loss markets from the latest house-exposure snapshot for
// operator review. Does NOT create reviews automatically; provides the
// signal so the admin UI can offer a "Create Hedge Review" CTA.

export interface HedgeWatchlistCandidate {
  wagerId: string;
  wagerTitle: string;
  status: string;
  worstCaseHouseLossCents: number;
  totalStakeCents: number;
  concentrationWarning: boolean;
  hasExistingReview: boolean;
  latestReviewId?: string;
  latestReviewStatus?: HedgeReviewStatus;
  hasKalshiComparison: boolean;
  latestComparisonId?: string;
  comparisonVerdict?: KalshiComparison['verdict'];
  recommendedAction: RecommendedAction;
  notes: string[];
}

export interface HedgeWatchlist {
  generatedAt: string;
  exposureSnapshotId?: string;
  thresholdCents: number;
  candidates: HedgeWatchlistCandidate[];
  warnings: string[];
}

export async function listHedgeWatchlistCandidates(): Promise<HedgeWatchlist> {
  const warnings: string[] = [];
  const out: HedgeWatchlist = {
    generatedAt: new Date().toISOString(),
    thresholdCents: HEDGE_REVIEW_LOSS_THRESHOLD_CENTS,
    candidates: [],
    warnings,
  };

  let exposureSnapshot: Awaited<ReturnType<typeof listExposureSnapshots>>[number] | undefined;
  try {
    const recent = await listExposureSnapshots(1);
    exposureSnapshot = recent[0];
  } catch {
    /* fall through */
  }
  if (!exposureSnapshot) {
    warnings.push(
      'No house-exposure snapshot exists yet. Generate one in House Exposure to populate the watchlist.',
    );
    return out;
  }
  out.exposureSnapshotId = exposureSnapshot.id;

  const highLoss = exposureSnapshot.topRiskMarkets.filter(
    (r) => r.worstCaseHouseLoss >= HEDGE_REVIEW_LOSS_THRESHOLD_CENTS,
  );
  if (highLoss.length === 0) {
    warnings.push(
      `No markets in the latest exposure snapshot exceed the $${(HEDGE_REVIEW_LOSS_THRESHOLD_CENTS / 100).toLocaleString()} hedge-review threshold.`,
    );
    return out;
  }

  for (const entry of highLoss) {
    const [reviews, comparisons] = await Promise.all([
      getHedgeReviewsByWager(entry.wagerId, 5),
      getComparisonsByWager(entry.wagerId, 5),
    ]);

    const latestReview = reviews[0];
    const latestComparison = comparisons[0];

    const exposureSummary: HedgeExposureSummary = {
      hasSnapshot: true,
      snapshotId: exposureSnapshot.id,
      totalStakeCents: entry.totalStake,
      potentialPayoutCents: entry.potentialPayout,
      worstCaseHouseLossCents: entry.worstCaseHouseLoss,
      realizedHouseResultCents: entry.realizedHouseResult,
      topUserPctOfMarket: entry.topUserPctOfMarket,
      concentrationWarning: entry.concentrationWarning,
    };
    const externalSummary: HedgeExternalSummary = latestComparison
      ? {
          hasComparison: true,
          comparisonId: latestComparison.id,
          comparisonVerdict: latestComparison.verdict,
          matchedMarketCount: latestComparison.matchedKalshiMarkets.length,
          highestConfidence: latestComparison.externalPricingSummary.highestConfidence,
          pricingGapCount: latestComparison.pricingGapNotes.length,
        }
      : {
          hasComparison: false,
          matchedMarketCount: 0,
          highestConfidence: null,
          pricingGapCount: 0,
        };

    const { action, notes } = deriveRecommendation(exposureSummary, externalSummary);
    const candidateNotes: string[] = [...notes];
    if (!latestComparison) {
      candidateNotes.push(
        'Generate a Kalshi comparison for this wager before deciding whether to hedge.',
      );
    }
    if (latestReview) {
      candidateNotes.push(
        `An existing hedge review (${latestReview.status}) is on file — see Review Detail.`,
      );
    }

    out.candidates.push({
      wagerId: entry.wagerId,
      wagerTitle: entry.title,
      status: entry.status,
      worstCaseHouseLossCents: entry.worstCaseHouseLoss,
      totalStakeCents: entry.totalStake,
      concentrationWarning: entry.concentrationWarning,
      hasExistingReview: !!latestReview,
      latestReviewId: latestReview?.id,
      latestReviewStatus: latestReview?.status,
      hasKalshiComparison: !!latestComparison,
      latestComparisonId: latestComparison?.id,
      comparisonVerdict: latestComparison?.verdict,
      recommendedAction: action,
      notes: candidateNotes,
    });
  }

  // Sort candidates by worst-case loss desc.
  out.candidates.sort((a, b) => b.worstCaseHouseLossCents - a.worstCaseHouseLossCents);
  return out;
}

export async function getHedgeReviewSummary(): Promise<HedgeReviewSummary> {
  const recent = await listHedgeReviews(100);
  const byStatus: Record<HedgeReviewStatus, number> = {
    draft: 0,
    under_review: 0,
    hedge_recommended: 0,
    no_hedge_recommended: 0,
    manually_hedged_elsewhere: 0,
    closed: 0,
  };
  const byRecommendation: Record<RecommendedAction, number> = {
    watch: 0,
    reduce_exposure: 0,
    manual_external_hedge_review: 0,
    do_not_hedge: 0,
  };
  for (const r of recent) {
    byStatus[r.status] += 1;
    byRecommendation[r.recommendedAction] += 1;
  }
  return { total: recent.length, byStatus, byRecommendation, latest: recent[0] ?? null };
}
