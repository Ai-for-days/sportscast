import type { ForecastPoint, GameSpecies, HuntForecast, SolunarData } from './types';

interface GameConfig {
  label: string;
  optimalTempRange: [number, number];
  windPref: 'calm' | 'light' | 'moderate';
  pressurePref: 'falling' | 'rising' | 'any';
  moonSensitivity: number;
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
  moose: {
    label: 'Moose',
    optimalTempRange: [10, 40],
    windPref: 'calm',
    pressurePref: 'falling',
    moonSensitivity: 0.8,
    rainPref: 'light',
    cloudPref: 'overcast',
  },
  mule_deer: {
    label: 'Mule Deer',
    optimalTempRange: [25, 55],
    windPref: 'light',
    pressurePref: 'falling',
    moonSensitivity: 0.85,
    rainPref: 'light',
    cloudPref: 'any',
  },
  wild_boar: {
    label: 'Wild Hog',
    optimalTempRange: [40, 70],
    windPref: 'calm',
    pressurePref: 'any',
    moonSensitivity: 0.6,
    rainPref: 'any',
    cloudPref: 'overcast',
  },
  pheasant: {
    label: 'Pheasant',
    optimalTempRange: [25, 50],
    windPref: 'light',
    pressurePref: 'rising',
    moonSensitivity: 0.2,
    rainPref: 'none',
    cloudPref: 'clear',
  },
};

// --- Region mapping ---

type Region =
  | 'northeast' | 'southeast' | 'midwest' | 'great_plains'
  | 'mountain_west' | 'southwest' | 'pacific_northwest' | 'california'
  | 'alaska' | 'hawaii' | 'gulf_coast';

const stateToRegion: Record<string, Region> = {
  'Connecticut': 'northeast', 'Delaware': 'northeast', 'Maine': 'northeast',
  'Maryland': 'northeast', 'Massachusetts': 'northeast', 'New Hampshire': 'northeast',
  'New Jersey': 'northeast', 'New York': 'northeast', 'Pennsylvania': 'northeast',
  'Rhode Island': 'northeast', 'Vermont': 'northeast', 'District of Columbia': 'northeast',
  'Virginia': 'southeast', 'West Virginia': 'southeast', 'Kentucky': 'southeast',
  'Tennessee': 'southeast', 'North Carolina': 'southeast', 'South Carolina': 'southeast',
  'Georgia': 'southeast', 'Alabama': 'southeast', 'Mississippi': 'southeast',
  'Arkansas': 'southeast', 'Florida': 'southeast',
  'Louisiana': 'gulf_coast',
  'Ohio': 'midwest', 'Indiana': 'midwest', 'Illinois': 'midwest',
  'Michigan': 'midwest', 'Wisconsin': 'midwest', 'Minnesota': 'midwest',
  'Iowa': 'midwest', 'Missouri': 'midwest',
  'North Dakota': 'great_plains', 'South Dakota': 'great_plains',
  'Nebraska': 'great_plains', 'Kansas': 'great_plains', 'Oklahoma': 'great_plains',
  'Montana': 'mountain_west', 'Wyoming': 'mountain_west', 'Idaho': 'mountain_west',
  'Colorado': 'mountain_west', 'Utah': 'mountain_west', 'Nevada': 'mountain_west',
  'Arizona': 'southwest', 'New Mexico': 'southwest', 'Texas': 'southwest',
  'Oregon': 'pacific_northwest', 'Washington': 'pacific_northwest',
  'California': 'california',
  'Alaska': 'alaska',
  'Hawaii': 'hawaii',
};

const regionGameSpecies: Record<Region, GameSpecies[]> = {
  northeast:        ['whitetail', 'turkey', 'duck', 'moose', 'wild_boar'],
  southeast:        ['whitetail', 'turkey', 'duck', 'wild_boar'],
  gulf_coast:       ['whitetail', 'duck', 'turkey', 'wild_boar'],
  midwest:          ['whitetail', 'turkey', 'duck', 'pheasant', 'wild_boar'],
  great_plains:     ['whitetail', 'mule_deer', 'turkey', 'duck', 'pheasant', 'wild_boar'],
  mountain_west:    ['elk', 'mule_deer', 'moose', 'duck', 'turkey'],
  southwest:        ['whitetail', 'mule_deer', 'turkey', 'duck', 'wild_boar', 'elk'],
  pacific_northwest:['elk', 'mule_deer', 'duck', 'turkey', 'wild_boar'],
  california:       ['mule_deer', 'duck', 'turkey', 'wild_boar', 'elk'],
  alaska:           ['moose', 'elk', 'duck'],
  hawaii:           ['wild_boar'],
};

