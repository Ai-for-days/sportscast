// ── Step 144 / Step 145: Weather market idea generator (admin-only, server-only) ──
//
// Generates draft cross-location pointspread market ideas from current
// forecast data. **Pure suggestion layer** — never creates a wager,
// never publishes anything, never touches pricing or settlement. The
// operator copies the title + setup notes manually into the existing
// wager-creation form (or follows a query-param-prefilled link) if they
// want a market.
//
// Step 145 added a target-difference search mode: instead of "show me
// the most interesting spreads," the operator can say "find me a
// forecasted temperature difference around 20°F" and the generator
// ranks pairs by closeness to that target. The cross-metric flag
// (high vs low) is now a first-class metricPair option, not a fixed
// permutation.
//
// Trust posture:
//   - Server-only — browser-import throws.
//   - Reads forecasts via the existing `getForecast` helper, which
//     respects the env-driven provider resolver (Open-Meteo by default).
//   - Does not import or call any wager-creation, market-publish,
//     pricing, settlement, grading, wallet, or audit-mutation code.
//   - Returns plain data only. No persistence in this build.
//
// See docs/weather-market-idea-generator.md for the philosophy and
// future-extension list.

// Step 152 — generator now consumes the bounded `weather-market-city-universe`
// directly. The legacy `FORECAST_QUALITY_SEED_CITIES` import is gone; the
// seed-12 cities still flow through the same code path because the
// universe module re-projects them into the same shape.
import {
  resolveCityUniverse,
  CITY_UNIVERSE_MODES,
  CITY_REGION_FILTERS,
  EXPANDED_US_CITY_COUNT,
  MAX_EXPANDED_CITIES,
  DEFAULT_EXPANDED_MAX,
  TAG_MODES,
  type CityUniverseMode,
  type CityRegionFilter,
  type WeatherMarketCity,
  type WeatherPersonalityTag,
  type TagMode,
} from './weather-market-city-universe';
import { getForecast } from './weather-queries';
import type { ForecastResponse, DailyForecast } from './types';
// Step 156 — historical outcome memory + interestingness scoring.
// Loaders are server-only + best-effort; the generator never blocks
// on their failure (they're wrapped in try/catch at the call site).
import {
  fetchOutcomeMemory,
  fetchFeedbackUsefulRate,
  scoreIdeaAgainstMemory,
} from './weather-market-outcome-memory';
// Step 163 — opportunity-quality scoring + suppression. All pure.
import {
  describeConfidence,
} from './weather-market-confidence-normalizer';
import {
  computeQualityScore,
  type QualityComponents,
  type QualityTier,
} from './weather-market-quality-score';
import { dedupeIdeas } from './weather-market-idea-deduper';

if (typeof window !== 'undefined') {
  throw new Error(
    'weather-market-idea-generator is server-only and must not be imported in client code',
  );
}

// ── Public types ────────────────────────────────────────────────────────────

export type IdeaMetric = 'daily_high' | 'daily_low';

/**
 * Step 145 — metric-pair selector. Controls which (metricA, metricB)
 * tuples the generator considers when scanning city pairs.
 *
 *   high_vs_high           — A.high vs B.high (same-metric)
 *   low_vs_low             — A.low  vs B.low  (same-metric)
 *   high_vs_low            — A.high vs B.low  (cross-metric)
 *   any_temperature_pair   — all three of the above
 */
export type MetricPairOption =
  | 'high_vs_high'
  | 'low_vs_low'
  | 'high_vs_low'
  | 'any_temperature_pair';

export const METRIC_PAIR_OPTIONS: readonly MetricPairOption[] = [
  'any_temperature_pair',
  'high_vs_high',
  'low_vs_low',
  'high_vs_low',
] as const;

export interface IdeaLocation {
  id: string;
  label: string;
  lat: number;
  lon: number;
  region: string;
}

export interface WeatherMarketIdea {
  id: string;
  title: string;
  description: string;
  /** Steps 144/145 only emit pointspread ideas. */
  kind: 'pointspread';
  locationA: IdeaLocation;
  locationB: IdeaLocation;
  metricA: IdeaMetric;
  metricB: IdeaMetric;
  /** YYYY-MM-DD. */
  targetDate: string;
  forecastValueA: number;
  forecastValueB: number;
  /** Signed (A - B). */
  rawDifference: number;
  /** |rawDifference| — convenience for the UI. */
  absDifference: number;
  /** Suggested spread on side A (negative when A is higher). */
  suggestedSpread: number;
  /** Default -110 for both sides. */
  suggestedOddsA: number;
  suggestedOddsB: number;
  /** Coarse confidence label derived from the forecast horizon and absolute spread. */
  confidenceLabel: 'higher' | 'medium' | 'lower';
  /** One-sentence rationale safe to copy into market description. */
  rationale: string;
  /** Free-text warnings the operator should read before creating a market. */
  warnings: string[];
  /** Always 'idea_only' in this build. */
  status: 'idea_only';
  /** Compact setup notes the operator can copy into the wager-creation form. */
  setupNotes: string;
  /**
   * Internal — used for sort and chip color. In the legacy
   * "interestingness" mode this is `|Δ| + region_bonus`. In target-
   * difference mode this is repurposed to `−|Δ − target|` so larger is
   * still better and the UI can keep its existing comparator.
   */
  interestingnessScore: number;
  /**
   * Step 145 — populated only in target-difference mode. The °F gap
   * between this idea's |Δ| and the requested targetDifferenceF.
   * Smaller = closer to the operator's target.
   */
  closenessToTarget?: number;
  /**
   * Step 145 — query-string fragment (no leading "?" or "&") the admin
   * UI appends to the wager-create page link to prefill the form. Kept
   * here so the prefill schema stays next to the canonical idea shape.
   */
  prefillQuery: string;
  /**
   * Step 156 — admin-only "operator interestingness" rating for the
   * idea, derived from historical resolved-market outcomes + Step 155
   * feedback. **NOT betting advice. NOT a win probability.** Always
   * optional — when the memory load fails, the idea is still emitted
   * without this field and the response carries a warning.
   */
  outcomeInterestingness?: {
    score: number;
    label: 'high_interest' | 'promising' | 'neutral' | 'low_signal' | 'insufficient_history';
    reasons: string[];
    sampleCount: number;
  };
  /**
   * Step 157 — operator-facing explanation built from the rest of the
   * signals on this idea (closeness to target, preset/tags, risk
   * warnings when available, interestingness, cross-metric / horizon
   * caveats). **Admin-only operator guidance, never betting advice.**
   * Populated at the API layer after risk-warning analysis runs so the
   * explanation can include duplicate/correlation summaries.
   */
  explanation?: {
    whySuggested: string[];
    whyInteresting: string[];
    riskSummary: string[];
    preCreationChecklist: string[];
    operatorSummary: string;
    cautionLevel: 'low' | 'medium' | 'high';
  };
  /**
   * Step 163 — opportunity-quality score (0-100) + tier classification.
   * **Operator-facing quality signal — not betting advice.** Populated
   * by the generator after the diversity re-ranker; absent only when
   * the quality pipeline fails (rare — wrapped in try/catch).
   */
  qualityScore?: number;
  qualityTier?: 'exceptional' | 'strong' | 'moderate' | 'weak' | 'suppress';
  qualityComponents?: {
    forecastConfidence: number;
    crossModelAgreement: number;
    regionalUniqueness: number;
    spreadUniqueness: number;
    metricClarity: number;
    noveltyScore: number;
    rarityProxy: number;
    diversityContribution: number;
  };
  /** Step 163 — raw confidence synthesized from existing signals. */
  rawConfidence?: number;
  /** Step 163 — normalized confidence after deterministic squashing. */
  normalizedConfidence?: number;
  /** Step 163 — true when this idea is in the inspector pool but suppressed from `result.ideas`. */
  suppressed?: boolean;
  /** Step 163 — populated when `suppressed === true`. */
  suppressionReason?:
    | 'tier_below_weak'
    | 'lower_quality_duplicate'
    | 'near_duplicate'
    | 'low_confidence_low_novelty';
  /** Step 163 — deduper cluster id. Same id ↔ same cluster. */
  dedupeClusterId?: string;
  dedupeClusterSize?: number;
  /** Step 163 — operator-facing contribution badges. */
  diversityContribution?: number;
  noveltyContribution?: number;
}

