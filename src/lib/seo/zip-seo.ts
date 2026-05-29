// ── Step 174: Scalable ZIP-page SEO template ────────────────────────────
//
// Reusable helper that builds a non-priority ZIP page's title / H1 /
// description / intro from `(city, state, zip)` plus optional weather
// signals. Priority ZIPs continue to use `priority-zip-content.ts` —
// this template fills the gap for the other ~41,000 ZIPs.
//
// Pure helpers. No I/O. Used by `src/pages/[...slug].astro`.

import { getPriorityZipContent, type PriorityZipContent } from '../priority-zip-content';
import { stateAbbrToSlug } from '../state-names';

const CANONICAL_HOST = 'https://wageronweather.com';

export interface ZipSeoInput {
  city: string;
  state: string;
  zip: string;
  /** Lower-case slug for the city (re-used for hub links). */
  citySlug?: string;
  /** Optional current conditions used to flavor the intro. */
  tempF?: number;
  highF?: number;
  lowF?: number;
  precipChance?: number;
  description?: string;
  alerts?: { event: string }[];
}

export interface ZipSeoResult {
  title: string;
  h1: string;
  description: string;
  intro: string;
  canonicalUrl: string;
  parentCityHubUrl?: string;
  parentStateHubUrl?: string;
  relatedZipUrls: string[];
  featuredZipUrls: string[];
  /** True when the input matched the Step 173 priority list (caller may skip the template). */
  isPriorityZip: boolean;
}

/** Default values shared with every non-priority ZIP. */
const DEFAULT_HIGHLIGHTS = ['rain', 'wind', 'heat', 'storms'];

const CONCERN_BY_STATE: Record<string, string[]> = {
  AL: ['heat', 'humidity', 'severe thunderstorms', 'hurricane risk'],
  AK: ['cold snaps', 'snow', 'wind chills', 'rapidly changing skies'],
  AZ: ['extreme heat', 'monsoon storms', 'dust advisories', 'dry air'],
  AR: ['heat', 'humidity', 'severe thunderstorms', 'tornado risk'],
  CA: ['heat waves', 'wildfire smoke', 'coastal fog', 'atmospheric rivers'],
  CO: ['high-altitude cold', 'snowfall', 'wind', 'rapidly changing afternoons'],
  CT: ['nor’easters', 'coastal storms', 'humidity', 'winter cold'],
  DE: ['coastal storms', 'humidity', 'winter cold', 'nor’easters'],
  DC: ['urban heat', 'humidity', 'thunderstorms', 'winter ice'],
  FL: ['heat', 'humidity', 'afternoon thunderstorms', 'hurricane season'],
  GA: ['heat', 'humidity', 'severe storms', 'tropical impacts'],
  HI: ['trade-wind shifts', 'tropical storms', 'micro-climate rainfall', 'vog'],
  ID: ['mountain snow', 'wildfire smoke', 'wind', 'temperature swings'],
  IL: ['lake-effect cold', 'severe storms', 'humidity', 'snow'],
  IN: ['severe storms', 'humidity', 'snow', 'winter cold'],
  IA: ['severe storms', 'tornado risk', 'snow', 'wind chills'],
  KS: ['severe storms', 'tornado risk', 'high winds', 'heat'],
  KY: ['severe storms', 'humidity', 'flooding', 'winter ice'],
  LA: ['heat', 'humidity', 'tropical storms', 'flash flooding'],
  ME: ['nor’easters', 'snow', 'wind chills', 'coastal storms'],
  MD: ['coastal storms', 'humidity', 'winter ice', 'thunderstorms'],
  MA: ['nor’easters', 'snow', 'coastal storms', 'humidity'],
  MI: ['lake-effect snow', 'wind chills', 'severe storms', 'humid summers'],
  MN: ['winter cold snaps', 'snow', 'severe summer storms', 'shoulder-season swings'],
  MS: ['heat', 'humidity', 'severe storms', 'tornado risk'],
  MO: ['severe storms', 'tornado risk', 'humidity', 'winter ice'],
  MT: ['mountain snow', 'cold snaps', 'wind', 'wildfire smoke'],
  NE: ['severe storms', 'tornado risk', 'high winds', 'snow'],
  NV: ['extreme heat', 'dry air', 'wind', 'dust events'],
  NH: ['snow', 'wind chills', 'nor’easters', 'mountain cold'],
  NJ: ['coastal storms', 'humidity', 'nor’easters', 'thunderstorms'],
  NM: ['heat', 'dry air', 'monsoon storms', 'wildfire smoke'],
  NY: ['urban heat', 'humidity', 'coastal storms', 'lake-effect snow upstate'],
  NC: ['heat', 'humidity', 'hurricane risk', 'severe storms'],
  ND: ['cold snaps', 'wind chills', 'snow', 'severe summer storms'],
  OH: ['severe storms', 'snow', 'humidity', 'winter ice'],
  OK: ['tornado risk', 'severe storms', 'high winds', 'heat'],
  OR: ['coastal rain', 'mountain snow', 'wildfire smoke', 'wind'],
  PA: ['severe storms', 'snow', 'humidity', 'winter ice'],
  RI: ['nor’easters', 'coastal storms', 'humidity', 'winter cold'],
  SC: ['heat', 'humidity', 'hurricane risk', 'severe storms'],
  SD: ['severe storms', 'snow', 'wind chills', 'tornado risk'],
  TN: ['severe storms', 'humidity', 'flooding', 'winter ice'],
  TX: ['heat', 'severe storms', 'wind', 'tropical impacts'],
  UT: ['mountain snow', 'wildfire smoke', 'wind', 'sudden temperature swings'],
  VT: ['snow', 'wind chills', 'mountain cold', 'nor’easters'],
  VA: ['humidity', 'thunderstorms', 'coastal storms', 'winter ice'],
  WA: ['coastal rain', 'mountain snow', 'wildfire smoke', 'wind'],
  WV: ['snow', 'severe storms', 'flooding', 'mountain cold'],
  WI: ['lake-effect snow', 'wind chills', 'severe storms', 'humid summers'],
  WY: ['mountain snow', 'wind', 'cold snaps', 'wildfire smoke'],
};

