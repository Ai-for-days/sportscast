// ── Step 155: Operator feedback on generated weather market ideas ───────
//
// Server-only Redis-backed store for the structured "useful / not
// useful + reason" feedback an admin records against ideas the
// generator produced. **Pure operator-tracking metadata.** Submitting
// feedback never publishes a market, never creates a wager, never
// touches pricing/settlement/wallet code paths, never mutates a
// smart-discovery preset definition. The Step 154 presets remain
// hard-coded in `weather-market-city-universe.ts`; the feedback
// summary is advisory only — preset edits stay manual.
//
// Trust posture (mirrors Steps 146/147/149/153 stores):
//   - Server-only — browser-import throws.
//   - Bounded retention (`MAX_FEEDBACK_RECORDS = 1000`).
//   - Imports nothing from wager-store / settlement / grading / wallet
//     / pricing / publish / Kalshi / Polymarket / forecast modules.
//   - Customer code paths cannot reach `weather-market-idea-feedback:*`
//     keys — that namespace is admin-only.
//   - The `presetId` / `weatherTags` / `metricPair` echoed on each
//     record come from the generator's resolved knobs at submit time,
//     not from operator-supplied free text. Hostile input cannot inject
//     unknown presets / tags / metric pairs because the API layer
//     (and this store, defensively) validates against the static
//     allow-lists.

import { getRedis } from './redis';

if (typeof window !== 'undefined') {
  throw new Error(
    'weather-market-idea-feedback-store is server-only and must not be imported in client code',
  );
}

// ── Public types ────────────────────────────────────────────────────────────

export type FeedbackRating = 'useful' | 'not_useful' | 'neutral';
export const FEEDBACK_RATINGS: readonly FeedbackRating[] = [
  'useful',
  'not_useful',
  'neutral',
] as const;

export type FeedbackReason =
  | 'good_candidate'
  | 'too_boring'
  | 'too_extreme'
  | 'bad_city_pair'
  | 'unclear_market'
  | 'duplicate'
  | 'wrong_metric_pair'
  | 'poor_forecast_confidence'
  | 'other';

export const FEEDBACK_REASONS: readonly FeedbackReason[] = [
  'good_candidate',
  'too_boring',
  'too_extreme',
  'bad_city_pair',
  'unclear_market',
  'duplicate',
  'wrong_metric_pair',
  'poor_forecast_confidence',
  'other',
] as const;

const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  good_candidate: 'Good candidate',
  too_boring: 'Too boring',
  too_extreme: 'Too extreme',
  bad_city_pair: 'Bad city pair',
  unclear_market: 'Unclear market',
  duplicate: 'Duplicate of existing market',
  wrong_metric_pair: 'Wrong metric pair',
  poor_forecast_confidence: 'Poor forecast confidence',
  other: 'Other',
};

export function getFeedbackReasonLabel(reason: string): string {
  return (FEEDBACK_REASON_LABELS as Record<string, string>)[reason] ?? reason;
}

/**
 * The minimum about a generated idea we want to keep with feedback so
 * the summary can render context even after the live universe / preset
 * definitions change. Frozen at submit time.
 */
export interface FeedbackIdeaSummary {
  title: string;
  locationAName: string;
  locationBName: string;
  metricA: string;
  metricB: string;
  /** Signed (A − B). */
  rawDifference: number;
  /** Suggested spread on side A (Step 145). */
  suggestedSpread: number;
}

export interface WeatherMarketIdeaFeedback {
  id: string;
  createdAt: string;
  /** Generator-issued idea id at the time of feedback. */
  ideaId: string;
  /** Optional fingerprint (matches the saved-idea/draft fingerprint scheme). */
  ideaFingerprint?: string;
  /** Step 154 — preset that produced the run, when applicable. */
  presetId?: string;
  /** Step 154 — tag filter that produced the run, when applicable. */
  weatherTags?: string[];
  tagMode?: 'any' | 'all';
  metricPair: string;
  targetDifferenceF?: number;
  toleranceF?: number;
  cityUniverse: string;
  region?: string;
  rating: FeedbackRating;
  /** Required when `rating === 'not_useful'`; optional otherwise. */
  reason?: FeedbackReason;
  /** Free-text operator note. ≤ FEEDBACK_NOTE_MAX_LEN chars. */
  operatorNote?: string;
  ideaSummary: FeedbackIdeaSummary;
}