// ── Heuristic thresholds ────────────────────────────────────────────────────

/** Minimum |Δ| (°F) to surface a *legacy* (non-target-difference) idea. */
const MIN_TEMPERATURE_DELTA_F = 8;
/** Cap on number of ideas returned per generation run. */
const DEFAULT_MAX_IDEAS = 20;
/** Step 145 — default tolerance window around `targetDifferenceF` (°F). */
const DEFAULT_TOLERANCE_F = 3;
/** Step 145 — input-validation ceilings, mirrored on the API. */
export const TARGET_DIFFERENCE_F_MAX = 80;
export const TOLERANCE_F_MAX = 20;
export const MAX_RESULTS_CAP = 100;
/** Default odds — operator can override at market-creation time. */
const DEFAULT_ODDS = -110;
/** Maximum forecast horizon in days for which we'll generate ideas. */
const MAX_HORIZON_DAYS = 5;

// ── Step 160: generation modes ──────────────────────────────────────────────
//
// Named admin-only "search shapes". Each mode is a deterministic
// tuning of the *existing* generator — bigger result cap, looser
// tolerance, optional cross-region preference, etc. Hard ceilings
// (MAX_RESULTS_CAP, MAX_EXPANDED_CITIES) still apply.

export type GenerationMode =
  | 'focused'
  | 'balanced'
  | 'broad_scan'
  | 'discovery'
  | 'rivalry_scan'
  | 'volatility_scan'
  | 'seasonal_scan';

export const GENERATION_MODES: readonly GenerationMode[] = [
  'focused',
  'balanced',
  'broad_scan',
  'discovery',
  'rivalry_scan',
  'volatility_scan',
  'seasonal_scan',
] as const;

export interface GenerationModeProfile {
  id: GenerationMode;
  label: string;
  /** Default `maxIdeas` for this mode (clamped to `MAX_RESULTS_CAP`). */
  maxIdeas: number;
  /** Default `maxCandidateCities` (clamped to `MAX_EXPANDED_CITIES`). */
  maxCandidateCities: number;
  /** Multiplier applied to `toleranceF` (legacy default 3°F). */
  toleranceScale: number;
  /** 0…2 — how much the cross-region/cross-metric novelty bonus contributes. */
  noveltyWeight: number;
  /** 0…2 — how aggressively to re-rank away from repeated city pairs / regions / metrics / spread buckets. */
  diversityWeight: number;
  /** If true, drop same-region pairs entirely during candidate enumeration. */
  requireCrossRegion: boolean;
  /** If true, weight `confidenceLabel='lower'` ideas higher (proxy for forecast instability). */
  preferLowerConfidence: boolean;
  /** If true, multiply score by the seasonal-tag bonus for matches against the current season. */
  preferSeasonalTags: boolean;
  description: string;
}

export const GENERATION_MODE_PROFILES: Record<GenerationMode, GenerationModeProfile> = {
  focused: {
    id: 'focused',
    label: 'Focused',
    maxIdeas: 10,
    maxCandidateCities: 25,
    toleranceScale: 0.5,
    noveltyWeight: 0.5,
    diversityWeight: 0.5,
    requireCrossRegion: false,
    preferLowerConfidence: false,
    preferSeasonalTags: false,
    description: 'Small candidate set, tight tolerance, fewer-but-cleaner results.',
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    maxIdeas: DEFAULT_MAX_IDEAS,
    maxCandidateCities: 50,
    toleranceScale: 1,
    noveltyWeight: 1,
    diversityWeight: 1,
    requireCrossRegion: false,
    preferLowerConfidence: false,
    preferSeasonalTags: false,
    description: 'Current default behavior — moderate volume, moderate diversity.',
  },
  broad_scan: {
    id: 'broad_scan',
    label: 'Broad scan',
    maxIdeas: 60,
    maxCandidateCities: 100,
    toleranceScale: 1.5,
    noveltyWeight: 0.8,
    diversityWeight: 1.5,
    requireCrossRegion: false,
    preferLowerConfidence: false,
    preferSeasonalTags: false,
    description: 'Larger result set, looser tolerance, diversity-protected top of list.',
  },
  discovery: {
    id: 'discovery',
    label: 'Discovery',
    maxIdeas: 40,
    maxCandidateCities: 100,
    toleranceScale: 2,
    noveltyWeight: 2,
    diversityWeight: 2,
    requireCrossRegion: false,
    preferLowerConfidence: false,
    preferSeasonalTags: true,
    description: 'Novelty- and diversity-heavy. Looser target match. Best for "show me something I have not seen".',
  },
  rivalry_scan: {
    id: 'rivalry_scan',
    label: 'Rivalry scan',
    maxIdeas: 30,
    maxCandidateCities: 80,
    toleranceScale: 1.2,
    noveltyWeight: 1.5,
    diversityWeight: 1,
    requireCrossRegion: true,
    preferLowerConfidence: false,
    preferSeasonalTags: false,
    description: 'Cross-region pairs only. Surfaces strong regional/weather contrasts.',
  },
  volatility_scan: {
    id: 'volatility_scan',
    label: 'Volatility scan',
    maxIdeas: 30,
    maxCandidateCities: 80,
    toleranceScale: 1,
    noveltyWeight: 1,
    diversityWeight: 1,
    requireCrossRegion: false,
    preferLowerConfidence: true,
    preferSeasonalTags: false,
    description: 'Prefers ideas whose forecasts are likely to swing — lower-confidence horizon picks rise.',
  },
  seasonal_scan: {
    id: 'seasonal_scan',
    label: 'Seasonal scan',
    maxIdeas: 30,
    maxCandidateCities: 80,
    toleranceScale: 1.2,
    noveltyWeight: 1,
    diversityWeight: 1,
    requireCrossRegion: false,
    preferLowerConfidence: false,
    preferSeasonalTags: true,
    description: 'Boosts city pairs whose tags match the current season (e.g. heat in summer, freeze in winter).',
  },
};

export function listGenerationModes(): readonly GenerationModeProfile[] {
  return GENERATION_MODES.map((m) => GENERATION_MODE_PROFILES[m]);
}

// ── Step 160: sort options surfaced to the admin UI ────────────────────────

export type IdeaSortOption =
  | 'interestingness'
  | 'target_closeness'
  | 'novelty'
  | 'risk'
  | 'diversity';

export const IDEA_SORT_OPTIONS: readonly IdeaSortOption[] = [
  'interestingness',
  'target_closeness',
  'novelty',
  'risk',
  'diversity',
] as const;

// ── Step 160: seasonal-tag table (deterministic, hemisphere=North) ─────────

