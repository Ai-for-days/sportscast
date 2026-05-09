// ── Step 152: Curated city universe for weather market idea finder ──────
//
// Pure data + a `resolveCityUniverse()` selector. **No I/O, no fetch,
// no network — every city is hard-coded so a typo in user input can
// never trigger an external lookup or accidentally widen the scan.**
// The Step 144 / 145 generator imports this module to choose which
// cities to forecast for an idea-search run.
//
// Trust posture:
//   - Pure data and pure functions. No `getRedis`, no `fetch`, no
//     external API. Importable from server (the generator) without
//     touching the wallet / settlement / grading / pricing / publish
//     code paths.
//   - Bounded scans: `MAX_EXPANDED_CITIES` is a hard ceiling on what
//     the resolver will return. The generator further caps via
//     `maxCandidateCities`.
//   - Two universes: the existing 12-city seed (re-mapped into the
//     finer Step-152 region taxonomy so the UI labels stay
//     consistent) and a curated ~75-city expanded US set. Adding new
//     universes later means adding a new mode here — the generator
//     does not invent new sources.
//
// Trade-off note: for ergonomics the seed cities keep their existing
// ids/coordinates from `forecast-quality-seed-cities.ts` so saved
// ideas / drafts / QA records that reference seed-city ids remain
// compatible with no migration. Their region tags are re-projected
// onto the finer Step-152 taxonomy (`SE` → `southeast` or `florida`,
// `S` → `texas` or `southeast`, etc.) so the operator's region filter
// behaves the same for both universes.

import {
  FORECAST_QUALITY_SEED_CITIES,
  type ForecastQualitySeedCity,
} from './forecast-quality-seed-cities';

// ── Public types ────────────────────────────────────────────────────────────

export type CityUniverseMode = 'seed_12' | 'expanded_us';

export const CITY_UNIVERSE_MODES: readonly CityUniverseMode[] = [
  'seed_12',
  'expanded_us',
] as const;

export type CityRegion =
  | 'northeast'
  | 'southeast'
  | 'midwest'
  | 'plains'
  | 'mountain'
  | 'southwest'
  | 'west_coast'
  | 'pacific_northwest'
  | 'texas'
  | 'florida';

export const CITY_REGIONS: readonly CityRegion[] = [
  'northeast',
  'southeast',
  'midwest',
  'plains',
  'mountain',
  'southwest',
  'west_coast',
  'pacific_northwest',
  'texas',
  'florida',
] as const;

/** Sentinel for "no region filter — return everything in the universe". */
export type CityRegionFilter = CityRegion | 'all_expanded';

export const CITY_REGION_FILTERS: readonly CityRegionFilter[] = [
  'all_expanded',
  ...CITY_REGIONS,
] as const;

export interface WeatherMarketCity {
  id: string;
  /** Human-readable "City, ST". Used in idea titles. */
  label: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  region: CityRegion;
  /** Rough US metro-population rank (1 = highest). Optional, used for sort/UI. */
  populationRank?: number;
  /**
   * Step 154 — curated weather-personality tags. Static, allow-listed,
   * non-scientific but reasonable. Populated by `CITY_TAGS_BY_ID` at
   * resolve time so the city catalog stays grep-friendly even though
   * the tag overlay is large.
   */
  tags?: WeatherPersonalityTag[];
}

// ── Step 154 — Weather personality tag taxonomy ─────────────────────────────

export type WeatherPersonalityTag =
  | 'hot'
  | 'cold'
  | 'humid'
  | 'dry'
  | 'desert'
  | 'mountain'
  | 'coastal'
  | 'plains'
  | 'windy'
  | 'snowy'
  | 'rainy'
  | 'storm_prone'
  | 'hurricane_exposed'
  | 'lake_effect'
  | 'high_variability'
  | 'big_diurnal_swing'
  | 'heat_index'
  | 'freeze_risk'
  | 'severe_weather'
  | 'urban_heat';

export const WEATHER_PERSONALITY_TAGS: readonly WeatherPersonalityTag[] = [
  'hot',
  'cold',
  'humid',
  'dry',
  'desert',
  'mountain',
  'coastal',
  'plains',
  'windy',
  'snowy',
  'rainy',
  'storm_prone',
  'hurricane_exposed',
  'lake_effect',
  'high_variability',
  'big_diurnal_swing',
  'heat_index',
  'freeze_risk',
  'severe_weather',
  'urban_heat',
] as const;

const TAG_LABELS: Record<WeatherPersonalityTag, string> = {
  hot: 'Hot',
  cold: 'Cold',
  humid: 'Humid',
  dry: 'Dry',
  desert: 'Desert',
  mountain: 'Mountain',
  coastal: 'Coastal',
  plains: 'Plains',
  windy: 'Windy',
  snowy: 'Snowy',
  rainy: 'Rainy',
  storm_prone: 'Storm-prone',
  hurricane_exposed: 'Hurricane-exposed',
  lake_effect: 'Lake-effect',
  high_variability: 'High variability',
  big_diurnal_swing: 'Big diurnal swing',
  heat_index: 'High heat index',
  freeze_risk: 'Freeze risk',
  severe_weather: 'Severe weather',
  urban_heat: 'Urban heat',
};

export function getTagLabel(tag: string): string {
  return (TAG_LABELS as Record<string, string>)[tag] ?? tag;
}

export type TagMode = 'any' | 'all';
export const TAG_MODES: readonly TagMode[] = ['any', 'all'] as const;

// ── Hard ceilings (defense-in-depth) ────────────────────────────────────────

/** Hardest possible cap on candidate cities returned by the resolver. */
export const MAX_EXPANDED_CITIES = 100;
/** Default cap when caller doesn't supply one (still ≤ MAX_EXPANDED_CITIES). */
export const DEFAULT_EXPANDED_MAX = 75;

// ── Re-projection of the seed-12 region tags onto the finer taxonomy ────────

