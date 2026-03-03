// Weather → sports betting analysis rules
// Based on Sharp Football Analysis, Covers, and MLB research

export type ImpactLevel = 'none' | 'moderate' | 'high';
export type BettingLean = 'under' | 'over' | 'underdog' | 'neutral' | 'possible_over_value';

export interface WeatherFactor {
  factor: string;
  level: ImpactLevel;
  detail: string;
  lean: BettingLean;
}

export interface BettingAnalysis {
  factors: WeatherFactor[];
  verdict: string;
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

export function analyzeBettingWeather(conditions: WeatherConditions): BettingAnalysis {
  const factors: WeatherFactor[] = [];

  // Wind analysis
  if (conditions.windSpeedMph >= 20) {
    factors.push({
      factor: 'Wind',
      level: 'high',
      detail: `${Math.round(conditions.windSpeedMph)} mph sustained winds — historically 2.7 fewer points than normal. Passing and kicking significantly impaired.`,
      lean: 'under',
    });
  } else if (conditions.windSpeedMph >= 15) {
    factors.push({
      factor: 'Wind',
      level: 'moderate',
      detail: `${Math.round(conditions.windSpeedMph)} mph winds cross the 15 mph threshold — expect reduced passing efficiency and shorter kicks.`,
      lean: 'under',
    });
  } else {
    factors.push({
      factor: 'Wind',
      level: 'none',
      detail: `${Math.round(conditions.windSpeedMph)} mph — no significant impact on gameplay.`,
      lean: 'neutral',
    });
  }

  // Temperature analysis
  if (conditions.tempF >= 85) {
    factors.push({
      factor: 'Temperature',
      level: 'high',
      detail: `${Math.round(conditions.tempF)}°F — player fatigue accelerates, especially in 2nd half. NFL Under, MLB Over (ball travels further in heat).`,
      lean: 'under',
    });
  } else if (conditions.tempF <= 25) {
    factors.push({
      factor: 'Temperature',
      level: 'high',
      detail: `${Math.round(conditions.tempF)}°F — grip issues affect ball handling. Books often over-adjust, creating possible Over value.`,
      lean: 'possible_over_value',
    });
  } else if (conditions.tempF <= 40) {
    factors.push({
      factor: 'Temperature',
      level: 'moderate',
      detail: `${Math.round(conditions.tempF)}°F — cold enough to affect player comfort and ball handling.`,
      lean: 'under',
    });
  } else {
    factors.push({
      factor: 'Temperature',
      level: 'none',
      detail: `${Math.round(conditions.tempF)}°F — comfortable range, no significant impact.`,
      lean: 'neutral',
    });
  }

  // Precipitation analysis
  if (conditions.precipProbability >= 70) {
    factors.push({
      factor: 'Precipitation',
      level: 'high',
      detail: `${conditions.precipProbability}% chance — heavy rain/snow creates chaos. Fumbles, slippery footing act as "great equalizer" between teams.`,
      lean: 'underdog',
    });
  } else if (conditions.precipProbability >= 40) {
    factors.push({
      factor: 'Precipitation',
      level: 'moderate',
      detail: `${conditions.precipProbability}% chance — wet conditions possible. Watch for surface effects on play.`,
      lean: 'neutral',
    });
  } else {
    factors.push({
      factor: 'Precipitation',
      level: 'none',
      detail: `${conditions.precipProbability}% chance — dry conditions expected.`,
      lean: 'neutral',
    });
  }

  // Humidity analysis
  if (conditions.humidity >= 80) {
    factors.push({
      factor: 'Humidity',
      level: 'high',
      detail: `${conditions.humidity}% — drains players faster. Watch for 4th quarter defensive fade. In baseball, humid air is actually thinner (ball flies further).`,
      lean: 'over',
    });
  } else if (conditions.humidity >= 60) {
    factors.push({
      factor: 'Humidity',
      level: 'moderate',
      detail: `${conditions.humidity}% — noticeable moisture, minor stamina impact.`,
      lean: 'neutral',
    });
  } else {
    factors.push({
      factor: 'Humidity',
      level: 'none',
      detail: `${conditions.humidity}% — comfortable humidity, no significant impact.`,
      lean: 'neutral',
    });
  }

  // Build verdict
  const highFactors = factors.filter(f => f.level === 'high');
  const moderateFactors = factors.filter(f => f.level === 'moderate');
  const leans = factors.filter(f => f.lean !== 'neutral').map(f => f.lean);

  let verdict: string;
  let keyInsight: string;

  if (highFactors.length >= 2) {
    verdict = 'Multiple severe weather impacts — conditions strongly favor adjusted betting lines.';
    keyInsight = 'Sharp bettors look for live betting value here, where you can see how weather is actually affecting the game before the algorithm catches up.';
  } else if (highFactors.length === 1) {
    const hf = highFactors[0];
    verdict = `${hf.factor} is the dominant weather factor for this event.`;
    keyInsight = hf.lean === 'under'
      ? 'The Under has historically been one of the most consistent weather-based betting trends.'
      : hf.lean === 'underdog'
        ? 'Chaos conditions narrow the talent gap — consider the underdog spread.'
        : hf.lean === 'possible_over_value'
          ? 'Books often over-adjust for extreme cold, creating hidden Over value.'
          : `Monitor ${hf.factor.toLowerCase()} conditions at game time for live betting edges.`;
  } else if (moderateFactors.length > 0) {
    verdict = 'Moderate weather impacts — worth monitoring but not a primary betting driver.';
    keyInsight = 'The real edge is in live betting — wait to see how conditions actually affect gameplay.';
  } else {
    verdict = 'Clean weather — no significant weather-based edges.';
    keyInsight = 'Focus on team matchups and traditional handicapping. Weather is not a factor here.';
  }

  return { factors, verdict, keyInsight };
}

const LEAN_LABELS: Record<BettingLean, string> = {
  under: 'Under',
  over: 'Over',
  underdog: 'Underdog',
  neutral: '—',
  possible_over_value: 'Over Value',
};

export function getLeanLabel(lean: BettingLean): string {
  return LEAN_LABELS[lean];
}