const SEASON_TAGS: Record<'winter' | 'spring' | 'summer' | 'fall', WeatherPersonalityTag[]> = {
  winter: ['cold', 'snowy', 'freeze_risk', 'lake_effect', 'windy'],
  spring: ['storm_prone', 'severe_weather', 'high_variability', 'windy', 'rainy'],
  summer: ['hot', 'humid', 'heat_index', 'hurricane_exposed', 'severe_weather', 'urban_heat'],
  fall: ['storm_prone', 'rainy', 'windy', 'high_variability', 'hurricane_exposed'],
};

function currentSeason(nowMs: number): 'winter' | 'spring' | 'summer' | 'fall' {
  const m = new Date(nowMs).getUTCMonth(); // 0=Jan
  if (m <= 1 || m === 11) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'fall';
}

const METRIC_LABELS: Record<IdeaMetric, string> = {
  daily_high: 'High',
  daily_low: 'Low',
};

// Mapping from idea's metric enum to the wager system's WagerMetric enum.
// Used both for the human-facing setup notes and for the prefill query
// string (so the wager-create form can populate metricA / metricB).
const IDEA_METRIC_TO_WAGER_METRIC: Record<IdeaMetric, 'high_temp' | 'low_temp'> = {
  daily_high: 'high_temp',
  daily_low: 'low_temp',
};

// ── Pure idea construction ──────────────────────────────────────────────────

function getMetricValue(daily: DailyForecast, metric: IdeaMetric): number | null {
  if (metric === 'daily_high') return daily.highF;
  if (metric === 'daily_low') return daily.lowF;
  return null;
}