const SEED_REGION_OVERRIDE: Record<string, CityRegion> = {
  // Direct overrides where the seed's coarse tag maps to a more specific bucket.
  // Keys are seed-city ids; values are the Step-152 region.
  'columbia-sc':    'southeast',
  'new-york-ny':    'northeast',
  'chicago-il':     'midwest',
  'dallas-tx':      'texas',
  'miami-fl':       'florida',
  'denver-co':      'mountain',
  'phoenix-az':     'southwest',
  'seattle-wa':     'pacific_northwest',
  'los-angeles-ca': 'west_coast',
  'boston-ma':      'northeast',
  'minneapolis-mn': 'midwest',
  'new-orleans-la': 'southeast',
};

function projectSeedCity(seed: ForecastQualitySeedCity): WeatherMarketCity {
  const [city, state] = seed.label.split(',').map((s) => s.trim());
  const region = SEED_REGION_OVERRIDE[seed.id] ?? 'southeast';
  return {
    id: seed.id,
    label: seed.label,
    city: city ?? seed.label,
    state: state ?? '',
    lat: seed.lat,
    lon: seed.lon,
    region,
  };
}

// ── Expanded US set (≈75 cities, hand-curated for diversity) ───────────────
//
// Coordinates are city centroids accurate to ~3 decimals. The list
// intentionally mixes top metros with weather-diverse outliers
// (mountain, desert, plains, coastal, Great Lakes, deep south,
// pacific northwest) so a target-difference search has a real chance
// of finding contrasts. Mainland US only — Alaska/Hawaii forecast
// handling is left for a later step.

