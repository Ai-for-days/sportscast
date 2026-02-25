import type {
  ForecastPoint,
  DailyForecast,
  AllergyData,
  AllergenSpecies,
  AllergyDayForecast,
  WeatherAdjustment,
  AllergyLevel,
  AllergenCategory,
} from './types';

// ─── Region definitions ───────────────────────────────────────────────

type Region = 'southeast' | 'northeast' | 'midwest' | 'southwest' | 'west_coast' | 'mountain_nw';

const regionLabels: Record<Region, string> = {
  southeast: 'Southeast',
  northeast: 'Northeast',
  midwest: 'Midwest',
  southwest: 'Southwest',
  west_coast: 'West Coast',
  mountain_nw: 'Mountain / Northwest',
};

const stateToRegion: Record<string, Region> = {
  // Southeast
  AL: 'southeast', AR: 'southeast', FL: 'southeast', GA: 'southeast',
  KY: 'southeast', LA: 'southeast', MS: 'southeast', NC: 'southeast',
  SC: 'southeast', TN: 'southeast', VA: 'southeast', WV: 'southeast',
  // Northeast
  CT: 'northeast', DE: 'northeast', DC: 'northeast', ME: 'northeast',
  MD: 'northeast', MA: 'northeast', NH: 'northeast', NJ: 'northeast',
  NY: 'northeast', PA: 'northeast', RI: 'northeast', VT: 'northeast',
  // Midwest
  IA: 'midwest', IL: 'midwest', IN: 'midwest', KS: 'midwest',
  MI: 'midwest', MN: 'midwest', MO: 'midwest', ND: 'midwest',
  NE: 'midwest', OH: 'midwest', OK: 'midwest', SD: 'midwest',
  WI: 'midwest', TX: 'midwest',
  // Southwest
  AZ: 'southwest', NM: 'southwest', NV: 'southwest', UT: 'southwest',
  // West Coast
  CA: 'west_coast', HI: 'west_coast',
  // Mountain / Northwest
  AK: 'mountain_nw', CO: 'mountain_nw', ID: 'mountain_nw', MT: 'mountain_nw',
  OR: 'mountain_nw', WA: 'mountain_nw', WY: 'mountain_nw',
};

// ─── Species calendars per region ─────────────────────────────────────
// Each entry: [name, category, icon, ...12 monthly levels (0-4), peakMonths[]]
// 0=none, 1=low, 2=moderate, 3=high, 4=very high

type SpeciesEntry = {
  name: string;
  category: AllergenCategory;
  icon: string;
  months: number[];   // 12 values, index 0 = January
  peakMonths: number[]; // 0-indexed months where species peaks
};