// --- Season data (months when hunting is open, by region) ---
// Months are 1-12. Year-round = [1,2,3,4,5,6,7,8,9,10,11,12]

const ALL_YEAR = [1,2,3,4,5,6,7,8,9,10,11,12];

const regionSeasons: Record<Region, Partial<Record<GameSpecies, number[]>>> = {
  northeast: {
    whitetail: [9,10,11,12,1],
    turkey:    [4,5,10,11],
    duck:      [10,11,12,1],
    moose:     [9,10],
    wild_boar: ALL_YEAR,
  },
  southeast: {
    whitetail: [9,10,11,12,1,2],
    turkey:    [3,4,5,10,11],
    duck:      [10,11,12,1],
    wild_boar: ALL_YEAR,
  },
  gulf_coast: {
    whitetail: [9,10,11,12,1,2],
    duck:      [11,12,1],
    turkey:    [3,4,5,10,11],
    wild_boar: ALL_YEAR,
  },
  midwest: {
    whitetail: [9,10,11,12,1],
    turkey:    [4,5,10,11],
    duck:      [10,11,12],
    pheasant:  [10,11,12,1],
    wild_boar: ALL_YEAR,
  },
  great_plains: {
    whitetail: [9,10,11,12,1],
    mule_deer: [10,11,12],
    turkey:    [4,5,10,11],
    duck:      [10,11,12,1],
    pheasant:  [11,12,1],
    wild_boar: ALL_YEAR,
  },
  mountain_west: {
    elk:       [8,9,10,11],
    mule_deer: [9,10,11],
    moose:     [9,10],
    duck:      [10,11,12,1],
    turkey:    [4,5,9,10,11],
  },
  southwest: {
    whitetail: [10,11,12,1,2],
    mule_deer: [10,11,12,1],
    turkey:    [4,5,11],
    duck:      [10,11,12,1],
    wild_boar: ALL_YEAR,
    elk:       [9,10,11],
  },
  pacific_northwest: {
    elk:       [9,10,11],
    mule_deer: [9,10,11],
    duck:      [10,11,12,1],
    turkey:    [4,5,9,10,11],
    wild_boar: ALL_YEAR,
  },
  california: {
    mule_deer: [8,9,10,11],
    duck:      [10,11,12,1],
    turkey:    [3,4,5,11],
    wild_boar: ALL_YEAR,
    elk:       [8,9],
  },
  alaska: {
    moose:     [8,9,10,11],
    elk:       [8,9,10,11],
    duck:      [9,10,11,12,1],
  },
  hawaii: {
    wild_boar: ALL_YEAR,
  },
};

const defaultGameSpecies: GameSpecies[] = ['whitetail', 'duck', 'turkey', 'elk'];

export function getGameSpeciesForState(state: string): GameSpecies[] {
  const region = stateToRegion[state];
  if (!region) return defaultGameSpecies;
  return regionGameSpecies[region];
}

function isInSeason(species: GameSpecies, state: string, month: number): boolean {
  const region = stateToRegion[state];
  if (!region) return true; // unknown region — assume in season
  const seasons = regionSeasons[region]?.[species];
  if (!seasons) return true; // no season data — assume in season
  return seasons.includes(month);
}

// --- Scoring functions ---

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
    pts = windMph >= 10 && windMph <= 25 ? 25 : windMph >= 5 ? 15 : 8;
  }
  const impact = pts >= 20 ? 'positive' : pts <= 8 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(windMph)} mph`, impact };
}

function scorePressure(config: GameConfig, hPa: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  const cls = classifyPressure(hPa);
  let pts = 10;
  if (config.pressurePref === 'falling') {
    if (cls === 'low') pts = 20; else if (cls === 'normal') pts = 12; else pts = 5;
  } else if (config.pressurePref === 'rising') {
    if (cls === 'high') pts = 20; else if (cls === 'normal') pts = 12; else pts = 5;
  } else {
    pts = 12;
  }
  const impact = pts >= 16 ? 'positive' : pts <= 7 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(hPa)} hPa (${cls})`, impact };
}

