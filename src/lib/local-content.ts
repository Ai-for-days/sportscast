// Local content generation for zip code pages
// Tier 1: Computed for ALL 41K zips (no manual data)
// Tier 2: Curated top ~200 cities (from city-local-data.ts)

// ─── Climate Zone ────────────────────────────────────────────────────

export type ClimateZone = 'tropical' | 'subtropical' | 'temperate' | 'continental' | 'northern';

export function getClimateZone(lat: number): ClimateZone {
  const absLat = Math.abs(lat);
  if (absLat < 25) return 'tropical';
  if (absLat < 33) return 'subtropical';
  if (absLat < 40) return 'temperate';
  if (absLat < 47) return 'continental';
  return 'northern';
}

const climateDescriptions: Record<ClimateZone, string> = {
  tropical: 'a tropical climate with warm temperatures year-round, high humidity, and a distinct wet and dry season. Expect temperatures rarely dipping below 60°F even in winter.',
  subtropical: 'a humid subtropical climate with hot summers, mild winters, and rainfall distributed throughout the year. Summer thunderstorms are common in the afternoon hours.',
  temperate: 'a temperate climate with four distinct seasons. Expect warm summers, cool autumns, cold winters, and pleasant springs with moderate precipitation throughout the year.',
  continental: 'a continental climate with significant temperature variations between seasons. Summers can be warm to hot while winters are cold with potential for heavy snowfall.',
  northern: 'a northern climate characterized by long, cold winters and short, mild summers. Snow cover can persist for months, and temperature swings between seasons are dramatic.',
};

export function getClimateDescription(zone: ClimateZone): string {
  return climateDescriptions[zone];
}

// ─── State Weather Challenges ────────────────────────────────────────

