import type { ForecastPoint, FishSpecies, FishForecast, SolunarData } from './types';

interface SpeciesConfig {
  label: string;
  optimalTempRange: [number, number]; // °F
  pressurePref: 'low' | 'high' | 'stable';
  solunarWeight: number; // 0-1 sensitivity to solunar
  cloudPref: 'overcast' | 'clear' | 'any';
  windPref: 'calm' | 'light' | 'moderate';
  rainTolerance: 'low' | 'medium' | 'high';
}

const speciesConfigs: Record<FishSpecies, SpeciesConfig> = {
  bass: {
    label: 'Largemouth Bass',
    optimalTempRange: [60, 80],
    pressurePref: 'low',
    solunarWeight: 0.8,
    cloudPref: 'overcast',
    windPref: 'light',
    rainTolerance: 'medium',
  },
  trout: {
    label: 'Trout',
    optimalTempRange: [48, 65],
    pressurePref: 'high',
    solunarWeight: 0.6,
    cloudPref: 'overcast',
    windPref: 'calm',
    rainTolerance: 'low',
  },
  catfish: {
    label: 'Catfish',
    optimalTempRange: [70, 85],
    pressurePref: 'low',
    solunarWeight: 0.9,
    cloudPref: 'any',
    windPref: 'moderate',
    rainTolerance: 'high',
  },
  crappie: {
    label: 'Crappie',
    optimalTempRange: [55, 75],
    pressurePref: 'stable',
    solunarWeight: 0.7,
    cloudPref: 'overcast',
    windPref: 'calm',
    rainTolerance: 'low',
  },
  walleye: {
    label: 'Walleye',
    optimalTempRange: [50, 70],
    pressurePref: 'low',
    solunarWeight: 0.85,
    cloudPref: 'overcast',
    windPref: 'light',
    rainTolerance: 'medium',
  },
};

function classifyPressure(hPa: number): 'low' | 'normal' | 'high' {
  if (hPa < 1005) return 'low';
  if (hPa > 1020) return 'high';
  return 'normal';
}

function scorePressure(config: SpeciesConfig, hPa: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  const cls = classifyPressure(hPa);
  let pts = 12; // baseline
  if (config.pressurePref === 'low' && cls === 'low') pts = 25;
  else if (config.pressurePref === 'low' && cls === 'normal') pts = 15;
  else if (config.pressurePref === 'low' && cls === 'high') pts = 5;
  else if (config.pressurePref === 'high' && cls === 'high') pts = 25;
  else if (config.pressurePref === 'high' && cls === 'normal') pts = 15;
  else if (config.pressurePref === 'high' && cls === 'low') pts = 5;
  else if (config.pressurePref === 'stable' && cls === 'normal') pts = 25;
  else if (config.pressurePref === 'stable') pts = 12;

  const impact = pts >= 20 ? 'positive' : pts <= 8 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(hPa)} hPa (${cls})`, impact };
}

function scoreTemperature(config: SpeciesConfig, tempF: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  const [lo, hi] = config.optimalTempRange;
  const mid = (lo + hi) / 2;

  let pts: number;
  if (tempF >= lo && tempF <= hi) {
    // In range — score based on distance from center
    const dist = Math.abs(tempF - mid);
    const halfRange = (hi - lo) / 2;
    pts = Math.round(25 - (dist / halfRange) * 8);
  } else {
    // Out of range — penalty based on distance
    const dist = tempF < lo ? lo - tempF : tempF - hi;
    pts = Math.max(0, Math.round(15 - dist * 0.8));
  }

  const impact = pts >= 20 ? 'positive' : pts <= 8 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(tempF)}°F (optimal ${lo}-${hi}°F)`, impact };
}

function scoreSolunar(config: SpeciesConfig, solunarRating: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  const pts = Math.round((solunarRating / 100) * 25 * config.solunarWeight);
  const impact = pts >= 15 ? 'positive' : pts <= 6 ? 'negative' : 'neutral';
  return { pts, label: `${solunarRating}/100`, impact };
}

