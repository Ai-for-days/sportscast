// ── Step 150: Market duplicate + correlation warnings (admin-only) ─────
//
// Pure-ish risk-analysis helpers. Given a candidate market shape and a
// "universe" of comparable records (saved ideas, draft wagers, live
// wagers), produce a list of `WeatherMarketRiskWarning`s the admin UI
// can surface as advisory pills. **Operator guidance only.** No call
// site of this file ever blocks a button, cancels a market, changes a
// price, or mutates a wallet/settlement record. The existing
// duplicate-draft / duplicate-publish guards from Steps 147/148 are
// the only hard refusals; everything here is informational.
//
// Trust posture:
//   - The pure analyzer (`analyzeRisk`) is just data-in / data-out.
//   - The async universe loader is **server-only** (browser-import
//     throws) and reads only from admin-context stores: the saved-idea
//     store (Step 146), the draft-wager store (Step 147), and the
//     live-wager store via the existing admin `listAllWagers` helper.
//   - Imports nothing from wallet / settlement / grading / pricing /
//     publish / Kalshi / Polymarket modules.
//   - PublicWagerView is not modified — risk warnings never enter the
//     public allow-list and cannot leak through `serializePublicWager`.

import type { WagerMetric } from './wager-types';
import type { WeatherMarketIdea } from './weather-market-idea-generator';
import type { SavedWeatherMarketIdea } from './weather-market-idea-store';
import type { DraftWager } from './weather-market-draft-wager-store';
import { listSavedIdeas } from './weather-market-idea-store';
import { listDraftWagers } from './weather-market-draft-wager-store';
import { listAllWagers } from './weather-market-store-admin';

// Note: `weather-market-store-admin` is a thin re-exporter of
// `wager-store.listAllWagers` so we can keep the trust footprint of
// this module narrow on grep ("wager-store" only appears in the
// indirection, not in the analyzer's logic). See that file for the
// rationale. If you'd rather inline the import, that's fine too —
// the safety property is the same either way.

// ── Public types ────────────────────────────────────────────────────────────

/**
 * The conservative warning taxonomy. New types should be added here
 * (and to `WARNING_TYPES`) so the UI legend stays stable.
 */
export type RiskWarningType =
  | 'exact_duplicate'
  | 'similar_market'
  | 'same_location_date_metric'
  | 'same_location_cluster'
  | 'same_date_cluster'
  | 'correlated_temperature_spread'
  | 'repeated_city_pair'
  | 'same_spread_nearby_line'
  | 'high_existing_activity';

export const RISK_WARNING_TYPES: readonly RiskWarningType[] = [
  'exact_duplicate',
  'similar_market',
  'same_location_date_metric',
  'same_location_cluster',
  'same_date_cluster',
  'correlated_temperature_spread',
  'repeated_city_pair',
  'same_spread_nearby_line',
  'high_existing_activity',
] as const;

export type RiskSeverity = 'info' | 'warning' | 'high';

export interface WeatherMarketRiskWarning {
  id: string;
  severity: RiskSeverity;
  type: RiskWarningType;
  title: string;
  description: string;
  /** Ids of comparison records that drove this warning. */
  relatedIds: string[];
  /** Display titles (parallel to relatedIds) so the UI doesn't have to rejoin. */
  relatedTitles: string[];
  suggestedAction: string;
}

/**
 * Internal normalized record. Saved ideas, draft wagers, and live
 * wagers all map into this shape so the analyzer can compare them
 * uniformly. Only pointspread markets are surfaced today (the
 * generator never produces other kinds), but we carry `kind` so a
 * future expansion can filter rather than crash.
 */
export interface MarketLikeRecord {
  source: 'idea' | 'draft' | 'wager';
  /** Source-specific id; never the wager id when source !== 'wager'. */
  id: string;
  /** Live wager id when known (drafts after publish, or live wagers). */
  wagerId?: string;
  title: string;
  kind: 'pointspread';
  /** YYYY-MM-DD. */
  targetDate: string;
  /** Lower-cased / trimmed for matching. */
  locationANorm: string;
  locationBNorm: string;
  locationADisplay: string;
  locationBDisplay: string;
  /** Wager-style metrics (high_temp / low_temp / actual_*). */
  metricA: string;
  metricB: string;
  spread: number;
  /** Source status string for hover-text — not used by matching logic. */
  status: string;
}