const stateWeatherChallenges: Record<string, string[]> = {
  AL: ['Severe thunderstorms and tornadoes during spring', 'Hurricane season impacts from June through November', 'Extreme heat and humidity in summer months'],
  AK: ['Extreme cold and blizzard conditions in winter', 'Limited daylight during winter months', 'Rapid weather changes due to maritime and arctic influences'],
  AZ: ['Extreme heat exceeding 110°F in summer', 'Monsoon thunderstorms from July through September', 'Flash flooding in desert washes and urban areas'],
  AR: ['Tornado Alley activity during spring months', 'Ice storms in winter causing hazardous travel', 'Summer heat and humidity with frequent thunderstorms'],
  CA: ['Wildfire season from late summer through fall', 'Atmospheric rivers bringing heavy rainfall and mudslides', 'Earthquake activity affecting infrastructure'],
  CO: ['Sudden mountain snowstorms even in spring', 'Hailstorms with softball-sized hail in summer', 'Rapid temperature changes — 40°F swings in 24 hours'],
  CT: ["Nor'easters bringing heavy snow and coastal flooding", 'Hurricane remnants in late summer and fall', 'Ice storms disrupting power and travel'],
  DE: ['Coastal flooding from storms and high tides', "Nor'easters with heavy snow and wind", 'Summer thunderstorms with damaging winds'],
  FL: ['Hurricane season with direct hits possible June–November', 'Daily afternoon thunderstorms in summer with lightning', 'Flooding from tropical systems and heavy rain'],
  GA: ['Severe thunderstorms and tornadoes in spring', 'Hurricane impacts along the coast', 'Ice storms in northern Georgia during winter'],
  HI: ['Flash flooding from intense tropical rainfall', 'Hurricane season threats in summer and fall', 'Trade wind disruptions affecting local weather patterns'],
  ID: ['Heavy mountain snowfall and avalanche risk', 'Wildfire smoke affecting air quality in summer', 'Extreme cold snaps in northern regions'],
  IL: ['Tornado risk in spring and early summer', 'Lake-effect snow along Lake Michigan', 'Extreme cold wind chills in winter'],
  IN: ['Tornado Alley activity during spring', 'Severe winter storms with significant snow', 'Flooding along major river systems'],
  IA: ['Severe thunderstorms with derechos possible', 'Blizzards and extreme cold in winter', 'River flooding during spring snowmelt'],
  KS: ['Tornado Alley — peak tornado activity in spring', 'Severe hailstorms causing crop and property damage', 'Extreme heat in summer and blizzards in winter'],
  KY: ['Severe thunderstorms and occasional tornadoes', 'Ice storms disrupting travel and power', 'Flash flooding in hilly terrain'],
  LA: ['Hurricane season with major storm risks', 'Extreme heat and humidity in summer', 'Flash flooding from tropical moisture'],
  ME: ["Nor'easters with heavy snowfall", 'Coastal storms causing erosion and flooding', 'Extreme cold with dangerous wind chills'],
  MD: ['Hurricane and tropical storm remnants', "Nor'easters bringing snow and ice", 'Summer heat waves with high humidity'],
  MA: ["Nor'easters with blizzard conditions", 'Coastal flooding from storm surge', 'Summer severe thunderstorms and occasional tornadoes'],
  MI: ['Lake-effect snow producing heavy accumulations', 'Severe thunderstorms with damaging winds', 'Extreme cold and ice storms in winter'],
  MN: ['Extreme cold with wind chills below -30°F', 'Severe thunderstorms and tornadoes in summer', 'Spring flooding from snowmelt'],
  MS: ['Hurricane and tropical storm impacts', 'Tornado risk throughout spring', 'Extreme summer heat and humidity'],
  MO: ['Tornado risk from spring through early summer', 'Ice storms in winter causing widespread outages', 'Flooding along the Missouri and Mississippi Rivers'],
  MT: ['Extreme cold — among the coldest in the Lower 48', 'Chinook winds causing rapid temperature changes', 'Wildfire smoke and drought conditions in summer'],
  NE: ['Tornado Alley severe weather in spring and summer', 'Blizzards with whiteout conditions in winter', 'Extreme temperature ranges throughout the year'],
  NV: ['Extreme desert heat exceeding 115°F', 'Flash flooding from sudden thunderstorms', 'High winds and dust storms in open terrain'],
  NH: ['Heavy snowfall and ice storms in winter', 'Mountain weather changing rapidly', 'Spring flooding from snowmelt'],
  NJ: ["Nor'easters with heavy snow and coastal flooding", 'Hurricane and tropical storm impacts', 'Summer severe thunderstorms'],
  NM: ['Extreme temperature swings between day and night', 'Monsoon thunderstorms with flash flooding', 'Dust storms in dry, windy conditions'],
  NY: ['Lake-effect snow in western New York', "Nor'easters with heavy snowfall", 'Hurricane impacts along the coast'],
  NC: ['Hurricane season affecting coastal and inland areas', 'Severe thunderstorms and tornadoes in spring', 'Ice storms in the Piedmont region'],
  ND: ['Extreme cold and blizzard conditions', 'Spring flooding from Red River snowmelt', 'Severe thunderstorms with large hail'],
  OH: ['Lake-effect snow near Lake Erie', 'Severe thunderstorms and tornado risk', 'Winter ice storms causing hazardous travel'],
  OK: ['Tornado Alley — among the highest tornado risk in the US', 'Severe hailstorms with very large hail', 'Ice storms in winter causing widespread damage'],
  OR: ['Atmospheric rivers bringing heavy rain and flooding', 'Wildfire smoke degrading air quality', 'Winter storms with mountain snow and valley rain'],
  PA: ['Lake-effect snow in northwestern regions', "Nor'easters with heavy snowfall", 'Flooding from remnants of tropical storms'],
  RI: ["Nor'easters with heavy snow and wind", 'Hurricane and tropical storm impacts', 'Coastal flooding from storm surge'],
  SC: ['Hurricane season with direct hit potential', 'Severe thunderstorms in spring and summer', 'Ice storms in the Upstate region'],
  SD: ['Severe thunderstorms with tornadoes and hail', 'Blizzards with extreme wind chills', 'Rapid weather changes between seasons'],
  TN: ['Severe thunderstorms and tornado risk', 'Flash flooding in mountainous eastern regions', 'Ice storms disrupting travel in winter'],
  TX: ['Tornado Alley activity in North Texas', 'Hurricane season along the Gulf Coast', 'Extreme heat exceeding 100°F for extended periods'],
  UT: ['Heavy mountain snowfall and avalanche risk', 'Air quality inversions trapping pollution', 'Flash flooding in slot canyons'],
  VT: ['Heavy snowfall and extreme cold in winter', 'Spring flooding from snowmelt and ice jams', 'Mountain weather changing rapidly'],
  VA: ['Hurricane and tropical storm impacts', "Nor'easters with snow and ice", 'Severe thunderstorms in spring and summer'],
  WA: ['Atmospheric rivers causing heavy rain and flooding', 'Wildfire smoke from regional fires', 'Volcanic hazard from Mount Rainier and Mount St. Helens'],
  WV: ['Flash flooding in mountain valleys', 'Heavy snowfall in higher elevations', 'Ice storms causing power outages'],
  WI: ['Extreme cold and heavy snowfall', 'Severe thunderstorms and tornadoes in summer', 'Lake-effect snow near Lake Michigan and Superior'],
  WY: ['Extreme wind events and ground blizzards', 'Rapid temperature drops from chinook reversal', 'Wildfire risk in forests and grasslands'],
  DC: ['Summer heat waves with high humidity', 'Hurricane remnants bringing flooding', 'Winter storms with ice and snow'],
};

