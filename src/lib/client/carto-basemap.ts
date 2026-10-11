// CARTO basemap tile URLs, with the API key CARTO started requiring in 2026.
//
// Without a key, cartocdn.com now serves every tile as a gray "API KEY
// REQUIRED / carto.com/basemaps/apikey" watermark instead of the map (seen on
// every ZIP page's radar on 2026-10-10; it is CARTO's server, not our code).
// The key is free (no account, emailed in a minute at carto.com/basemaps/apikey)
// and free for commercial use up to 1M tile requests a month.
//
// It is a browser-side key by design (it rides on every tile URL), so it lives
// in PUBLIC_CARTO_BASEMAP_KEY, which Astro inlines into the client bundle at
// BUILD time: after adding or changing it in Vercel, redeploy.

const KEY = (import.meta.env.PUBLIC_CARTO_BASEMAP_KEY as string | undefined)?.trim() ?? '';

/** Leaflet tile URL for one CARTO raster style, e.g. 'light_nolabels' or 'light_all'. */
export function cartoBasemapUrl(style: string): string {
  const base = `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`;
  return KEY ? `${base}?key=${encodeURIComponent(KEY)}` : base;
}
