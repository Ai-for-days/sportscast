// ── Step 129: Forecast Confidence + Volatility Intelligence ─────────────────
//
// Lightweight, public-facing forecast intelligence layer. Pure heuristics
// derived from the forecast payload we already have on the weather page —
// no new data sources, no model calls, no scientific overclaiming.
//
// The goal is "quietly intelligent": readable confidence + stability +
// trend signals that make the page feel smarter without pretending to be
// ensemble meteorology.
//
// See docs/forecast-intelligence-notes.md for the design philosophy and
// the future-expansion roadmap.

import type {
  ForecastResponse,
  ForecastPoint,
  DailyForecast,
  WeatherAlert,
} from './types';

// ── Public shape ────────────────────────────────────────────────────────────

export type ForecastConfidenceLevel = 'high' | 'moderate' | 'low';
export type ForecastVolatilityLevel = 'stable' | 'shifting' | 'volatile';
export type ForecastTrendDirection =
  | 'warming'
  | 'cooling'
  | 'wetter'
  | 'drier'
  | 'windier'
  | 'calming'
  | 'stable';

export interface ForecastTrend {
  direction: ForecastTrendDirection;
  /** Short customer-facing phrase. */
  summary: string;
}

export interface ForecastIntelligenceSummary {
  confidence: ForecastConfidenceLevel;
  /** One-sentence rationale safe to render directly. */
  confidenceExplanation: string;
  volatility: ForecastVolatilityLevel;
  /** One-sentence rationale safe to render directly. */
  volatilityExplanation: string;
  /** Up to two most-relevant trends. Empty when nothing notable. */
  trends: ForecastTrend[];
  /** "Updated 12 minutes ago" / null when generatedAt is missing. */
  freshness: string | null;
  /** True when an active Severe/Extreme alert is shaping the verdict. */
  hasActiveSevereAlert: boolean;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / xs.length);
}

function meanAbsDelta(xs: number[]): number {
  if (xs.length < 2) return 0;
  const deltas: number[] = [];
  for (let i = 1; i < xs.length; i++) deltas.push(Math.abs(xs[i] - xs[i - 1]));
  return avg(deltas);
}

function downgradeConfidence(level: ForecastConfidenceLevel): ForecastConfidenceLevel {
  if (level === 'high') return 'moderate';
  if (level === 'moderate') return 'low';
  return 'low';
}

function isSevereAlert(a: WeatherAlert): boolean {
  return a.severity === 'Severe' || a.severity === 'Extreme';
}

