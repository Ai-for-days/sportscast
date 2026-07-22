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

export function analyzeWeatherImpact(conditions: WeatherConditions): WeatherImpactAnalysis {
  const factors: WeatherFactor[] = [];

  // Wind
  if (conditions.windSpeedMph >= 20) {
    factors.push({
      factor: 'Wind',
      level: 'high',
      detail: `${Math.round(conditions.windSpeedMph)} mph sustained winds — passing and kicking are significantly impaired, and games in conditions this windy historically see lower scoring.`,
    });
  } else if (conditions.windSpeedMph >= 15) {
    factors.push({
      factor: 'Wind',
      level: 'moderate',
      detail: `${Math.round(conditions.windSpeedMph)} mph winds cross the 15 mph threshold — expect reduced passing efficiency and shorter kicks.`,
    });
  } else {
    factors.push({
      factor: 'Wind',
      level: 'none',
      detail: `${Math.round(conditions.windSpeedMph)} mph — no significant impact on gameplay.`,
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
      detail: `${conditions.precipProbability}% chance — heavy rain or snow creates chaos on the field. Fumbles and slippery footing tend to narrow the gap between teams.`,
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

  // Humidity
  if (conditions.humidity >= 80) {
    factors.push({
      factor: 'Humidity',
      level: 'high',
      detail: `${conditions.humidity}% — drains players faster; watch for a late-game defensive fade. In baseball, humid air is actually less dense, so the ball flies a little farther.`,
    });
  } else if (conditions.humidity >= 60) {
    factors.push({
      factor: 'Humidity',
      level: 'moderate',
      detail: `${conditions.humidity}% — noticeable moisture, minor stamina impact.`,
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
    keyInsight = 'Conditions like these have a measurable effect on how the game is played.';
  } else if (highFactors.length === 1) {
    const hf = highFactors[0];
    summary = `${hf.factor} is the dominant weather factor for this event.`;
    keyInsight = `${hf.factor} at this level is the condition most likely to shape how this game plays out.`;
  } else if (moderateFactors.length > 0) {
    summary = 'Moderate weather impacts — worth monitoring but not a dominant factor.';
    keyInsight = 'Keep an eye on how conditions develop closer to game time.';
  } else {
    summary = 'Clean weather — no significant weather-based impact on play.';
    keyInsight = 'Team matchups will be the main story here; weather is not a factor.';
  }

  return { factors, summary, keyInsight };
}