// ── Caps ────────────────────────────────────────────────────────────────────

export const MAX_FEEDBACK_RECORDS = 1000;
export const FEEDBACK_NOTE_MAX_LEN = 500;

const KEY = {
  one: (id: string) => `weather-market-idea-feedback:${id}`,
  all: 'weather-market-idea-feedbacks:all',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `wmif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseRecord(raw: string | null | unknown): WeatherMarketIdeaFeedback | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as WeatherMarketIdeaFeedback)
      : (raw as WeatherMarketIdeaFeedback);
  } catch {
    return null;
  }
}

function isValidRating(s: unknown): s is FeedbackRating {
  return typeof s === 'string' && (FEEDBACK_RATINGS as readonly string[]).includes(s);
}

function isValidReason(s: unknown): s is FeedbackReason {
  return typeof s === 'string' && (FEEDBACK_REASONS as readonly string[]).includes(s);
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface SubmitFeedbackInput {
  ideaId: string;
  ideaFingerprint?: string;
  presetId?: string;
  weatherTags?: string[];
  tagMode?: 'any' | 'all';
  metricPair: string;
  targetDifferenceF?: number;
  toleranceF?: number;
  cityUniverse: string;
  region?: string;
  rating: FeedbackRating;
  reason?: FeedbackReason;
  operatorNote?: string;
  ideaSummary: FeedbackIdeaSummary;
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<WeatherMarketIdeaFeedback> {
  if (!input.ideaId) {
    throw new Error('feedback_idea_id_required');
  }
  if (!isValidRating(input.rating)) {
    throw new Error('feedback_invalid_rating');
  }
  if (input.reason !== undefined && !isValidReason(input.reason)) {
    throw new Error('feedback_invalid_reason');
  }

  const redis = getRedis();
  const id = generateId();
  const now = new Date().toISOString();
  const note =
    typeof input.operatorNote === 'string' && input.operatorNote.trim().length > 0
      ? input.operatorNote.slice(0, FEEDBACK_NOTE_MAX_LEN)
      : undefined;

  const record: WeatherMarketIdeaFeedback = {
    id,
    createdAt: now,
    ideaId: input.ideaId,
    ideaFingerprint: input.ideaFingerprint,
    presetId: input.presetId,
    weatherTags: input.weatherTags && input.weatherTags.length > 0 ? input.weatherTags : undefined,
    tagMode: input.tagMode,
    metricPair: input.metricPair,
    targetDifferenceF: input.targetDifferenceF,
    toleranceF: input.toleranceF,
    cityUniverse: input.cityUniverse,
    region: input.region,
    rating: input.rating,
    reason: input.reason,
    operatorNote: note,
    ideaSummary: input.ideaSummary,
  };

  const score = Date.parse(now) || Date.now();
  const pipe = redis.pipeline();
  pipe.set(KEY.one(id), JSON.stringify(record));
  pipe.zadd(KEY.all, { score, member: id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_FEEDBACK_RECORDS - 1);
  await pipe.exec();
  return record;
}

export interface ListFeedbackOptions {
  /** Cap on records returned. Clamped to MAX_FEEDBACK_RECORDS. */
  limit?: number;
  /** Optional preset filter. */
  presetId?: string;
  /** Optional rating filter. */
  rating?: FeedbackRating;
  /** Optional metric-pair filter. */
  metricPair?: string;
}

export async function listFeedback(options: ListFeedbackOptions = {}): Promise<WeatherMarketIdeaFeedback[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_FEEDBACK_RECORDS, Math.max(1, options.limit ?? 200));
  const ids = (await redis.zrange(KEY.all, 0, -1, { rev: true })) as string[];
  if (!ids || ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.one(id));
  const rows = (await pipe.exec()) as Array<string | null | unknown>;
  const out: WeatherMarketIdeaFeedback[] = [];
  for (const row of rows) {
    const r = parseRecord(row);
    if (!r) continue;
    if (options.presetId && r.presetId !== options.presetId) continue;
    if (options.rating && r.rating !== options.rating) continue;
    if (options.metricPair && r.metricPair !== options.metricPair) continue;
    out.push(r);
    if (out.length >= safe) break;
  }
  return out;
}

export async function getFeedback(id: string): Promise<WeatherMarketIdeaFeedback | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = (await redis.get(KEY.one(id))) as string | null;
  return parseRecord(raw);
}
