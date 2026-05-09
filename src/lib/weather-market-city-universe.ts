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
}

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
}

export interface ResolveCityUniverseResult {
  cities: WeatherMarketCity[];
  /** Was the result truncated by `maxCandidateCities` / `MAX_EXPANDED_CITIES`? */
  cappedAt?: number;
}

/**
 * Pure resolver. **Reads no I/O — only returns slices of the static
 * arrays above.** Backward-compatible with the Step-145 call sites:
 * the seed-12 mode returns the same cities (with re-projected
 * regions) so existing seed-city ids in saved ideas / drafts /
 * QA records continue to resolve.
 */
export function resolveCityUniverse(
  options: ResolveCityUniverseOptions,
): ResolveCityUniverseResult {
  let pool: WeatherMarketCity[];
  switch (options.mode) {
    case 'expanded_us':
      pool = EXPANDED_US_CITIES;
      break;
    case 'seed_12':
    default:
      pool = FORECAST_QUALITY_SEED_CITIES.map(projectSeedCity);
      break;
  }

  if (options.region && options.region !== 'all_expanded') {
    pool = pool.filter((c) => c.region === options.region);
  }
  if (options.cityIds && options.cityIds.length > 0) {
    const wanted = new Set(options.cityIds);
    pool = pool.filter((c) => wanted.has(c.id));
  }

  const requestedCap = options.maxCandidateCities ?? Number.POSITIVE_INFINITY;
  const cap = Math.min(MAX_EXPANDED_CITIES, Math.max(1, requestedCap));
  if (pool.length > cap) {
    return { cities: pool.slice(0, cap), cappedAt: cap };
  }
  return { cities: pool };
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