const EXPANDED_US_CITIES: WeatherMarketCity[] = [
  // ── Northeast / Mid-Atlantic ──
  { id: 'new-york-ny',       label: 'New York, NY',       city: 'New York',       state: 'NY', lat: 40.7128, lon: -74.0060,  region: 'northeast', populationRank: 1 },
  { id: 'philadelphia-pa',   label: 'Philadelphia, PA',   city: 'Philadelphia',   state: 'PA', lat: 39.9526, lon: -75.1652,  region: 'northeast', populationRank: 6 },
  { id: 'washington-dc',     label: 'Washington, DC',     city: 'Washington',     state: 'DC', lat: 38.9072, lon: -77.0369,  region: 'northeast', populationRank: 23 },
  { id: 'boston-ma',         label: 'Boston, MA',         city: 'Boston',         state: 'MA', lat: 42.3601, lon: -71.0589,  region: 'northeast', populationRank: 24 },
  { id: 'baltimore-md',      label: 'Baltimore, MD',      city: 'Baltimore',      state: 'MD', lat: 39.2904, lon: -76.6122,  region: 'northeast', populationRank: 30 },
  { id: 'pittsburgh-pa',     label: 'Pittsburgh, PA',     city: 'Pittsburgh',     state: 'PA', lat: 40.4406, lon: -79.9959,  region: 'northeast', populationRank: 68 },
  { id: 'buffalo-ny',        label: 'Buffalo, NY',        city: 'Buffalo',        state: 'NY', lat: 42.8864, lon: -78.8784,  region: 'northeast', populationRank: 76 },
  { id: 'newark-nj',         label: 'Newark, NJ',         city: 'Newark',         state: 'NJ', lat: 40.7357, lon: -74.1724,  region: 'northeast' },
  { id: 'hartford-ct',       label: 'Hartford, CT',       city: 'Hartford',       state: 'CT', lat: 41.7658, lon: -72.6734,  region: 'northeast' },
  { id: 'providence-ri',     label: 'Providence, RI',     city: 'Providence',     state: 'RI', lat: 41.8240, lon: -71.4128,  region: 'northeast' },
  { id: 'burlington-vt',     label: 'Burlington, VT',     city: 'Burlington',     state: 'VT', lat: 44.4759, lon: -73.2121,  region: 'northeast' },
  { id: 'portland-me',       label: 'Portland, ME',       city: 'Portland',       state: 'ME', lat: 43.6591, lon: -70.2568,  region: 'northeast' },
  { id: 'virginia-beach-va', label: 'Virginia Beach, VA', city: 'Virginia Beach', state: 'VA', lat: 36.8529, lon: -75.9780,  region: 'northeast', populationRank: 44 },

  // ── Southeast (excl. Texas & Florida; those have their own buckets) ──
  { id: 'charlotte-nc',      label: 'Charlotte, NC',      city: 'Charlotte',      state: 'NC', lat: 35.2271, lon: -80.8431,  region: 'southeast', populationRank: 16 },
  { id: 'nashville-tn',      label: 'Nashville, TN',      city: 'Nashville',      state: 'TN', lat: 36.1627, lon: -86.7816,  region: 'southeast', populationRank: 21 },
  { id: 'memphis-tn',        label: 'Memphis, TN',        city: 'Memphis',        state: 'TN', lat: 35.1495, lon: -90.0490,  region: 'southeast', populationRank: 28 },
  { id: 'louisville-ky',     label: 'Louisville, KY',     city: 'Louisville',     state: 'KY', lat: 38.2527, lon: -85.7585,  region: 'southeast', populationRank: 29 },
  { id: 'atlanta-ga',        label: 'Atlanta, GA',        city: 'Atlanta',        state: 'GA', lat: 33.7490, lon: -84.3880,  region: 'southeast', populationRank: 38 },
  { id: 'raleigh-nc',        label: 'Raleigh, NC',        city: 'Raleigh',        state: 'NC', lat: 35.7796, lon: -78.6382,  region: 'southeast', populationRank: 41 },
  { id: 'columbia-sc',       label: 'Columbia, SC',       city: 'Columbia',       state: 'SC', lat: 34.0007, lon: -81.0348,  region: 'southeast' },
  { id: 'charleston-sc',     label: 'Charleston, SC',     city: 'Charleston',     state: 'SC', lat: 32.7765, lon: -79.9311,  region: 'southeast' },
  { id: 'birmingham-al',     label: 'Birmingham, AL',     city: 'Birmingham',     state: 'AL', lat: 33.5186, lon: -86.8104,  region: 'southeast' },
  { id: 'richmond-va',       label: 'Richmond, VA',       city: 'Richmond',       state: 'VA', lat: 37.5407, lon: -77.4360,  region: 'southeast' },
  { id: 'knoxville-tn',      label: 'Knoxville, TN',      city: 'Knoxville',      state: 'TN', lat: 35.9606, lon: -83.9207,  region: 'southeast' },
  { id: 'new-orleans-la',    label: 'New Orleans, LA',    city: 'New Orleans',    state: 'LA', lat: 29.9511, lon: -90.0715,  region: 'southeast' },
  { id: 'lexington-ky',      label: 'Lexington, KY',      city: 'Lexington',      state: 'KY', lat: 38.0406, lon: -84.5037,  region: 'southeast' },

  // ── Florida ──
  { id: 'miami-fl',          label: 'Miami, FL',          city: 'Miami',          state: 'FL', lat: 25.7617, lon: -80.1918,  region: 'florida' },
  { id: 'jacksonville-fl',   label: 'Jacksonville, FL',   city: 'Jacksonville',   state: 'FL', lat: 30.3322, lon: -81.6557,  region: 'florida', populationRank: 12 },
  { id: 'tampa-fl',          label: 'Tampa, FL',          city: 'Tampa',          state: 'FL', lat: 27.9506, lon: -82.4572,  region: 'florida', populationRank: 48 },
  { id: 'orlando-fl',        label: 'Orlando, FL',        city: 'Orlando',        state: 'FL', lat: 28.5383, lon: -81.3792,  region: 'florida' },
  { id: 'tallahassee-fl',    label: 'Tallahassee, FL',    city: 'Tallahassee',    state: 'FL', lat: 30.4383, lon: -84.2807,  region: 'florida' },
  { id: 'pensacola-fl',      label: 'Pensacola, FL',      city: 'Pensacola',      state: 'FL', lat: 30.4213, lon: -87.2169,  region: 'florida' },

  // ── Midwest / Great Lakes ──
  { id: 'chicago-il',        label: 'Chicago, IL',        city: 'Chicago',        state: 'IL', lat: 41.8781, lon: -87.6298,  region: 'midwest',  populationRank: 3 },
  { id: 'columbus-oh',       label: 'Columbus, OH',       city: 'Columbus',       state: 'OH', lat: 39.9612, lon: -82.9988,  region: 'midwest',  populationRank: 14 },
  { id: 'indianapolis-in',   label: 'Indianapolis, IN',   city: 'Indianapolis',   state: 'IN', lat: 39.7684, lon: -86.1581,  region: 'midwest',  populationRank: 15 },
  { id: 'detroit-mi',        label: 'Detroit, MI',        city: 'Detroit',        state: 'MI', lat: 42.3314, lon: -83.0458,  region: 'midwest',  populationRank: 27 },
  { id: 'milwaukee-wi',      label: 'Milwaukee, WI',      city: 'Milwaukee',      state: 'WI', lat: 43.0389, lon: -87.9065,  region: 'midwest',  populationRank: 31 },
  { id: 'kansas-city-mo',    label: 'Kansas City, MO',    city: 'Kansas City',    state: 'MO', lat: 39.0997, lon: -94.5786,  region: 'midwest',  populationRank: 36 },
  { id: 'minneapolis-mn',    label: 'Minneapolis, MN',    city: 'Minneapolis',    state: 'MN', lat: 44.9778, lon: -93.2650,  region: 'midwest',  populationRank: 46 },
  { id: 'cleveland-oh',      label: 'Cleveland, OH',      city: 'Cleveland',      state: 'OH', lat: 41.4993, lon: -81.6944,  region: 'midwest',  populationRank: 50 },
  { id: 'cincinnati-oh',     label: 'Cincinnati, OH',     city: 'Cincinnati',     state: 'OH', lat: 39.1031, lon: -84.5120,  region: 'midwest',  populationRank: 53 },
  { id: 'st-louis-mo',       label: 'St. Louis, MO',      city: 'St. Louis',      state: 'MO', lat: 38.6270, lon: -90.1994,  region: 'midwest',  populationRank: 61 },
  { id: 'madison-wi',        label: 'Madison, WI',        city: 'Madison',        state: 'WI', lat: 43.0731, lon: -89.4012,  region: 'midwest' },
  { id: 'des-moines-ia',     label: 'Des Moines, IA',     city: 'Des Moines',     state: 'IA', lat: 41.5868, lon: -93.6250,  region: 'midwest' },

  // ── Plains ──
  { id: 'oklahoma-city-ok',  label: 'Oklahoma City, OK',  city: 'Oklahoma City',  state: 'OK', lat: 35.4676, lon: -97.5164,  region: 'plains',   populationRank: 22 },
  { id: 'omaha-ne',          label: 'Omaha, NE',          city: 'Omaha',          state: 'NE', lat: 41.2565, lon: -95.9345,  region: 'plains',   populationRank: 39 },
  { id: 'tulsa-ok',          label: 'Tulsa, OK',          city: 'Tulsa',          state: 'OK', lat: 36.1540, lon: -95.9928,  region: 'plains',   populationRank: 47 },
  { id: 'wichita-ks',        label: 'Wichita, KS',        city: 'Wichita',        state: 'KS', lat: 37.6872, lon: -97.3301,  region: 'plains',   populationRank: 51 },
  { id: 'lincoln-ne',        label: 'Lincoln, NE',        city: 'Lincoln',        state: 'NE', lat: 40.8136, lon: -96.7026,  region: 'plains' },
  { id: 'fargo-nd',          label: 'Fargo, ND',          city: 'Fargo',          state: 'ND', lat: 46.8772, lon: -96.7898,  region: 'plains' },
  { id: 'sioux-falls-sd',    label: 'Sioux Falls, SD',    city: 'Sioux Falls',    state: 'SD', lat: 43.5446, lon: -96.7311,  region: 'plains' },

  // ── Mountain ──
  { id: 'denver-co',         label: 'Denver, CO',         city: 'Denver',         state: 'CO', lat: 39.7392, lon: -104.9903, region: 'mountain', populationRank: 19 },
  { id: 'colorado-springs-co', label: 'Colorado Springs, CO', city: 'Colorado Springs', state: 'CO', lat: 38.8339, lon: -104.8214, region: 'mountain', populationRank: 40 },
  { id: 'salt-lake-city-ut', label: 'Salt Lake City, UT', city: 'Salt Lake City', state: 'UT', lat: 40.7608, lon: -111.8910, region: 'mountain' },
  { id: 'boise-id',          label: 'Boise, ID',          city: 'Boise',          state: 'ID', lat: 43.6150, lon: -116.2023, region: 'mountain' },
  { id: 'helena-mt',         label: 'Helena, MT',         city: 'Helena',         state: 'MT', lat: 46.5891, lon: -112.0391, region: 'mountain' },
  { id: 'cheyenne-wy',       label: 'Cheyenne, WY',       city: 'Cheyenne',       state: 'WY', lat: 41.1400, lon: -104.8202, region: 'mountain' },
  { id: 'reno-nv',           label: 'Reno, NV',           city: 'Reno',           state: 'NV', lat: 39.5296, lon: -119.8138, region: 'mountain' },

  // ── Southwest (desert / hot SW) ──
  { id: 'phoenix-az',        label: 'Phoenix, AZ',        city: 'Phoenix',        state: 'AZ', lat: 33.4484, lon: -112.0740, region: 'southwest', populationRank: 5 },
  { id: 'las-vegas-nv',      label: 'Las Vegas, NV',      city: 'Las Vegas',      state: 'NV', lat: 36.1699, lon: -115.1398, region: 'southwest', populationRank: 26 },
  { id: 'tucson-az',         label: 'Tucson, AZ',         city: 'Tucson',         state: 'AZ', lat: 32.2226, lon: -110.9747, region: 'southwest', populationRank: 33 },
  { id: 'mesa-az',           label: 'Mesa, AZ',           city: 'Mesa',           state: 'AZ', lat: 33.4152, lon: -111.8315, region: 'southwest', populationRank: 37 },
  { id: 'albuquerque-nm',    label: 'Albuquerque, NM',    city: 'Albuquerque',    state: 'NM', lat: 35.0844, lon: -106.6504, region: 'southwest', populationRank: 32 },
  { id: 'santa-fe-nm',       label: 'Santa Fe, NM',       city: 'Santa Fe',       state: 'NM', lat: 35.6870, lon: -105.9378, region: 'southwest' },

  // ── West Coast (CA + Reno excluded — kept in mountain) ──
  { id: 'los-angeles-ca',    label: 'Los Angeles, CA',    city: 'Los Angeles',    state: 'CA', lat: 34.0522, lon: -118.2437, region: 'west_coast', populationRank: 2 },
  { id: 'san-diego-ca',      label: 'San Diego, CA',      city: 'San Diego',      state: 'CA', lat: 32.7157, lon: -117.1611, region: 'west_coast', populationRank: 8 },
  { id: 'san-jose-ca',       label: 'San Jose, CA',       city: 'San Jose',       state: 'CA', lat: 37.3382, lon: -121.8863, region: 'west_coast', populationRank: 10 },
  { id: 'san-francisco-ca',  label: 'San Francisco, CA',  city: 'San Francisco',  state: 'CA', lat: 37.7749, lon: -122.4194, region: 'west_coast', populationRank: 17 },
  { id: 'fresno-ca',         label: 'Fresno, CA',         city: 'Fresno',         state: 'CA', lat: 36.7378, lon: -119.7871, region: 'west_coast', populationRank: 34 },
  { id: 'sacramento-ca',     label: 'Sacramento, CA',     city: 'Sacramento',     state: 'CA', lat: 38.5816, lon: -121.4944, region: 'west_coast', populationRank: 35 },
  { id: 'long-beach-ca',     label: 'Long Beach, CA',     city: 'Long Beach',     state: 'CA', lat: 33.7701, lon: -118.1937, region: 'west_coast', populationRank: 43 },
  { id: 'oakland-ca',        label: 'Oakland, CA',        city: 'Oakland',        state: 'CA', lat: 37.8044, lon: -122.2712, region: 'west_coast', populationRank: 45 },
  { id: 'bakersfield-ca',    label: 'Bakersfield, CA',    city: 'Bakersfield',    state: 'CA', lat: 35.3733, lon: -119.0187, region: 'west_coast', populationRank: 52 },
  { id: 'anaheim-ca',        label: 'Anaheim, CA',        city: 'Anaheim',        state: 'CA', lat: 33.8366, lon: -117.9143, region: 'west_coast', populationRank: 55 },
  { id: 'riverside-ca',      label: 'Riverside, CA',      city: 'Riverside',      state: 'CA', lat: 33.9533, lon: -117.3962, region: 'west_coast', populationRank: 57 },

  // ── Pacific Northwest ──
  { id: 'seattle-wa',        label: 'Seattle, WA',        city: 'Seattle',        state: 'WA', lat: 47.6062, lon: -122.3321, region: 'pacific_northwest', populationRank: 18 },
  { id: 'portland-or',       label: 'Portland, OR',       city: 'Portland',       state: 'OR', lat: 45.5152, lon: -122.6784, region: 'pacific_northwest', populationRank: 25 },
  { id: 'spokane-wa',        label: 'Spokane, WA',        city: 'Spokane',        state: 'WA', lat: 47.6588, lon: -117.4260, region: 'pacific_northwest' },
  { id: 'eugene-or',         label: 'Eugene, OR',         city: 'Eugene',         state: 'OR', lat: 44.0521, lon: -123.0868, region: 'pacific_northwest' },

  // ── Texas ──
  { id: 'houston-tx',        label: 'Houston, TX',        city: 'Houston',        state: 'TX', lat: 29.7604, lon: -95.3698,  region: 'texas',     populationRank: 4 },
  { id: 'san-antonio-tx',    label: 'San Antonio, TX',    city: 'San Antonio',    state: 'TX', lat: 29.4241, lon: -98.4936,  region: 'texas',     populationRank: 7 },
  { id: 'dallas-tx',         label: 'Dallas, TX',         city: 'Dallas',         state: 'TX', lat: 32.7767, lon: -96.7970,  region: 'texas',     populationRank: 9 },
  { id: 'austin-tx',         label: 'Austin, TX',         city: 'Austin',         state: 'TX', lat: 30.2672, lon: -97.7431,  region: 'texas',     populationRank: 11 },
  { id: 'fort-worth-tx',     label: 'Fort Worth, TX',     city: 'Fort Worth',     state: 'TX', lat: 32.7555, lon: -97.3308,  region: 'texas',     populationRank: 13 },
  { id: 'el-paso-tx',        label: 'El Paso, TX',        city: 'El Paso',        state: 'TX', lat: 31.7619, lon: -106.4850, region: 'texas',     populationRank: 20 },
  { id: 'lubbock-tx',        label: 'Lubbock, TX',        city: 'Lubbock',        state: 'TX', lat: 33.5779, lon: -101.8552, region: 'texas' },
  { id: 'amarillo-tx',       label: 'Amarillo, TX',       city: 'Amarillo',       state: 'TX', lat: 35.2220, lon: -101.8313, region: 'texas' },
  { id: 'corpus-christi-tx', label: 'Corpus Christi, TX', city: 'Corpus Christi', state: 'TX', lat: 27.8006, lon: -97.3964,  region: 'texas' },
];