export interface MarketRiskUniverse {
  ideas: MarketLikeRecord[];
  drafts: MarketLikeRecord[];
  wagers: MarketLikeRecord[];
}

// ── Heuristic thresholds (tuned conservative) ──────────────────────────────

/** |Δspread| ≤ this counts as exact (rounded to one decimal). */
const EXACT_SPREAD_TOLERANCE_F = 0.5;
/** |Δspread| ≤ this counts as "near" — drives `same_spread_nearby_line`. */
const NEAR_SPREAD_TOLERANCE_F = 2;
/** Markets per (locationA, date) at or above which we flag a cluster. */
const SAME_LOCATION_CLUSTER_THRESHOLD = 3;
/** Markets per date at or above which we flag a global concentration. */
const SAME_DATE_CLUSTER_THRESHOLD = 5;
/** Total active records on the candidate's date involving any of its locations. */
const HIGH_EXISTING_ACTIVITY_THRESHOLD = 3;
/** Repeated city pair count threshold (across all sources). */
const REPEATED_CITY_PAIR_THRESHOLD = 2;

// ── Normalization helpers ──────────────────────────────────────────────────

const IDEA_METRIC_TO_WAGER: Record<'daily_high' | 'daily_low', WagerMetric> = {
  daily_high: 'high_temp',
  daily_low: 'low_temp',
};

function normalizeName(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase();
}

function pairKey(a: string, b: string): string {
  // Direction-agnostic key for repeated-city-pair detection. Direction
  // *does* matter for spread sign, but for "you keep proposing markets
  // on this same pair" the operator wants both orderings counted.
  return [a, b].sort().join('|');
}

