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

import {
  FORECAST_QUALITY_SEED_CITIES,
  type ForecastQualitySeedCity,
} from './forecast-quality-seed-cities';
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
  cityA: ForecastQualitySeedCity;
  cityB: ForecastQualitySeedCity;
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

// ── Candidate-city resolution (Step 145 Task E) ─────────────────────────────
//
// For now, the only candidate set is the existing 12-seed-city list at
// `forecast-quality-seed-cities.ts`. The shape below is deliberately a
// thin abstraction so future expansion (top-50, region filters, custom
// admin-curated lists) can plug in without changing the generator's
// hot path. It does NOT yet scan large uncontrolled lists — see the
// docs for the safety reasons.

export type CandidateCitySet = 'seed' /* future: 'top-50' | 'all-supported' */;

export interface CandidateCityResolverInput {
  set: CandidateCitySet;
  cityIds?: string[];
  region?: string;
}

export function resolveCandidateCities(
  input: CandidateCityResolverInput,
): ForecastQualitySeedCity[] {
  // Today only the seed list is supported. Adding new sets later means
  // returning the right slice here — callers don't need to change.
  let pool: ForecastQualitySeedCity[];
  switch (input.set) {
    case 'seed':
    default:
      pool = FORECAST_QUALITY_SEED_CITIES;
      break;
  }
  if (input.cityIds && input.cityIds.length > 0) {
    pool = pool.filter((c) => input.cityIds!.includes(c.id));
  }
  if (input.region) {
    pool = pool.filter((c) => c.region === input.region);
  }
  return pool;
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
  /** Subset of seed-city ids; defaults to all 12. */
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
  /** Future-extensible candidate-city selector. Defaults to the seed list. */
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
   * Step 145 — echo the resolved knobs so the UI can render the
   * effective query without re-deriving (esp. when dayOffset was used).
   */
  resolved: {
    metricPair: MetricPairOption;
    targetDifferenceF?: number;
    toleranceF?: number;
    candidateSet: CandidateCitySet;
    cityIds: string[];
  };
}

export async function generateWeatherMarketIdeas(
  options: GenerateIdeasOptions,
): Promise<GenerateIdeasResult> {
  const nowMs = options.nowMs ?? Date.now();
  const candidateSet: CandidateCitySet = options.candidateSet ?? 'seed';
  const metricPair: MetricPairOption = options.metricPair ?? 'any_temperature_pair';
  const warnings: string[] = [];

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
      resolved: {
        metricPair,
        targetDifferenceF: options.targetDifferenceF,
        toleranceF: options.toleranceF,
        candidateSet,
        cityIds: [],
      },
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
      resolved: {
        metricPair,
        targetDifferenceF: options.targetDifferenceF,
        toleranceF: options.toleranceF,
        candidateSet,
        cityIds: options.cityIds ?? [],
      },
    };
  }
  if (daysAhead > MAX_HORIZON_DAYS) {
    warnings.push(
      `Target date is ${daysAhead} days out — beyond the ${MAX_HORIZON_DAYS}-day reliable horizon. Ideas may be unreliable.`,
    );
  }

  const seeds = resolveCandidateCities({
    set: candidateSet,
    cityIds: options.cityIds,
  });

  const concurrency = Math.max(
    1,
    Math.min(8, options.concurrency ?? DEFAULT_FORECAST_CONCURRENCY),
  );
  const requestedMax = options.maxResults ?? options.maxIdeas ?? DEFAULT_MAX_IDEAS;
  const maxIdeas = Math.max(1, Math.min(MAX_RESULTS_CAP, requestedMax));

  // Fetch forecasts per city — per-city failures are isolated so one
  // broken upstream doesn't sink the whole generation.
  type CityForecast = {
    city: ForecastQualitySeedCity;
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

  for (const cf of cityForecasts) {
    if (cf.failureNote) warnings.push(`${cf.city.label}: forecast fetch failed — ${cf.failureNote}`);
  }

  // Pluck the matching daily entry per city for the target date.
  const cityDay = new Map<string, { city: ForecastQualitySeedCity; daily: DailyForecast }>();
  for (const cf of cityForecasts) {
    if (!cf.forecast?.daily) continue;
    const day = cf.forecast.daily.find((d) => d.date === targetDate);
    if (day) cityDay.set(cf.city.id, { city: cf.city, daily: day });
  }

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
      resolved: {
        metricPair,
        targetDifferenceF: options.targetDifferenceF,
        toleranceF: options.toleranceF,
        candidateSet,
        cityIds: seeds.map((c) => c.id),
      },
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
    resolved: {
      metricPair,
      targetDifferenceF: options.targetDifferenceF,
      toleranceF: options.toleranceF,
      candidateSet,
      cityIds: seeds.map((c) => c.id),
    },
  };
}