// ── Resolver ────────────────────────────────────────────────────────────────

export interface ResolveCityUniverseOptions {
  /** 'seed_12' (the existing 12 seed cities) or 'expanded_us' (the curated ~75-city set). */
  mode: CityUniverseMode;
  /** Optional region filter. `'all_expanded'` means no filter. */
  region?: CityRegionFilter;
  /** Optional explicit id allow-list (e.g. operator deselected some cities). */
  cityIds?: string[];
  /** Hard cap on returned cities. Clamped to `MAX_EXPANDED_CITIES`. */
  maxCandidateCities?: number;
  /**
   * Step 154 — optional weather-personality tag filter. When present
   * and `cityIds` is empty, the resolver narrows to cities whose
   * static tag set matches `weatherTags` per `tagMode` (`'any'` keeps
   * a city with at least one match; `'all'` requires every tag).
   * When `cityIds` is non-empty, the explicit selection wins and
   * tags/region are ignored.
   */
  weatherTags?: WeatherPersonalityTag[];
  tagMode?: TagMode;
}

export interface ResolveCityUniverseResult {
  cities: WeatherMarketCity[];
  /** Was the result truncated by `maxCandidateCities` / `MAX_EXPANDED_CITIES`? */
  cappedAt?: number;
  /**
   * Step 154 — count of cities that survived the tag filter (after
   * region narrowing, before the cap). Equal to `cities.length` when
   * no tag filter was applied.
   */
  tagFilteredCityCount?: number;
}

