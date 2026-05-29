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
  'morning commutes and school drop-offs',
  'evening errands and after-work plans',
  'weekend outdoor activities',
  'youth sports and field practice',
  'local events and gatherings',
  'trip planning and travel days',
];

/**
 * Normalize a state input value to a 2-letter USPS abbreviation.
 * Geocoded responses often return the full state name (sometimes in
 * ALL CAPS, e.g. "SOUTH CAROLINA") instead of the abbreviation, which
 * made the rendered ZIP pages read "Columbia, SOUTH CAROLINA 29209".
 * Detect both shapes and prefer the 2-letter form for titles / H1.
 */
export function normalizeStateAbbr(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  // Try to map the full name back to its abbreviation via the
  // ABBR → slug table in state-names.ts.
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  for (const [abbr, fullSlug] of Object.entries(STATE_ABBR_TO_FULL)) {
    if (fullSlug === slug) return abbr;
  }
  // Defensive fallback: take the first two letters of whatever came in.
  return trimmed.toUpperCase().slice(0, 2);
}

/** Render a state value as a title-cased full name when one is known
 *  ("SC" → "South Carolina"). Falls back to the input as-is. */
export function stateFullDisplay(stateAbbr: string): string {
  const abbr = normalizeStateAbbr(stateAbbr);
  const slug = STATE_ABBR_TO_FULL[abbr];
  if (!slug) return abbr;
  return slug
    .split('-')
    .map((w) => (w === 'of' ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

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
  // Always render the 2-letter USPS abbreviation in user-facing
  // titles / H1s / meta descriptions. Geocoder sometimes returns
  // "SOUTH CAROLINA" — normalize it to "SC".
  const stateClean = normalizeStateAbbr(input.state ?? '');
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
  const stateClean = normalizeStateAbbr(input.state);
  const zipClean = input.zip.trim();
  return (
    `Hourly and 15-day weather forecast for ${cityClean}, ${stateClean} ${zipClean}. ` +
    `Track current temperature, daily highs and lows, rain chances, and wind for ${cityClean}.`
  );
}

/**
 * Construct a varied intro paragraph. Each ZIP gets a stable but
 * non-identical phrasing pulled from a small template pool, so the
 * 41k pages don't read as obvious boilerplate. Mentions the
 * city/state/ZIP once each; state-specific concern fragments come
 * from the CONCERN_BY_STATE table.
 */
export function buildIntroVariant(input: {
  city: string;
  state: string;
  zip: string;
}): string {
  const stateAbbr = normalizeStateAbbr(input.state);
  const concerns = CONCERN_BY_STATE[stateAbbr] ?? DEFAULT_HIGHLIGHTS;
  const idx = zipHash(input.zip);
  const concernA = concerns[idx % concerns.length];
  const concernB = concerns[(idx + 1) % concerns.length];

  // 4 intro variants. Each says roughly the same thing but with
  // different phrasing — picked deterministically per ZIP so the
  // same ZIP always renders the same intro.
  const variant = idx % 4;
  if (variant === 0) {
    return (
      `Hourly and 15-day weather forecast for ${input.city}, ${stateAbbr} ${input.zip}. ` +
      `Track current temperature, daily highs and lows, ${concernA}, and ${concernB} across the next two weeks.`
    );
  }
  if (variant === 1) {
    return (
      `Get the current ${input.city}, ${stateAbbr} ${input.zip} weather plus a 10-day to 15-day outlook. ` +
      `The hourly breakdown covers short-term planning; the extended forecast helps you spot ${concernA} and ${concernB} before they arrive.`
    );
  }
  if (variant === 2) {
    return (
      `${input.city}, ${stateAbbr} weather for ZIP ${input.zip}: current conditions, hourly changes through tomorrow, and a daily outlook out to two weeks. ` +
      `Watch this page for ${concernA} and ${concernB} that can shift fast in this part of the state.`
    );
  }
  return (
    `Current conditions, hourly trends, and a 10-day to 15-day forecast for ${input.city}, ${stateAbbr} ${input.zip}. ` +
    `Local weather can differ from nearby ZIPs — use the extended outlook to plan around ${concernA} and ${concernB}.`
  );
}

/**
 * Second paragraph for non-priority ZIPs. Adds use-case framing
 * without repeating the location stamp. Stays in safe-variable lane
 * (city / state / ZIP / use cases / state name) — no neighborhood /
 * landmark / elevation claims.
 */
export function buildBodyVariant(input: {
  city: string;
  state: string;
  zip: string;
}): string {
  const stateAbbr = normalizeStateAbbr(input.state);
  const stateFull = stateFullDisplay(stateAbbr);
  const idx = zipHash(input.zip);
  const useCaseA = USE_CASE_PHRASES[idx % USE_CASE_PHRASES.length];
  const useCaseB = USE_CASE_PHRASES[(idx + 2) % USE_CASE_PHRASES.length];

  // 3 body variants for cadence variety. Mention the location once
  // per paragraph at most.
  const variant = idx % 3;
  if (variant === 0) {
    return (
      `Whether you're planning ${useCaseA} or ${useCaseB}, the ${input.zip} forecast combines today's temperature, ` +
      `tomorrow's hourly breakdown, and the daily highs and lows for the next two weeks. ${stateFull} weather can swing ` +
      `quickly between systems, so the extended view helps you spot the big changes before they arrive.`
    );
  }
  if (variant === 1) {
    return (
      `The forecast is useful for ${useCaseA} as well as ${useCaseB}. ${stateFull} sees a mix of fast-moving systems, ` +
      `so the page pairs current conditions with a multi-day outlook to help you plan ahead — not just react to today's weather.`
    );
  }
  return (
    `Operators, residents, and visitors use this page for ${useCaseA} and ${useCaseB}. The combination of current ` +
    `temperature, hourly trends, and the 10-day to 15-day outlook makes it easier to plan around ${stateFull}'s changing weather rather than guess.`
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
