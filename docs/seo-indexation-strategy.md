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

## Step 174 — Route groups + Search Console diagnosis

### Centralized noindex policy (`src/lib/seo/noindex-policy.ts`)

The `shouldNoIndexPathname(pathname)` helper is the single source of truth for which routes emit `meta name="robots" content="noindex, nofollow"`. `BaseLayout.astro` calls it on every request — even when a page forgets to pass `noIndex={true}`, the meta is still emitted for any pathname matching:

| Route prefix | Reason |
|---|---|
| `/admin` / `/admin/*` | `admin_surface` |
| `/api/admin` / `/api/admin/*` | `admin_api_surface` |
| `/login`, `/signup`, `/api/auth/*` | `auth_surface` |
| `/account` / `/account/*` | `account_surface` |
| `/dashboard`, `/settings` | `system_or_dashboard` |
| `/preview`, `/internal`, `/_dev` | `preview_or_internal` |

`vercel.json` emits the matching `X-Robots-Tag: noindex, nofollow` HTTP header for `/admin/(.*)` and `/api/admin/(.*)`, so the policy applies even on raw API responses that don't pass through `BaseLayout`.

### Indexation policy classifier (`src/lib/seo/indexation-policy.ts`)

`classifyIndexationBand(pathname)` returns one of four bands per the Step 174 spec:

| Band | Examples | Sitemap action |
|---|---|---|
| `index` | `/`, `/weather/texas`, `/weather/texas/dallas`, `/united-states-texas-dallas-75201`, `/venues`, `/map`, `/historical` | included with full priority |
| `crawlable_deprioritized` | Generic ZIP forecast pages (the ~41,000 non-priority ZIPs) | included with `priority: 0.5` |
| `noindex` | `/admin/*`, `/login`, `/signup`, `/account`, `/api/admin/*` | excluded entirely |
| `consolidate_candidate` | `/forecast/{lat},{lon}` coordinate-fallback paths | excluded (let Google decide based on the canonical of the resolved ZIP page) |

The classifier is **pure and observation-only** in Step 174 — sitemap + render decisions still derive from the older per-route logic. A future step can wire the classifier into the sitemap `filter` callback once the band assignments have been verified against Search Console impression data.

### Search Console diagnosis cheat sheet

Likely causes + fixes for the GSC statuses we currently see:

| GSC status | Likely cause | Fix landed in this step / earlier | Remaining work |
|---|---|---|---|
| `Discovered – currently not indexed` | Too many low-linked generated ZIP pages; weak crawl priority; insufficient hub architecture. | Step 173 added 5 city hubs + homepage hub-link section. Step 174 adds `ForecastInternalLinks` to every ZIP page so each ZIP links up to its city + state hub and out to featured priority ZIPs. | Add new city hubs in batches only when impression data justifies it — never auto-generate one per `us-cities.ts` entry. |
| `Crawled – currently not indexed` | Thin / repetitive page content; weak uniqueness signal. | Step 174 `zip-seo.ts` template produces a varied intro per ZIP (state-specific concern fragments, deterministic per-ZIP rotation). Priority ZIPs keep their Step 173 custom intros. | Watch for ZIP pages that remain "crawled, not indexed" after the next recrawl — those are candidates for `consolidate_candidate` band. |
| `Alternate page with proper canonical` | Expected on the www variants after the Step 173 301 + canonical consolidation. | Already handled by `vercel.json` redirects + `BaseLayout.astro` non-www canonical. | Wait for Google to recrawl. No code change needed. |
| Server errors | Edge function failures or route misses. | `scripts/verify-seo-routing.mjs` (Step 174) checks the 6 spec test routes for redirect + canonical + sitemap correctness. | Run the verification script against the production deploy after every SEO-affecting change. |

### Scalable ZIP SEO template (`src/lib/seo/zip-seo.ts`)

Non-priority ZIPs now flow through `buildZipSeo(input)` which produces:

- Title: `{City}, {ST} {ZIP} Weather Forecast: Hourly, 10-Day & 15-Day`
- H1: `{City}, {ST} {ZIP} Weather Forecast`
- Description: spec default ("Check the weather forecast for…")
- Intro: a varied paragraph built from a state-specific concern table (47 entries, one per state-with-distinct-weather) with deterministic per-ZIP rotation so the same ZIP always renders the same intro.
- `parentCityHubUrl`, `parentStateHubUrl`, featured ZIPs, related ZIPs.

Priority ZIPs (Step 173) continue to use their custom intros from `priority-zip-content.ts` — the template recognizes them and short-circuits.

### Internal-link module (`src/components/seo/ForecastInternalLinks.astro`)

Rendered at the bottom of every ZIP page. Two columns:

- **Browse this area** — parent city hub, parent state hub, homepage ZIP lookup.
- **Featured ZIP forecasts** — the 5 priority ZIPs.

All links public; never admin. The module supports an optional `relatedZipLinks` prop for future nearby-ZIP wiring.

### Verification script (`scripts/verify-seo-routing.mjs`)

End-to-end checker. Run after every SEO-affecting deploy:

```
node scripts/verify-seo-routing.mjs --base https://wageronweather.com
```

Checks for each of the 6 spec test routes:

1. `https://www.wageronweather.com/{path}` 301-redirects to the exact non-www equivalent.
2. The non-www HTML emits a canonical `<link>` pointing at the non-www host.
3. No `www.wageronweather.com` URL appears inside the rendered HTML body.
4. `/admin/*` HTML carries `meta name="robots" content="noindex, nofollow"`.
5. `/admin/*` + `/api/admin/*` HTTP responses carry `X-Robots-Tag: noindex, nofollow`.
6. `sitemap-index.xml` and a sample of its child sitemaps contain only non-www URLs and exclude `/admin/` / `/api/`.

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