export function getStateWeatherChallenges(stateAbbr: string): string[] {
  return stateWeatherChallenges[stateAbbr.toUpperCase()] || [
    'Seasonal weather variations affecting daily activities',
    'Occasional severe weather requiring preparation',
    'Temperature extremes during peak summer and winter months',
  ];
}

// ─── Region Mapping (reuse from allergy-forecast.ts pattern) ─────────

export type Region = 'southeast' | 'northeast' | 'midwest' | 'southwest' | 'west_coast' | 'mountain_nw';

const stateToRegion: Record<string, Region> = {
  AL: 'southeast', AR: 'southeast', FL: 'southeast', GA: 'southeast',
  KY: 'southeast', LA: 'southeast', MS: 'southeast', NC: 'southeast',
  SC: 'southeast', TN: 'southeast', VA: 'southeast', WV: 'southeast',
  CT: 'northeast', DE: 'northeast', DC: 'northeast', ME: 'northeast',
  MD: 'northeast', MA: 'northeast', NH: 'northeast', NJ: 'northeast',
  NY: 'northeast', PA: 'northeast', RI: 'northeast', VT: 'northeast',
  IA: 'midwest', IL: 'midwest', IN: 'midwest', KS: 'midwest',
  MI: 'midwest', MN: 'midwest', MO: 'midwest', ND: 'midwest',
  NE: 'midwest', OH: 'midwest', OK: 'midwest', SD: 'midwest',
  WI: 'midwest', TX: 'midwest',
  AZ: 'southwest', NM: 'southwest', NV: 'southwest', UT: 'southwest',
  CA: 'west_coast', HI: 'west_coast',
  AK: 'mountain_nw', CO: 'mountain_nw', ID: 'mountain_nw', MT: 'mountain_nw',
  OR: 'mountain_nw', WA: 'mountain_nw', WY: 'mountain_nw',
};

export function getRegion(stateAbbr: string): Region {
  return stateToRegion[stateAbbr.toUpperCase()] || 'southeast';
}

// ─── Seasonal Guide ──────────────────────────────────────────────────

interface SeasonalGuide {
  season: string;
  description: string;
}

