// ── Step 175: Full-scale ZIP-page SEO template ─────────────────────────
//
// Reusable helper that builds a non-priority ZIP page's title / H1 /
// description / multi-sentence intro / OG-Twitter fields / JSON-LD
// hooks from `(city, state, zip)` plus optional weather signals.
//
// Step 174 introduced this template with a single-sentence intro and
// short copy. Step 175 expands it so every one of the ~41,000 generic
// ZIP pages gets:
//   - a multi-sentence body that uses safe (city/state/ZIP/range/use-
//     case) variables — never hallucinated neighborhood facts.
//   - explicit OG + Twitter metadata strings (the BaseLayout consumes
//     them via the standard title/description props; this helper just
//     keeps everything in one place).
//   - canonical non-www URLs.
//   - parent city + state hub links and a curated set of related ZIPs
//     so each ZIP is reachable from the broader hub graph.
//
// Priority ZIPs continue to use `priority-zip-content.ts` — this
// template fills the gap for the other ~41,000 ZIPs.
//
// Pure helpers. No I/O. Used by `src/pages/[...slug].astro`.

import { getPriorityZipContent, type PriorityZipContent } from '../priority-zip-content';
import { stateAbbrToSlug, STATE_ABBR_TO_FULL } from '../state-names';

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
  /** Optional list of nearby ZIPs (same city/state) for related-link block. */
  nearbyZips?: Array<{ zip: string; city: string; state: string }>;
}

export interface ZipSeoResult {
  title: string;
  h1: string;
  description: string;
  intro: string;
  /** Additional paragraph used after the intro to expand topical coverage. */
  body: string;
  /** Open Graph + Twitter title (same string used for both). */
  socialTitle: string;
  /** Open Graph + Twitter description (same string used for both). */
  socialDescription: string;
  canonicalUrl: string;
  parentCityHubUrl?: string;
  parentStateHubUrl?: string;
  /** Pre-resolved related ZIP links (max 8) for the in-page link block. */
  relatedZipLinks: Array<{ label: string; url: string }>;
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

/** Safe, generic use-case phrases that work for any ZIP. */
const USE_CASE_PHRASES = [
  'commuting and school drop-off',
  'evening errands and after-work plans',
  'weekend outdoor activities',
  'youth sports and field practice',
  'local events and gatherings',
  'travel and trip planning',
];

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
  const description = buildMetaDescription({ city: cityClean, state: stateClean, zip: zipClean });

  const intro = buildIntroVariant({ city: cityClean, state: stateClean, zip: zipClean });
  const body = buildBodyVariant({ city: cityClean, state: stateClean, zip: zipClean });

  const canonicalUrl = buildLocationCanonical(zipClean, cityClean, stateClean);
  const parentStateHubUrl = stateClean
    ? `${CANONICAL_HOST}/weather/${stateAbbrToSlug(stateClean)}`
    : undefined;
  const parentCityHubUrl =
    stateClean && cityClean
      ? `${CANONICAL_HOST}/weather/${stateAbbrToSlug(stateClean)}/${citySlug(cityClean)}`
      : undefined;

  const relatedZipLinks = buildRelatedZipLinks(input);

  return {
    title,
    h1,
    description,
    intro,
    body,
    socialTitle: title,
    socialDescription: description,
    canonicalUrl,
    parentCityHubUrl,
    parentStateHubUrl,
    relatedZipLinks,
    featuredZipUrls: featuredZipUrls(),
    isPriorityZip: false,
  };
}

function priorityToResult(input: ZipSeoInput, priority: PriorityZipContent): ZipSeoResult {
  const stateClean = priority.stateAbbr.toUpperCase();
  const description = buildMetaDescription({
    city: priority.city,
    state: stateClean,
    zip: priority.zip,
  });
  return {
    title: priority.title,
    h1: priority.h1,
    description,
    intro: priority.intro,
    body: '',
    socialTitle: priority.title,
    socialDescription: description,
    canonicalUrl: buildLocationCanonical(priority.zip, priority.city, stateClean),
    parentStateHubUrl: `${CANONICAL_HOST}/weather/${stateAbbrToSlug(stateClean)}`,
    parentCityHubUrl: `${CANONICAL_HOST}/weather/${stateAbbrToSlug(stateClean)}/${citySlug(priority.city)}`,
    relatedZipLinks: buildRelatedZipLinks(input),
    featuredZipUrls: featuredZipUrls(),
    isPriorityZip: true,
  };
}