/**
 * Pure resolver. **Reads no I/O — only returns slices of the static
 * arrays above.** Backward-compatible with the Step-145 call sites:
 * the seed-12 mode returns the same cities (with re-projected
 * regions) so existing seed-city ids in saved ideas / drafts /
 * QA records continue to resolve.
 *
 * Step 154 — when `weatherTags` is supplied (and `cityIds` is empty),
 * the resolver narrows the pool to cities matching those tags per
 * `tagMode`. Every returned city carries its static tag overlay in
 * `tags` so the UI / risk analyzer can render them without re-deriving.
 */
export function resolveCityUniverse(
  options: ResolveCityUniverseOptions,
): ResolveCityUniverseResult {
  let pool: WeatherMarketCity[];
  switch (options.mode) {
    case 'expanded_us':
      // Augment with tag overlay so callers always see populated tags.
      pool = EXPANDED_US_CITIES.map((c) => ({ ...c, tags: getCityTags(c.id) }));
      break;
    case 'seed_12':
    default:
      pool = FORECAST_QUALITY_SEED_CITIES.map((s) => {
        const projected = projectSeedCity(s);
        return { ...projected, tags: getCityTags(projected.id) };
      });
      break;
  }

  if (options.region && options.region !== 'all_expanded') {
    pool = pool.filter((c) => c.region === options.region);
  }
  if (options.cityIds && options.cityIds.length > 0) {
    const wanted = new Set(options.cityIds);
    pool = pool.filter((c) => wanted.has(c.id));
  }

  // Step 154 — tag filter applies AFTER region narrowing but BEFORE
  // the candidate cap, and only when no explicit `cityIds` selection
  // was supplied (per the "selection overrides tags" rule).
  let tagFilteredCityCount: number | undefined;
  if (
    (!options.cityIds || options.cityIds.length === 0) &&
    options.weatherTags &&
    options.weatherTags.length > 0
  ) {
    const mode: TagMode = options.tagMode ?? 'any';
    const tagSet = options.weatherTags;
    pool = pool.filter((c) => {
      const cityTags = c.tags ?? [];
      if (cityTags.length === 0) return false;
      return mode === 'all'
        ? tagSet.every((t) => cityTags.includes(t))
        : tagSet.some((t) => cityTags.includes(t));
    });
    tagFilteredCityCount = pool.length;
  }

  const requestedCap = options.maxCandidateCities ?? Number.POSITIVE_INFINITY;
  const cap = Math.min(MAX_EXPANDED_CITIES, Math.max(1, requestedCap));
  if (pool.length > cap) {
    return { cities: pool.slice(0, cap), cappedAt: cap, tagFilteredCityCount };
  }
  return { cities: pool, tagFilteredCityCount };
}

/** Convenience for the API: total expanded-set size for UI labels / limits. */
export const EXPANDED_US_CITY_COUNT = EXPANDED_US_CITIES.length;

// ── Step 153 — accessors used by the searchable picker + city-set store ───
//
// These exports keep the canonical city catalog inside this module
// (so a typo in operator input cannot widen the scan) while letting
// the API surface a curated read-only view + validate ids.

/**
 * Read-only snapshot of the curated expanded universe. The bootstrap
 * response sends this verbatim to the admin UI for the picker. **Admin
 * surface only — never reach this from public/customer code paths.**
 */
export function listExpandedUniverse(): readonly WeatherMarketCity[] {
  return EXPANDED_US_CITIES;
}

