// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

// Step 176 — the previous `@astrojs/sitemap` integration auto-named
// child sitemaps (`sitemap-0.xml`, `sitemap-1.xml`, …) which made
// per-state Search Console inspection impossible. The integration is
// replaced with custom SSR endpoints under `src/pages/sitemap-*.xml.ts`
// that emit semantic shard names: `sitemap-pages.xml`,
// `sitemap-states.xml`, `sitemap-cities.xml`, and per-state ZIP shards
// like `sitemap-zips-tx.xml`. Those routes derive their content from
// the shared helper at `src/lib/seo/sitemap-shards.ts`, which is also
// the source of truth for the admin SEO health dashboard.

const SITE = 'https://wageronweather.com';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  site: SITE,
  trailingSlash: 'never',
  integrations: [react()],
  // Bumped 30s -> 60s -> 300s. 60s was for the Kalshi climate fetch (~100
  // weather series sequentially, ~35-45s end-to-end). Bumped again
  // 2026-08-25: the auto-market cron engines (auto-hvl-market.ts and
  // friends) were hitting a hard "Task timed out after 60 seconds" even
  // after removing their heaviest cost (getScheduleGames's lite mode) --
  // NFL/NCAA-football schedule fetches eat a real ESPN-403-then-fallback
  // tax on every call (see league-schedule.ts's own comment on this), and
  // a first-ever pass creating many new HvH/LvL/venue-O/U wagers also pays
  // a real NWS station-resolution cost per new location. 300s (this
  // account's plan maximum on standard compute) gives real headroom
  // instead of chasing every individual slow path.
  adapter: vercel({ maxDuration: 300 }),
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ['recharts', 'react-leaflet'],
    },
  },
});
