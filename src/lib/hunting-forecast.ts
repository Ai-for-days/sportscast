import type { ForecastPoint, GameSpecies, HuntForecast, SolunarData } from './types';

interface GameConfig {
  label: string;
  optimalTempRange: [number, number]; // °F
  windPref: 'calm' | 'light' | 'moderate';
  pressurePref: 'falling' | 'rising' | 'any';
  moonSensitivity: number; // 0-1, how much moon phase affects activity
  rainPref: 'light' | 'none' | 'any';
  cloudPref: 'overcast' | 'clear' | 'any';
}

const gameConfigs: Record<GameSpecies, GameConfig> = {
  whitetail: {
    label: 'Whitetail Deer',
    optimalTempRange: [20, 50],
    windPref: 'calm',
    pressurePref: 'falling',
    moonSensitivity: 0.9,
    rainPref: 'light',
    cloudPref: 'overcast',
  },
  duck: {
    label: 'Waterfowl / Duck',
    optimalTempRange: [25, 45],
    windPref: 'moderate',
    pressurePref: 'falling',
    moonSensitivity: 0.4,
    rainPref: 'any',
    cloudPref: 'overcast',
  },
  turkey: {
    label: 'Wild Turkey',
    optimalTempRange: [40, 70],
    windPref: 'calm',
    pressurePref: 'rising',
    moonSensitivity: 0.3,
    rainPref: 'none',
    cloudPref: 'clear',
  },
  elk: {
    label: 'Elk',
    optimalTempRange: [15, 45],
    windPref: 'light',
    pressurePref: 'falling',
    moonSensitivity: 0.7,
    rainPref: 'light',
    cloudPref: 'any',
  },
};

function classifyPressure(hPa: number): 'low' | 'normal' | 'high' {
  if (hPa < 1005) return 'low';
  if (hPa > 1020) return 'high';
  return 'normal';
}

function scoreWind(config: GameConfig, windMph: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  let pts: number;
  if (config.windPref === 'calm') {
    pts = windMph <= 5 ? 25 : windMph <= 10 ? 18 : windMph <= 15 ? 10 : 3;
  } else if (config.windPref === 'light') {
    pts = windMph >= 3 && windMph <= 12 ? 25 : windMph <= 3 ? 18 : windMph <= 20 ? 10 : 3;
  } else {
    // moderate — ducks prefer wind to push birds
    pts = windMph >= 10 && windMph <= 25 ? 25 : windMph >= 5 ? 15 : 8;
  }
  const impact = pts >= 20 ? 'positive' : pts <= 8 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(windMph)} mph`, impact };
}

function scorePressure(config: GameConfig, hPa: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  const cls = classifyPressure(hPa);
  let pts = 10; // baseline

  if (config.pressurePref === 'falling') {
    // Low pressure = animals feed heavily before storms
    if (cls === 'low') pts = 20;
    else if (cls === 'normal') pts = 12;
    else pts = 5;
  } else if (config.pressurePref === 'rising') {
    if (cls === 'high') pts = 20;
    else if (cls === 'normal') pts = 12;
    else pts = 5;
  } else {
    pts = 12; // 'any'
  }

  const impact = pts >= 16 ? 'positive' : pts <= 7 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(hPa)} hPa (${cls})`, impact };
}

function scoreTemperature(config: GameConfig, tempF: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  const [lo, hi] = config.optimalTempRange;

  let pts: number;
  if (tempF >= lo && tempF <= hi) {
    pts = 20;
  } else {
    const dist = tempF < lo ? lo - tempF : tempF - hi;
    pts = Math.max(0, Math.round(18 - dist * 0.6));
  }

  const impact = pts >= 16 ? 'positive' : pts <= 7 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(tempF)}°F (optimal ${lo}-${hi}°F)`, impact };
}

function scoreMoonPhase(config: GameConfig, solunarRating: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  // For deer: new moon = more dawn/dusk movement (less night feeding).
  // So LOWER solunar rating (quarter moons) = less moonlight = more daytime feeding.
  // For deer/elk, we invert slightly: dark skies push activity into shooting hours.
  let effectiveRating: number;
  if (config.moonSensitivity >= 0.7) {
    // Deer/elk: dark moon nights = more daytime movement
    // Bright full moon = nocturnal feeding = less daytime activity
    effectiveRating = 100 - solunarRating * 0.4; // dampened inverse
  } else {
    effectiveRating = 50; // low sensitivity species
  }

  const pts = Math.round((effectiveRating / 100) * 20 * config.moonSensitivity);
  const impact = pts >= 12 ? 'positive' : pts <= 5 ? 'negative' : 'neutral';
  return { pts, label: `Solunar ${solunarRating}/100`, impact };
}

function scorePrecip(config: GameConfig, precipMm: number, precipProb: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  let pts = 5; // baseline

  if (config.rainPref === 'light') {
    if (precipMm > 0 && precipMm < 3 && precipProb > 20) pts = 10; // light rain covers sound
    else if (precipMm >= 5) pts = 2; // heavy rain = animals bed down
    else pts = 5;
  } else if (config.rainPref === 'none') {
    if (precipProb < 20) pts = 10;
    else if (precipMm >= 3) pts = 1;
    else pts = 5;
  } else {
    // 'any' (duck)
    pts = 7;
  }

  const label = precipProb > 0 ? `${precipProb}% chance, ${precipMm.toFixed(1)}mm` : 'None expected';
  const impact = pts >= 8 ? 'positive' : pts <= 3 ? 'negative' : 'neutral';
  return { pts, label, impact };
}

function scoreCloudCover(config: GameConfig, cloudPct: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  let pts: number;
  if (config.cloudPref === 'overcast') {
    pts = cloudPct >= 60 ? 5 : cloudPct >= 30 ? 3 : 1;
  } else if (config.cloudPref === 'clear') {
    pts = cloudPct <= 30 ? 5 : cloudPct <= 60 ? 3 : 1;
  } else {
    pts = 3;
  }
  const impact = pts >= 4 ? 'positive' : pts <= 2 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(cloudPct)}% cloud cover`, impact };
}