/** Look up a single city by id from the expanded universe. */
export function findExpandedCityById(id: string): WeatherMarketCity | undefined {
  if (!id) return undefined;
  return EXPANDED_US_CITIES.find((c) => c.id === id);
}

export interface ValidateCityIdsResult {
  /** Ids that resolved to a city in the expanded universe. */
  valid: string[];
  /** Ids the caller supplied that did NOT resolve. Useful for clear 400s. */
  invalid: string[];
}

/**
 * Validate an array of city ids against the curated expanded universe.
 * Used by the admin endpoint to reject typos / hostile input cleanly
 * (rather than silently filtering them, which can mask bugs in the UI).
 */
export function validateExpandedCityIds(ids: readonly string[]): ValidateCityIdsResult {
  const valid: string[] = [];
  const invalid: string[] = [];
  const known = new Set(EXPANDED_US_CITIES.map((c) => c.id));
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) {
      invalid.push(String(id));
      continue;
    }
    if (known.has(id)) valid.push(id);
    else invalid.push(id);
  }
  return { valid, invalid };
}

// ── Step 154 — Per-city tag overlay ────────────────────────────────────────
//
// Curated, non-scientific climatological tags. Kept as an overlay map
// rather than inlined in the city array so the city catalog stays
// grep-friendly and easy to skim. **Static, allow-listed, no I/O.**
// Cities that aren't keyed here resolve to an empty tag array. Adding
// a new tag means: extend `WeatherPersonalityTag`, add the label to
// `TAG_LABELS`, and add it to the relevant city entries below.

const CITY_TAGS_BY_ID: Record<string, WeatherPersonalityTag[]> = {
  // ── Northeast ──
  'new-york-ny':       ['humid', 'urban_heat', 'snowy', 'coastal'],
  'philadelphia-pa':   ['humid', 'urban_heat', 'snowy'],
  'washington-dc':     ['humid', 'urban_heat', 'freeze_risk'],
  'boston-ma':         ['cold', 'snowy', 'coastal', 'freeze_risk', 'urban_heat'],
  'baltimore-md':      ['humid', 'urban_heat'],
  'pittsburgh-pa':     ['snowy', 'freeze_risk', 'high_variability'],
  'buffalo-ny':        ['snowy', 'lake_effect', 'cold', 'freeze_risk', 'windy'],
  'newark-nj':         ['humid', 'urban_heat'],
  'hartford-ct':       ['snowy', 'freeze_risk', 'high_variability'],
  'providence-ri':     ['coastal', 'snowy', 'freeze_risk'],
  'burlington-vt':     ['cold', 'snowy', 'freeze_risk', 'lake_effect'],
  'portland-me':       ['cold', 'coastal', 'snowy', 'freeze_risk'],
  'virginia-beach-va': ['humid', 'coastal', 'hurricane_exposed'],

  // ── Southeast ──
  'charlotte-nc':      ['humid', 'storm_prone'],
  'nashville-tn':      ['humid', 'severe_weather', 'storm_prone'],
  'memphis-tn':        ['humid', 'hot', 'severe_weather', 'storm_prone'],
  'louisville-ky':     ['humid', 'severe_weather'],
  'atlanta-ga':        ['humid', 'urban_heat', 'storm_prone'],
  'raleigh-nc':        ['humid', 'hurricane_exposed'],
  'columbia-sc':       ['humid', 'hot', 'hurricane_exposed'],
  'charleston-sc':     ['humid', 'coastal', 'hurricane_exposed', 'hot'],
  'birmingham-al':     ['humid', 'hot', 'severe_weather', 'storm_prone'],
  'richmond-va':       ['humid', 'hurricane_exposed'],
  'knoxville-tn':      ['humid', 'high_variability'],
  'new-orleans-la':    ['humid', 'hot', 'hurricane_exposed', 'coastal'],
  'lexington-ky':      ['humid', 'high_variability'],

  // ── Florida ──
  'miami-fl':          ['hot', 'humid', 'hurricane_exposed', 'coastal', 'heat_index'],
  'jacksonville-fl':   ['hot', 'humid', 'hurricane_exposed', 'coastal'],
  'tampa-fl':          ['hot', 'humid', 'hurricane_exposed', 'coastal', 'heat_index'],
  'orlando-fl':        ['hot', 'humid', 'hurricane_exposed', 'storm_prone'],
  'tallahassee-fl':    ['hot', 'humid', 'hurricane_exposed'],
  'pensacola-fl':      ['hot', 'humid', 'hurricane_exposed', 'coastal'],

  // ── Midwest ──
  'chicago-il':        ['cold', 'snowy', 'lake_effect', 'windy', 'urban_heat', 'freeze_risk', 'high_variability'],
  'columbus-oh':       ['snowy', 'freeze_risk', 'high_variability'],
  'indianapolis-in':   ['snowy', 'freeze_risk', 'severe_weather'],
  'detroit-mi':        ['cold', 'snowy', 'lake_effect', 'freeze_risk', 'urban_heat'],
  'milwaukee-wi':      ['cold', 'snowy', 'lake_effect', 'freeze_risk', 'windy'],
  'kansas-city-mo':    ['plains', 'severe_weather', 'storm_prone', 'high_variability'],
  'minneapolis-mn':    ['cold', 'snowy', 'freeze_risk', 'big_diurnal_swing'],
  'cleveland-oh':      ['cold', 'snowy', 'lake_effect', 'freeze_risk'],
  'cincinnati-oh':     ['humid', 'snowy', 'severe_weather'],
  'st-louis-mo':       ['humid', 'severe_weather', 'storm_prone', 'high_variability'],
  'madison-wi':        ['cold', 'snowy', 'freeze_risk'],
  'des-moines-ia':     ['cold', 'snowy', 'plains', 'severe_weather'],

  // ── Plains ──
  'oklahoma-city-ok':  ['plains', 'severe_weather', 'storm_prone', 'windy', 'high_variability'],
  'omaha-ne':          ['plains', 'severe_weather', 'snowy', 'windy'],
  'tulsa-ok':          ['plains', 'severe_weather', 'storm_prone'],
  'wichita-ks':        ['plains', 'severe_weather', 'storm_prone', 'windy'],
  'lincoln-ne':        ['plains', 'severe_weather', 'snowy'],
  'fargo-nd':          ['cold', 'plains', 'snowy', 'windy', 'freeze_risk', 'big_diurnal_swing'],
  'sioux-falls-sd':    ['plains', 'snowy', 'severe_weather', 'windy'],

  // ── Mountain ──
  'denver-co':         ['mountain', 'dry', 'big_diurnal_swing', 'snowy', 'freeze_risk', 'high_variability'],
  'colorado-springs-co': ['mountain', 'dry', 'big_diurnal_swing', 'snowy'],
  'salt-lake-city-ut': ['mountain', 'dry', 'snowy', 'big_diurnal_swing'],
  'boise-id':          ['mountain', 'dry', 'snowy', 'freeze_risk'],
  'helena-mt':         ['mountain', 'cold', 'dry', 'snowy', 'freeze_risk', 'big_diurnal_swing'],
  'cheyenne-wy':       ['mountain', 'plains', 'windy', 'dry', 'snowy', 'big_diurnal_swing'],
  'reno-nv':           ['mountain', 'dry', 'big_diurnal_swing'],

  // ── Southwest ──
  'phoenix-az':        ['hot', 'dry', 'desert', 'urban_heat', 'heat_index'],
  'las-vegas-nv':      ['hot', 'dry', 'desert', 'urban_heat', 'heat_index'],
  'tucson-az':         ['hot', 'dry', 'desert'],
  'mesa-az':           ['hot', 'dry', 'desert', 'urban_heat'],
  'albuquerque-nm':    ['dry', 'mountain', 'big_diurnal_swing'],
  'santa-fe-nm':       ['mountain', 'dry', 'big_diurnal_swing', 'snowy'],

  // ── West Coast ──
  'los-angeles-ca':    ['coastal', 'urban_heat'],
  'san-diego-ca':      ['coastal'],
  'san-jose-ca':       ['coastal'],
  'san-francisco-ca':  ['coastal'],
  'fresno-ca':         ['hot', 'dry', 'urban_heat'],
  'sacramento-ca':     ['hot', 'dry'],
  'long-beach-ca':     ['coastal'],
  'oakland-ca':        ['coastal'],
  'bakersfield-ca':    ['hot', 'dry', 'desert'],
  'anaheim-ca':        ['coastal', 'urban_heat'],
  'riverside-ca':      ['hot', 'dry'],

  // ── Pacific Northwest ──
  'seattle-wa':        ['rainy', 'coastal'],
  'portland-or':       ['rainy', 'coastal'],
  'spokane-wa':        ['dry', 'snowy', 'freeze_risk'],
  'eugene-or':         ['rainy'],

  // ── Texas ──
  'houston-tx':        ['hot', 'humid', 'hurricane_exposed', 'coastal', 'urban_heat', 'storm_prone'],
  'san-antonio-tx':    ['hot', 'humid', 'severe_weather'],
  'dallas-tx':         ['hot', 'humid', 'severe_weather', 'storm_prone', 'urban_heat'],
  'austin-tx':         ['hot', 'humid', 'severe_weather'],
  'fort-worth-tx':     ['hot', 'severe_weather', 'plains', 'storm_prone'],
  'el-paso-tx':        ['hot', 'dry', 'desert', 'big_diurnal_swing'],
  'lubbock-tx':        ['plains', 'dry', 'severe_weather', 'windy', 'big_diurnal_swing'],
  'amarillo-tx':       ['plains', 'dry', 'severe_weather', 'windy', 'big_diurnal_swing'],
  'corpus-christi-tx': ['hot', 'humid', 'hurricane_exposed', 'coastal'],
};