function ideaId(): string {
  return `idea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function describeRationale(idea: Omit<WeatherMarketIdea, 'rationale'>): string {
  const dir = idea.rawDifference > 0 ? 'warmer than' : 'cooler than';
  const absDelta = Math.abs(idea.rawDifference);
  return (
    `${idea.locationA.label} ${METRIC_LABELS[idea.metricA].toLowerCase()} forecast ` +
    `${idea.forecastValueA}°F is ${absDelta}°F ${dir} ${idea.locationB.label} ` +
    `${METRIC_LABELS[idea.metricB].toLowerCase()} forecast ${idea.forecastValueB}°F ` +
    `for ${idea.targetDate}.`
  );
}

function buildSetupNotes(idea: WeatherMarketIdea): string {
  const lines: string[] = [
    'Pointspread (cross-location temperature)',
    `Title: ${idea.title}`,
    `Target date: ${idea.targetDate}`,
    `Location A: ${idea.locationA.label} (${idea.locationA.lat.toFixed(3)}, ${idea.locationA.lon.toFixed(3)}) — ${METRIC_LABELS[idea.metricA]}`,
    `Location B: ${idea.locationB.label} (${idea.locationB.lat.toFixed(3)}, ${idea.locationB.lon.toFixed(3)}) — ${METRIC_LABELS[idea.metricB]}`,
    `Spread (A side): ${idea.suggestedSpread >= 0 ? '+' : ''}${idea.suggestedSpread}°F`,
    `Default odds: A ${idea.suggestedOddsA} / B ${idea.suggestedOddsB}`,
  ];
  if (idea.closenessToTarget !== undefined) {
    lines.push(`Closeness to target Δ: ${idea.closenessToTarget.toFixed(1)}°F`);
  }
  if (idea.warnings.length > 0) {
    lines.push(`Warnings: ${idea.warnings.join(' · ')}`);
  }
  return lines.join('\n');
}

function buildPrefillQuery(idea: WeatherMarketIdea): string {
  // Step 145 — emit the same prefill schema AdminDashboard already
  // understands (prefillKind / prefillLocationA / etc.) plus the new
  // per-side metric overrides. The operator clicks "Use this idea",
  // lands on /admin/wagers, and the form is populated; they still have
  // to click Create Wager to publish — no auto-creation.
  const params = new URLSearchParams();
  params.set('prefillKind', 'pointspread');
  params.set('prefillMetric', IDEA_METRIC_TO_WAGER_METRIC[idea.metricA]);
  params.set('prefillMetricA', IDEA_METRIC_TO_WAGER_METRIC[idea.metricA]);
  params.set('prefillMetricB', IDEA_METRIC_TO_WAGER_METRIC[idea.metricB]);
  params.set('prefillLocationA', idea.locationA.label);
  params.set('prefillLocationB', idea.locationB.label);
  params.set('prefillLocationALat', String(idea.locationA.lat));
  params.set('prefillLocationALon', String(idea.locationA.lon));
  params.set('prefillLocationBLat', String(idea.locationB.lat));
  params.set('prefillLocationBLon', String(idea.locationB.lon));
  params.set('prefillSpread', String(idea.suggestedSpread));
  params.set('prefillLocationAOdds', String(idea.suggestedOddsA));
  params.set('prefillLocationBOdds', String(idea.suggestedOddsB));
  params.set('prefillDate', idea.targetDate);
  params.set('prefillTitle', idea.title);
  return params.toString();
}

function isCrossMetric(a: IdeaMetric, b: IdeaMetric): boolean {
  return a !== b;
}

function confidenceLabelFor(daysAhead: number, absDelta: number): WeatherMarketIdea['confidenceLabel'] {
  if (daysAhead <= 2 && absDelta >= 15) return 'higher';
  if (daysAhead <= 3) return 'medium';
  return 'lower';
}

function dateOffsetDays(targetDate: string, todayMs = Date.now()): number {
  const targetMs = Date.parse(`${targetDate}T12:00:00Z`);
  if (!Number.isFinite(targetMs)) return MAX_HORIZON_DAYS + 1;
  return Math.round((targetMs - todayMs) / (24 * 60 * 60 * 1000));
}

function targetDateFromOffset(dayOffset: number, todayMs = Date.now()): string {
  const d = new Date(todayMs);
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

function metricPairsFor(option: MetricPairOption): Array<[IdeaMetric, IdeaMetric]> {
  if (option === 'high_vs_high') return [['daily_high', 'daily_high']];
  if (option === 'low_vs_low') return [['daily_low', 'daily_low']];
  if (option === 'high_vs_low') return [['daily_high', 'daily_low']];
  return [
    ['daily_high', 'daily_high'],
    ['daily_low', 'daily_low'],
    ['daily_high', 'daily_low'],
  ];
}

interface BuildIdeaInputs {
  // Step 152 — accepts WeatherMarketCity (from the expanded universe)
  // or any structurally compatible record (id/label/lat/lon/region).
  // Seed-12 cities continue to flow through here unchanged because
  // the resolver re-projects them into the same shape.
  cityA: WeatherMarketCity;
  cityB: WeatherMarketCity;
  metricA: IdeaMetric;
  metricB: IdeaMetric;
  targetDate: string;
  forecastValueA: number;
  forecastValueB: number;
  daysAhead: number;
  /** When set, score/skip rules switch to "closeness to target". */
  targetDifferenceF?: number;
  toleranceF?: number;
}

function buildIdea(inputs: BuildIdeaInputs): WeatherMarketIdea | null {
  const rawDifference = inputs.forecastValueA - inputs.forecastValueB;
  const absDelta = Math.abs(rawDifference);

  // Step 145 — gating logic differs between the two modes.
  if (inputs.targetDifferenceF !== undefined) {
    const tol = inputs.toleranceF ?? DEFAULT_TOLERANCE_F;
    if (Math.abs(absDelta - inputs.targetDifferenceF) > tol) return null;
  } else if (absDelta < MIN_TEMPERATURE_DELTA_F) {
    return null;
  }

  const suggestedSpread = -Math.round(rawDifference); // negative on the higher side
  const warnings: string[] = [];
  if (isCrossMetric(inputs.metricA, inputs.metricB)) {
    warnings.push(
      'Cross-metric spread (high vs low). The PointspreadWager schema now supports per-side metricA / metricB (Step 145). Confirm both sides are populated when you create the wager.',
    );
  }
  if (inputs.daysAhead > MAX_HORIZON_DAYS) {
    warnings.push(
      `Target date beyond ${MAX_HORIZON_DAYS}-day forecast horizon — accuracy degrades quickly past this.`,
    );
  }

  const titleA = `${inputs.cityA.label} ${METRIC_LABELS[inputs.metricA]}`;
  const titleB = `${inputs.cityB.label} ${METRIC_LABELS[inputs.metricB]}`;
  const title = `${titleA} ${suggestedSpread >= 0 ? '+' : ''}${suggestedSpread}°F vs ${titleB}`;

  const closenessToTarget =
    inputs.targetDifferenceF !== undefined
      ? Math.abs(absDelta - inputs.targetDifferenceF)
      : undefined;

  // Score: in target mode, smaller closeness = better, so we negate and
  // add a tiny region-contrast tiebreaker. In legacy mode we keep the
  // original |Δ| + region bonus formula so existing callers see the
  // same ranking.
  const regionBonus = inputs.cityA.region === inputs.cityB.region ? -3 : 2;
  const interestingnessScore =
    closenessToTarget !== undefined
      ? -closenessToTarget * 10 + regionBonus
      : absDelta + regionBonus;

  const idea: WeatherMarketIdea = {
    id: ideaId(),
    title,
    description: '',
    kind: 'pointspread',
    locationA: {
      id: inputs.cityA.id,
      label: inputs.cityA.label,
      lat: inputs.cityA.lat,
      lon: inputs.cityA.lon,
      region: inputs.cityA.region,
    },
    locationB: {
      id: inputs.cityB.id,
      label: inputs.cityB.label,
      lat: inputs.cityB.lat,
      lon: inputs.cityB.lon,
      region: inputs.cityB.region,
    },
    metricA: inputs.metricA,
    metricB: inputs.metricB,
    targetDate: inputs.targetDate,
    forecastValueA: Math.round(inputs.forecastValueA),
    forecastValueB: Math.round(inputs.forecastValueB),
    rawDifference: Math.round(rawDifference),
    absDifference: Math.round(absDelta),
    suggestedSpread,
    suggestedOddsA: DEFAULT_ODDS,
    suggestedOddsB: DEFAULT_ODDS,
    confidenceLabel: confidenceLabelFor(inputs.daysAhead, absDelta),
    rationale: '',
    warnings,
    status: 'idea_only',
    setupNotes: '',
    interestingnessScore,
    closenessToTarget,
    prefillQuery: '',
  };

  idea.rationale = describeRationale(idea as Omit<WeatherMarketIdea, 'rationale'>);
  const closenessTag =
    closenessToTarget !== undefined
      ? ` Within ${closenessToTarget.toFixed(1)}°F of the requested target.`
      : '';
  idea.description = `Draft idea: ${idea.rationale} Suggested line ${suggestedSpread >= 0 ? '+' : ''}${suggestedSpread}°F at ${DEFAULT_ODDS}/${DEFAULT_ODDS}.${closenessTag}`;
  idea.setupNotes = buildSetupNotes(idea);
  idea.prefillQuery = buildPrefillQuery(idea);
  return idea;
}

// ── Concurrency helper (lifted from the Step 138 batch runner) ──────────────

const DEFAULT_FORECAST_CONCURRENCY = 4;

async function runInChunks<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    const results = await Promise.all(slice.map((it, j) => fn(it, i + j)));
    out.push(...results);
  }
  return out;
}

// ── Candidate-city resolution (Step 145 Task E → Step 152) ──────────────────
//
// Step 145 introduced a thin `resolveCandidateCities` shim that only
// understood the 12-seed list. Step 152 swaps the underlying source
// for the curated `weather-market-city-universe` module, which adds an
// `expanded_us` (~75-city) set + a region filter while keeping every
// scan bounded and admin-only. This shim retains the legacy
// `CandidateCitySet = 'seed'` value as a backward-compatible alias for
// `cityUniverse: 'seed_12'` so any existing call sites keep working.

/** @deprecated since Step 152 — pass `cityUniverse: 'seed_12' | 'expanded_us'` instead. */
export type CandidateCitySet = 'seed' | 'expanded_us';

export interface CandidateCityResolverInput {
  set: CandidateCitySet;
  cityIds?: string[];
  region?: string;
  /** Step 152 — caps the returned slice. Clamped to MAX_EXPANDED_CITIES. */
  maxCandidateCities?: number;
}

function legacySetToMode(set: CandidateCitySet): CityUniverseMode {
  return set === 'expanded_us' ? 'expanded_us' : 'seed_12';
}

function isValidRegionFilter(s: unknown): s is CityRegionFilter {
  return typeof s === 'string' && (CITY_REGION_FILTERS as readonly string[]).includes(s);
}

export function resolveCandidateCities(
  input: CandidateCityResolverInput,
): WeatherMarketCity[] {
  const region = isValidRegionFilter(input.region) ? input.region : undefined;
  const { cities } = resolveCityUniverse({
    mode: legacySetToMode(input.set),
    region,
    cityIds: input.cityIds,
    maxCandidateCities: input.maxCandidateCities,
  });
  return cities;
}

// ── Public entry point ──────────────────────────────────────────────────────

export interface GenerateIdeasOptions {
  /**
   * YYYY-MM-DD. Either this or `dayOffset` must be provided. If both are
   * provided, `targetDate` wins.
   */
  targetDate?: string;
  /**
   * Offset in days from today (UTC noon). Resolved to `targetDate` when
   * `targetDate` is not supplied.
   */
  dayOffset?: number;
  /** Subset of city ids within the chosen universe; defaults to all. */
  cityIds?: string[];
  /** Cap on returned ideas. Defaults to 20. */
  maxIdeas?: number;
  /** Step 145 alias for maxIdeas — accepted for API symmetry. */
  maxResults?: number;
  /** Concurrency for forecast fetches. Defaults to 4. */
  concurrency?: number;
  /**
   * Step 145 — target-difference search. When set, the generator filters
   * to pairs whose |Δ| falls within `toleranceF` of this value and ranks
   * by closeness to it. When unset, the legacy "most interesting" mode
   * applies (|Δ| ≥ 8°F, ranked by `|Δ| + region_bonus`).
   */
  targetDifferenceF?: number;
  toleranceF?: number;
  /** Which (metricA, metricB) tuples to consider. Defaults to all three. */
  metricPair?: MetricPairOption;
  /**
   * Step 152 — primary candidate-city selector. `'seed_12'` keeps the
   * Step 144 12-city safe set; `'expanded_us'` uses the curated ~75-
   * city universe. Defaults to `'seed_12'` so legacy callers see no
   * behavior change. The legacy `candidateSet` alias is still honored.
   */
  cityUniverse?: CityUniverseMode;
  /** Step 152 — optional region filter. `'all_expanded'` (or omitted) means no filter. */
  region?: CityRegionFilter;
  /**
   * Step 152 — hard cap on candidate cities the resolver will return.
   * Clamped to `MAX_EXPANDED_CITIES`. Useful in expanded mode to bound
   * forecast-fetch fan-out without changing the returned-idea cap.
   */
  maxCandidateCities?: number;
  /**
   * Step 154 — weather-personality tag filter. Applied after the
   * region filter but before the candidate cap, and only when the
   * caller did not supply an explicit `cityIds` selection (selection
   * always wins). Each tag must be in the static allow-list — the
   * resolver does not validate; the API layer does.
   */
  weatherTags?: WeatherPersonalityTag[];
  /** Step 154 — `'any'` (default) or `'all'`. */
  tagMode?: TagMode;
  /** @deprecated since Step 152 — use `cityUniverse` instead. */
  candidateSet?: CandidateCitySet;
  /**
   * Step 160 — named generation profile. Overrides the per-mode tunings
   * (maxIdeas / maxCandidateCities / toleranceF scaling / diversity +
   * novelty weights / cross-region requirement / season + confidence
   * bonuses). Explicit `maxIdeas` / `maxCandidateCities` / `toleranceF`
   * still win when supplied. Defaults to `'balanced'` (current behavior).
   */
  generationMode?: GenerationMode;
  /** Override "now" for tests. */
  nowMs?: number;
}

export interface GenerateIdeasResult {
  generatedAt: string;
  targetDate: string;
  cityCount: number;
  ideas: WeatherMarketIdea[];
  warnings: string[];
  /**
   * Step 145 / Step 152 — echo the resolved knobs so the UI can render
   * the effective query without re-deriving, plus operator-visible
   * counters so the expanded-scan UX makes the cost obvious.
   */
  resolved: {
    metricPair: MetricPairOption;
    targetDifferenceF?: number;
    toleranceF?: number;
    /** Step 152 — primary universe field. */
    cityUniverse: CityUniverseMode;
    /** Step 152 — region filter actually applied (`'all_expanded'` if none). */
    region: CityRegionFilter;
    /** @deprecated since Step 152 — kept for legacy clients. Mirrors `cityUniverse`. */
    candidateSet: CandidateCitySet;
    cityIds: string[];
    /** Step 152 — number of candidate cities the resolver returned (after region filter + cap). */
    candidateCityCount: number;
    /** Step 152 — cap that was applied (only set when truncation actually happened). */
    cityCountCappedTo?: number;
    /** Step 152 — how many candidates returned a usable forecast for the target date. */
    successfulForecastCount: number;
    /** Step 152 — how many candidates failed forecast fetch (network, rate-limit, etc.). */
    failedForecastCount: number;
    /** Step 154 — operator-supplied tag filter (sanitized to allow-list at API). */
    weatherTags?: WeatherPersonalityTag[];
    /** Step 154 — tag-match mode actually applied. */
    tagMode?: TagMode;
    /** Step 154 — surviving city count after the tag filter (before the cap). */
    tagFilteredCityCount?: number;
    /** Step 160 — the generation profile that was applied. */
    generationMode: GenerationMode;
    /** Step 160 — counters surfacing the cost of the search. */
    evaluatedPairCount: number;
    /** Step 160 — how many `candidates` survived the gating before ranking. */
    candidatesBeforeRanking: number;
    /** Step 160 — set when the diversity re-ranker actually swapped items. */
    diversityReorderedCount?: number;
    /** Step 163 — how many ideas entered the Step-163 quality pipeline. */
    evaluatedBeforeSuppressionCount?: number;
    /** Step 163 — how many made it through suppression + dedupe into `result.ideas`. */
    retainedAfterSuppressionCount?: number;
    /** Step 163 — total ideas marked suppressed by tier or low-confidence-low-novelty. */
    suppressedCount?: number;
    /** Step 163 — ideas collapsed by the near-duplicate suppressor. */
    dedupedCount?: number;
    /** Step 163 — mean qualityScore across retained ideas. */
    avgQualityScore?: number;
    /** Step 163 — per-reason suppression counts (for audit + inspector). */
    suppressedByReason?: Record<string, number>;
  };
  /**
   * Step 163 — every idea the quality pipeline saw, including the
   * suppressed ones. Capped at `MAX_RESULTS_CAP` so the response stays
   * bounded. The inspector page reads this; existing UI ignores it.
   */
  evaluatedIdeas?: WeatherMarketIdea[];
}

export async function generateWeatherMarketIdeas(
  options: GenerateIdeasOptions,
): Promise<GenerateIdeasResult> {
  const nowMs = options.nowMs ?? Date.now();
  // Step 152 — primary mode is `cityUniverse`; the deprecated
  // `candidateSet` is honored as a fallback so any older caller still
  // sees the same behavior.
  const cityUniverse: CityUniverseMode =
    options.cityUniverse ??
    (options.candidateSet === 'expanded_us' ? 'expanded_us' : 'seed_12');
  const region: CityRegionFilter = options.region ?? 'all_expanded';
  const candidateSet: CandidateCitySet =
    cityUniverse === 'expanded_us' ? 'expanded_us' : 'seed';
  const metricPair: MetricPairOption = options.metricPair ?? 'any_temperature_pair';
  // Step 160 — resolve mode profile first so the per-mode tunings can
  // override defaults below. Explicit options still win.
  const generationMode: GenerationMode = options.generationMode ?? 'balanced';
  const modeProfile = GENERATION_MODE_PROFILES[generationMode];
  const warnings: string[] = [];

  function emptyResolved(extra: Partial<GenerateIdeasResult['resolved']> = {}): GenerateIdeasResult['resolved'] {
    return {
      metricPair,
      targetDifferenceF: options.targetDifferenceF,
      toleranceF: options.toleranceF,
      cityUniverse,
      region,
      candidateSet,
      cityIds: [],
      candidateCityCount: 0,
      successfulForecastCount: 0,
      failedForecastCount: 0,
      generationMode,
      evaluatedPairCount: 0,
      candidatesBeforeRanking: 0,
      ...(options.weatherTags && options.weatherTags.length > 0
        ? { weatherTags: options.weatherTags, tagMode: options.tagMode ?? 'any' }
        : {}),
      ...extra,
    };
  }

  // Resolve targetDate from dayOffset when omitted.
  let targetDate = options.targetDate;
  if (!targetDate && typeof options.dayOffset === 'number') {
    targetDate = targetDateFromOffset(options.dayOffset, nowMs);
  }
  if (!targetDate) {
    return {
      generatedAt: new Date(nowMs).toISOString(),
      targetDate: '',
      cityCount: 0,
      ideas: [],
      warnings: ['No targetDate or dayOffset provided.'],
      resolved: emptyResolved(),
    };
  }

  const daysAhead = dateOffsetDays(targetDate, nowMs);
  if (!Number.isFinite(daysAhead) || daysAhead < 0) {
    return {
      generatedAt: new Date(nowMs).toISOString(),
      targetDate,
      cityCount: 0,
      ideas: [],
      warnings: [`Invalid target date "${targetDate}".`],
      resolved: emptyResolved({ cityIds: options.cityIds ?? [] }),
    };
  }
  if (daysAhead > MAX_HORIZON_DAYS) {
    warnings.push(
      `Target date is ${daysAhead} days out — beyond the ${MAX_HORIZON_DAYS}-day reliable horizon. Ideas may be unreliable.`,
    );
  }

  // Step 152 — resolve through the new bounded city-universe selector.
  // For expanded_us we apply a default cap of DEFAULT_EXPANDED_MAX (75),
  // overridable up to MAX_EXPANDED_CITIES (100). seed_12 is already
  // 12-city-bounded so the cap is rarely active there.
  // Step 160 — when no explicit cap is supplied, the mode profile picks
  // it. Hard ceiling (MAX_EXPANDED_CITIES) still wins.
  const requestedMaxCities = options.maxCandidateCities
    ?? Math.min(
      MAX_EXPANDED_CITIES,
      cityUniverse === 'expanded_us' ? modeProfile.maxCandidateCities : MAX_EXPANDED_CITIES,
    );
  const { cities: seeds, cappedAt, tagFilteredCityCount } = resolveCityUniverse({
    mode: cityUniverse,
    region,
    cityIds: options.cityIds,
    maxCandidateCities: requestedMaxCities,
    weatherTags: options.weatherTags,
    tagMode: options.tagMode,
  });
  if (cappedAt !== undefined) {
    warnings.push(
      `Candidate city count capped at ${cappedAt} (universe ${cityUniverse}, region ${region}). Expanded scans are bounded and admin-only.`,
    );
  }
  if (
    options.weatherTags &&
    options.weatherTags.length > 0 &&
    (!options.cityIds || options.cityIds.length === 0) &&
    tagFilteredCityCount !== undefined &&
    tagFilteredCityCount < 2
  ) {
    warnings.push(
      `Tag filter (${(options.weatherTags as string[]).join(', ')} · ${options.tagMode ?? 'any'}) narrowed the universe to ${tagFilteredCityCount} city/cities. Need at least 2 to build a spread idea — try fewer tags, switch to 'any' mode, or relax the region filter.`,
    );
  }

  const concurrency = Math.max(
    1,
    Math.min(8, options.concurrency ?? DEFAULT_FORECAST_CONCURRENCY),
  );
  // Step 160 — mode profile picks the default `maxIdeas` when the caller
  // omits both `maxResults` and `maxIdeas`. Hard ceiling MAX_RESULTS_CAP
  // (100) still wins.
  const requestedMax =
    options.maxResults ?? options.maxIdeas ?? modeProfile.maxIdeas;
  const maxIdeas = Math.max(1, Math.min(MAX_RESULTS_CAP, requestedMax));
  // Step 160 — mode-scaled target tolerance. Explicit `toleranceF`
  // (when the operator typed one) still wins.
  const effectiveToleranceF =
    options.toleranceF !== undefined
      ? options.toleranceF
      : options.targetDifferenceF !== undefined
        ? Math.min(TOLERANCE_F_MAX, DEFAULT_TOLERANCE_F * modeProfile.toleranceScale)
        : undefined;

  // Fetch forecasts per city — per-city failures are isolated so one
  // broken upstream doesn't sink the whole generation.
  type CityForecast = {
    city: WeatherMarketCity;
    forecast?: ForecastResponse;
    failureNote?: string;
  };

  const cityForecasts: CityForecast[] = await runInChunks(seeds, concurrency, async (city) => {
    try {
      const horizon = Math.max(1, Math.min(15, daysAhead + 2));
      const forecast = await getForecast(city.lat, city.lon, horizon);
      return { city, forecast };
    } catch (err: any) {
      return { city, failureNote: err?.message ?? String(err) };
    }
  });

  let failedForecastCount = 0;
  for (const cf of cityForecasts) {
    if (cf.failureNote) {
      failedForecastCount += 1;
      warnings.push(`${cf.city.label}: forecast fetch failed — ${cf.failureNote}`);
    }
  }

  // Pluck the matching daily entry per city for the target date.
  const cityDay = new Map<string, { city: WeatherMarketCity; daily: DailyForecast }>();
  for (const cf of cityForecasts) {
    if (!cf.forecast?.daily) continue;
    const day = cf.forecast.daily.find((d) => d.date === targetDate);
    if (day) cityDay.set(cf.city.id, { city: cf.city, daily: day });
  }
  const successfulForecastCount = cityDay.size;

  const baseResolved: GenerateIdeasResult['resolved'] = {
    metricPair,
    targetDifferenceF: options.targetDifferenceF,
    toleranceF: effectiveToleranceF,
    cityUniverse,
    region,
    candidateSet,
    cityIds: seeds.map((c) => c.id),
    candidateCityCount: seeds.length,
    successfulForecastCount,
    failedForecastCount,
    generationMode,
    evaluatedPairCount: 0,
    candidatesBeforeRanking: 0,
    ...(cappedAt !== undefined ? { cityCountCappedTo: cappedAt } : {}),
    ...(options.weatherTags && options.weatherTags.length > 0
      ? {
          weatherTags: options.weatherTags,
          tagMode: options.tagMode ?? 'any',
          tagFilteredCityCount,
        }
      : {}),
  };

  if (cityDay.size < 2) {
    warnings.push(
      `Only ${cityDay.size} city/cities had a forecast for ${targetDate}. Need at least 2 to build a spread idea.`,
    );
    return {
      generatedAt: new Date(nowMs).toISOString(),
      targetDate,
      cityCount: cityDay.size,
      ideas: [],
      warnings,
      resolved: baseResolved,
    };
  }

  const metricPairs = metricPairsFor(metricPair);
  const cityList = Array.from(cityDay.values());
  const candidates: WeatherMarketIdea[] = [];
  let evaluatedPairCount = 0;

  for (let i = 0; i < cityList.length; i++) {
    for (let j = 0; j < cityList.length; j++) {
      if (i === j) continue;
      const a = cityList[i];
      const b = cityList[j];
      // Step 160 — rivalry_scan forces cross-region pairs only.
      if (modeProfile.requireCrossRegion && a.city.region === b.city.region) continue;
      for (const [metricA, metricB] of metricPairs) {
        // Skip identical-metric pairs where i > j to avoid duplicate
        // (cityA, cityB, high/high) and (cityB, cityA, high/high). For
        // cross-metric pairs we keep both orderings — they're different
        // ideas (A-high vs B-low ≠ B-high vs A-low).
        if (metricA === metricB && i > j) continue;
        evaluatedPairCount += 1;
        const valueA = getMetricValue(a.daily, metricA);
        const valueB = getMetricValue(b.daily, metricB);
        if (valueA === null || valueB === null) continue;
        const idea = buildIdea({
          cityA: a.city,
          cityB: b.city,
          metricA,
          metricB,
          targetDate,
          forecastValueA: valueA,
          forecastValueB: valueB,
          daysAhead,
          targetDifferenceF: options.targetDifferenceF,
          toleranceF: effectiveToleranceF,
        });
        if (idea) candidates.push(idea);
      }
    }
  }

  baseResolved.evaluatedPairCount = evaluatedPairCount;
  baseResolved.candidatesBeforeRanking = candidates.length;

  // Step 160 — apply novelty bonus + seasonal/volatility weighting
  // before the initial sort. Pure score adjustment; safe to apply to
  // legacy and target-difference modes because both already use
  // `interestingnessScore` as their comparator.
  const season = currentSeason(nowMs);
  const seasonTags = new Set<string>(SEASON_TAGS[season]);
  for (const idea of candidates) {
    const noveltyBonus = computeNoveltyBonus(idea);
    idea.interestingnessScore += noveltyBonus * modeProfile.noveltyWeight;
    if (modeProfile.preferLowerConfidence && idea.confidenceLabel === 'lower') {
      idea.interestingnessScore += 4;
    }
    if (modeProfile.preferSeasonalTags) {
      const aTags = (idea.locationA as any).tags as readonly string[] | undefined;
      const bTags = (idea.locationB as any).tags as readonly string[] | undefined;
      const tagHits =
        (aTags?.filter((t) => seasonTags.has(t)).length ?? 0) +
        (bTags?.filter((t) => seasonTags.has(t)).length ?? 0);
      if (tagHits > 0) {
        idea.interestingnessScore += Math.min(8, tagHits * 1.5);
      }
    }
  }

  // Rank by interestingness score (in target mode this is the negated
  // closeness so smaller distance still ends up first), take top N.
  candidates.sort((a, b) => b.interestingnessScore - a.interestingnessScore);

  // Step 160 — diversity re-ranker. Walks the sorted candidates and
  // applies a per-item penalty when its city-pair / region-pair /
  // metric-pair / spread-bucket has already appeared in the result list.
  // Greedy MMR-style selection. Skipped when diversityWeight === 0.
  const { selected: topIdeas, reorderedCount } =
    modeProfile.diversityWeight > 0
      ? applyDiversityRerank(candidates, maxIdeas, modeProfile.diversityWeight)
      : { selected: candidates.slice(0, maxIdeas), reorderedCount: 0 };

  if (reorderedCount > 0) {
    baseResolved.diversityReorderedCount = reorderedCount;
  }

  // Step 156 — best-effort historical-outcome scoring. Loaders are
  // server-only and never throw; on failure the ideas come back without
  // the score and we attach a single warning so the operator knows.
  // The score is admin-only operator-interestingness, NOT betting advice.
  try {
    const [memory, feedbackLookup] = await Promise.all([
      fetchOutcomeMemory(),
      fetchFeedbackUsefulRate({
        presetId: undefined, // generator doesn't know presetId; API can pass it later
        metricPair,
      }),
    ]);
    if (memory.length > 0) {
      for (const idea of topIdeas) {
        const score = scoreIdeaAgainstMemory(
          idea,
          memory,
          feedbackLookup.rate,
          feedbackLookup.sampleCount,
        );
        idea.outcomeInterestingness = {
          score: score.score,
          label: score.label,
          reasons: score.reasons,
          sampleCount: score.sampleCount,
        };
      }
    } else {
      // Memory loaded but is empty (no resolved markets yet) — still
      // attach the "insufficient_history" label so the UI can render
      // something rather than a missing field.
      for (const idea of topIdeas) {
        idea.outcomeInterestingness = {
          score: 25,
          label: 'insufficient_history',
          reasons: ['No resolved historical markets to compare against yet — keep generating to build memory.'],
          sampleCount: 0,
        };
      }
    }
  } catch (err: any) {
    warnings.push(
      `Historical outcome memory unavailable (${err?.message ?? String(err)}). Ideas surfaced without an interestingness score.`,
    );
  }

  // Step 163 — opportunity-quality scoring + suppression + dedupe. Pure
  // pipeline; wrapped in try/catch so a defect can never block ranking.
  let retainedIdeas: WeatherMarketIdea[] = topIdeas;
  let evaluatedIdeas: WeatherMarketIdea[] | undefined;
  try {
    const qualityPass = runQualityPipeline(topIdeas, candidates, daysAhead);
    retainedIdeas = qualityPass.retained;
    evaluatedIdeas = qualityPass.evaluated;
    baseResolved.evaluatedBeforeSuppressionCount = qualityPass.evaluatedCount;
    baseResolved.retainedAfterSuppressionCount = qualityPass.retainedCount;
    baseResolved.suppressedCount = qualityPass.suppressedCount;
    baseResolved.dedupedCount = qualityPass.dedupedCount;
    baseResolved.avgQualityScore = qualityPass.avgQualityScore;
    baseResolved.suppressedByReason = qualityPass.suppressedByReason;
  } catch (err: any) {
    warnings.push(
      `Quality pipeline unavailable (${err?.message ?? String(err)}). Returning ideas without quality scoring.`,
    );
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    targetDate,
    cityCount: cityDay.size,
    ideas: retainedIdeas,
    warnings,
    resolved: baseResolved,
    evaluatedIdeas,
  };
}

// ── Step 163 — quality + suppression pipeline (pure) ───────────────────────

interface QualityPipelineResult {
  retained: WeatherMarketIdea[];
  evaluated: WeatherMarketIdea[];
  evaluatedCount: number;
  retainedCount: number;
  suppressedCount: number;
  dedupedCount: number;
  avgQualityScore: number;
  suppressedByReason: Record<string, number>;
}

/**
 * Runs Step 163's quality scoring, near-duplicate suppression, and
 * tier-based suppression over the ranked top ideas. Pure — no I/O.
 *
 * Hard caps are unchanged: `evaluated` is capped at MAX_RESULTS_CAP.
 * Inputs are not mutated; ideas are returned as shallow clones.
 */
function runQualityPipeline(
  topIdeas: WeatherMarketIdea[],
  fullCandidates: WeatherMarketIdea[],
  daysAhead: number,
): QualityPipelineResult {
  // Frequency maps computed over the full candidate set (better signal
  // than the already-truncated topIdeas slice).
  const regionPairCount = new Map<string, number>();
  const spreadBucketCount = new Map<string, number>();
  const cityPairCount = new Map<string, number>();
  for (const c of fullCandidates) {
    const rk = pairKeyStr(c.locationA.region, c.locationB.region);
    const sk = spreadBucket(c.suggestedSpread);
    const ck = pairKeyStr(c.locationA.id, c.locationB.id);
    regionPairCount.set(rk, (regionPairCount.get(rk) ?? 0) + 1);
    spreadBucketCount.set(sk, (spreadBucketCount.get(sk) ?? 0) + 1);
    cityPairCount.set(ck, (cityPairCount.get(ck) ?? 0) + 1);
  }
  const totalCandidates = Math.max(1, fullCandidates.length);

  // Confidence + quality per idea — write back onto a shallow clone so
  // the original topIdeas list keeps its original shape if anything
  // downstream still references it.
  const normalizedConfidenceById: Record<string, number> = {};
  const qualityScoreById: Record<string, number> = {};
  const scored: WeatherMarketIdea[] = topIdeas.map((idea) => {
    const conf = describeConfidence(idea);
    const rk = pairKeyStr(idea.locationA.region, idea.locationB.region);
    const sk = spreadBucket(idea.suggestedSpread);
    const ck = pairKeyStr(idea.locationA.id, idea.locationB.id);
    const noveltyBonus = computeNoveltyBonus(idea);
    const quality = computeQualityScore(idea, {
      normalizedConfidence: conf.normalized,
      daysAhead,
      regionPairCount: regionPairCount.get(rk) ?? 1,
      spreadBucketCount: spreadBucketCount.get(sk) ?? 1,
      cityPairCount: cityPairCount.get(ck) ?? 1,
      totalCandidates,
      // Diversity contribution proxy: the smaller the share of cities
      // sharing this idea's pair, the bigger the diversity bump.
      diversityContribution: Math.round(
        100 * (1 - ((cityPairCount.get(ck) ?? 1) - 1) / totalCandidates),
      ),
      noveltyBonus,
    });
    normalizedConfidenceById[idea.id] = conf.normalized;
    qualityScoreById[idea.id] = quality.score;
    return {
      ...idea,
      rawConfidence: conf.raw,
      normalizedConfidence: conf.normalized,
      qualityScore: quality.score,
      qualityTier: quality.tier as QualityTier,
      qualityComponents: quality.components as QualityComponents,
      diversityContribution: quality.components.diversityContribution,
      noveltyContribution: quality.components.noveltyScore,
    };
  });

  // Near-duplicate suppression.
  const deduped = dedupeIdeas(scored, { normalizedConfidenceById, qualityScoreById });

  // Tier suppression + preservation rules. Lower_quality duplicates are
  // always suppressed; the rest follow tier with novelty/confidence/region
  // preservation overrides.
  const suppressedByReason: Record<string, number> = {};
  let dedupedCount = 0;
  const annotated: WeatherMarketIdea[] = [];
  for (const idea of deduped.annotated) {
    let suppressed = !idea.dedupeRetained;
    let reason: WeatherMarketIdea['suppressionReason'] | undefined = idea.dedupeReason as any;
    if (suppressed) dedupedCount += 1;

    if (!suppressed) {
      const tier = idea.qualityTier;
      const normConf = idea.normalizedConfidence ?? 50;
      const novelty = idea.noveltyContribution ?? 50;
      const ck = pairKeyStr(idea.locationA.id, idea.locationB.id);
      const rk = pairKeyStr(idea.locationA.region, idea.locationB.region);
      const uniqueRegion = (regionPairCount.get(rk) ?? 1) === 1;
      const uniqueCityPair = (cityPairCount.get(ck) ?? 1) === 1;

      // Preservation rules (Step 163 "Keep" list).
      const preservedByNovelty = novelty >= 80;
      const preservedByConfidence = normConf >= 85;
      const preservedByCrossRegion = idea.locationA.region !== idea.locationB.region && uniqueRegion;
      const preservedRare = uniqueCityPair && (idea.qualityScore ?? 0) >= 55;
      const preserved =
        preservedByNovelty || preservedByConfidence || preservedByCrossRegion || preservedRare;

      if (tier === 'suppress' && !preserved) {
        suppressed = true;
        reason = 'tier_below_weak';
      } else if (
        !preserved &&
        normConf < 45 &&
        novelty < 35 &&
        (tier === 'weak' || tier === 'suppress')
      ) {
        suppressed = true;
        reason = 'low_confidence_low_novelty';
      }
    }

    if (suppressed && reason) {
      suppressedByReason[reason] = (suppressedByReason[reason] ?? 0) + 1;
    }

    annotated.push({
      ...idea,
      suppressed,
      suppressionReason: suppressed ? reason : undefined,
      dedupeClusterId: idea.dedupeClusterId,
      dedupeClusterSize: idea.dedupeClusterSize,
    });
  }

  const retained = annotated.filter((i) => !i.suppressed);
  const evaluated = annotated.slice(0, MAX_RESULTS_CAP);
  const avg =
    retained.length === 0
      ? 0
      : Math.round(
          (retained.reduce((s, i) => s + (i.qualityScore ?? 0), 0) / retained.length) * 100,
        ) / 100;

  return {
    retained,
    evaluated,
    evaluatedCount: scored.length,
    retainedCount: retained.length,
    suppressedCount: annotated.length - retained.length,
    dedupedCount,
    avgQualityScore: avg,
    suppressedByReason,
  };
}

function pairKeyStr(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ── Step 160 — novelty + diversity helpers ─────────────────────────────────

/**
 * Pure novelty bonus: rewards cross-region pairs, cross-metric pairs,
 * and unusual region pairings. Score is intentionally small so it
 * shifts ties without overpowering the |Δ| / closeness signal. The
 * caller multiplies by `modeProfile.noveltyWeight`.
 */
export function computeNoveltyBonus(idea: WeatherMarketIdea): number {
  let bonus = 0;
  if (idea.locationA.region !== idea.locationB.region) bonus += 2;
  if (idea.metricA !== idea.metricB) bonus += 1.5;
  // Mild lat-spread bonus — pairings that span >10° of latitude tend
  // to read as more "distinctive" to the operator. Bounded so a
  // contrived antipodal pair can't dominate.
  const latSpread = Math.abs(idea.locationA.lat - idea.locationB.lat);
  if (latSpread >= 10) bonus += Math.min(2, latSpread / 10);
  return bonus;
}

function spreadBucket(spread: number): string {
  const a = Math.abs(spread);
  if (a < 5) return '<5';
  if (a < 10) return '5-10';
  if (a < 15) return '10-15';
  if (a < 20) return '15-20';
  if (a < 30) return '20-30';
  return '30+';
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Greedy MMR-style re-ranker. Walks the input list (already sorted by
 * `interestingnessScore` desc) and picks `limit` items, applying a
 * penalty whenever a candidate's city-pair / region-pair / metric-pair /
 * spread-bucket has already appeared in the selected list. Penalties
 * scale with `weight`. The original `interestingnessScore` is never
 * mutated — the penalty is applied to a working copy.
 *
 * Returns the selected ideas plus a counter for how many positions
 * changed vs. the naive top-N.
 */
export function applyDiversityRerank(
  candidates: WeatherMarketIdea[],
  limit: number,
  weight: number,
): { selected: WeatherMarketIdea[]; reorderedCount: number } {
  const safeLimit = Math.max(1, Math.min(limit, candidates.length));
  if (candidates.length === 0) return { selected: [], reorderedCount: 0 };

  const naiveTop = candidates.slice(0, safeLimit);
  const selected: WeatherMarketIdea[] = [];
  const seenPair = new Map<string, number>();
  const seenRegionPair = new Map<string, number>();
  const seenMetricPair = new Map<string, number>();
  const seenSpreadBucket = new Map<string, number>();

  const remaining = candidates.slice();

  while (selected.length < safeLimit && remaining.length > 0) {
    let bestIdx = 0;
    let bestEffective = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const pk = pairKey(c.locationA.id, c.locationB.id);
      const rk = pairKey(c.locationA.region, c.locationB.region);
      const mk = c.metricA + '-' + c.metricB;
      const sk = spreadBucket(c.suggestedSpread);
      const penalty =
        (seenPair.get(pk) ?? 0) * 6 +
        (seenRegionPair.get(rk) ?? 0) * 2.5 +
        (seenMetricPair.get(mk) ?? 0) * 1.2 +
        (seenSpreadBucket.get(sk) ?? 0) * 1;
      const effective = c.interestingnessScore - penalty * weight;
      if (effective > bestEffective) {
        bestEffective = effective;
        bestIdx = i;
      }
    }
    const picked = remaining.splice(bestIdx, 1)[0];
    selected.push(picked);
    const pk = pairKey(picked.locationA.id, picked.locationB.id);
    const rk = pairKey(picked.locationA.region, picked.locationB.region);
    const mk = picked.metricA + '-' + picked.metricB;
    const sk = spreadBucket(picked.suggestedSpread);
    seenPair.set(pk, (seenPair.get(pk) ?? 0) + 1);
    seenRegionPair.set(rk, (seenRegionPair.get(rk) ?? 0) + 1);
    seenMetricPair.set(mk, (seenMetricPair.get(mk) ?? 0) + 1);
    seenSpreadBucket.set(sk, (seenSpreadBucket.get(sk) ?? 0) + 1);
  }

  // Count how many positions changed vs. the naive top-N order.
  let reorderedCount = 0;
  for (let i = 0; i < selected.length; i++) {
    if (selected[i].id !== naiveTop[i]?.id) reorderedCount += 1;
  }
  return { selected, reorderedCount };
}