const seasonalGuides: Record<Region, SeasonalGuide[]> = {
  southeast: [
    { season: 'Spring (Mar–May)', description: 'Warm temperatures with occasional severe thunderstorms. Peak allergy season as trees and grasses pollinate. Great for outdoor festivals and fishing.' },
    { season: 'Summer (Jun–Aug)', description: 'Hot and humid with daily afternoon thunderstorms. Heat index often exceeds 100°F. Hurricane season begins June 1. Best to plan outdoor activities for morning hours.' },
    { season: 'Fall (Sep–Nov)', description: 'Gradually cooling temperatures with lower humidity. Peak hurricane season through October. Excellent for outdoor sports, hiking, and fall foliage in the mountains.' },
    { season: 'Winter (Dec–Feb)', description: 'Mild compared to northern states, with occasional cold fronts and ice storms. Daytime highs typically in the 40s–60s°F. Good season for year-round outdoor activities.' },
  ],
  northeast: [
    { season: 'Spring (Mar–May)', description: "Unpredictable weather as winter transitions — snow possible into April. Rapid warming brings mud season. Nor'easters still possible through March." },
    { season: 'Summer (Jun–Aug)', description: 'Warm and humid with occasional heat waves. Afternoon thunderstorms common. Excellent beach and outdoor recreation season.' },
    { season: 'Fall (Sep–Nov)', description: 'Beautiful foliage season with crisp, cool weather. First frost typically arrives in October. Great for apple picking, hiking, and outdoor events.' },
    { season: 'Winter (Dec–Feb)', description: "Cold with significant snowfall potential. Nor'easters can dump 12+ inches. Wind chill regularly below 0°F in northern areas. Snow sports season at its peak." },
  ],
  midwest: [
    { season: 'Spring (Mar–May)', description: 'Tornado season begins with severe thunderstorms. Rapid temperature changes week to week. Flooding risk from snowmelt and heavy rain.' },
    { season: 'Summer (Jun–Aug)', description: 'Hot and humid with severe thunderstorm risk. Tornado season continues into June. Excellent growing season with long daylight hours.' },
    { season: 'Fall (Sep–Nov)', description: 'Cool and pleasant with beautiful fall colors. Harvest season for agriculture. First frost arrives in October for most areas.' },
    { season: 'Winter (Dec–Feb)', description: 'Cold with heavy snowfall and dangerous wind chills. Lake-effect snow near the Great Lakes. Arctic air masses can push temperatures well below zero.' },
  ],
  southwest: [
    { season: 'Spring (Mar–May)', description: 'Warming temperatures with dry conditions. Wildflower season in the deserts. Wind events can bring dust storms.' },
    { season: 'Summer (Jun–Sep)', description: 'Extreme heat in low deserts exceeding 110°F. Monsoon season brings afternoon thunderstorms and flash flood risk from July through September.' },
    { season: 'Fall (Oct–Nov)', description: 'Cooling temperatures make this the most pleasant outdoor season. Clear skies ideal for hiking and stargazing. Tourist season begins.' },
    { season: 'Winter (Dec–Feb)', description: 'Mild in the deserts with highs in the 60s°F. Higher elevations see significant snowfall. Excellent season for desert outdoor recreation.' },
  ],
  west_coast: [
    { season: 'Spring (Mar–May)', description: 'Warming and drying as the rainy season ends. Wildflowers bloom in the hills. Still cool and wet in the Pacific Northwest.' },
    { season: 'Summer (Jun–Aug)', description: 'Dry and warm in California with marine fog along the coast. Pacific Northwest warms up with dry conditions. Wildfire season begins.' },
    { season: 'Fall (Sep–Nov)', description: 'Peak wildfire season in early fall. Atmospheric rivers begin bringing rain in November. Santa Ana or Diablo winds create fire weather.' },
    { season: 'Winter (Dec–Feb)', description: 'Rainy season with atmospheric rivers bringing heavy precipitation. Mountain snow provides vital water supply. Mild temperatures along the coast.' },
  ],
  mountain_nw: [
    { season: 'Spring (Mar–May)', description: 'Snowmelt season with flooding risk in valleys. Mountain passes may remain closed through May. Rapidly changing conditions.' },
    { season: 'Summer (Jun–Aug)', description: 'Short but pleasant season with warm days and cool nights. Wildfire smoke can impact air quality. Best season for hiking and mountain recreation.' },
    { season: 'Fall (Sep–Nov)', description: 'Early snow in mountains by September. Beautiful fall colors in aspen groves. Hunting season with changing weather conditions.' },
    { season: 'Winter (Dec–Feb)', description: 'Heavy snowfall in mountains — world-class ski conditions. Extreme cold in valleys. Chinook winds can cause rapid warming along the front range.' },
  ],
};

export function getSeasonalGuide(region: Region): SeasonalGuide[] {
  return seasonalGuides[region];
}

// ─── Outdoor Activities ──────────────────────────────────────────────

export interface ActivitySuggestion {
  activity: string;
  description: string;
}

