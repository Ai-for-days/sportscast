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
  type CityUniverseMode,
  type CityRegionFilter,
  type WeatherMarketCity,
} from './weather-market-city-universe';
import { getForecast } from './weather-queries';
import type { ForecastResponse, DailyForecast } from './types';

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
  /** @deprecated since Step 152 — use `cityUniverse` instead. */
  candidateSet?: CandidateCitySet;
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
  };
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
  const requestedMaxCities = options.maxCandidateCities
    ?? (cityUniverse === 'expanded_us' ? DEFAULT_EXPANDED_MAX : MAX_EXPANDED_CITIES);
  const { cities: seeds, cappedAt } = resolveCityUniverse({
    mode: cityUniverse,
    region,
    cityIds: options.cityIds,
    maxCandidateCities: requestedMaxCities,
  });
  if (cappedAt !== undefined) {
    warnings.push(
      `Candidate city count capped at ${cappedAt} (universe ${cityUniverse}, region ${region}). Expanded scans are bounded and admin-only.`,
    );
  }

  const concurrency = Math.max(
    1,
    Math.min(8, options.concurrency ?? DEFAULT_FORECAST_CONCURRENCY),
  );
  const requestedMax = options.maxResults ?? options.maxIdeas ?? DEFAULT_MAX_IDEAS;
  const maxIdeas = Math.max(1, Math.min(MAX_RESULTS_CAP, requestedMax));

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
    toleranceF: options.toleranceF,
    cityUniverse,
    region,
    candidateSet,
    cityIds: seeds.map((c) => c.id),
    candidateCityCount: seeds.length,
    successfulForecastCount,
    failedForecastCount,
    ...(cappedAt !== undefined ? { cityCountCappedTo: cappedAt } : {}),
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

  for (let i = 0; i < cityList.length; i++) {
    for (let j = 0; j < cityList.length; j++) {
      if (i === j) continue;
      const a = cityList[i];
      const b = cityList[j];
      for (const [metricA, metricB] of metricPairs) {
        // Skip identical-metric pairs where i > j to avoid duplicate
        // (cityA, cityB, high/high) and (cityB, cityA, high/high). For
        // cross-metric pairs we keep both orderings — they're different
        // ideas (A-high vs B-low ≠ B-high vs A-low).
        if (metricA === metricB && i > j) continue;
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
          toleranceF: options.toleranceF,
        });
        if (idea) candidates.push(idea);
      }
    }
  }

  // Rank by interestingness score (in target mode this is the negated
  // closeness so smaller distance still ends up first), take top N.
  candidates.sort((a, b) => b.interestingnessScore - a.interestingnessScore);
  const topIdeas = candidates.slice(0, maxIdeas);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    targetDate,
    cityCount: cityDay.size,
    ideas: topIdeas,
    warnings,
    resolved: baseResolved,
  };
}