/**
 * Build a complete SEO bundle for a ZIP page. **Priority ZIPs short-
 * circuit early** — the caller should fall through to the
 * `priority-zip-content.ts` lookup for those.
 */
export function buildZipSeo(input: ZipSeoInput): ZipSeoResult {
  const priority = getPriorityZipContent(input.zip);
  if (priority) {
    return priorityToResult(input, priority);
  }

  const cityClean = (input.city ?? '').trim();
  const stateClean = (input.state ?? '').trim().toUpperCase();
  const zipClean = (input.zip ?? '').trim();

  const title = `${cityClean}, ${stateClean} ${zipClean} Weather Forecast: Hourly, 10-Day & 15-Day`;
  const h1 = `${cityClean}, ${stateClean} ${zipClean} Weather Forecast`;
  const description =
    `Check the weather forecast for ${cityClean}, ${stateClean} ${zipClean}, including current conditions, hourly changes, and extended 10-day to 15-day outlooks for planning around rain, wind, heat, and storms.`;

  const intro = buildIntroVariant({ city: cityClean, state: stateClean, zip: zipClean });

  const canonicalUrl = buildLocationCanonical(zipClean, cityClean, stateClean);
  const parentStateHubUrl = stateClean ? `${CANONICAL_HOST}/weather/${stateAbbrToSlug(stateClean)}` : undefined;
  const parentCityHubUrl =
    stateClean && cityClean
      ? `${CANONICAL_HOST}/weather/${stateAbbrToSlug(stateClean)}/${citySlug(cityClean)}`
      : undefined;

  return {
    title,
    h1,
    description,
    intro,
    canonicalUrl,
    parentCityHubUrl,
    parentStateHubUrl,
    relatedZipUrls: [],
    featuredZipUrls: featuredZipUrls(),
    isPriorityZip: false,
  };
}

function priorityToResult(input: ZipSeoInput, priority: PriorityZipContent): ZipSeoResult {
  const stateClean = priority.stateAbbr.toUpperCase();
  return {
    title: priority.title,
    h1: priority.h1,
    description:
      `Check the weather forecast for ${priority.city}, ${stateClean} ${priority.zip}, including current conditions, hourly changes, and extended 10-day to 15-day outlooks.`,
    intro: priority.intro,
    canonicalUrl: buildLocationCanonical(priority.zip, priority.city, stateClean),
    parentStateHubUrl: `${CANONICAL_HOST}/weather/${stateAbbrToSlug(stateClean)}`,
    parentCityHubUrl: `${CANONICAL_HOST}/weather/${stateAbbrToSlug(stateClean)}/${citySlug(priority.city)}`,
    relatedZipUrls: [],
    featuredZipUrls: featuredZipUrls(),
    isPriorityZip: true,
  };
}

/**
 * Construct a varied intro paragraph. **Avoids identical boilerplate**
 * by mixing in state-specific concerns + ZIP context. Pure — same
 * input always produces the same output.
 */
export function buildIntroVariant(input: {
  city: string;
  state: string;
  zip: string;
}): string {
  const concerns = CONCERN_BY_STATE[input.state.toUpperCase()] ?? DEFAULT_HIGHLIGHTS;
  // Deterministic rotation by hashing the ZIP — produces a stable
  // pick per page across deploys so Google sees the same content.
  const idx = zipHash(input.zip);
  const concernA = concerns[idx % concerns.length];
  const concernB = concerns[(idx + 1) % concerns.length];

  return (
    `This forecast covers ${input.city}, ${input.state} ${input.zip}. Local weather in this ZIP can differ from nearby cities and surrounding ZIP codes — `
    + `use this page to track current conditions, hourly changes, and extended 10-day to 15-day weather trends. `
    + `Plan around the conditions that matter here, including ${concernA} and ${concernB}.`
  );
}

/** Build the non-www canonical for a ZIP location. */
export function buildLocationCanonical(zip: string, city: string, stateAbbr: string): string {
  const stateSlug = stateAbbrToSlug(stateAbbr) || stateAbbr.toLowerCase();
  const citySlugClean = citySlug(city);
  const path = citySlugClean
    ? `/united-states-${stateSlug}-${citySlugClean}-${zip}`
    : `/united-states-${stateSlug}-${zip}`;
  return `${CANONICAL_HOST}${path}`;
}

function citySlug(city: string): string {
  return (city ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function zipHash(zip: string): number {
  let h = 0;
  for (let i = 0; i < zip.length; i++) h = (h * 31 + zip.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The 5 Step 173 priority ZIPs, surfaced on every non-priority ZIP page. */
function featuredZipUrls(): string[] {
  return [
    `${CANONICAL_HOST}/united-states-new-york-new-york-10001`,
    `${CANONICAL_HOST}/united-states-minnesota-saint-paul-55101`,
    `${CANONICAL_HOST}/united-states-texas-houston-77205`,
    `${CANONICAL_HOST}/united-states-texas-dallas-75201`,
    `${CANONICAL_HOST}/united-states-oklahoma-oklahoma-city-73101`,
  ];
}
