// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  site: 'https://wageronweather.com',
  integrations: [react(), sitemap()],
  adapter: vercel({ maxDuration: 30 }),
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ['recharts', 'react-leaflet'],
    },
  },
});