function scoreCloudCover(config: SpeciesConfig, cloudPct: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  let pts: number;
  if (config.cloudPref === 'overcast') {
    pts = cloudPct >= 70 ? 10 : cloudPct >= 40 ? 6 : 3;
  } else if (config.cloudPref === 'clear') {
    pts = cloudPct <= 30 ? 10 : cloudPct <= 60 ? 6 : 3;
  } else {
    pts = 6; // 'any'
  }
  const impact = pts >= 8 ? 'positive' : pts <= 4 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(cloudPct)}% cloud cover`, impact };
}

function scoreWind(config: SpeciesConfig, windMph: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  let pts: number;
  if (config.windPref === 'calm') {
    pts = windMph <= 5 ? 10 : windMph <= 10 ? 7 : windMph <= 15 ? 4 : 1;
  } else if (config.windPref === 'light') {
    pts = windMph >= 5 && windMph <= 12 ? 10 : windMph <= 5 ? 7 : windMph <= 18 ? 5 : 2;
  } else {
    // moderate
    pts = windMph >= 8 && windMph <= 18 ? 10 : windMph <= 8 ? 6 : 3;
  }
  const impact = pts >= 8 ? 'positive' : pts <= 4 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(windMph)} mph`, impact };
}

function scorePrecip(precipMm: number, precipProb: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  let pts = 0;
  if (precipProb < 20 && precipMm < 0.5) {
    pts = 0; // no bonus, no penalty
  } else if (precipProb < 50 && precipMm < 2.5) {
    pts = 5; // light rain bonus
  } else if (precipProb >= 50 || precipMm >= 5) {
    pts = -15; // heavy rain penalty
  } else {
    pts = -5; // moderate
  }
  const label = precipProb > 0 ? `${precipProb}% chance, ${precipMm.toFixed(1)}mm` : 'None expected';
  const impact = pts > 0 ? 'positive' : pts < -5 ? 'negative' : 'neutral';
  return { pts, label, impact };
}

function activityRating(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

function generateTips(species: FishSpecies, score: number, tempF: number, windMph: number, pressure: number): string[] {
  const tips: string[] = [];
  const config = speciesConfigs[species];

  if (tempF < config.optimalTempRange[0]) {
    tips.push(`Water temps likely cold — fish deeper structure and slow your presentation.`);
  } else if (tempF > config.optimalTempRange[1]) {
    tips.push(`Warm conditions — target shaded areas and deeper, cooler water.`);
  }

  if (species === 'bass' && classifyPressure(pressure) === 'low') {
    tips.push('Low pressure activates bass feeding — try topwater lures.');
  }
  if (species === 'trout' && windMph < 5) {
    tips.push('Calm winds — use lighter line and smaller presentations for wary trout.');
  }
  if (species === 'catfish') {
    tips.push('Catfish are most active at dawn and dusk — focus on solunar major periods.');
  }
  if (species === 'crappie' && tempF >= 55 && tempF <= 65) {
    tips.push('Prime crappie temps — work submerged brush piles with small jigs.');
  }
  if (species === 'walleye' && classifyPressure(pressure) === 'low') {
    tips.push('Falling pressure triggers walleye feeding — try jigging near drop-offs.');
  }

  if (score >= 80) {
    tips.push('Excellent conditions — extend your time on the water today!');
  } else if (score < 40) {
    tips.push('Tough conditions — be patient and focus on structure and cover.');
  }

  return tips.slice(0, 3);
}

export function calculateFishForecast(
  forecast: ForecastPoint,
  solunar: SolunarData,
  species: FishSpecies
): FishForecast {
  const config = speciesConfigs[species];

  const pressure = scorePressure(config, forecast.pressure);
  const temp = scoreTemperature(config, forecast.tempF);
  const sol = scoreSolunar(config, solunar.rating);
  const cloud = scoreCloudCover(config, forecast.cloudCover);
  const wind = scoreWind(config, forecast.windSpeedMph);
  const precip = scorePrecip(forecast.precipMm, forecast.precipProbability);

  const rawScore = pressure.pts + temp.pts + sol.pts + cloud.pts + wind.pts + precip.pts;
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    species,
    score,
    activityRating: activityRating(score),
    bestTimes: solunar.periods,
    keyFactors: [
      { label: 'Pressure', value: pressure.label, impact: pressure.impact },
      { label: 'Temperature', value: temp.label, impact: temp.impact },
      { label: 'Solunar', value: sol.label, impact: sol.impact },
      { label: 'Cloud Cover', value: cloud.label, impact: cloud.impact },
      { label: 'Wind', value: wind.label, impact: wind.impact },
      { label: 'Precipitation', value: precip.label, impact: precip.impact },
    ],
    tips: generateTips(species, score, forecast.tempF, forecast.windSpeedMph, forecast.pressure),
  };
}

export function getAllFishForecasts(forecast: ForecastPoint, solunar: SolunarData): FishForecast[] {
  const allSpecies: FishSpecies[] = ['bass', 'trout', 'catfish', 'crappie', 'walleye'];
  return allSpecies.map(s => calculateFishForecast(forecast, solunar, s));
}

export { speciesConfigs as fishSpeciesConfigs };