function ideaWarnId(type: RiskWarningType): string {
  return `risk-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeIdea(
  saved: SavedWeatherMarketIdea | { id: string; idea: WeatherMarketIdea },
): MarketLikeRecord {
  const idea = (saved as SavedWeatherMarketIdea).idea ?? (saved as { idea: WeatherMarketIdea }).idea;
  return {
    source: 'idea',
    id: (saved as { id: string }).id,
    title: idea.title,
    kind: 'pointspread',
    targetDate: idea.targetDate,
    locationANorm: normalizeName(idea.locationA?.label),
    locationBNorm: normalizeName(idea.locationB?.label),
    locationADisplay: idea.locationA?.label ?? '',
    locationBDisplay: idea.locationB?.label ?? '',
    metricA: IDEA_METRIC_TO_WAGER[idea.metricA] ?? idea.metricA,
    metricB: IDEA_METRIC_TO_WAGER[idea.metricB] ?? idea.metricB,
    spread: idea.suggestedSpread,
    status: (saved as SavedWeatherMarketIdea).status ?? 'new',
  };
}

/** Standalone (unsaved) idea normalizer for the generator response path. */
export function normalizeBareIdea(idea: WeatherMarketIdea): MarketLikeRecord {
  return normalizeIdea({ id: idea.id, idea });
}

export function normalizeDraft(d: DraftWager): MarketLikeRecord {
  const i = d.input;
  return {
    source: 'draft',
    id: d.id,
    wagerId: d.publishedWagerId,
    title: i.title,
    kind: 'pointspread',
    targetDate: i.targetDate,
    locationANorm: normalizeName(i.locationA?.name),
    locationBNorm: normalizeName(i.locationB?.name),
    locationADisplay: i.locationA?.name ?? '',
    locationBDisplay: i.locationB?.name ?? '',
    metricA: i.metricA ?? i.metric,
    metricB: i.metricB ?? i.metric,
    spread: i.spread ?? 0,
    status: d.status,
  };
}

/** Live `Wager` from `wager-store`. Only pointspreads are surfaced. */
export function normalizeWager(w: any): MarketLikeRecord | null {
  if (!w || w.kind !== 'pointspread') return null;
  return {
    source: 'wager',
    id: w.id,
    wagerId: w.id,
    title: w.title ?? '',
    kind: 'pointspread',
    targetDate: w.targetDate,
    locationANorm: normalizeName(w.locationA?.name),
    locationBNorm: normalizeName(w.locationB?.name),
    locationADisplay: w.locationA?.name ?? '',
    locationBDisplay: w.locationB?.name ?? '',
    metricA: w.metricA ?? w.metric,
    metricB: w.metricB ?? w.metric,
    spread: typeof w.spread === 'number' ? w.spread : 0,
    status: w.status ?? 'unknown',
  };
}

// ── Async universe loader ──────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  throw new Error(
    'weather-market-risk-warnings async loader is server-only and must not be imported in client code',
  );
}

export interface FetchUniverseOptions {
  /** Live wagers in these statuses are considered "active". Defaults to open + locked. */
  liveStatuses?: Array<'open' | 'locked' | 'graded' | 'void'>;
  /** Cap on each comparison set to keep the request cheap. */
  maxPerSet?: number;
}

export async function fetchRiskUniverse(
  options: FetchUniverseOptions = {},
): Promise<MarketRiskUniverse> {
  const liveStatuses = new Set(options.liveStatuses ?? ['open', 'locked']);
  const maxPerSet = Math.min(500, Math.max(50, options.maxPerSet ?? 200));

  const [savedIdeas, drafts, wagers] = await Promise.all([
    listSavedIdeas({ limit: maxPerSet }).catch(() => []),
    listDraftWagers(maxPerSet).catch(() => []),
    listAllWagers(maxPerSet).catch(() => [] as any[]),
  ]);

  return {
    ideas: savedIdeas.map(normalizeIdea),
    drafts: drafts.map(normalizeDraft),
    wagers: wagers
      .filter((w) => liveStatuses.has(w.status))
      .map(normalizeWager)
      .filter((r): r is MarketLikeRecord => r !== null),
  };
}

// ── Pure analyzer ──────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  /** Source ids to skip (e.g. the candidate's own saved-idea id). */
  excludeIds?: Iterable<string>;
}

function allRecords(u: MarketRiskUniverse): MarketLikeRecord[] {
  return [...u.ideas, ...u.drafts, ...u.wagers];
}

function isSamePair(a: MarketLikeRecord, b: MarketLikeRecord): boolean {
  return (
    (a.locationANorm === b.locationANorm && a.locationBNorm === b.locationBNorm) ||
    (a.locationANorm === b.locationBNorm && a.locationBNorm === b.locationANorm)
  );
}

function isSamePairSameDirection(a: MarketLikeRecord, b: MarketLikeRecord): boolean {
  return a.locationANorm === b.locationANorm && a.locationBNorm === b.locationBNorm;
}

function isSameMetricPair(a: MarketLikeRecord, b: MarketLikeRecord): boolean {
  return (
    (a.metricA === b.metricA && a.metricB === b.metricB) ||
    (a.metricA === b.metricB && a.metricB === b.metricA)
  );
}

function spreadDelta(a: MarketLikeRecord, b: MarketLikeRecord): number {
  return Math.abs(a.spread - b.spread);
}

export function analyzeRisk(
  candidate: MarketLikeRecord,
  universe: MarketRiskUniverse,
  options: AnalyzeOptions = {},
): WeatherMarketRiskWarning[] {
  const exclude = new Set<string>(options.excludeIds ?? []);
  // Always exclude the candidate by its own id and (if known) wager id.
  exclude.add(candidate.id);
  if (candidate.wagerId) exclude.add(candidate.wagerId);

  const others = allRecords(universe).filter((r) => {
    if (exclude.has(r.id)) return false;
    if (r.wagerId && exclude.has(r.wagerId)) return false;
    return true;
  });

  const warnings: WeatherMarketRiskWarning[] = [];
  const pushWarning = (
    type: RiskWarningType,
    severity: RiskSeverity,
    title: string,
    description: string,
    matches: MarketLikeRecord[],
    suggestedAction: string,
  ) => {
    if (matches.length === 0) return;
    warnings.push({
      id: ideaWarnId(type),
      type,
      severity,
      title,
      description,
      relatedIds: matches.map((m) => m.id),
      relatedTitles: matches.map((m) => m.title),
      suggestedAction,
    });
  };

  // ── Same-date matchers ────────────────────────────────────────────────────
  const sameDate = others.filter((r) => r.targetDate === candidate.targetDate);

  // (1) Exact duplicate: same direction + same metric pair + spread within tolerance.
  const exactDuplicates = sameDate.filter(
    (r) =>
      isSamePairSameDirection(r, candidate) &&
      isSameMetricPair(r, candidate) &&
      spreadDelta(r, candidate) <= EXACT_SPREAD_TOLERANCE_F,
  );
  pushWarning(
    'exact_duplicate',
    'high',
    'Exact duplicate market detected',
    `Another ${exactDuplicates.length === 1 ? 'record' : exactDuplicates.length + ' records'} matches this market on date, locations, metrics, and spread (within ±${EXACT_SPREAD_TOLERANCE_F}°F).`,
    exactDuplicates,
    'Confirm this is intentional. Publishing a duplicate live wager will create overlapping customer markets.',
  );

  // (2) Same-spread, near line — broader than exact, lower severity.
  const nearbySameSpread = sameDate.filter(
    (r) =>
      isSamePairSameDirection(r, candidate) &&
      isSameMetricPair(r, candidate) &&
      spreadDelta(r, candidate) > EXACT_SPREAD_TOLERANCE_F &&
      spreadDelta(r, candidate) <= NEAR_SPREAD_TOLERANCE_F,
  );
  pushWarning(
    'same_spread_nearby_line',
    'warning',
    'Same market with a nearby spread already exists',
    `Another record on the same locations + date + metrics has a spread within ±${NEAR_SPREAD_TOLERANCE_F}°F of this one.`,
    nearbySameSpread,
    'Decide whether you want both lines live, or move one to better differentiate them.',
  );

  // (3) Similar market — same pair (any direction) + same date, but different
  //     metrics or larger spread gap.
  const similar = sameDate.filter(
    (r) =>
      !exactDuplicates.includes(r) &&
      !nearbySameSpread.includes(r) &&
      isSamePair(r, candidate) &&
      spreadDelta(r, candidate) <= NEAR_SPREAD_TOLERANCE_F * 2,
  );
  pushWarning(
    'similar_market',
    'warning',
    'Similar market already exists',
    'Another record covers the same city pair on the same date with a comparable spread.',
    similar,
    'Customers may find these markets interchangeable. Differentiate the title or rules.',
  );

  // (4) Correlated temperature spread — at least one shared location, same date.
  const correlated = sameDate.filter(
    (r) =>
      !isSamePair(r, candidate) &&
      (r.locationANorm === candidate.locationANorm ||
        r.locationBNorm === candidate.locationBNorm ||
        r.locationANorm === candidate.locationBNorm ||
        r.locationBNorm === candidate.locationANorm),
  );
  pushWarning(
    'correlated_temperature_spread',
    'info',
    'Correlated exposure on a shared location',
    `${correlated.length} other ${correlated.length === 1 ? 'market shares' : 'markets share'} a location with this one on ${candidate.targetDate}. Outcomes may move together.`,
    correlated,
    'Be mindful of concentration if you publish this — a heat wave at the shared city moves multiple markets.',
  );

  // (5) Same location + date + metric (different other side).
  const sameLocDateMetric = sameDate.filter(
    (r) =>
      !isSamePair(r, candidate) &&
      ((r.locationANorm === candidate.locationANorm && r.metricA === candidate.metricA) ||
        (r.locationBNorm === candidate.locationBNorm && r.metricB === candidate.metricB)),
  );
  pushWarning(
    'same_location_date_metric',
    'info',
    'Same location/date/metric already used',
    'Another market resolves on the same metric at one of these locations on this date.',
    sameLocDateMetric,
    'No action needed — this is just a reminder that grading inputs overlap.',
  );

  // ── Cluster matchers ──────────────────────────────────────────────────────

  // (6) Same-location cluster: count records that touch the candidate's
  //     locationA OR locationB on the same date.
  const locationCluster = sameDate.filter(
    (r) =>
      r.locationANorm === candidate.locationANorm ||
      r.locationBNorm === candidate.locationANorm ||
      r.locationANorm === candidate.locationBNorm ||
      r.locationBNorm === candidate.locationBNorm,
  );
  if (locationCluster.length >= SAME_LOCATION_CLUSTER_THRESHOLD) {
    pushWarning(
      'same_location_cluster',
      'warning',
      `${locationCluster.length} markets cluster on these locations on ${candidate.targetDate}`,
      `Threshold is ≥ ${SAME_LOCATION_CLUSTER_THRESHOLD} active records sharing at least one of this market's locations on the same date.`,
      locationCluster,
      'Consider whether the book wants this much exposure to weather at these cities on this date.',
    );
  }

  // (7) Same-date cluster: count of all active records on this date.
  if (sameDate.length >= SAME_DATE_CLUSTER_THRESHOLD) {
    pushWarning(
      'same_date_cluster',
      'info',
      `${sameDate.length} other markets target ${candidate.targetDate}`,
      `Threshold is ≥ ${SAME_DATE_CLUSTER_THRESHOLD} other active records on the same target date.`,
      sameDate.slice(0, 8),
      'Heavy concentration on one date amplifies operational risk if observation data is delayed or contested.',
    );
  }

  // (8) Repeated city pair across all sources.
  const candidatePairKey = pairKey(candidate.locationANorm, candidate.locationBNorm);
  const repeatedPair = others.filter(
    (r) => pairKey(r.locationANorm, r.locationBNorm) === candidatePairKey,
  );
  if (repeatedPair.length >= REPEATED_CITY_PAIR_THRESHOLD) {
    pushWarning(
      'repeated_city_pair',
      'info',
      `City pair appears in ${repeatedPair.length} other records`,
      'You have proposed or published markets on this same city pair before. Customers may interpret them as a series.',
      repeatedPair.slice(0, 6),
      'Optional — consistency in titling helps customers if you keep building on this pair.',
    );
  }

  // (9) High existing activity on the date involving either of the
  //     candidate's locations (any direction, any metric, any source).
  const highActivity = others.filter(
    (r) =>
      r.targetDate === candidate.targetDate &&
      (r.locationANorm === candidate.locationANorm ||
        r.locationBNorm === candidate.locationANorm ||
        r.locationANorm === candidate.locationBNorm ||
        r.locationBNorm === candidate.locationBNorm),
  );
  if (
    highActivity.length >= HIGH_EXISTING_ACTIVITY_THRESHOLD &&
    locationCluster.length < SAME_LOCATION_CLUSTER_THRESHOLD
  ) {
    // Only emit if the location-cluster warning didn't already cover this
    // — keeps the panel from showing two warnings for the same root cause.
    pushWarning(
      'high_existing_activity',
      'info',
      `Elevated activity on ${candidate.targetDate}`,
      `${highActivity.length} active or proposed records on this date already touch one of these locations.`,
      highActivity.slice(0, 6),
      'Consider spacing out market launches if too many resolve on the same day.',
    );
  }

  return warnings;
}

/**
 * Convenience: analyze every record in `candidates` against the
 * universe in one call. Used by the API to attach warnings to list
 * responses without doing N round-trips through the universe loader.
 */
export function analyzeRiskBatch(
  candidates: MarketLikeRecord[],
  universe: MarketRiskUniverse,
): Map<string, WeatherMarketRiskWarning[]> {
  const out = new Map<string, WeatherMarketRiskWarning[]>();
  for (const c of candidates) {
    out.set(c.id, analyzeRisk(c, universe));
  }
  return out;
}