function freshnessLabel(generatedAt: string | undefined): string | null {
  if (!generatedAt) return null;
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return null;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Just updated';
  if (mins < 60) return `Updated ${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
}

// ── Confidence ──────────────────────────────────────────────────────────────

interface ConfidenceFactors {
  hasActiveSevereAlert: boolean;
  dailyHighSpreadF: number;
  hourlyTempStdDevF: number;
  forecastAgeHours: number | null;
  /** Number of daily entries we have visibility into (longer ≈ less certain late). */
  dailyHorizonDays: number;
}

function computeConfidence(f: ConfidenceFactors): {
  level: ForecastConfidenceLevel;
  explanation: string;
} {
  let level: ForecastConfidenceLevel = 'high';
  const reasons: string[] = [];

  if (f.hasActiveSevereAlert) {
    level = downgradeConfidence(level);
    reasons.push('an active severe weather alert is in effect');
  }
  if (f.dailyHighSpreadF >= 25) {
    level = downgradeConfidence(level);
    reasons.push(`daily highs swing ${Math.round(f.dailyHighSpreadF)}°F across the period`);
  }
  if (f.hourlyTempStdDevF >= 9) {
    level = downgradeConfidence(level);
    reasons.push('near-term temperatures vary widely hour to hour');
  }
  if (f.forecastAgeHours !== null && f.forecastAgeHours >= 12) {
    level = downgradeConfidence(level);
    reasons.push('the underlying forecast was last updated several hours ago');
  }

  let explanation: string;
  if (level === 'high') {
    explanation = 'Forecast conditions look relatively settled.';
  } else if (level === 'moderate') {
    explanation = reasons.length > 0
      ? `Watch for changes — ${reasons[0]}.`
      : 'Some details may shift as the forecast updates.';
  } else {
    explanation = reasons.length > 0
      ? `Lower confidence — ${reasons.slice(0, 2).join(' and ')}.`
      : 'Conditions remain uncertain — check back later.';
  }
  return { level, explanation };
}

// ── Volatility ──────────────────────────────────────────────────────────────

interface VolatilityFactors {
  /** Mean absolute hour-to-hour temperature change (next 24h), °F. */
  hourlyTempDelta: number;
  /** Mean absolute hour-to-hour precipitation-probability change, percentage points. */
  hourlyPrecipDelta: number;
  /** Mean absolute hour-to-hour wind-speed change, mph. */
  hourlyWindDelta: number;
}

function computeVolatility(f: VolatilityFactors): {
  level: ForecastVolatilityLevel;
  explanation: string;
} {
  // Score each axis on a 0-2 scale, take the max.
  const tempScore = f.hourlyTempDelta >= 4 ? 2 : f.hourlyTempDelta >= 2 ? 1 : 0;
  const precipScore = f.hourlyPrecipDelta >= 20 ? 2 : f.hourlyPrecipDelta >= 10 ? 1 : 0;
  const windScore = f.hourlyWindDelta >= 8 ? 2 : f.hourlyWindDelta >= 5 ? 1 : 0;
  const max = Math.max(tempScore, precipScore, windScore);

  let level: ForecastVolatilityLevel;
  if (max >= 2) level = 'volatile';
  else if (max >= 1) level = 'shifting';
  else level = 'stable';

  // Pick the dominant axis for the explanation.
  let dominantAxis: 'temp' | 'precip' | 'wind' | null = null;
  if (max > 0) {
    if (tempScore === max) dominantAxis = 'temp';
    else if (precipScore === max) dominantAxis = 'precip';
    else if (windScore === max) dominantAxis = 'wind';
  }

  let explanation: string;
  if (level === 'stable') {
    explanation = 'Hour-to-hour conditions are holding steady.';
  } else if (level === 'shifting') {
    explanation = dominantAxis === 'precip'
      ? 'Rain chances are moving around through the day.'
      : dominantAxis === 'wind'
      ? 'Winds are easing and picking back up through the day.'
      : 'Temperatures are nudging up and down through the day.';
  } else {
    explanation = dominantAxis === 'precip'
      ? 'Precipitation timing is unsettled — chances jump hour to hour.'
      : dominantAxis === 'wind'
      ? 'Winds are gusty and changing fast — expect noticeable shifts.'
      : 'Temperatures are swinging quickly — the next several hours feel unstable.';
  }
  return { level, explanation };
}

// ── Trends ──────────────────────────────────────────────────────────────────

const TREND_PRIORITY: ForecastTrendDirection[] = [
  'wetter',
  'drier',
  'warming',
  'cooling',
  'windier',
  'calming',
];

function computeTrends(daily: DailyForecast[]): ForecastTrend[] {
  // Compare day 1 to day 5 (or whichever is the last available).
  if (daily.length < 3) return [];
  const start = daily[0];
  const endIdx = Math.min(daily.length - 1, 4);
  const end = daily[endIdx];
  const horizonLabel = endIdx >= 4 ? 'over the next several days' : 'this week';

  const tempDelta = end.highF - start.highF;
  const precipDelta = end.precipProbability - start.precipProbability;
  const windDelta = end.windSpeedMph - start.windSpeedMph;

  const candidates: ForecastTrend[] = [];

  if (precipDelta >= 20) {
    candidates.push({
      direction: 'wetter',
      summary: `Rain chances climb to ${end.precipProbability}% ${horizonLabel}.`,
    });
  } else if (precipDelta <= -20) {
    candidates.push({
      direction: 'drier',
      summary: `Rain chances ease to ${end.precipProbability}% ${horizonLabel}.`,
    });
  }

  if (tempDelta >= 8) {
    candidates.push({
      direction: 'warming',
      summary: `Forecast trending warmer — highs near ${Math.round(end.highF)}°F ${horizonLabel}.`,
    });
  } else if (tempDelta <= -8) {
    candidates.push({
      direction: 'cooling',
      summary: `Forecast trending cooler — highs near ${Math.round(end.highF)}°F ${horizonLabel}.`,
    });
  }

  if (windDelta >= 8) {
    candidates.push({
      direction: 'windier',
      summary: `Winds picking up — gusts toward ${Math.round(end.windGustMph)} mph ${horizonLabel}.`,
    });
  } else if (windDelta <= -8) {
    candidates.push({
      direction: 'calming',
      summary: `Winds easing into the week, settling near ${Math.round(end.windSpeedMph)} mph.`,
    });
  }

  if (candidates.length === 0) {
    return [
      {
        direction: 'stable',
        summary: `Forecast remains relatively steady ${horizonLabel}.`,
      },
    ];
  }

  // Sort by TREND_PRIORITY, return up to two.
  candidates.sort(
    (a, b) =>
      TREND_PRIORITY.indexOf(a.direction) - TREND_PRIORITY.indexOf(b.direction),
  );
  return candidates.slice(0, 2);
}

// ── Public entry point ──────────────────────────────────────────────────────

export function buildForecastIntelligence(
  forecast: ForecastResponse,
): ForecastIntelligenceSummary {
  const hourly = forecast.hourly ?? [];
  const daily = forecast.daily ?? [];
  const alerts = forecast.alerts ?? [];

  const next24 = hourly.slice(0, 24);
  const dailyHighs = daily.slice(0, 7).map((d) => d.highF);
  const dailyLows = daily.slice(0, 7).map((d) => d.lowF);
  const dailyHighSpread =
    dailyHighs.length > 1 ? Math.max(...dailyHighs) - Math.min(...dailyLows) : 0;
  const hourlyTempStdDev = stddev(next24.map((p) => p.tempF));

  const hourlyTempDelta = meanAbsDelta(next24.map((p) => p.tempF));
  const hourlyPrecipDelta = meanAbsDelta(next24.map((p) => p.precipProbability));
  const hourlyWindDelta = meanAbsDelta(next24.map((p) => p.windSpeedMph));

  const hasActiveSevereAlert = alerts.some(isSevereAlert);

  const generatedAtMs = forecast.generatedAt
    ? Date.parse(forecast.generatedAt)
    : NaN;
  const forecastAgeHours = Number.isFinite(generatedAtMs)
    ? Math.max(0, (Date.now() - generatedAtMs) / 3_600_000)
    : null;

  const confidence = computeConfidence({
    hasActiveSevereAlert,
    dailyHighSpreadF: dailyHighSpread,
    hourlyTempStdDevF: hourlyTempStdDev,
    forecastAgeHours,
    dailyHorizonDays: daily.length,
  });

  const volatility = computeVolatility({
    hourlyTempDelta,
    hourlyPrecipDelta,
    hourlyWindDelta,
  });

  const trends = computeTrends(daily);
  const freshness = freshnessLabel(forecast.generatedAt);

  return {
    confidence: confidence.level,
    confidenceExplanation: confidence.explanation,
    volatility: volatility.level,
    volatilityExplanation: volatility.explanation,
    trends,
    freshness,
    hasActiveSevereAlert,
  };
}
