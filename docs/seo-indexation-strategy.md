# SEO / Indexation Strategy (Step 173 baseline)

Canonical host: **`https://wageronweather.com/`** (non-www).

## Canonical / host policy

- `https://www.wageronweather.com/*` 301-redirects to
  `https://wageronweather.com/$1` via `vercel.json` (`redirects[]`
  rule with `has: [{ type: 'host', value: 'www.wageronweather.com' }]`).
- Every `<link rel="canonical">` is built against the non-www host
  inside `BaseLayout.astro` regardless of which host actually served
  the request.
- Sitemap entries are emitted only against the non-www host (the
  `SITE` constant in `astro.config.mjs`).
- Internal links use root-relative paths (`/weather/...`,
  `/united-states-...`). Absolute URLs in metadata are built against
  the non-www host.

## Admin URL policy

- Every `/admin/*` page emits `meta name="robots" content="noindex,
  nofollow"`. This is enforced in two layers:
  - `BaseLayout.astro` defensively sets `noIndex` whenever the path
    starts with `/admin`, even when the page forgets to pass
    `noIndex={true}`.
  - `vercel.json` adds `X-Robots-Tag: noindex, nofollow` HTTP headers
    for `/admin/(.*)` and `/api/admin/(.*)`.
- Admin URLs are not in the sitemap. The sitemap integration's
  `customPages` array only contains the homepage, state hubs, city
  hubs, and ZIP pages. The `filter` callback drops anything matching
  `/admin/` or `/api/` as a belt-and-suspenders guard.
- Public pages do not link to admin URLs. The homepage hub-links
  section, the `[...slug].astro` ZIP-page footer, the state hub, and
  the city hub all link only to public weather pages.

## Indexable now

| Surface | Examples | Sitemap priority |
|---|---|---|
| Homepage | `/` | `1.0` |
| Venues hub | `/venues` | `0.9` |
| League pages | `/venues/mlb`, `/venues/nfl`, etc. | `0.8` |
| State hubs | `/weather/new-york`, `/weather/minnesota`, … (51 total) | `0.7` |
| City hubs (Step 173) | `/weather/new-york/new-york`, `/weather/texas/houston`, … (5 priority) | `0.75` |
| Map | `/map` | `0.7` |
| Priority ZIP pages | `/united-states-new-york-new-york-10001`, `/united-states-texas-dallas-75201`, etc. | `0.5` |
| All other ZIP pages | `/united-states-...-{zip}` (~41,000 total) | `0.5` |
| Historical | `/historical` | `0.6` |

## Deprioritize / candidate noindex later

Listed for transparency; **not yet implemented in Step 173** (the spec
explicitly says "Do not mass-noindex all ZIP pages yet"):

- Thin ZIP pages that consistently log zero impressions over a 90-day
  window in Google Search Console.
- Pure duplicate / near-duplicate pages (e.g. multiple ZIPs in the
  same city that share content + a 2-degree forecast delta).
- Any internal search / filter result page surfaced in the
  future.
- All admin / system / operator pages (`/admin/*`, `/api/admin/*`) —
  already noindex via meta + HTTP header.

## What we deliberately do not do

- We do not add the rest of the ~75-city universe to the sitemap as
  city hubs. The Step 173 city-hub set is deliberately small (5) to
  avoid re-introducing the "discovered but not indexed" backlog Google
  flagged. New city hubs should land in batches only when there is
  evidence the previous batch is being indexed.
- We do not noindex generic ZIP pages. Per Step 173 spec: "Do not
  mass-noindex all ZIP pages yet."
- We do not block crawl of `/forecast/*` lat-lon fallback paths. They
  remain indexable but are not in the sitemap, so Google can decide on
  its own whether they have value.
- We do not pre-render any admin page. Admin pages are all
  `prerender: false` and gated behind `requireAdmin`.

## Files that carry the canonical / SEO policy

| Concern | File |
|---|---|
| www → non-www 301 redirect | `vercel.json` (`redirects[]`) |
| `X-Robots-Tag` on admin | `vercel.json` (`headers[]`) |
| Canonical `<link>` + meta robots | `src/components/layout/BaseLayout.astro` |
| Sitemap config (non-www host, admin/api filter) | `astro.config.mjs` |
| Homepage title + description | `src/lib/seo-meta.ts` (`getHomepageMeta`) |
| Per-ZIP title + description | `src/lib/seo-meta.ts` (`getLocationMeta`) |
| Priority ZIP titles / H1 / intros | `src/lib/priority-zip-content.ts` |
| Homepage hub links section | `src/pages/index.astro` |
| State hub page | `src/pages/weather/[state].astro` |
| City hub page (Step 173) | `src/pages/weather/[state]/[city].astro` |
| ZIP page (with priority intro hook) | `src/pages/[...slug].astro` |

## Audit checklist

Before changing anything in the SEO policy, re-run these:

1. `grep -rn "www.wageronweather.com" src docs` — every match should
   be in a doc, a test fixture, or the explicit `vercel.json` redirect
   rule. Source code should never hardcode the www host.
2. `grep -rn "wageronweather.com" astro.config.mjs vercel.json` —
   confirm canonical host is non-www.
3. `vercel.json` redirects must include the host=www.wageronweather.com
   → non-www 301 rule.
4. `BaseLayout.astro` canonical builder must use the non-www host
   constant, not `Astro.url.host`.
5. Sitemap output (after `npm run build` + serving the resulting
   `sitemap-index.xml`) must contain zero `www.` URLs and zero
   `/admin/` / `/api/` URLs.
