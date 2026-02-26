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
      customPages: zipPages,
      entryLimit: 10000,
      serialize(item) {
        const url = item.url;
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