/** Compose the meta description used for both `<meta name="description">` and OG/Twitter. */
export function buildMetaDescription(input: { city: string; state: string; zip: string }): string {
  const cityClean = input.city.trim();
  const stateClean = input.state.trim().toUpperCase();
  const zipClean = input.zip.trim();
  return (
    `Check the weather forecast for ${cityClean}, ${stateClean} ${zipClean}, including hourly conditions and ` +
    `10-day to 15-day outlooks. Plan around local rain, wind, heat, snow, storms, and seasonal swings in ${cityClean}.`
  );
}

/**
 * Construct a varied intro paragraph. **Avoids identical boilerplate**
 * by mixing in state-specific concerns + ZIP context. Pure — same
 * input always produces the same output across deploys.
 */
export function buildIntroVariant(input: {
  city: string;
  state: string;
  zip: string;
}): string {
  const stateAbbr = input.state.toUpperCase();
  const concerns = CONCERN_BY_STATE[stateAbbr] ?? DEFAULT_HIGHLIGHTS;
  const idx = zipHash(input.zip);
  const concernA = concerns[idx % concerns.length];
  const concernB = concerns[(idx + 1) % concerns.length];

  return (
    `This forecast covers ${input.city}, ${stateAbbr} ${input.zip}. Local weather in this ZIP can ` +
    `differ from nearby cities and surrounding ZIP codes — use this page to track current conditions, ` +
    `hourly changes, and extended 10-day to 15-day weather trends. Plan around the conditions that ` +
    `matter here, including ${concernA} and ${concernB}.`
  );
}

/**
 * Second paragraph for non-priority ZIPs. Stays in the same safe-
 * variable lane (city / state / ZIP / range / use cases) — no
 * neighborhood / landmark / elevation claims.
 */
export function buildBodyVariant(input: {
  city: string;
  state: string;
  zip: string;
}): string {
  const stateAbbr = input.state.toUpperCase();
  const stateFull = STATE_ABBR_TO_FULL[stateAbbr]
    ? capitalizeWords(STATE_ABBR_TO_FULL[stateAbbr].replace(/-/g, ' '))
    : stateAbbr;
  const idx = zipHash(input.zip);
  const useCaseA = USE_CASE_PHRASES[idx % USE_CASE_PHRASES.length];
  const useCaseB = USE_CASE_PHRASES[(idx + 2) % USE_CASE_PHRASES.length];

  return (
    `Use the ${input.city}, ${stateAbbr} ${input.zip} forecast for ${useCaseA} as well as ${useCaseB}. ` +
    `Conditions can shift quickly across ${stateFull}, so the page combines current temperature, an hourly ` +
    `breakdown for the next day, and a 10-day to 15-day outlook so you can spot rain, snow, storms, and ` +
    `temperature swings before they arrive.`
  );
}

/**
 * Build a curated list of related ZIP links from the optional
 * `nearbyZips` input. Filters out the current ZIP, deduplicates, and
 * trims to 8 entries to keep the link block scannable.
 */
export function buildRelatedZipLinks(input: ZipSeoInput): Array<{ label: string; url: string }> {
  const list = input.nearbyZips ?? [];
  if (!list.length) return [];
  const seen = new Set<string>();
  const out: Array<{ label: string; url: string }> = [];
  for (const entry of list) {
    if (!entry?.zip || entry.zip === input.zip) continue;
    if (seen.has(entry.zip)) continue;
    seen.add(entry.zip);
    const url = buildLocationCanonical(entry.zip, entry.city, entry.state)
      .replace(CANONICAL_HOST, '');
    out.push({ label: `${entry.city} ${entry.zip}`, url });
    if (out.length >= 8) break;
  }
  return out;
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

function capitalizeWords(s: string): string {
  return s.replace(/(^|\s)([a-z])/g, (_m, sp, ch) => sp + ch.toUpperCase());
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