/** Step 154 — return the static tag array for a given city id. */
export function getCityTags(id: string): WeatherPersonalityTag[] {
  return CITY_TAGS_BY_ID[id] ?? [];
}

/** Step 154 — public list of allowed tags. */
export function listWeatherPersonalityTags(): readonly WeatherPersonalityTag[] {
  return WEATHER_PERSONALITY_TAGS;
}

/**
 * Validate an array of operator-supplied tag strings against the
 * static allow-list. Used by the admin endpoint to reject typos /
 * hostile input cleanly.
 */
export interface ValidateTagsResult {
  valid: WeatherPersonalityTag[];
  invalid: string[];
}
export function validateWeatherPersonalityTags(tags: readonly string[]): ValidateTagsResult {
  const valid: WeatherPersonalityTag[] = [];
  const invalid: string[] = [];
  const known = new Set(WEATHER_PERSONALITY_TAGS as readonly string[]);
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string' || t.length === 0) {
      invalid.push(String(t));
      continue;
    }
    if (seen.has(t)) continue;
    seen.add(t);
    if (known.has(t)) valid.push(t as WeatherPersonalityTag);
    else invalid.push(t);
  }
  return { valid, invalid };
}

/**
 * Filter the full expanded universe by a tag set. `mode='any'` keeps a
 * city if it has at least one matching tag; `mode='all'` requires every
 * tag to be present. Pure data over the static catalog — no fetch, no
 * Redis. Returns cities with their `tags` already populated.
 */
export function getCitiesByTags(
  tags: readonly WeatherPersonalityTag[],
  mode: TagMode = 'any',
): WeatherMarketCity[] {
  if (tags.length === 0) {
    return EXPANDED_US_CITIES.map((c) => ({ ...c, tags: getCityTags(c.id) }));
  }
  const out: WeatherMarketCity[] = [];
  for (const c of EXPANDED_US_CITIES) {
    const cityTags = getCityTags(c.id);
    const matches =
      mode === 'all'
        ? tags.every((t) => cityTags.includes(t))
        : tags.some((t) => cityTags.includes(t));
    if (matches) out.push({ ...c, tags: cityTags });
  }
  return out;
}

/** Per-tag count across the expanded universe — for the bootstrap UI. */
export function expandedCityCountsByTag(): Record<WeatherPersonalityTag, number> {
  const out = Object.fromEntries(
    WEATHER_PERSONALITY_TAGS.map((t) => [t, 0]),
  ) as Record<WeatherPersonalityTag, number>;
  for (const c of EXPANDED_US_CITIES) {
    for (const t of getCityTags(c.id)) {
      out[t] += 1;
    }
  }
  return out;
}