const regionCalendars: Record<Region, SpeciesEntry[]> = {
  southeast: [
    { name: 'Oak',             category: 'tree',    icon: '🌳', months: [0,1,3,4,4,2,0,0,0,0,0,0], peakMonths: [2,3,4] },
    { name: 'Pine',            category: 'tree',    icon: '🌲', months: [0,1,3,4,3,1,0,0,0,0,0,0], peakMonths: [2,3] },
    { name: 'Cedar / Juniper', category: 'tree',    icon: '🌿', months: [3,4,3,1,0,0,0,0,0,0,1,2], peakMonths: [0,1] },
    { name: 'Sweetgum',        category: 'tree',    icon: '🍂', months: [0,0,2,3,3,1,0,0,0,0,0,0], peakMonths: [3,4] },
    { name: 'Birch',           category: 'tree',    icon: '🌳', months: [0,0,2,3,2,0,0,0,0,0,0,0], peakMonths: [3] },
    { name: 'Bermuda Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,1,2,3,4,4,3,1,0,0], peakMonths: [5,6,7] },
    { name: 'Bahia Grass',     category: 'grass',   icon: '🌾', months: [0,0,0,0,2,3,3,3,2,0,0,0], peakMonths: [5,6,7] },
    { name: 'Johnson Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,1,2,3,3,2,1,0,0,0], peakMonths: [5,6] },
    { name: 'Ragweed',         category: 'weed',    icon: '🥀', months: [0,0,0,0,0,0,1,3,4,4,2,0], peakMonths: [8,9] },
    { name: 'Pigweed',         category: 'weed',    icon: '🌱', months: [0,0,0,0,0,1,2,3,3,2,0,0], peakMonths: [7,8] },
    { name: 'Dock / Sorrel',   category: 'weed',    icon: '🌱', months: [0,0,1,2,3,2,1,0,0,0,0,0], peakMonths: [4] },
    { name: 'Alternaria',      category: 'mold',    icon: '🍄', months: [1,1,2,2,3,3,4,4,3,2,1,1], peakMonths: [6,7] },
    { name: 'Cladosporium',    category: 'mold',    icon: '🍄', months: [1,1,2,2,3,3,3,3,3,2,1,1], peakMonths: [5,6,7] },
    { name: 'Dust Mites',      category: 'indoor',  icon: '🏠', months: [3,3,2,2,2,2,3,3,3,3,3,3], peakMonths: [0,1,6,7,8,9,10,11] },
    { name: 'Pet Dander',      category: 'indoor',  icon: '🐾', months: [3,3,2,1,1,1,1,1,2,2,3,3], peakMonths: [0,1,10,11] },
  ],
  northeast: [
    { name: 'Birch',           category: 'tree',    icon: '🌳', months: [0,0,1,3,4,2,0,0,0,0,0,0], peakMonths: [4] },
    { name: 'Oak',             category: 'tree',    icon: '🌳', months: [0,0,0,2,4,3,1,0,0,0,0,0], peakMonths: [4] },
    { name: 'Maple',           category: 'tree',    icon: '🍁', months: [0,0,2,3,3,1,0,0,0,0,0,0], peakMonths: [3,4] },
    { name: 'Elm',             category: 'tree',    icon: '🌳', months: [0,1,3,3,2,0,0,0,0,0,0,0], peakMonths: [2,3] },
    { name: 'Ash',             category: 'tree',    icon: '🌳', months: [0,0,1,3,3,1,0,0,0,0,0,0], peakMonths: [3,4] },
    { name: 'Timothy Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,0,2,3,4,3,1,0,0,0], peakMonths: [6] },
    { name: 'Orchard Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,0,2,3,3,2,1,0,0,0], peakMonths: [5,6] },
    { name: 'Kentucky Bluegrass', category: 'grass', icon: '🌾', months: [0,0,0,0,2,3,3,2,0,0,0,0], peakMonths: [5,6] },
    { name: 'Ragweed',         category: 'weed',    icon: '🥀', months: [0,0,0,0,0,0,0,2,4,4,1,0], peakMonths: [8,9] },
    { name: 'Nettle',          category: 'weed',    icon: '🌱', months: [0,0,0,0,1,2,3,3,2,0,0,0], peakMonths: [6,7] },
    { name: 'Plantain',        category: 'weed',    icon: '🌱', months: [0,0,0,1,2,2,2,2,1,0,0,0], peakMonths: [4,5] },
    { name: 'Cladosporium',    category: 'mold',    icon: '🍄', months: [0,0,1,2,3,3,4,4,3,2,1,0], peakMonths: [6,7] },
    { name: 'Alternaria',      category: 'mold',    icon: '🍄', months: [0,0,1,1,2,3,3,4,3,2,0,0], peakMonths: [7] },
    { name: 'Dust Mites',      category: 'indoor',  icon: '🏠', months: [3,3,2,2,1,1,2,2,2,2,3,3], peakMonths: [0,1,10,11] },
    { name: 'Pet Dander',      category: 'indoor',  icon: '🐾', months: [3,3,2,1,1,1,1,1,1,2,3,3], peakMonths: [0,1,10,11] },
  ],
  midwest: [
    { name: 'Oak',             category: 'tree',    icon: '🌳', months: [0,0,1,3,4,3,1,0,0,0,0,0], peakMonths: [4] },
    { name: 'Elm',             category: 'tree',    icon: '🌳', months: [0,1,3,3,2,0,0,0,0,0,0,0], peakMonths: [2,3] },
    { name: 'Cottonwood',      category: 'tree',    icon: '🌳', months: [0,0,1,2,3,4,2,0,0,0,0,0], peakMonths: [5] },
    { name: 'Maple',           category: 'tree',    icon: '🍁', months: [0,0,2,3,3,1,0,0,0,0,0,0], peakMonths: [3,4] },
    { name: 'Mulberry',        category: 'tree',    icon: '🌳', months: [0,0,1,3,4,2,0,0,0,0,0,0], peakMonths: [4] },
    { name: 'Timothy Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,0,2,3,4,3,1,0,0,0], peakMonths: [6] },
    { name: 'Bermuda Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,0,1,2,3,3,2,1,0,0], peakMonths: [6,7] },
    { name: 'Orchard Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,0,2,3,3,2,1,0,0,0], peakMonths: [5,6] },
    { name: 'Ragweed',         category: 'weed',    icon: '🥀', months: [0,0,0,0,0,0,0,2,4,4,2,0], peakMonths: [8,9] },
    { name: 'Pigweed',         category: 'weed',    icon: '🌱', months: [0,0,0,0,0,1,2,3,3,1,0,0], peakMonths: [7,8] },
    { name: 'Lamb\'s Quarters', category: 'weed',   icon: '🌱', months: [0,0,0,0,1,2,3,3,2,1,0,0], peakMonths: [6,7] },
    { name: 'Alternaria',      category: 'mold',    icon: '🍄', months: [0,0,1,1,2,3,4,4,3,2,1,0], peakMonths: [6,7] },
    { name: 'Cladosporium',    category: 'mold',    icon: '🍄', months: [0,0,1,2,2,3,3,3,3,2,1,0], peakMonths: [5,6,7] },
    { name: 'Dust Mites',      category: 'indoor',  icon: '🏠', months: [3,3,2,2,1,1,2,2,2,3,3,3], peakMonths: [0,1,10,11] },
    { name: 'Pet Dander',      category: 'indoor',  icon: '🐾', months: [3,3,2,1,1,1,1,1,1,2,3,3], peakMonths: [0,1,10,11] },
  ],
  southwest: [
    { name: 'Juniper / Cedar', category: 'tree',    icon: '🌿', months: [3,4,4,2,1,0,0,0,0,0,1,2], peakMonths: [1,2] },
    { name: 'Mesquite',        category: 'tree',    icon: '🌳', months: [0,0,1,2,3,3,2,1,0,0,0,0], peakMonths: [4,5] },
    { name: 'Mulberry',        category: 'tree',    icon: '🌳', months: [0,1,3,4,3,1,0,0,0,0,0,0], peakMonths: [3] },
    { name: 'Olive',           category: 'tree',    icon: '🫒', months: [0,0,1,3,4,2,0,0,0,0,0,0], peakMonths: [4] },
    { name: 'Palo Verde',      category: 'tree',    icon: '🌳', months: [0,0,1,3,4,2,0,0,0,0,0,0], peakMonths: [4] },
    { name: 'Bermuda Grass',   category: 'grass',   icon: '🌾', months: [0,0,1,2,3,4,4,4,3,2,1,0], peakMonths: [5,6,7] },
    { name: 'Rye Grass',       category: 'grass',   icon: '🌾', months: [1,2,3,3,2,0,0,0,0,1,2,1], peakMonths: [2,3] },
    { name: 'Sagebrush',       category: 'weed',    icon: '🌿', months: [0,0,0,0,0,0,0,2,4,4,2,0], peakMonths: [8,9] },
    { name: 'Ragweed',         category: 'weed',    icon: '🥀', months: [0,0,0,0,0,0,0,2,3,3,1,0], peakMonths: [8,9] },
    { name: 'Russian Thistle', category: 'weed',    icon: '🌵', months: [0,0,0,0,0,1,2,3,3,2,0,0], peakMonths: [7,8] },
    { name: 'Saltbush',        category: 'weed',    icon: '🌱', months: [0,0,0,0,0,0,1,2,3,2,1,0], peakMonths: [8] },
    { name: 'Aspergillus',     category: 'mold',    icon: '🍄', months: [1,1,1,1,2,2,3,3,3,2,1,1], peakMonths: [6,7,8] },
    { name: 'Cladosporium',    category: 'mold',    icon: '🍄', months: [1,1,1,2,2,3,3,3,2,2,1,1], peakMonths: [5,6,7] },
    { name: 'Dust Mites',      category: 'indoor',  icon: '🏠', months: [2,2,2,2,2,2,3,3,3,2,2,2], peakMonths: [6,7,8] },
    { name: 'Pet Dander',      category: 'indoor',  icon: '🐾', months: [3,3,2,1,1,1,1,1,1,2,3,3], peakMonths: [0,1,10,11] },
  ],
  west_coast: [
    { name: 'Oak',             category: 'tree',    icon: '🌳', months: [0,1,3,4,4,2,0,0,0,0,0,0], peakMonths: [3,4] },
    { name: 'Alder',           category: 'tree',    icon: '🌳', months: [2,3,3,2,0,0,0,0,0,0,0,1], peakMonths: [1,2] },
    { name: 'Cypress',         category: 'tree',    icon: '🌲', months: [2,3,3,2,0,0,0,0,0,0,0,1], peakMonths: [1,2] },
    { name: 'Eucalyptus',      category: 'tree',    icon: '🌳', months: [1,2,2,1,1,1,1,1,1,1,1,1], peakMonths: [1,2] },
    { name: 'Olive',           category: 'tree',    icon: '🫒', months: [0,0,1,3,4,3,1,0,0,0,0,0], peakMonths: [4] },
    { name: 'Bermuda Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,1,2,3,4,4,3,2,0,0], peakMonths: [6,7] },
    { name: 'Rye Grass',       category: 'grass',   icon: '🌾', months: [0,1,2,3,3,2,1,0,0,0,1,0], peakMonths: [3,4] },
    { name: 'Timothy Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,1,2,3,3,2,1,0,0,0], peakMonths: [5,6] },
    { name: 'Ragweed',         category: 'weed',    icon: '🥀', months: [0,0,0,0,0,0,0,1,3,3,1,0], peakMonths: [8,9] },
    { name: 'Sagebrush',       category: 'weed',    icon: '🌿', months: [0,0,0,0,0,0,0,2,3,3,1,0], peakMonths: [8,9] },
    { name: 'Nettle',          category: 'weed',    icon: '🌱', months: [0,0,1,2,3,3,2,1,0,0,0,0], peakMonths: [4,5] },
    { name: 'Cladosporium',    category: 'mold',    icon: '🍄', months: [1,1,2,2,3,3,3,3,3,2,1,1], peakMonths: [5,6,7,8] },
    { name: 'Alternaria',      category: 'mold',    icon: '🍄', months: [0,0,1,2,2,3,3,4,3,2,1,0], peakMonths: [7] },
    { name: 'Dust Mites',      category: 'indoor',  icon: '🏠', months: [3,3,2,1,1,1,2,2,2,2,3,3], peakMonths: [0,1,10,11] },
    { name: 'Pet Dander',      category: 'indoor',  icon: '🐾', months: [3,3,2,1,1,1,1,1,1,2,3,3], peakMonths: [0,1,10,11] },
  ],
  mountain_nw: [
    { name: 'Alder',           category: 'tree',    icon: '🌳', months: [0,1,3,3,2,0,0,0,0,0,0,0], peakMonths: [2,3] },
    { name: 'Birch',           category: 'tree',    icon: '🌳', months: [0,0,1,2,4,3,0,0,0,0,0,0], peakMonths: [4] },
    { name: 'Cottonwood',      category: 'tree',    icon: '🌳', months: [0,0,0,1,3,4,2,0,0,0,0,0], peakMonths: [5] },
    { name: 'Pine',            category: 'tree',    icon: '🌲', months: [0,0,0,1,2,3,3,1,0,0,0,0], peakMonths: [5,6] },
    { name: 'Juniper',         category: 'tree',    icon: '🌿', months: [1,2,3,3,2,0,0,0,0,0,0,0], peakMonths: [2,3] },
    { name: 'Timothy Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,0,1,3,4,3,1,0,0,0], peakMonths: [6] },
    { name: 'Orchard Grass',   category: 'grass',   icon: '🌾', months: [0,0,0,0,2,3,3,2,1,0,0,0], peakMonths: [5,6] },
    { name: 'Kentucky Bluegrass', category: 'grass', icon: '🌾', months: [0,0,0,0,2,3,3,2,0,0,0,0], peakMonths: [5,6] },
    { name: 'Ragweed',         category: 'weed',    icon: '🥀', months: [0,0,0,0,0,0,0,2,3,3,1,0], peakMonths: [8,9] },
    { name: 'Sagebrush',       category: 'weed',    icon: '🌿', months: [0,0,0,0,0,0,1,3,4,3,1,0], peakMonths: [8] },
    { name: 'Russian Thistle', category: 'weed',    icon: '🌵', months: [0,0,0,0,0,0,1,2,3,2,0,0], peakMonths: [8] },
    { name: 'Cladosporium',    category: 'mold',    icon: '🍄', months: [0,0,1,1,2,3,3,3,3,2,1,0], peakMonths: [5,6,7,8] },
    { name: 'Alternaria',      category: 'mold',    icon: '🍄', months: [0,0,0,1,2,2,3,3,3,2,0,0], peakMonths: [6,7,8] },
    { name: 'Dust Mites',      category: 'indoor',  icon: '🏠', months: [3,3,2,2,1,1,1,1,2,2,3,3], peakMonths: [0,1,10,11] },
    { name: 'Pet Dander',      category: 'indoor',  icon: '🐾', months: [3,3,2,1,1,1,1,1,1,2,3,3], peakMonths: [0,1,10,11] },
  ],
};

// ─── Level helpers ────────────────────────────────────────────────────

const levelLabels: AllergyLevel[] = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];

function numToLevel(n: number): AllergyLevel {
  const clamped = Math.max(0, Math.min(4, Math.round(n)));
  return levelLabels[clamped];
}

function levelToLegacy(level: AllergyLevel): string {
  if (level === 'Very Low') return 'Low';
  return level;
}

function scoreToLevel(score: number): AllergyLevel {
  if (score < 15) return 'Very Low';
  if (score < 35) return 'Low';
  if (score < 55) return 'Moderate';
  if (score < 75) return 'High';
  return 'Very High';
}

// ─── Weather adjustment logic ─────────────────────────────────────────

interface WeatherFactors {
  windSpeedMph: number;
  precipMm: number;
  humidity: number;
  tempF: number;
  dewPointF: number;
}

function adjustLevel(baseline: number, category: AllergenCategory, weather: WeatherFactors): number {
  if (baseline <= 0) return 0;

  let adj = baseline;

  if (category === 'mold') {
    // Mold loves moisture
    if (weather.humidity >= 80) adj += 1;
    else if (weather.humidity >= 70) adj += 0.5;
    if (weather.dewPointF >= 65) adj += 0.5;
    if (weather.precipMm >= 2) adj += 0.5; // damp surfaces
    if (weather.humidity < 40) adj -= 0.5;
  } else if (category === 'indoor') {
    // Indoor allergens: worse when sealed up (cold/hot)
    if (weather.tempF < 40) adj += 0.5;
    if (weather.tempF > 90) adj += 0.5;
    // Rain keeps people indoors
    if (weather.precipMm >= 5) adj += 0.5;
  } else {
    // Pollen (tree, grass, weed)
    if (weather.windSpeedMph >= 20) adj += 1;
    else if (weather.windSpeedMph >= 12) adj += 0.5;

    if (weather.precipMm >= 5) adj -= 1.5;
    else if (weather.precipMm >= 2) adj -= 0.75;

    if (weather.humidity >= 80) adj -= 0.5; // dampens pollen grains
    else if (weather.humidity < 30) adj += 0.25; // dry = more airborne

    if (weather.tempF >= 85) adj += 0.5;
    if (weather.tempF < 40) adj -= 0.5;
  }

  return Math.max(0, Math.min(4, adj));
}

function getWeatherAdjustments(weather: WeatherFactors): WeatherAdjustment[] {
  const adjustments: WeatherAdjustment[] = [];

  if (weather.windSpeedMph >= 20) {
    adjustments.push({ label: 'Strong Wind', value: `${weather.windSpeedMph} mph`, impact: 'increases' });
  } else if (weather.windSpeedMph >= 12) {
    adjustments.push({ label: 'Moderate Wind', value: `${weather.windSpeedMph} mph`, impact: 'increases' });
  }

  if (weather.precipMm >= 5) {
    adjustments.push({ label: 'Heavy Rain', value: `${weather.precipMm.toFixed(1)} mm`, impact: 'decreases' });
  } else if (weather.precipMm >= 2) {
    adjustments.push({ label: 'Light Rain', value: `${weather.precipMm.toFixed(1)} mm`, impact: 'decreases' });
  }

  if (weather.humidity >= 80) {
    adjustments.push({ label: 'High Humidity', value: `${weather.humidity}%`, impact: 'increases' });
  } else if (weather.humidity < 30) {
    adjustments.push({ label: 'Low Humidity', value: `${weather.humidity}%`, impact: 'increases' });
  }

  if (weather.tempF >= 85) {
    adjustments.push({ label: 'High Temperature', value: `${weather.tempF}°F`, impact: 'increases' });
  } else if (weather.tempF < 40) {
    adjustments.push({ label: 'Cold Temperature', value: `${weather.tempF}°F`, impact: 'decreases' });
  }

  if (weather.dewPointF >= 65) {
    adjustments.push({ label: 'High Dew Point', value: `${weather.dewPointF}°F`, impact: 'increases' });
  }

  return adjustments;
}

// ─── Scoring ──────────────────────────────────────────────────────────

function calculateOverallScore(species: AllergenSpecies[]): number {
  const active = species.filter(s => s.adjustedLevel > 0);
  if (active.length === 0) return 0;

  const maxLevel = Math.max(...active.map(s => s.adjustedLevel));
  const avgLevel = active.reduce((sum, s) => sum + s.adjustedLevel, 0) / active.length;

  // 60% weight on max severity, 40% on average
  const raw = (maxLevel * 0.6 + avgLevel * 0.4) / 4 * 100;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

// ─── Tips ─────────────────────────────────────────────────────────────

function generateTips(
  activeSpecies: AllergenSpecies[],
  weather: WeatherFactors,
  overallScore: number,
): string[] {
  const tips: string[] = [];

  if (overallScore < 15) {
    tips.push('Allergen levels are very low — great day for outdoor activities.');
    return tips;
  }

  const hasHighPollen = activeSpecies.some(s =>
    (s.category === 'tree' || s.category === 'grass' || s.category === 'weed') && s.adjustedLevel >= 3
  );
  const hasHighMold = activeSpecies.some(s => s.category === 'mold' && s.adjustedLevel >= 3);
  const hasHighIndoor = activeSpecies.some(s => s.category === 'indoor' && s.adjustedLevel >= 3);

  if (hasHighPollen) {
    if (weather.windSpeedMph >= 15) {
      tips.push('Windy conditions are spreading pollen — keep windows closed and consider an N95 mask outdoors.');
    } else {
      tips.push('Pollen counts are elevated. Shower and change clothes after spending time outside.');
    }
    if (weather.precipMm < 1) {
      tips.push('No rain expected to wash away pollen. Consider running HEPA air purifiers indoors.');
    }
  }

  if (weather.precipMm >= 5 && hasHighPollen) {
    tips.push('Rain is helping wash pollen out of the air — a good window for outdoor time.');
  }

  if (hasHighMold) {
    tips.push('Mold spore levels are high. Avoid piles of damp leaves and check indoor humidity (aim for 30-50%).');
  }

  if (hasHighIndoor) {
    tips.push('Indoor allergens are elevated. Vacuum with a HEPA filter and wash bedding in hot water weekly.');
  }

  if (overallScore >= 60) {
    tips.push('Consider taking antihistamines before symptoms start for best relief.');
  }

  const peaking = activeSpecies.filter(s => s.isPeak && s.adjustedLevel >= 2);
  if (peaking.length > 0) {
    const names = peaking.slice(0, 3).map(s => s.name).join(', ');
    tips.push(`Currently peaking: ${names}. Limit extended outdoor exposure during midday hours.`);
  }

  return tips.slice(0, 4);
}

// ─── 5-day forecast ───────────────────────────────────────────────────

function buildFiveDayForecast(
  dailyForecasts: DailyForecast[],
  region: Region,
  month: number,
): AllergyDayForecast[] {
  const calendar = regionCalendars[region];
  const days = dailyForecasts.slice(0, 5);

  return days.map(day => {
    const weather: WeatherFactors = {
      windSpeedMph: day.windSpeedMph,
      precipMm: day.precipMm,
      humidity: day.humidity,
      tempF: (day.highF + day.lowF) / 2,
      dewPointF: 0, // not available in daily, approximate
    };
    // Rough dew point approximation from humidity and avg temp
    const avgTemp = (day.highF + day.lowF) / 2;
    weather.dewPointF = Math.round(avgTemp - ((100 - day.humidity) / 5) * 1.8);

    const species = calendar.map(entry => {
      const baseline = entry.months[month];
      const adjusted = adjustLevel(baseline, entry.category, weather);
      return { adjustedLevel: adjusted };
    });

    const active = species.filter(s => s.adjustedLevel > 0);
    let score = 0;
    if (active.length > 0) {
      const maxLevel = Math.max(...active.map(s => s.adjustedLevel));
      const avgLevel = active.reduce((sum, s) => sum + s.adjustedLevel, 0) / active.length;
      score = Math.round((maxLevel * 0.6 + avgLevel * 0.4) / 4 * 100);
    }

    // Determine dominant weather factor
    let dominantFactor = 'Seasonal baseline';
    if (day.precipMm >= 5) dominantFactor = 'Rain washing away pollen';
    else if (day.windSpeedMph >= 20) dominantFactor = 'High wind dispersing pollen';
    else if (day.humidity >= 80) dominantFactor = 'High humidity boosting mold';
    else if ((day.highF + day.lowF) / 2 >= 85) dominantFactor = 'Warm temps increasing pollen release';
    else if ((day.highF + day.lowF) / 2 < 40) dominantFactor = 'Cold reducing pollen activity';

    return {
      date: day.date,
      score: Math.max(0, Math.min(100, score)),
      level: scoreToLevel(score),
      dominantFactor,
    };
  });
}

// ─── Main export ──────────────────────────────────────────────────────

export function calculateAllergyForecast(
  current: ForecastPoint,
  daily: DailyForecast[],
  state: string | undefined,
  month: number,
): AllergyData {
  const stateCode = (state || '').replace(/\s+/g, '').toUpperCase().slice(0, 2);
  const region: Region = stateToRegion[stateCode] || 'southeast';
  const calendar = regionCalendars[region];

  const weather: WeatherFactors = {
    windSpeedMph: current.windSpeedMph,
    precipMm: current.precipMm,
    humidity: current.humidity,
    tempF: current.tempF,
    dewPointF: current.dewPointF,
  };

  const allSpecies: AllergenSpecies[] = calendar.map(entry => {
    const baseline = entry.months[month];
    const adjusted = adjustLevel(baseline, entry.category, weather);
    return {
      name: entry.name,
      category: entry.category,
      icon: entry.icon,
      baselineLevel: baseline,
      adjustedLevel: adjusted,
      levelLabel: numToLevel(adjusted),
      inSeason: baseline > 0,
      isPeak: entry.peakMonths.includes(month),
    };
  });

  const activeSpecies = allSpecies
    .filter(s => s.inSeason)
    .sort((a, b) => b.adjustedLevel - a.adjustedLevel);

  const inactiveSpecies = allSpecies
    .filter(s => !s.inSeason)
    .sort((a, b) => a.name.localeCompare(b.name));

  const overallScore = calculateOverallScore(activeSpecies);
  const overallLevel = scoreToLevel(overallScore);

  // Build legacy fields from highest per-category
  function highestInCat(cat: AllergenCategory): string {
    const inCat = activeSpecies.filter(s => s.category === cat);
    if (inCat.length === 0) return 'Low';
    return levelToLegacy(numToLevel(Math.max(...inCat.map(s => s.adjustedLevel))));
  }

  const fiveDayForecast = buildFiveDayForecast(daily, region, month);
  const weatherAdjustments = getWeatherAdjustments(weather);
  const tips = generateTips(activeSpecies, weather, overallScore);

  return {
    // Legacy
    treePollen: highestInCat('tree'),
    ragweedPollen: highestInCat('weed'),
    grassPollen: highestInCat('grass'),
    mold: highestInCat('mold'),
    dustAndDander: highestInCat('indoor'),
    // Enhanced
    region,
    regionLabel: regionLabels[region],
    overallScore,
    overallLevel,
    activeSpecies,
    inactiveSpecies,
    fiveDayForecast,
    tips,
    weatherAdjustments,
  };
}
