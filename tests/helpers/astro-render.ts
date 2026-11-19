// Render real .astro pages in a test (WOW-034).
//
// Boots Vite in middleware mode with this project's own Astro config, loads
// pages through Vite's SSR module graph, and renders them with Astro's
// container API and the React renderer. The page code that runs is the
// project's own, unmodified: same imports, same components, same libraries.
//
// What it does NOT run: Vercel's edge, and src/middleware.ts (the container
// skips middleware; tests that care call onRequest themselves). There is no
// .env in this worktree, so nothing can reach a real database; tests install
// a CountingRedis through the same module instance the pages import.

import { createServer, type ViteDevServer } from 'vite';
import { getViteConfig } from 'astro/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface AstroHarness {
  server: ViteDevServer;
  load<T = any>(path: string): Promise<T>;
  render(pagePath: string, url: string, opts?: { params?: Record<string, string>; headers?: Record<string, string> }): Promise<Response>;
  close(): Promise<void>;
}

export async function bootAstro(): Promise<AstroHarness> {
  const cfg = await getViteConfig({
    root: process.cwd(),
    // Per process, outside the shared node_modules (a junction to the main checkout).
    cacheDir: join(tmpdir(), `wow-vite-test-${process.pid}`),
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: [] },
  } as any)({ mode: 'test', command: 'serve' });
  const server = await createServer({ ...(cfg as any), configFile: false });
  // Vite sets NODE_ENV=development, which makes Astro stamp every island with a
  // `server-render-time` timing attribute (dev only, never in a production
  // build). Leave development once the server is up, so two renders of the
  // same input are byte-for-byte comparable.
  process.env.NODE_ENV = 'test';
  const { experimental_AstroContainer } = (await server.ssrLoadModule('astro/container')) as any;
  const reactSsr = ((await server.ssrLoadModule('@astrojs/react/server.js')) as any).default;
  const container = await experimental_AstroContainer.create({
    renderers: [{ name: '@astrojs/react', clientEntrypoint: '@astrojs/react/client.js', ssr: reactSsr }],
  });
  return {
    server,
    load: (path) => server.ssrLoadModule(path) as any,
    async render(pagePath, url, opts = {}) {
      const page = (await server.ssrLoadModule(pagePath)) as any;
      return container.renderToResponse(page.default, {
        request: new Request(url, { headers: opts.headers ?? {} }),
        params: opts.params,
      });
    },
    close: () => server.close(),
  };
}
