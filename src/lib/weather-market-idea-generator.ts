// ── Step 144: Weather market idea generator (admin-only, server-only) ───────
//
// Generates draft cross-location pointspread market ideas from current
// forecast data. **Pure suggestion layer** — never creates a wager,
// never publishes anything, never touches pricing or settlement. The
// operator copies the title + setup notes manually into the existing
// wager-creation form if they want a market.
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
  /** Step 144 only emits pointspread ideas. */
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
  /** Internal — used by the UI to color the score chip. Higher = more interesting. */
  interestingnessScore: number;
}

// ── Heuristic thresholds ────────────────────────────────────────────────────

/** Minimum |Δ| (°F) to surface an idea. Below this it's too tight to be interesting. */
const MIN_TEMPERATURE_DELTA_F = 8;
/** Cap on number of ideas returned per generation run. */
const DEFAULT_MAX_IDEAS = 20;
/** Default odds — operator can override at market-creation time. */
const DEFAULT_ODDS = -110;
/** Maximum forecast horizon in days for which we'll generate ideas. */
const MAX_HORIZON_DAYS = 5;

const METRIC_LABELS: Record<IdeaMetric, string> = {
  daily_high: 'High',
  daily_low: 'Low',
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
  if (idea.warnings.length > 0) {
    lines.push(`Warnings: ${idea.warnings.join(' · ')}`);
  }
  return lines.join('\n');
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

interface BuildIdeaInputs {
  cityA: ForecastQualitySeedCity;
  cityB: ForecastQualitySeedCity;
  metricA: IdeaMetric;
  metricB: IdeaMetric;
  targetDate: string;
  forecastValueA: number;
  forecastValueB: number;
  daysAhead: number;
}

function buildIdea(inputs: BuildIdeaInputs): WeatherMarketIdea | null {
  const rawDifference = inputs.forecastValueA - inputs.forecastValueB;
  const absDelta = Math.abs(rawDifference);
  if (absDelta < MIN_TEMPERATURE_DELTA_F) return null;

  const suggestedSpread = -Math.round(rawDifference); // negative on the higher side
  const warnings: string[] = [];
  if (isCrossMetric(inputs.metricA, inputs.metricB)) {
    warnings.push(
      'Cross-metric spread (high vs low). The current PointspreadWager schema carries a single metric — extend the wager model before publishing this kind of market.',
    );
  }
  if (inputs.daysAhead > 5) {
    warnings.push(
      'Target date beyond 5-day forecast horizon — accuracy degrades quickly past this.',
    );
  }

  const titleA = `${inputs.cityA.label} ${METRIC_LABELS[inputs.metricA]}`;
  const titleB = `${inputs.cityB.label} ${METRIC_LABELS[inputs.metricB]}`;
  const title = `${titleA} ${suggestedSpread >= 0 ? '+' : ''}${suggestedSpread}°F vs ${titleB}`;

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
    suggestedSpread,
    suggestedOddsA: DEFAULT_ODDS,
    suggestedOddsB: DEFAULT_ODDS,
    confidenceLabel: confidenceLabelFor(inputs.daysAhead, absDelta),
    rationale: '',
    warnings,
    status: 'idea_only',
    setupNotes: '',
    interestingnessScore: absDelta + (inputs.cityA.region === inputs.cityB.region ? -3 : 2),
  };

  idea.rationale = describeRationale(idea as Omit<WeatherMarketIdea, 'rationale'>);
  idea.description = `Draft idea: ${idea.rationale} Suggested line ${suggestedSpread >= 0 ? '+' : ''}${suggestedSpread}°F at ${DEFAULT_ODDS}/${DEFAULT_ODDS}.`;
  idea.setupNotes = buildSetupNotes(idea);
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

// ── Public entry point ──────────────────────────────────────────────────────

export interface GenerateIdeasOptions {
  /** YYYY-MM-DD. Required. Must be within MAX_HORIZON_DAYS days of today. */
  targetDate: string;
  /** Subset of seed-city ids; defaults to all 12. */
  cityIds?: string[];
  /** Cap on returned ideas. Defaults to 20. */
  maxIdeas?: number;
  /** Concurrency for forecast fetches. Defaults to 4. */
  concurrency?: number;
  /** Override "now" for tests. */
  nowMs?: number;
}

export interface GenerateIdeasResult {
  generatedAt: string;
  targetDate: string;
  cityCount: number;
  ideas: WeatherMarketIdea[];
  warnings: string[];
}

export async function generateWeatherMarketIdeas(
  options: GenerateIdeasOptions,
): Promise<GenerateIdeasResult> {
  const nowMs = options.nowMs ?? Date.now();
  const daysAhead = dateOffsetDays(options.targetDate, nowMs);
  const warnings: string[] = [];
  if (!Number.isFinite(daysAhead) || daysAhead < 0) {
    return {
      generatedAt: new Date(nowMs).toISOString(),
      targetDate: options.targetDate,
      cityCount: 0,
      ideas: [],
      warnings: [`Invalid target date "${options.targetDate}".`],
    };
  }
  if (daysAhead > MAX_HORIZON_DAYS) {
    warnings.push(
      `Target date is ${daysAhead} days out — beyond the ${MAX_HORIZON_DAYS}-day reliable horizon. Ideas may be unreliable.`,
    );
  }

  const allSeeds = FORECAST_QUALITY_SEED_CITIES;
  const seeds = options.cityIds && options.cityIds.length > 0
    ? allSeeds.filter((c) => options.cityIds!.includes(c.id))
    : allSeeds;

  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? DEFAULT_FORECAST_CONCURRENCY));
  const maxIdeas = Math.max(1, Math.min(100, options.maxIdeas ?? DEFAULT_MAX_IDEAS));

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
    const day = cf.forecast.daily.find((d) => d.date === options.targetDate);
    if (day) cityDay.set(cf.city.id, { city: cf.city, daily: day });
  }

  if (cityDay.size < 2) {
    warnings.push(
      `Only ${cityDay.size} city/cities had a forecast for ${options.targetDate}. Need at least 2 to build a spread idea.`,
    );
    return {
      generatedAt: new Date(nowMs).toISOString(),
      targetDate: options.targetDate,
      cityCount: cityDay.size,
      ideas: [],
      warnings,
    };
  }

  const metricPairs: Array<[IdeaMetric, IdeaMetric]> = [
    ['daily_high', 'daily_high'],
    ['daily_low', 'daily_low'],
    ['daily_high', 'daily_low'],
  ];

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
        // ideas (Waco-high vs Walla-low ≠ Walla-high vs Waco-low).
        if (metricA === metricB && i > j) continue;
        const valueA = getMetricValue(a.daily, metricA);
        const valueB = getMetricValue(b.daily, metricB);
        if (valueA === null || valueB === null) continue;
        const idea = buildIdea({
          cityA: a.city,
          cityB: b.city,
          metricA,
          metricB,
          targetDate: options.targetDate,
          forecastValueA: valueA,
          forecastValueB: valueB,
          daysAhead,
        });
        if (idea) candidates.push(idea);
      }
    }
  }

  // Rank by interestingness score, take top N.
  candidates.sort((a, b) => b.interestingnessScore - a.interestingnessScore);
  const topIdeas = candidates.slice(0, maxIdeas);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    targetDate: options.targetDate,
    cityCount: cityDay.size,
    ideas: topIdeas,
    warnings,
  };
}
