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
  adapter: vercel({ maxDuration: 30 }),
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ['recharts', 'react-leaflet'],
    },
  },
});