// ── Step 154 — Smart discovery presets ─────────────────────────────────────
//
// Operator-friendly named scans. **Static, allow-listed.** Each preset
// resolves through the approved static universe; a preset can supply
// either tags+tagMode or cityIds (or both — cityIds takes precedence
// in the UI when both are present, but both are exposed so the operator
// can read what the preset stands for). Suggested numeric defaults can
// be empty — a preset without a target difference falls back to the
// generator's "most interesting" mode.

export type MetricPairOptionForPreset =
  | 'high_vs_high'
  | 'low_vs_low'
  | 'high_vs_low'
  | 'any_temperature_pair';

export interface SmartDiscoveryPreset {
  id: string;
  label: string;
  description: string;
  /** When set, applied as the tag filter. */
  tags?: WeatherPersonalityTag[];
  tagMode?: TagMode;
  /** When set, used as the explicit selection (overrides region+tags). */
  cityIds?: string[];
  /** Optional region narrowing applied alongside tags. */
  region?: CityRegionFilter;
  /** Suggested generator knobs (operator can still edit before Generate). */
  metricPair?: MetricPairOptionForPreset;
  targetDifferenceF?: number;
  toleranceF?: number;
  dayOffset?: number;
}

export const SMART_DISCOVERY_PRESETS: readonly SmartDiscoveryPreset[] = [
  {
    id: 'hot_vs_cold',
    label: 'Hot vs Cold contrast',
    description:
      'Contrast hot-tagged cities with cold-tagged cities for big spread opportunities. Pairs are still drawn from the approved universe.',
    tags: ['hot', 'cold'],
    tagMode: 'any',
    metricPair: 'high_vs_high',
    targetDifferenceF: 30,
    toleranceF: 5,
    dayOffset: 1,
  },
  {
    id: 'desert_vs_mountain',
    label: 'Desert heat vs Mountain cold',
    description:
      'Filter to desert-tagged and mountain-tagged cities — typically big high-vs-high or high-vs-low spreads in summer.',
    tags: ['desert', 'mountain'],
    tagMode: 'any',
    metricPair: 'high_vs_high',
    targetDifferenceF: 25,
    toleranceF: 5,
    dayOffset: 1,
  },
  {
    id: 'humid_vs_dry',
    label: 'Humid vs Dry',
    description:
      'Contrast humid southeast/coastal cities against dry mountain/southwest cities. Useful for heat-index narratives.',
    tags: ['humid', 'dry'],
    tagMode: 'any',
    metricPair: 'high_vs_high',
    targetDifferenceF: 15,
    toleranceF: 5,
    dayOffset: 1,
  },
  {
    id: 'windy_markets',
    label: 'Windy markets',
    description:
      'Restrict to cities tagged windy. Pair with future wind-spread support; for now still emits temperature pairs.',
    tags: ['windy'],
    tagMode: 'any',
    metricPair: 'high_vs_high',
    targetDifferenceF: 15,
    toleranceF: 5,
    dayOffset: 1,
  },
  {
    id: 'snow_risk',
    label: 'Snow risk',
    description:
      'Cities tagged snowy or freeze-risk. Most useful in the cool half of the year.',
    tags: ['snowy', 'freeze_risk'],
    tagMode: 'any',
    metricPair: 'low_vs_low',
    targetDifferenceF: 20,
    toleranceF: 5,
    dayOffset: 1,
  },
  {
    id: 'severe_weather_watch',
    label: 'Severe weather watch',
    description:
      'Cities tagged severe-weather or storm-prone (Tornado Alley + southern thunderstorm corridors).',
    tags: ['severe_weather', 'storm_prone'],
    tagMode: 'any',
    metricPair: 'any_temperature_pair',
    dayOffset: 1,
  },
  {
    id: 'coastal_vs_inland',
    label: 'Coastal vs inland',
    description:
      'Filter to coastal-tagged cities for cross-coast or coast-vs-inland pairings.',
    tags: ['coastal'],
    tagMode: 'any',
    metricPair: 'high_vs_high',
    targetDifferenceF: 10,
    toleranceF: 5,
    dayOffset: 1,
  },
  {
    id: 'big_temperature_swing',
    label: 'Big diurnal swing',
    description:
      'Cities known for big day-to-night temperature swings (mountains, deserts, plains).',
    tags: ['big_diurnal_swing'],
    tagMode: 'any',
    metricPair: 'high_vs_low',
    dayOffset: 1,
  },
  {
    id: 'texas_heat',
    label: 'Texas heat cities',
    description:
      'Hot-tagged cities in Texas. Combine with high-vs-high for intra-region spread ideas.',
    tags: ['hot'],
    tagMode: 'any',
    region: 'texas',
    metricPair: 'high_vs_high',
    targetDifferenceF: 10,
    toleranceF: 5,
    dayOffset: 1,
  },
  {
    id: 'nfl_weather_cities',
    label: 'NFL-style weather cities',
    description:
      'Cold/wind/snow NFL-stadium cities for Sunday-weather narratives. Curated city list — no tag filter.',
    cityIds: [
      'buffalo-ny',
      'chicago-il',
      'pittsburgh-pa',
      'cleveland-oh',
      'denver-co',
      'seattle-wa',
      'boston-ma',
      'minneapolis-mn',
      'kansas-city-mo',
      'philadelphia-pa',
      'detroit-mi',
    ],
    metricPair: 'low_vs_low',
    dayOffset: 1,
  },
];

export function listSmartDiscoveryPresets(): readonly SmartDiscoveryPreset[] {
  return SMART_DISCOVERY_PRESETS;
}

export function getSmartDiscoveryPreset(id: string): SmartDiscoveryPreset | undefined {
  if (!id) return undefined;
  return SMART_DISCOVERY_PRESETS.find((p) => p.id === id);
}

export function isValidPresetId(id: string): boolean {
  return !!getSmartDiscoveryPreset(id);
}