export function getOutdoorActivities(
  region: Region,
  currentTempF: number,
  precipProbability: number,
  windSpeedMph: number,
): ActivitySuggestion[] {
  const activities: ActivitySuggestion[] = [];

  // Weather-aware suggestions
  const isRainy = precipProbability > 50;
  const isWindy = windSpeedMph > 20;
  const isCold = currentTempF < 40;
  const isHot = currentTempF > 90;
  const isNice = !isRainy && !isWindy && currentTempF >= 50 && currentTempF <= 85;

  if (isNice) {
    activities.push({ activity: 'Outdoor Sports', description: 'Current conditions are ideal for outdoor sports and recreational activities.' });
  }

  if (isRainy) {
    activities.push({ activity: 'Indoor Activities', description: 'Rain is likely — consider indoor alternatives or bring waterproof gear if heading outdoors.' });
  }

  if (isCold && !isRainy) {
    activities.push({ activity: 'Winter Sports', description: 'Cold conditions are favorable for winter sports and activities. Dress in layers.' });
  }

  if (isHot) {
    activities.push({ activity: 'Water Activities', description: 'Beat the heat with swimming, kayaking, or other water-based recreation. Stay hydrated.' });
  }

  // Region-specific suggestions
  const regionActivities: Record<Region, ActivitySuggestion[]> = {
    southeast: [
      { activity: 'Fishing', description: 'The Southeast offers excellent freshwater and saltwater fishing year-round. Bass, catfish, and redfish are popular catches.' },
      { activity: 'Golf', description: 'Mild winters make this region a year-round golf destination with courses open most days.' },
    ],
    northeast: [
      { activity: 'Hiking', description: 'The Appalachian Trail and state parks offer world-class hiking with scenic views.' },
      { activity: 'Skiing', description: 'Winter months bring quality skiing and snowboarding at mountain resorts throughout the region.' },
    ],
    midwest: [
      { activity: 'Fishing', description: 'Lakes and rivers across the Midwest provide excellent fishing for walleye, bass, and panfish.' },
      { activity: 'Hunting', description: 'Fall hunting season is a major outdoor activity with whitetail deer, waterfowl, and upland game.' },
    ],
    southwest: [
      { activity: 'Hiking', description: 'Desert trails and canyon hikes are best in cooler months. Always carry plenty of water.' },
      { activity: 'Stargazing', description: 'Low light pollution and clear skies make this region ideal for stargazing and astronomy.' },
    ],
    west_coast: [
      { activity: 'Surfing', description: 'The Pacific coast offers surfing year-round with varying conditions from beach breaks to point breaks.' },
      { activity: 'Trail Running', description: 'Coastal and mountain trails provide diverse terrain for trail running and hiking.' },
    ],
    mountain_nw: [
      { activity: 'Skiing', description: 'World-class powder skiing at resorts throughout the Rocky Mountains and Cascades.' },
      { activity: 'Mountain Biking', description: 'Summer brings excellent mountain biking on alpine trails with stunning mountain scenery.' },
    ],
  };

  activities.push(...(regionActivities[region] || []));

  return activities.slice(0, 4);
}

// ─── Dynamic Weather Integration ────────────────────────────────────

export function getWeatherImpactNote(
  currentTempF: number,
  description: string,
  precipProbability: number,
  windSpeedMph: number,
): string | null {
  const descLower = description.toLowerCase();

  if (descLower.includes('snow') || descLower.includes('blizzard')) {
    return 'Current snow conditions may impact travel and outdoor plans. Check road conditions before heading out and allow extra travel time.';
  }
  if (descLower.includes('thunderstorm') || descLower.includes('storm')) {
    return 'Active thunderstorms in the area may produce lightning, heavy rain, and gusty winds. Seek indoor shelter if outdoors.';
  }
  if (precipProbability > 70) {
    return 'High chance of precipitation today — plan for wet conditions if spending time outdoors. Rain gear recommended.';
  }
  if (currentTempF > 100) {
    return 'Extreme heat advisory conditions — limit outdoor exposure, stay hydrated, and check on vulnerable neighbors.';
  }
  if (currentTempF < 10) {
    return 'Dangerously cold temperatures — frostbite can occur on exposed skin in minutes. Limit time outdoors.';
  }
  if (windSpeedMph > 30) {
    return 'High winds may affect driving, especially for high-profile vehicles. Secure outdoor furniture and items.';
  }
  if (descLower.includes('fog')) {
    return 'Foggy conditions reducing visibility — use low beam headlights and allow extra following distance while driving.';
  }

  return null;
}