function activityRating(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

function generateTips(species: GameSpecies, score: number, tempF: number, windMph: number, pressure: number): string[] {
  const tips: string[] = [];
  const config = gameConfigs[species];

  if (species === 'whitetail') {
    if (classifyPressure(pressure) === 'low') {
      tips.push('Falling pressure triggers heavy feeding — sit your best stand all day.');
    }
    if (tempF < 35) tips.push('Cold snap — deer will be moving. Focus on food sources.');
    if (windMph > 15) tips.push('High winds — hunt protected valleys and lee sides of ridges.');
  }

  if (species === 'duck') {
    if (windMph >= 10) tips.push('Good wind for decoying — set up crosswind spreads.');
    if (tempF < 35) tips.push('Cold front pushing birds — expect good migration activity.');
    if (classifyPressure(pressure) === 'low') tips.push('Storm front approaching — ducks feed aggressively before weather moves in.');
  }

  if (species === 'turkey') {
    if (windMph < 8 && tempF >= 40) tips.push('Calm morning — gobblers should be vocal. Set up early.');
    if (classifyPressure(pressure) === 'high') tips.push('High pressure = predictable roost-to-feed patterns.');
    if (tempF > 65) tips.push('Warm day — turkeys may go quiet midday. Focus on early morning.');
  }

  if (species === 'elk') {
    if (classifyPressure(pressure) === 'low') tips.push('Pressure dropping — elk feed heavily in meadows before storms.');
    if (tempF < 30) tips.push('Cold conditions — glass south-facing slopes in early morning.');
    if (windMph <= 10) tips.push('Light winds — use thermals to plan your approach.');
  }

  if (score >= 80) {
    tips.push('Outstanding conditions — make the most of your time afield!');
  } else if (score < 40) {
    tips.push('Tough conditions — focus on known bedding areas and travel corridors.');
  }

  return tips.slice(0, 3);
}

export function calculateHuntForecast(
  forecast: ForecastPoint,
  solunar: SolunarData,
  species: GameSpecies
): HuntForecast {
  const config = gameConfigs[species];

  const wind = scoreWind(config, forecast.windSpeedMph);
  const pressure = scorePressure(config, forecast.pressure);
  const temp = scoreTemperature(config, forecast.tempF);
  const moon = scoreMoonPhase(config, solunar.rating);
  const precip = scorePrecip(config, forecast.precipMm, forecast.precipProbability);
  const cloud = scoreCloudCover(config, forecast.cloudCover);

  const rawScore = wind.pts + pressure.pts + temp.pts + moon.pts + precip.pts + cloud.pts;
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    species,
    score,
    activityRating: activityRating(score),
    bestTimes: solunar.periods,
    keyFactors: [
      { label: 'Wind', value: wind.label, impact: wind.impact },
      { label: 'Pressure', value: pressure.label, impact: pressure.impact },
      { label: 'Temperature', value: temp.label, impact: temp.impact },
      { label: 'Moon Phase', value: moon.label, impact: moon.impact },
      { label: 'Precipitation', value: precip.label, impact: precip.impact },
      { label: 'Cloud Cover', value: cloud.label, impact: cloud.impact },
    ],
    tips: generateTips(species, score, forecast.tempF, forecast.windSpeedMph, forecast.pressure),
  };
}

export function getAllHuntForecasts(forecast: ForecastPoint, solunar: SolunarData): HuntForecast[] {
  const allSpecies: GameSpecies[] = ['whitetail', 'duck', 'turkey', 'elk'];
  return allSpecies.map(s => calculateHuntForecast(forecast, solunar, s));
}

export { gameConfigs as huntSpeciesConfigs };
