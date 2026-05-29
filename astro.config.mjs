// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync } from 'fs';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// State abbreviation → slug (matches state-names.ts)
const STATE_ABBR_TO_SLUG = {
  AL:'alabama',AK:'alaska',AZ:'arizona',AR:'arkansas',CA:'california',
  CO:'colorado',CT:'connecticut',DE:'delaware',DC:'district-of-columbia',
  FL:'florida',GA:'georgia',HI:'hawaii',ID:'idaho',IL:'illinois',
  IN:'indiana',IA:'iowa',KS:'kansas',KY:'kentucky',LA:'louisiana',
  ME:'maine',MD:'maryland',MA:'massachusetts',MI:'michigan',MN:'minnesota',
  MS:'mississippi',MO:'missouri',MT:'montana',NE:'nebraska',NV:'nevada',
  NH:'new-hampshire',NJ:'new-jersey',NM:'new-mexico',NY:'new-york',
  NC:'north-carolina',ND:'north-dakota',OH:'ohio',OK:'oklahoma',OR:'oregon',
  PA:'pennsylvania',PR:'puerto-rico',RI:'rhode-island',SC:'south-carolina',
  SD:'south-dakota',TN:'tennessee',TX:'texas',UT:'utah',VT:'vermont',
  VA:'virginia',WA:'washington',WV:'west-virginia',WI:'wisconsin',WY:'wyoming',
};

const SITE = 'https://wageronweather.com';

// Generate 51 state hub page URLs for the sitemap
const statePages = Object.values(STATE_ABBR_TO_SLUG).map(slug => `${SITE}/weather/${slug}`);

// Step 173 Part B — initial set of city hub pages for the sitemap.
// Mirrors the priority hubs listed in the spec + on the homepage. We
// intentionally do NOT auto-generate one per city in `us-cities.ts` —
// that would explode the sitemap and re-introduce the "discovered but
// not indexed" backlog Google flagged. Add new hubs deliberately as
// they earn impressions.
const cityHubPages = [
  '/weather/new-york/new-york',
  '/weather/minnesota/saint-paul',
  '/weather/texas/houston',
  '/weather/texas/dallas',
  '/weather/oklahoma/oklahoma-city',
].map(p => `${SITE}${p}`);

// Generate ~41K zip code URLs for the sitemap
const zipData = JSON.parse(readFileSync('./src/data/us-zip-codes.json', 'utf-8'));
const zipPages = zipData.map((/** @type {{ z: string; c: string; s: string }} */ e) => {
  const stateSlug = STATE_ABBR_TO_SLUG[e.s] || e.s.toLowerCase();
  const citySlug = e.c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const path = citySlug
    ? `/united-states-${stateSlug}-${citySlug}-${e.z}`
    : `/united-states-${stateSlug}-${e.z}`;
  return `${SITE}${path}`;
});

// https://astro.build/config
export default defineConfig({
  output: 'server',
  site: SITE,
  trailingSlash: 'never',
  integrations: [
    react(),
    sitemap({
      // Step 173 — only non-www URLs (the `SITE` constant is
      // `https://wageronweather.com`). Admin and API routes are
      // excluded because Astro's sitemap integration does not
      // auto-include `prerender: false` server routes anyway, and we
      // never add `/admin/*` to `customPages`.
      customPages: [...statePages, ...cityHubPages, ...zipPages],
      filter(page) {
        // Belt-and-suspenders: drop anything that smells like an
        // admin route in case a future Astro version starts including
        // server routes.
        if (page.includes('/admin/')) return false;
        if (page.includes('/api/')) return false;
        return true;
      },
      entryLimit: 10000,
      serialize(item) {
        const url = item.url;
        // Step 173 — city hub pages.
        if (cityHubPages.includes(url) || cityHubPages.some((p) => url === `${p}/`)) {
          return { ...item, priority: 0.75, changefreq: 'hourly' };
        }
        // Homepage
        if (url === `${SITE}/` || url === SITE) {
          return { ...item, priority: 1.0, changefreq: 'daily' };
        }
        // Venues hub
        if (url === `${SITE}/venues` || url === `${SITE}/venues/`) {
          return { ...item, priority: 0.9, changefreq: 'weekly' };
        }
        // League pages
        if (url.match(/\/venues\/(mlb|nfl|ncaa-football|mls|community)$/)) {
          return { ...item, priority: 0.8, changefreq: 'weekly' };
        }
        // Map
        if (url === `${SITE}/map` || url === `${SITE}/map/`) {
          return { ...item, priority: 0.7, changefreq: 'daily' };
        }
        // Historical
        if (url === `${SITE}/historical` || url === `${SITE}/historical/`) {
          return { ...item, priority: 0.6, changefreq: 'monthly' };
        }
        // State hub pages
        if (url.startsWith(`${SITE}/weather/`)) {
          return { ...item, priority: 0.7, changefreq: 'hourly' };
        }
        // Zip code pages (all ~41K)
        if (url.startsWith(`${SITE}/united-states-`)) {
          return { ...item, priority: 0.5, changefreq: 'hourly' };
        }
        // Default
        return item;
      },
    }),
  ],
  adapter: vercel({ maxDuration: 30 }),
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ['recharts', 'react-leaflet'],
    },
  },
});