// ─── Weather Overview (Featured Snippet Targeting) ──────────────────

export interface WeatherOverviewInput {
  city: string;
  state: string;
  tempF: number;
  feelsLikeF: number;
  description: string;
  highF: number;
  lowF: number;
  precipChance: number;
  humidity: number;
  windSpeedMph: number;
  uvIndex: number;
}

export function generateWeatherOverview(input: WeatherOverviewInput): string {
  const { city, state, tempF, feelsLikeF, description, highF, lowF, precipChance, humidity, windSpeedMph } = input;
  const location = `${city}, ${state}`;
  const temp = Math.round(tempF);
  const feels = Math.round(feelsLikeF);
  const high = Math.round(highF);
  const low = Math.round(lowF);
  const desc = description.toLowerCase();

  // Sentence 1: current conditions
  let overview = `The weather in ${location} right now is ${temp}°F and ${desc}`;
  if (Math.abs(feels - temp) >= 5) {
    overview += `, feeling like ${feels}°F`;
  }
  overview += '.';

  // Sentence 2: today's forecast
  overview += ` Today expect a high of ${high}°F and a low of ${low}°F`;
  if (precipChance >= 50) {
    overview += ` with a ${precipChance}% chance of rain`;
  } else if (precipChance >= 20) {
    overview += ` with a slight chance of rain (${precipChance}%)`;
  }
  overview += '.';

  // Sentence 3: wind + humidity context
  const windLabel = windSpeedMph <= 5 ? 'calm' : windSpeedMph <= 15 ? 'light' : windSpeedMph <= 25 ? 'moderate' : 'strong';
  const humidLabel = humidity >= 70 ? 'high' : humidity >= 40 ? 'moderate' : 'low';
  overview += ` Winds are ${windLabel} at ${windSpeedMph} mph with ${humidLabel} humidity at ${humidity}%.`;

  return overview;
}

// ─── Clothing Recommendation ────────────────────────────────────────

export function generateClothingRecommendation(
  tempF: number,
  feelsLikeF: number,
  precipChance: number,
  windSpeedMph: number,
  uvIndex: number,
  humidity: number,
): string {
  const feels = Math.round(feelsLikeF);
  let rec: string;

  if (feels >= 95) {
    rec = 'Wear lightweight, loose-fitting clothing in light colors. Stay hydrated and limit time in direct sun.';
  } else if (feels >= 80 && humidity >= 65) {
    rec = 'Choose breathable, moisture-wicking fabrics like cotton or linen. The humidity makes it feel hotter than it is.';
  } else if (feels >= 80) {
    rec = 'Shorts and a t-shirt are ideal. Light, breathable fabrics will keep you comfortable.';
  } else if (feels >= 70) {
    rec = precipChance > 30
      ? 'Light clothing with a rain jacket or umbrella — comfortable temperatures but rain is possible.'
      : 'A t-shirt and shorts or light pants are comfortable. Sunglasses recommended.';
  } else if (feels >= 55) {
    rec = 'Dress in layers — a light jacket or sweater over a t-shirt works well for the temperature range today.';
  } else if (feels >= 40) {
    rec = windSpeedMph > 15
      ? 'A warm coat and long pants are recommended. Wind makes it feel colder — a windbreaker helps.'
      : 'A warm sweater or fleece jacket with long pants. Consider a hat if you\'ll be outside for a while.';
  } else if (feels >= 25) {
    rec = 'A heavy coat, warm layers, and closed-toe shoes. Hat and gloves recommended, especially in the wind.';
  } else {
    rec = `Bundle up with a heavy winter coat, thermal layers, insulated boots, hat, gloves, and a scarf. It feels like ${feels}°F with wind chill.`;
  }

  // Rain modifier
  if (precipChance > 50 && feels < 70) {
    rec += ' Waterproof outer layer and footwear recommended.';
  }

  // UV modifier
  if (uvIndex >= 6) {
    rec += ' UV is high — sunscreen, sunglasses, and a hat are essential.';
  }

  return rec;
}