function scoreTemperature(config: GameConfig, tempF: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  const [lo, hi] = config.optimalTempRange;
  let pts: number;
  if (tempF >= lo && tempF <= hi) { pts = 20; }
  else { const dist = tempF < lo ? lo - tempF : tempF - hi; pts = Math.max(0, Math.round(18 - dist * 0.6)); }
  const impact = pts >= 16 ? 'positive' : pts <= 7 ? 'negative' : 'neutral';
  return { pts, label: `${Math.round(tempF)}°F (optimal ${lo}-${hi}°F)`, impact };
}

function scoreMoonPhase(config: GameConfig, solunarRating: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  let effectiveRating: number;
  if (config.moonSensitivity >= 0.7) {
    effectiveRating = 100 - solunarRating * 0.4;
  } else {
    effectiveRating = 50;
  }
  const pts = Math.round((effectiveRating / 100) * 20 * config.moonSensitivity);
  const impact = pts >= 12 ? 'positive' : pts <= 5 ? 'negative' : 'neutral';
  return { pts, label: `Solunar ${solunarRating}/100`, impact };
}

function scorePrecip(config: GameConfig, precipMm: number, precipProb: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  let pts = 5;
  if (config.rainPref === 'light') {
    if (precipMm > 0 && precipMm < 3 && precipProb > 20) pts = 10;
    else if (precipMm >= 5) pts = 2; else pts = 5;
  } else if (config.rainPref === 'none') {
    if (precipProb < 20) pts = 10; else if (precipMm >= 3) pts = 1; else pts = 5;
  } else { pts = 7; }
  const label = precipProb > 0 ? `${precipProb}% chance, ${precipMm.toFixed(1)}mm` : 'None expected';
  const impact = pts >= 8 ? 'positive' : pts <= 3 ? 'negative' : 'neutral';
  return { pts, label, impact };
}

function scoreCloudCover(config: GameConfig, cloudPct: number): { pts: number; label: string; impact: 'positive' | 'neutral' | 'negative' } {
  let pts: number;
  if (config.cloudPref === 'overcast') { pts = cloudPct >= 60 ? 5 : cloudPct >= 30 ? 3 : 1; }
  else if (config.cloudPref === 'clear') { pts = cloudPct <= 30 ? 5 : cloudPct <= 60 ? 3 : 1; }
  else { pts = 3; }
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

  if (species === 'whitetail') {
    if (classifyPressure(pressure) === 'low') tips.push('Falling pressure triggers heavy feeding — sit your best stand all day.');
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
  if (species === 'moose') {
    if (tempF < 30) tips.push('Cold temps get moose moving — check willow flats and creek bottoms.');
    if (classifyPressure(pressure) === 'low') tips.push('Dropping pressure — moose feed actively before storms.');
    if (windMph < 8) tips.push('Calm conditions — cow calls carry well. Try calling near cover.');
  }
  if (species === 'mule_deer') {
    if (classifyPressure(pressure) === 'low') tips.push('Falling barometer moves muleys off ridges to feed — glass transition zones.');
    if (tempF < 35) tips.push('Cold snap pushes mule deer to south-facing slopes for warmth.');
    if (windMph > 12) tips.push('Breezy — mule deer bed in sheltered draws. Glass from a distance.');
  }
  if (species === 'wild_boar') {
    if (tempF >= 40 && tempF <= 60) tips.push('Moderate temps — hogs will be active at dawn and dusk.');
    tips.push('Hogs are most active in low-light hours — focus on feeders and wallows.');
  }
  if (species === 'pheasant') {
    if (windMph >= 5 && windMph <= 15) tips.push('Light wind — birds hold tight in cover, great for dogs.');
    if (classifyPressure(pressure) === 'high') tips.push('High pressure = birds feeding in crop fields early morning.');
    if (tempF < 30) tips.push('Cold weather concentrates pheasants near food and thick cover.');
  }

  if (score >= 80) tips.push('Outstanding conditions — make the most of your time afield!');
  else if (score < 40) tips.push('Tough conditions — focus on known bedding areas and travel corridors.');

  return tips.slice(0, 3);
}

export function calculateHuntForecast(
  forecast: ForecastPoint, solunar: SolunarData, species: GameSpecies, state: string, month: number
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
    species, score,
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
    inSeason: isInSeason(species, state, month),
  };
}

export function getAllHuntForecasts(forecast: ForecastPoint, solunar: SolunarData, state: string, month: number): HuntForecast[] {
  const species = getGameSpeciesForState(state);
  return species.map(s => calculateHuntForecast(forecast, solunar, s, state, month));
}

export { gameConfigs as huntSpeciesConfigs };
