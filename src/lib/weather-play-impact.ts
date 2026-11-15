// Weather → gameplay impact analysis (factual, neutral).
// Describes how weather conditions affect play on the field. This is
// informational weather context ONLY — no betting advice, and no edge/value/
// lean framing (see CLAUDE.md "No betting advice" guardrail).

export type ImpactLevel = 'none' | 'moderate' | 'high';

export interface WeatherFactor {
  factor: string;
  level: ImpactLevel;
  detail: string;
}

export interface WeatherImpactAnalysis {
  factors: WeatherFactor[];
  summary: string;
  keyInsight: string;
}

export interface WeatherConditions {
  tempF: number;
  windSpeedMph: number;
  windGustMph?: number;
  precipProbability: number;
  humidity: number;
  description?: string;
}

/** Default tolerance for matching an hourly forecast point to a requested time. */
export const HOURLY_MATCH_MAX_MINUTES = 90;

/**
 * Pick the hourly point closest to `target`. If the closest point is more than
 * `maxMinutes` away (for example, the requested time is past the end of the
 * hourly forecast), return null. There is no fallback to a distant point.
 */
export function pickHourlyPoint<T extends { time: string }>(
  hourly: readonly T[] | null | undefined,
  target: Date,
  maxMinutes: number = HOURLY_MATCH_MAX_MINUTES,
): T | null {
  if (!hourly || hourly.length === 0) return null;
  const targetMs = target.getTime();
  if (!Number.isFinite(targetMs)) return null;
  let best: T | null = null;
  let bestDiff = Infinity;
  for (const point of hourly) {
    const ms = new Date(point.time).getTime();
    if (!Number.isFinite(ms)) continue;
    const diff = Math.abs(ms - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = point; }
  }
  if (best === null) return null;
  if (bestDiff > maxMinutes * 60 * 1000) return null;
  return best;
}

/** Gusts are mentioned when they run at least this far above sustained wind. */
const GUST_MENTION_MARGIN_MPH = 10;

/** Humidity only counts as heat stress at or above this temperature. */
const HUMIDITY_WARM_MIN_F = 75;

export function analyzeWeatherImpact(conditions: WeatherConditions): WeatherImpactAnalysis {
  const factors: WeatherFactor[] = [];

  const gust = conditions.windGustMph;
  const gustSuffix =
    typeof gust === 'number' && Number.isFinite(gust) && gust >= conditions.windSpeedMph + GUST_MENTION_MARGIN_MPH
      ? ` Gusts to ${Math.round(gust)} mph.`
      : '';

  // Wind
  if (conditions.windSpeedMph >= 20) {
    factors.push({
      factor: 'Wind',
      level: 'high',
      detail: `${Math.round(conditions.windSpeedMph)} mph sustained. Strong sustained wind makes passing and kicking harder.${gustSuffix}`,
    });
  } else if (conditions.windSpeedMph >= 15) {
    factors.push({
      factor: 'Wind',
      level: 'moderate',
      detail: `${Math.round(conditions.windSpeedMph)} mph winds cross the 15 mph threshold — expect reduced passing efficiency and shorter kicks.${gustSuffix}`,
    });
  } else {
    factors.push({
      factor: 'Wind',
      level: 'none',
      detail: `${Math.round(conditions.windSpeedMph)} mph — no significant impact on gameplay.${gustSuffix}`,
    });
  }

  // Temperature
  if (conditions.tempF >= 85) {
    factors.push({
      factor: 'Temperature',
      level: 'high',
      detail: `${Math.round(conditions.tempF)}°F — player fatigue accelerates, especially in the second half. In baseball, the ball carries farther in hot, less-dense air.`,
    });
  } else if (conditions.tempF <= 25) {
    factors.push({
      factor: 'Temperature',
      level: 'high',
      detail: `${Math.round(conditions.tempF)}°F — extreme cold affects grip and ball handling for players and kickers alike.`,
    });
  } else if (conditions.tempF <= 40) {
    factors.push({
      factor: 'Temperature',
      level: 'moderate',
      detail: `${Math.round(conditions.tempF)}°F — cold enough to affect player comfort and ball handling.`,
    });
  } else {
    factors.push({
      factor: 'Temperature',
      level: 'none',
      detail: `${Math.round(conditions.tempF)}°F — comfortable range, no significant impact.`,
    });
  }

  // Precipitation
  if (conditions.precipProbability >= 70) {
    factors.push({
      factor: 'Precipitation',
      level: 'high',
      detail: `${conditions.precipProbability}% chance. High chance of precipitation; a wet surface and ball are likely if it falls. Chance is not intensity.`,
    });
  } else if (conditions.precipProbability >= 40) {
    factors.push({
      factor: 'Precipitation',
      level: 'moderate',
      detail: `${conditions.precipProbability}% chance — wet conditions possible. Watch for surface effects on play.`,
    });
  } else {
    factors.push({
      factor: 'Precipitation',
      level: 'none',
      detail: `${conditions.precipProbability}% chance — dry conditions expected.`,
    });
  }

  // Humidity — only counts as a factor when it is also warm.
  const warm = conditions.tempF >= HUMIDITY_WARM_MIN_F;
  if (warm && conditions.humidity >= 80) {
    factors.push({
      factor: 'Humidity',
      level: 'high',
      detail: `${conditions.humidity}%. High humidity adds heat stress when it is also warm. In baseball, humid air is slightly less dense.`,
    });
  } else if (warm && conditions.humidity >= 60) {
    factors.push({
      factor: 'Humidity',
      level: 'moderate',
      detail: `${conditions.humidity}% — noticeable moisture, minor stamina impact.`,
    });
  } else if (conditions.humidity >= 60) {
    factors.push({
      factor: 'Humidity',
      level: 'none',
      detail: `${conditions.humidity}% — below ${HUMIDITY_WARM_MIN_F}°F, humidity adds little heat stress.`,
    });
  } else {
    factors.push({
      factor: 'Humidity',
      level: 'none',
      detail: `${conditions.humidity}% — comfortable humidity, no significant impact.`,
    });
  }

  // Build neutral summary
  const highFactors = factors.filter(f => f.level === 'high');
  const moderateFactors = factors.filter(f => f.level === 'moderate');

  let summary: string;
  let keyInsight: string;

  if (highFactors.length >= 2) {
    summary = 'Multiple significant weather factors are in play for this event.';
    keyInsight = 'Several conditions are outside the comfortable range.';
  } else if (highFactors.length === 1) {
    const hf = highFactors[0];
    summary = `${hf.factor} is the dominant weather factor for this event.`;
    keyInsight = `${hf.factor} is the condition furthest outside the comfortable range.`;
  } else if (moderateFactors.length > 0) {
    summary = 'Moderate weather impacts — worth monitoring but not a dominant factor.';
    keyInsight = 'Keep an eye on how conditions develop closer to game time.';
  } else {
    summary = 'Clean weather — no significant weather-based impact on play.';
    keyInsight = 'Team matchups will be the main story here; weather is not a factor.';
  }

  return { factors, summary, keyInsight };
}
