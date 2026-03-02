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
  tropical: 'a tropical climate with warm temperatures year-round, high humidity, and a distinct wet and dry season. Average highs stay between 80–90°F throughout the year, with winter lows rarely dipping below 60°F. Annual rainfall averages 50–65 inches, concentrated in the summer wet season from June through October. Trade winds provide some relief from the heat, and tropical storms and hurricanes are a seasonal concern. The UV index remains high year-round, making sun protection essential.',
  subtropical: 'a humid subtropical climate with hot, muggy summers and mild, relatively short winters. Summer temperatures regularly reach the 90s°F with heat indices exceeding 100°F due to high humidity levels averaging 70–80%. Annual precipitation of 45–60 inches is spread throughout the year, though afternoon thunderstorms are a daily occurrence from May through September. Winters are mild with occasional cold fronts bringing temperatures into the 30s–40s°F. Severe weather including tornadoes and tropical systems can impact the area from spring through fall.',
  temperate: 'a temperate climate with four distinct seasons and moderate weather extremes. Summers are warm with average highs in the 80s°F, while winters bring average lows in the 20s–30s°F with regular snowfall in many areas. Annual precipitation of 35–50 inches is fairly evenly distributed, with spring and early summer being the wettest periods. Fall foliage season provides spectacular color displays from late September through November. The region experiences a wide variety of weather patterns including nor\'easters, severe thunderstorms, and the occasional winter ice storm.',
  continental: 'a continental climate with dramatic temperature swings between seasons and sometimes within a single week. Summers can be warm to hot with highs in the 80s–90s°F, while winter brings extended periods of bitter cold with temperatures plunging well below 0°F during arctic outbreaks. Annual snowfall ranges from 30 to over 80 inches depending on proximity to the Great Lakes. Spring is the most volatile season, bringing severe thunderstorms, tornadoes, and rapid freeze-thaw cycles. Autumn is generally the most pleasant season with crisp temperatures and low humidity.',
  northern: 'a northern climate characterized by long, harsh winters and short, pleasant summers. Winter temperatures regularly drop below 0°F with wind chills reaching -30°F or colder, and snow cover can persist from November through April. Summers are brief but enjoyable with average highs in the 70s–80s°F and cool nights in the 50s°F. Annual precipitation is modest at 20–40 inches, with much of it falling as snow. The growing season is short at 90–130 days, and daylight hours vary dramatically — from 8–9 hours in December to 15–16 hours in June.',
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
    { season: 'Spring (Mar–May)', description: 'Temperatures climb from the 60s into the 80s°F with increasing humidity. Severe thunderstorms and tornadoes are most active in March and April — keep weather alerts enabled. Pollen counts peak in April, making it the toughest month for allergy sufferers. Dogwoods and azaleas bloom across the region, and outdoor festivals kick off. Evening temperatures in the 50s–60s are perfect for patio dining and evening walks.' },
    { season: 'Summer (Jun–Aug)', description: 'Hot and humid with highs in the 90s°F and heat indices frequently exceeding 105°F. Daily afternoon thunderstorms develop like clockwork between 2–6 PM, often bringing brief but intense downpours, lightning, and gusty winds. Hurricane season runs June 1 through November 30 — monitor tropical forecasts regularly. Plan outdoor activities for early morning before 10 AM or after 6 PM to avoid peak heat. Hydration and sun protection are essential.' },
    { season: 'Fall (Sep–Nov)', description: 'One of the best seasons in the Southeast as humidity drops and temperatures ease into the 60s–80s°F. Hurricane season remains active through October so stay weather-aware. Fall foliage peaks in the Appalachian mountains during October and in lower elevations through November. Football tailgating, harvest festivals, and outdoor concerts make this prime outdoor season. First frost typically arrives in late October to mid-November.' },
    { season: 'Winter (Dec–Feb)', description: 'Mild compared to northern states with daytime highs in the 45–60°F range and overnight lows in the 25–40°F range. Occasional cold fronts can bring ice storms and freezing rain that shut down roads for days — even a thin glaze causes major disruptions since the region has limited ice-removal equipment. Snow is rare in coastal areas but more common in the mountains. The dry, cool weather makes it an excellent season for hiking, running, and outdoor sports.' },
  ],
  northeast: [
    { season: 'Spring (Mar–May)', description: "Unpredictable and exciting — temperatures can swing from the 30s to 70s°F within the same week. Snow is still possible through mid-April in northern New England. Nor'easters can bring heavy, wet snow in March and April. By May, temperatures settle into the 60s–70s°F with blooming cherry blossoms, lilacs, and flowering trees. Mud season in Vermont and Maine makes dirt roads challenging from mid-March through April. Spring thunderstorms become more common in May." },
    { season: 'Summer (Jun–Aug)', description: 'Warm and humid with temperatures in the 80s–90s°F. Heat waves can push temperatures above 95°F with high humidity making it feel well over 100°F. Afternoon thunderstorms are common, occasionally producing damaging wind and hail. Beaches, lakes, and mountains draw crowds — expect traffic on summer weekends. Hurricane remnants can bring heavy rain and flooding from July through September. Evening concerts, outdoor dining, and state fairs make summer the busiest outdoor season.' },
    { season: 'Fall (Sep–Nov)', description: 'The crown jewel of Northeast weather. September brings warm days in the 70s and cool nights in the 50s. Peak fall foliage runs from late September in Vermont and Maine through late October in the Mid-Atlantic. Apple picking, corn mazes, and cider mills are regional traditions. First frost arrives in October in the north and November further south. By late November, temperatures drop into the 30s–40s°F with the first snowflakes possible in higher elevations.' },
    { season: 'Winter (Dec–Feb)', description: "Cold and snowy with temperatures regularly in the 20s–30s°F and wind chills below 0°F during arctic outbreaks. Nor'easters can drop 12–24+ inches of snow in a single storm, shutting down travel for days. Lake-effect snow bands hammering upstate New York can produce 3–5 inches per hour. Skiing, snowboarding, and ice skating are popular activities. Road salt and plowing keeps major highways passable, but side roads can be treacherous." },
  ],
  midwest: [
    { season: 'Spring (Mar–May)', description: 'Tornado season is in full swing with the most dangerous period from April through mid-June. Severe thunderstorms can produce tornadoes, large hail, and damaging straight-line winds — have a storm shelter plan. Spring flooding is common as snowmelt combines with heavy rain, especially along the Mississippi, Missouri, and Ohio River systems. Temperatures yo-yo from the 40s into the 70s°F with dramatic swings week to week. Wildflowers emerge and farmers begin planting.' },
    { season: 'Summer (Jun–Aug)', description: 'Hot and humid with temperatures in the 85–100°F range and the corn belt humidity making it feel even hotter. Severe thunderstorms remain a threat with derechos (long-lived damaging wind storms) possible. State fairs, barbecues, and lake recreation are summer staples. The region produces some of the most spectacular lightning displays in the country. Mosquito activity is heavy near standing water. Evening baseball, fireworks, and outdoor concerts thrive.' },
    { season: 'Fall (Sep–Nov)', description: 'A beautiful season as the oppressive humidity breaks and temperatures ease into the 50s–70s°F. Harvest season transforms the landscape with golden cornfields and combines running at full speed. Fall foliage peaks from late September in Minnesota and Wisconsin through late October in Missouri and Kentucky. High school and college football dominate weekends. First frost arrives in September in the north and October further south. November brings the transition to winter with increasing gray skies.' },
    { season: 'Winter (Dec–Feb)', description: 'Brutally cold with average highs in the 20s–30s°F and arctic outbreaks pushing wind chills to -20 to -40°F. Lake-effect snow belts near the Great Lakes can see 60–100+ inches of snow per season. Blizzards can produce whiteout conditions and paralyze travel for days. Ice fishing, snowmobiling, and cross-country skiing are popular winter activities. Keep an emergency kit in your vehicle — getting stranded in winter weather can be dangerous.' },
  ],
  southwest: [
    { season: 'Spring (Mar–May)', description: 'The desert comes alive with temperatures climbing through the pleasant 70s–90s°F range before summer extremes arrive. March and April are the peak tourist months with ideal hiking weather. Wildflower super-blooms occur in wet years, carpeting the desert floor with color. Wind events can produce dust storms (haboobs) with visibility dropping to near zero — pull over and wait them out. UV levels are intense even in spring due to high elevation and clear skies.' },
    { season: 'Summer (Jun–Sep)', description: 'Dangerously hot in the low deserts with temperatures exceeding 110–120°F in Phoenix, Las Vegas, and Death Valley. The monsoon season from July through September brings dramatic afternoon thunderstorms with spectacular lightning, flash flooding in slot canyons and washes, and occasional dust storms. Higher elevations like Flagstaff and Santa Fe offer escape with temperatures in the 80s°F. If hiking, start before dawn and carry at least one gallon of water per person.' },
    { season: 'Fall (Oct–Nov)', description: 'The most pleasant season as temperatures drop into the comfortable 70s–85°F range in the deserts. Clear skies with less than 10% cloud cover most days make this perfect for hiking, biking, and stargazing. National parks see peak visitation in October and November. Aspen groves turn gold in the higher elevations of New Mexico and Utah. Nighttime temperatures cool into the 40s–50s°F, perfect for campfires and star photography.' },
    { season: 'Winter (Dec–Feb)', description: 'Mild and sunny in the low deserts with highs in the 60s–70s°F and cool nights in the 40s°F — snowbirds flock to the region. Higher elevations see significant snow with ski resorts in Utah, New Mexico, and Arizona mountains. Flagstaff averages 100+ inches of snow per season. Clear winter skies offer exceptional stargazing conditions. The combination of comfortable daytime temperatures and low hotel prices makes winter excellent for desert exploration.' },
  ],
  west_coast: [
    { season: 'Spring (Mar–May)', description: 'California warms into the 70s°F while the Pacific Northwest remains cool and rainy with temperatures in the 50s–60s°F. The Central Valley and Sierra foothills explode with wildflower blooms, especially California poppies. Marine layer fog keeps coastal areas 10–15°F cooler than inland. Snowpack in the Sierra Nevada and Cascades begins melting, feeding rivers and reservoirs. Whale migration along the coast provides excellent viewing opportunities. Late spring is ideal for wine country visits.' },
    { season: 'Summer (Jun–Aug)', description: 'Dry and warm in California with coastal temperatures in the 65–75°F range (thanks to marine fog) and inland valleys reaching 95–110°F. The Pacific Northwest enjoys its best weather with sunny skies, low humidity, and temperatures in the 75–85°F. Wildfire season intensifies from July onward — smoke from regional fires can degrade air quality for weeks. Ocean water temperatures reach 60–68°F for surfing and swimming. Outdoor concerts, farmers markets, and hiking season are at their peak.' },
    { season: 'Fall (Sep–Nov)', description: 'September and October are often the warmest months in the Pacific Northwest and coastal California as marine fog retreats. Peak wildfire and Santa Ana/Diablo wind season creates dangerous fire weather in October and November — have a go-bag ready in fire-prone areas. Atmospheric rivers begin returning to the Pacific Northwest in November, sometimes bringing 4–6 inches of rain in a single event. Fall color peaks along the Columbia River Gorge in October. Harvest festivals and wine crush season draw visitors.' },
    { season: 'Winter (Dec–Feb)', description: 'Rainy season brings 60–80% of the annual precipitation with atmospheric rivers capable of dumping 5–10 inches of rain in 24–48 hours, causing mudslides and flooding. Mountain snow builds the crucial snowpack that supplies water through summer — the Sierra Nevada can receive 30+ feet of total snowfall. Coastal temperatures remain mild in the 50s–60s°F. King tides cause coastal flooding in December and January. Excellent season for storm watching along the Oregon and Washington coasts.' },
  ],
  mountain_nw: [
    { season: 'Spring (Mar–May)', description: 'Snowmelt season creates flooding risk in valleys while mountain passes may remain closed through late May. Temperatures fluctuate wildly from the 30s to 70s°F, sometimes within the same day. Avalanche danger remains high through April — backcountry travelers need avalanche training and gear. Rivers swell with snowmelt making it prime whitewater season. Wildflowers begin appearing at lower elevations in May while mountains remain snow-covered. Be prepared for any weather when venturing out.' },
    { season: 'Summer (Jun–Aug)', description: 'The short but glorious mountain summer brings warm days in the 75–90s°F with cool nights in the 40s–50s°F — perfect camping weather. Wildfire smoke from regional fires can blanket valleys for weeks, turning skies orange and degrading air quality to hazardous levels. Afternoon thunderstorms develop over the mountains daily, often bringing lightning that ignites new fires. July and August are prime hiking, camping, fishing, and mountain biking months. Higher-elevation wildflowers peak in July.' },
    { season: 'Fall (Sep–Nov)', description: 'Aspen groves and larch trees turn brilliant gold against evergreen mountainsides from mid-September through early October. First significant mountain snow arrives by late September, signaling the transition. Hunting season is a major cultural tradition across the mountain states. Temperatures range from the 50s–70s°F in September to the 20s–40s°F by November. Fall storms can bring early season blizzards to mountain passes — carry chains and winter supplies when traveling.' },
    { season: 'Winter (Dec–Feb)', description: 'World-class powder skiing across dozens of resorts in Colorado, Utah, Montana, Wyoming, and Idaho draws millions of visitors. Mountain valleys experience temperature inversions trapping cold air and fog for days while mountaintops bask in sunshine. Temperatures range from highs in the 20s–30s°F to overnight lows of -10 to -30°F during arctic outbreaks. Chinook winds along the front range can raise temperatures 40–50°F in hours. Snowmobiling, ice climbing, and backcountry skiing are popular activities.' },
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

  // Weather-aware suggestions based on current conditions
  const isRainy = precipProbability > 50;
  const isWindy = windSpeedMph > 20;
  const isCold = currentTempF < 40;
  const isCool = currentTempF >= 40 && currentTempF < 60;
  const isHot = currentTempF > 90;
  const isWarm = currentTempF >= 70 && currentTempF <= 90;
  const isMild = currentTempF >= 55 && currentTempF <= 75;
  const isNice = !isRainy && !isWindy && currentTempF >= 50 && currentTempF <= 85;

  if (isMild && !isRainy && !isWindy) {
    activities.push({ activity: 'Outdoor Dining', description: 'Perfect weather for eating outside — temperatures in the sweet spot make patios and picnics ideal. Pack a lunch or find a local restaurant with outdoor seating.' });
  }

  if (isNice) {
    activities.push({ activity: 'Running & Walking', description: 'Current conditions are ideal for a run, jog, or long walk. Temperatures are comfortable and precipitation is unlikely — get outside and enjoy the fresh air.' });
  }

  if (isRainy) {
    activities.push({ activity: 'Indoor Activities', description: 'Rain is likely — great day for museums, bowling, indoor rock climbing, escape rooms, or catching a movie. If heading outdoors, waterproof layers and shoes are essential.' });
  }

  if (isCold && !isRainy) {
    activities.push({ activity: 'Winter Sports', description: 'Cold conditions are perfect for ice skating, cross-country skiing, snowshoeing, or building a snowman. Dress in warm, moisture-wicking layers and protect extremities from frostbite.' });
  }

  if (isCool && !isRainy) {
    activities.push({ activity: 'Hiking & Nature Walks', description: 'Cool weather is ideal for vigorous hiking without overheating. Bring a light jacket for rest stops and enjoy the crisp air on local trails and greenways.' });
  }

  if (isHot) {
    activities.push({ activity: 'Water Recreation', description: 'Beat the heat at the pool, lake, or river. Swimming, kayaking, paddleboarding, and tubing are excellent choices. Apply sunscreen frequently, drink plenty of water, and avoid peak sun hours from 11 AM–3 PM.' });
  }

  if (isWarm && !isRainy) {
    activities.push({ activity: 'Cycling', description: 'Warm and dry conditions are great for road biking, mountain biking, or a casual neighborhood ride. Bring water and sunscreen for longer rides.' });
  }

  if (isWindy && !isRainy) {
    activities.push({ activity: 'Kite Flying & Wind Sports', description: 'Windy conditions are perfect for flying kites at the park, windsurfing, kiteboarding, or sailing. Head to an open area away from trees and power lines.' });
  }

  if (!isRainy && !isWindy && currentTempF >= 45 && currentTempF <= 85) {
    activities.push({ activity: 'Gardening', description: 'Great weather for yard work, planting, weeding, or tending to your garden. Moderate temperatures make extended time outdoors comfortable without overheating.' });
  }

  // Region-specific suggestions
  const regionActivities: Record<Region, ActivitySuggestion[]> = {
    southeast: [
      { activity: 'Freshwater Fishing', description: 'The Southeast offers some of the best bass fishing in the country. Rivers, reservoirs, and farm ponds are loaded with largemouth bass, catfish, crappie, and bream year-round.' },
      { activity: 'Golf', description: 'Mild winters and hundreds of public courses make the Southeast a year-round golf destination. Famous courses along the coast and in the Piedmont region offer play most days of the year.' },
      { activity: 'Kayaking & Canoeing', description: 'Paddle through cypress swamps, lazy rivers, and coastal marshes teeming with wildlife. The Southeast has some of the most scenic paddling in the country from the Everglades to the Blue Ridge.' },
      { activity: 'Beach Going', description: 'Miles of Atlantic and Gulf Coast beaches offer swimming, shelling, surfing, and relaxation. Water temperatures are comfortable for swimming from May through October.' },
    ],
    northeast: [
      { activity: 'Hiking the Appalachians', description: 'The Appalachian Trail, White Mountains, Adirondacks, and Catskills offer world-class hiking from easy day hikes to challenging multi-day backpacking trips through stunning scenery.' },
      { activity: 'Skiing & Snowboarding', description: 'Winter brings excellent skiing at resorts from Vermont and New Hampshire to New York and Pennsylvania. Night skiing, cross-country, and snowshoeing round out winter recreation options.' },
      { activity: 'Leaf Peeping', description: 'Fall foliage season draws millions of visitors. Drive scenic routes through Vermont, New Hampshire, and the Berkshires for peak color from late September through late October.' },
      { activity: 'Beach & Coastal Activities', description: 'Cape Cod, the Jersey Shore, Long Island, and Maine coast offer swimming, sailing, lobster bakes, and lighthouses. Surfing at Montauk and Rhode Island draws board riders spring through fall.' },
    ],
    midwest: [
      { activity: 'Lake Fishing', description: 'Thousands of lakes across Minnesota, Wisconsin, Michigan, and the Great Lakes provide outstanding fishing for walleye, muskie, bass, perch, and panfish. Ice fishing is a beloved winter tradition.' },
      { activity: 'Hunting', description: 'Fall hunting season is deeply rooted in Midwest culture. Whitetail deer, wild turkey, pheasant, duck, and goose hunting draw outdoorsmen from across the country to the prairies and hardwood forests.' },
      { activity: 'State Fair & Festival Going', description: 'The Midwest hosts iconic state fairs and seasonal festivals from county fairs to music festivals. Summer and fall weekends are packed with community events, food, and entertainment.' },
      { activity: 'Boating & Water Sports', description: 'The Great Lakes and thousands of inland lakes offer powerboating, sailing, jet skiing, and pontoon cruising. Lake Michigan beaches rival ocean shores for beauty.' },
    ],
    southwest: [
      { activity: 'Desert Hiking & Canyon Exploration', description: 'Explore red rock canyons, slot canyons, and desert trails in the Grand Canyon, Zion, Arches, and beyond. Best in cooler months — always carry at least a gallon of water per person per day.' },
      { activity: 'Stargazing & Dark Sky Viewing', description: 'Some of the darkest skies in the nation. International Dark Sky Parks in Utah, Arizona, and New Mexico offer stunning Milky Way views, meteor shower watching, and astronomy events.' },
      { activity: 'Rock Climbing', description: 'World-class climbing at Red Rocks (Nevada), Indian Creek (Utah), Cochise Stronghold (Arizona), and Joshua Tree. Fall through spring offers the best conditions for desert climbing.' },
      { activity: 'Off-Roading & ATV Riding', description: 'Sand dunes, desert washes, and rugged mountain trails provide exceptional off-road adventures. Moab, Sedona, and the Baja-adjacent desert offer trails for all skill levels.' },
    ],
    west_coast: [
      { activity: 'Surfing', description: 'The Pacific coast offers year-round surfing from Huntington Beach to Santa Cruz to Tofino. Water temperatures range from the low 50s to upper 60s°F — wetsuits are standard gear north of Malibu.' },
      { activity: 'Trail Running & Hiking', description: 'Coastal cliffs, redwood forests, volcanic peaks, and alpine meadows provide incredibly diverse terrain. The Pacific Crest Trail, Muir Woods, and Olympic National Park are bucket-list destinations.' },
      { activity: 'Wine Country Touring', description: 'Napa Valley, Sonoma, Willamette Valley, and Paso Robles offer world-class wine tasting with beautiful scenery. Cycling between vineyards is a popular activity in fair weather.' },
      { activity: 'Whale Watching', description: 'Gray whales migrate along the coast December through April, and humpback whales feed offshore from May through November. Boat tours and coastal viewpoints offer excellent sighting opportunities.' },
    ],
    mountain_nw: [
      { activity: 'Skiing & Snowboarding', description: 'World-class powder at resorts like Big Sky, Jackson Hole, Sun Valley, Whitefish, and dozens more throughout the Rockies and Cascades. Utah claims the "Greatest Snow on Earth" with consistently dry, fluffy powder.' },
      { activity: 'Mountain Biking', description: 'Summer transforms ski resorts into lift-served mountain bike parks. Boise, Bend, Moab, and Whitefish are mountain biking meccas with hundreds of miles of singletrack trails.' },
      { activity: 'Fly Fishing', description: 'Blue-ribbon trout streams throughout Montana, Idaho, Wyoming, and Colorado offer some of the finest fly fishing in the world. The Madison, Henry\'s Fork, and Green River are legendary waters.' },
      { activity: 'Backcountry Camping', description: 'Millions of acres of wilderness offer true solitude. Yellowstone, Glacier, Grand Teton, and the Frank Church Wilderness provide unparalleled backcountry experiences in some of the most pristine landscapes in North America.' },
    ],
  };

  activities.push(...(regionActivities[region] || []));

  return activities.slice(0, 8);
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
