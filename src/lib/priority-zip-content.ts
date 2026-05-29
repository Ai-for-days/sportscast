// ── Step 173 Part B: Priority ZIP-page SEO content ──────────────────────
//
// Five priority ZIP codes get a focused title / H1 / intro template per
// the Step 173 spec. Other ZIP pages keep their existing generic SEO
// copy (see `seo-meta.ts`). Pure lookup — no I/O.

export interface PriorityZipContent {
  zip: string;
  city: string;
  stateAbbr: string;
  /** Page <title> per Step 173 spec. */
  title: string;
  /** Page H1. */
  h1: string;
  /** Unique intro paragraph — must NOT be repeated boilerplate. */
  intro: string;
}

const PRIORITY: Record<string, PriorityZipContent> = {
  '10001': {
    zip: '10001',
    city: 'New York',
    stateAbbr: 'NY',
    title: 'New York, NY 10001 Weather Forecast: Hourly, 10-Day & 15-Day',
    h1: 'New York, NY 10001 Weather Forecast',
    intro:
      'This forecast focuses on New York, NY 10001 — the Chelsea / Midtown South area where the urban heat island, river-driven humidity, and tall-building wind tunnels can make conditions noticeably different from outer-borough or New Jersey ZIPs. Use this page to review current conditions, hourly changes, and extended 10-day to 15-day weather trends for planning around heat, rain, snow, and gusty winds.',
  },
  '55101': {
    zip: '55101',
    city: 'Saint Paul',
    stateAbbr: 'MN',
    title: 'Saint Paul, MN 55101 Weather Forecast: Hourly, 10-Day & 15-Day',
    h1: 'Saint Paul, MN 55101 Weather Forecast',
    intro:
      'This forecast focuses on Saint Paul, MN 55101, the downtown core along the Mississippi River where temperatures, snow accumulation, and wind chills can diverge sharply from nearby suburbs in Ramsey and Dakota counties. Use this page to review current conditions, hourly changes, and extended 10-day to 15-day weather trends for planning around winter cold snaps, summer thunderstorms, and shoulder-season swings.',
  },
  '77205': {
    zip: '77205',
    city: 'Houston',
    stateAbbr: 'TX',
    title: 'Houston, TX 77205 Weather Forecast: Hourly, 10-Day & 15-Day',
    h1: 'Houston, TX 77205 Weather Forecast',
    intro:
      'This forecast focuses on Houston, TX 77205 in the Humble / IAH area on the city\'s north side, where coastal humidity, Gulf-driven storms, and afternoon heat indexes routinely differ from inland or south-Houston ZIPs. Use this page to review current conditions, hourly changes, and extended 10-day to 15-day weather trends for planning around heat, severe storms, and tropical activity.',
  },
  '75201': {
    zip: '75201',
    city: 'Dallas',
    stateAbbr: 'TX',
    title: 'Dallas, TX 75201 Weather Forecast: Hourly, 10-Day & 15-Day',
    h1: 'Dallas, TX 75201 Weather Forecast',
    intro:
      'This forecast focuses on Dallas, TX 75201, where downtown conditions can differ from nearby suburbs and surrounding North Texas ZIP codes. Use this page to review current conditions, hourly changes, and extended 10-day to 15-day weather trends for planning around heat, storms, wind, and rain.',
  },
  '73101': {
    zip: '73101',
    city: 'Oklahoma City',
    stateAbbr: 'OK',
    title: 'Oklahoma City, OK 73101 Weather Forecast: Hourly, 10-Day & 15-Day',
    h1: 'Oklahoma City, OK 73101 Weather Forecast',
    intro:
      'This forecast focuses on Oklahoma City, OK 73101 — the central downtown core where severe-weather season, sudden temperature swings, and high-wind days play out across the southern Plains. Use this page to review current conditions, hourly changes, and extended 10-day to 15-day weather trends for planning around tornado threats, thunderstorms, ice events, and summer heat.',
  },
};

export function getPriorityZipContent(zip: string | undefined): PriorityZipContent | null {
  if (!zip) return null;
  return PRIORITY[zip] ?? null;
}

export function listPriorityZips(): readonly PriorityZipContent[] {
  return Object.values(PRIORITY);
}
