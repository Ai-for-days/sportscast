# SEO / Indexation Strategy (Step 173 baseline, Step 174–177 layers)

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

## Step 175 — Full-scale ZIP SEO optimization

### What is fully optimized in code now

- **Homepage**: keyword-aligned title + meta (`getHomepageMeta`).
- **State hubs** (`/weather/{state}`): keyword-aligned title + meta
  (`getStateMeta`), substantive copy (challenges + seasonal guide +
  all-cities list), curated featured-ZIP block linking to priority
  ZIPs in the state, `BreadcrumbList` + `CollectionPage` JSON-LD with
  the curated city list as `mainEntity.ItemList`, canonical non-www.
- **City hubs** (`/weather/{state}/{city}`): keyword-aligned title +
  meta, substantive copy, curated ZIP list, parent state hub link,
  related-cities-in-same-state block, `BreadcrumbList` +
  `CollectionPage` JSON-LD with curated ZIP items as
  `mainEntity.ItemList`, canonical non-www.
- **All ZIP forecast pages**: title + H1 + meta description via
  `buildZipSeo` (Step 174 template, expanded in Step 175 to a
  multi-sentence body), `WebPage` + `BreadcrumbList` + `Place` +
  `FAQPage` JSON-LD, OG + Twitter title/description (reuses
  `seoMeta.title` + `seoMeta.description` via `BaseLayout`),
  canonical non-www, parent city + state hub links, curated nearby-ZIP
  list (up to 8 sibling ZIPs in the same city), featured priority-ZIP
  block.
- **5 priority ZIPs** (10001, 55101, 77205, 75201, 73101): retain
  custom title + intro from `priority-zip-content.ts`.
- **noindex coverage**: `/admin/*`, `/api/admin/*`, `/login`,
  `/signup`, `/api/auth/*`, `/account/*`, `/dashboard`, `/settings`,
  `/preview`, `/internal`, `/_dev` — meta layer via
  `noindex-policy.ts` + HTTP layer via `vercel.json` `X-Robots-Tag`.

### What is likely to help but not guaranteed

- Stronger metadata + richer multi-sentence body per ZIP.
- BreadcrumbList + WebPage + CollectionPage + Place + FAQ JSON-LD.
- Hub-graph internal linking (homepage → state hub → city hub → ZIP).
- Curated featured-ZIP blocks on state hubs + every ZIP page.
- Continued sitemap segmentation via `@astrojs/sitemap` `entryLimit:
  10000` boundary — Google sees several manageable child sitemaps
  rather than one giant feed.

### What is still not guaranteed

- Google can still choose not to index any individual ZIP page.
- Low-demand ZIPs may remain `Discovered – currently not indexed` or
  `Crawled – currently not indexed` despite the template upgrade.
- GSC impression data should drive future prioritization decisions:
  promote ZIPs that earn impressions to custom content; consider
  noindexing ZIPs that stay at zero impressions for 90+ days.
- We do not claim that all 41,134 discovered URLs will be indexed.
- The 301 + non-www canonical + sitemap exclusion of `www.` URLs is
  the right *signal*, but Google still controls the recrawl cadence.

### Sitemap segmentation (current + planned)

**Current behavior.** Astro's `@astrojs/sitemap` integration is
configured with `entryLimit: 10000` in `astro.config.mjs`. The
integration emits `sitemap-index.xml` plus `sitemap-0.xml`,
`sitemap-1.xml`, … child sitemaps. With ~41k ZIPs + 51 state hubs + 5
city hubs + venues + map + historical + homepage, that produces ~5
child sitemaps. Google ingests the index file; the segmentation is
real, even if the child names are not semantic.

**Planned semantic segmentation.** `src/lib/seo/sitemap-segmentation.ts`
defines the four semantic segments (`pages`, `states`, `cities`,
`zips`) and a stable chunk size (10,000) so a future migration can
emit `sitemap-pages.xml`, `sitemap-states.xml`, `sitemap-cities.xml`,
`sitemap-zips-1.xml`, … without changing consumer code. Until that
migration ships, the helper is observation-only and the verification
script just walks whichever child sitemaps the index advertises.

**Migration sketch (do NOT ship yet).** Replace the single `sitemap`
integration block with a custom Astro endpoint at
`src/pages/sitemap-pages.xml.ts` (etc.) that emits each segment using
`assignSitemapSegment` as the filter. Add a custom
`src/pages/sitemap-index.xml.ts` that references all segments. Drop
the `@astrojs/sitemap` integration. Validate with the broadened
`scripts/verify-seo-routing.mjs` before deploying.

### Search Console diagnosis (updated)

| GSC status | Likely cause | Step 175 fix | Remaining work |
|---|---|---|---|
| `Discovered – currently not indexed` | Crawl priority / weak hub linking / sitemap scale. | Stronger state hub copy + curated featured-ZIP block; richer ZIP body + nearby-ZIP block on every ZIP page; documented sitemap segmentation strategy. | Add new city hubs in batches as GSC impression data justifies them. |
| `Crawled – currently not indexed` | Thin / repetitive content. | `zip-seo.ts` now emits a multi-sentence body (intro + body) per ZIP, varied by state-specific concern table + use-case rotation; priority ZIPs keep custom intros. | After next recrawl, ZIPs still in this bucket are candidates for `consolidate_candidate` band. |
| `Alternate page with proper canonical` | Expected on www variants after 301 + canonical consolidation. | Already handled by `vercel.json` redirect + `BaseLayout` non-www canonical. | Wait for recrawl. No code change. |
| Server errors | Edge function failures or route misses. | `scripts/verify-seo-routing.mjs` now covers ~20+ representative routes (homepage, multiple state + city hubs, all 5 priority ZIPs, 10 non-priority ZIP samples, admin / API admin / auth / account / dashboard noindex routes, sitemap-index + child sitemaps). | Run after every SEO-affecting deploy. |

## Step 176 — Crawl architecture + sitemap segmentation + SEO operations

Step 176 moves the SEO surface from "well-structured pages" to a real
crawl architecture with operator visibility.

### Real sitemap segmentation

`@astrojs/sitemap` is no longer used. The sitemap routes are now custom
SSR endpoints with semantic shard names:

| URL | Source | Contents |
|---|---|---|
| `/sitemap-index.xml` | `src/pages/sitemap-index.xml.ts` | lists every child shard |
| `/sitemap-pages.xml` | `src/pages/sitemap-pages.xml.ts` | homepage, venues hub, league pages, map, historical |
| `/sitemap-states.xml` | `src/pages/sitemap-states.xml.ts` | 50 state hubs + DC |
| `/sitemap-cities.xml` | `src/pages/sitemap-cities.xml.ts` | curated city-hub roster |
| `/sitemap-zips-{state}.xml` | `src/pages/sitemap-zips-[state].xml.ts` | per-state ZIP shards (e.g. `sitemap-zips-tx.xml`) |

Per-state ZIP sharding makes "are my Texas ZIPs being discovered?"
answerable directly in Search Console without inspecting an opaque
`sitemap-0.xml`. The largest shard (TX, ~2,600 URLs) is well under
the 50,000-URL sitemap limit.

Source of truth: `src/lib/seo/sitemap-shards.ts`. Every endpoint
delegates to its `buildPagesShard` / `buildStatesShard` /
`buildCitiesShard` / `buildZipShardForState` helper, and the admin SEO
health dashboard reads the same helpers — there is no drift between
"what we say is in the sitemap" and "what is actually in the sitemap."

All emitted URLs are forced through an `isClean(loc)` predicate that
rejects:

- www-host URLs
- any pathname matching `isNoIndexPathname` (admin / admin API / login
  / signup / auth API / account / dashboard / settings / preview /
  internal / `_dev`)
- any `/api/*` route

### ZIP priority tiers

`src/lib/seo/zip-priority.ts` is a pure classifier:

| Tier | Rule | Source |
|---|---|---|
| 1 | Manually-designated priority ZIPs OR ZIPs in a curated city hub OR ZIPs in a tier-1 metro from `us-cities.ts` | `priority-zip-content.ts`, `CITY_HUB_ROSTER`, `us-cities.ts` |
| 2 | ZIPs in a tier-2/3 city from `us-cities.ts` | `us-cities.ts` |
| 3 | Everything else | — |

Helpers used across the codebase:

- `getZipPriorityTier(record)` — tier classifier.
- `sortZipPagesByPriority(records)` — sort by tier then ZIP. Pure.
- `getFeaturedZipsForState(allZips, state, limit?)` — top Tier-1 ZIPs.
- `getFeaturedZipsForCity(allZips, state, city, limit)` — curated ZIP list.
- `getRelatedZipsForZip(allZips, record, limit)` — same-city Tier-1 first, then state-level Tier-1 fallback.
- `countZipsByTier(allZips)` — admin dashboard input.

### Best-pages-first internal linking

The link graph now hierarchically surfaces higher-tier pages first:

- **Homepage** — links to 6 priority state hubs, every curated city
  hub, and every Tier-1 ZIP. No flat long-tail ZIP list.
- **State hubs** — three featured sections: "Current Conditions Across
  {state}" (top tier-1 cities with live weather), "Featured
  {state} ZIP Forecasts" (priority ZIPs + Tier-1 ZIPs from
  `getFeaturedZipsForState`), and "Curated City Weather Hubs"
  (the `CITY_HUB_ROSTER` entries in the state). Then "All
  {state} Cities" remains as the comprehensive browse-by-city block.
- **City hubs** — ZIP list ordered by `getFeaturedZipsForCity` so
  Tier-1 ZIPs (typically the priority designations) bubble to the top.
  Related-cities block surfaces same-state siblings sorted by
  curated tier. Back-link to state hub + homepage.
- **ZIP pages** — nearby/related ZIPs sourced from
  `getRelatedZipsForZip` so Tier-1 in-city siblings appear before
  long-tail ones, with state-level Tier-1 ZIPs as the fallback.

### Admin SEO health dashboard

`/admin/system/seo-health` — read-only, admin-gated, `noindex`. Surfaces:

- Canonical host + sitemap index URL.
- Hub coverage (state hub count, city hub count, ZIP page count).
- ZIP priority tier counts + percentages.
- Sitemap shard table (label, URL count, child URL).
- Noindex route groups.
- Generation timestamp.

The dashboard makes no Search Console API calls. Future Step 177/178
will add a GSC client that consumes the types in
`src/lib/seo/gsc-types.ts`.

### Future GSC integration types

`src/lib/seo/gsc-types.ts` — types only, no fetch. Defines the shapes
future loaders will produce:

- `GscUrlPerformanceRow` — impressions / clicks / CTR / avg position.
- `GscUrlIndexationRow` — indexed status + not-indexed reason + canonicals.
- `GscRouteType` — homepage / state hub / city hub / ZIP page / noindex variants.
- `GscReconciliationRow` — joins URL + route type + tier + sitemap +
  performance + indexation for the future dashboard.
- `GscSitemapShardStatus` — per-shard discovered/indexed counts +
  warnings + errors.
- `GscDashboardSnapshot` — top-level container.

### Validation script coverage

`scripts/verify-seo-routing.mjs` now covers:

- 8 state hubs + 5 city hubs + all 5 priority ZIPs + 25 sample Tier-2/3 ZIPs across 25 states.
- 6 noindex routes (`/admin`, `/api/admin/system/weathernext-probe`, `/login`, `/signup`, `/account`, `/dashboard`).
- `sitemap-index.xml` references each expected top-level shard (`pages`, `states`, `cities`) and a sample of state-ZIP shards (`tx`, `ca`, `ny`, `fl`).
- Every shard returns 200, uses only non-www URLs, excludes admin / API / login / signup / account / dashboard / settings / preview / internal.
- No duplicate URLs across all shards.
- OG / Twitter title/desc + non-www `og:url` on every indexable URL.
- JSON-LD blocks free of www URLs, BreadcrumbList present on every hub + ZIP page.
- ZIP H1 + meta description + internal-link module presence.
- Hub H1 + meta description presence.

### What is now strong in code

| Capability | Mechanism |
|---|---|
| Per-state sitemap segmentation | `sitemap-zips-{state}.xml` endpoints |
| Best-pages-first link graph | `zip-priority.ts` driving homepage + hubs + ZIP page link blocks |
| Deterministic tier assignment | `getZipPriorityTier(record)` |
| Operator visibility into SEO architecture | `/admin/system/seo-health` |
| Canonical consolidation | non-www canonical + 301 + sitemap-only non-www URLs |
| Private-route exclusion | `isNoIndexPathname` covers meta robots + sitemap filter + `vercel.json` `X-Robots-Tag` |

### What likely helps indexing/crawling

- Semantic shard names make per-shard discovery counts inspectable in
  Search Console — you can now answer "are my Texas ZIPs discovered?".
- Curated featured-ZIP blocks on every state hub give Tier-1 ZIPs
  multiple inbound public links.
- Best-pages-first link graph reduces wasted crawl budget on
  long-tail ZIPs by routing crawlers through hubs first.
- Per-state shards keep `<lastmod>` semantics meaningful — if a single
  state's content changes, only that shard's timestamp moves.

### What remains Google-dependent

- Whether any individual ZIP page is ever indexed.
- Whether low-demand ZIPs leave `Discovered – currently not indexed`.
- Recrawl cadence on the 301 + non-www canonical for the legacy
  `www.` URLs already in Google's index.
- Whether `Crawled – currently not indexed` ZIPs upgrade to indexed
  after the multi-sentence body + structured data improvements.
- We do not claim that all ~41,000 ZIPs will be indexed. GSC impression
  data should drive promotion decisions (move a high-impression ZIP to
  the priority list, demote a zero-impression ZIP to `consolidate_candidate`).

### Search Console post-deploy checklist

After this step ships and Vercel finishes deploying:

1. Re-submit `https://wageronweather.com/sitemap-index.xml` in Search
   Console → Sitemaps. Confirm each child shard appears as a
   discovered sitemap.
2. URL-inspect the homepage. Confirm canonical = non-www, indexable.
3. URL-inspect each state hub (sample at least 5).
4. URL-inspect each curated city hub (5).
5. URL-inspect all 5 Tier-1 priority ZIPs.
6. URL-inspect ≥5 long-tail ZIPs from different states (sanity check
   the scalable template).
7. Monitor `Pages` report → `Sitemaps` for per-shard discovered URL
   counts. Per-state shards should each show their actual ZIP count.
8. Monitor `Crawl Stats` for whether crawl budget shifts toward hubs.
9. Monitor `Discovered – currently not indexed` — should plateau or
   decline if the hub linking is helping crawl prioritization.
10. Monitor `Crawled – currently not indexed` — should decline if the
    template upgrade improves uniqueness signals.
11. Monitor `Alternate page with proper canonical` — should decline
    over weeks as Google recrawls and consolidates www → non-www.
12. **Do not** expect immediate indexing of all 41,134 ZIPs. Use 30/60/90
    day windows to evaluate movement, not day-over-day swings.

## Step 177 — Search Console reconciliation + SEO prioritization loop

Step 177 moves SEO operations from "what we ship" to "what Google
actually sees", without yet wiring up the Search Console API.

### Manual import workflow

The admin SEO health dashboard at `/admin/system/seo-health` now hosts
a **Search Console reconciliation** panel that accepts two CSVs the
operator pastes (or uploads) from Search Console:

1. **Page indexing CSV** — Search Console → **Pages** → export ▸
   **Download CSV**. Each row is one URL with the current GSC verdict
   ("Submitted and indexed", "Crawled - currently not indexed",
   "Discovered - currently not indexed", "Alternate page with proper
   canonical tag", etc.) plus optional reason / source / last-crawl.
2. **Performance CSV** — Search Console → **Performance** →
   **Pages** tab → ⤓ **Export** ▸ **Pages**. Each row is one URL
   with the impressions / clicks / CTR / average position for the
   selected date window.

You can also paste TSV from the Search Console UI directly. The parser
in `src/lib/seo/gsc-import.ts` is tolerant of common header variations
and unknown columns; malformed rows are skipped and counted under
`warnings.skipped`.

Press **Analyze GSC exports**. The dashboard does:

- normalize every URL to its non-www canonical (`normalizeGscUrl`),
- classify route type via `classifyRouteType` (homepage / state_hub /
  city_hub / zip_page / venues_hub / league_page / map / historical /
  noindex_*),
- attach the expected sitemap shard via `assignSitemapShard`,
- look up ZIP priority tier via `getZipPriorityTier` for ZIP pages,
- compute an advisory recommendation per row (`classifyGscRecommendation`),
- bucket rows into 10 actionable queues.

The dashboard's output:

- **Totals** — indexed / not-indexed / impressions / clicks.
- **By route type** — count of each verdict per surface.
- **By ZIP priority tier** — indexed vs not-indexed vs impressions
  for Tier 1 / Tier 2 / Tier 3.
- **By sitemap shard** — URLs declared in shard vs URLs seen in GSC
  vs indexed vs impressions. Highlights shards that GSC is ignoring.
- **Canonical / host issues** — count of legacy `www.` URLs, alternate
  canonical findings, mismatched canonicals, and a sample of external
  URLs that don't belong to this site.
- **Actionable queues** — 10 prioritized buckets (see below).

### Recommendation taxonomy

`classifyGscRecommendation` returns one of these per URL, with a short
list of human-readable reasons. **Advisory only** — Step 177 does
not auto-mutate the site, the sitemap, the priority list, or any link
block. Operators read the queue, decide manually, and the change
ships in a separate code review.

| Recommendation | Trigger | Operator action |
|---|---|---|
| `promote` | indexed + impressions on Tier-2/3 ZIP | Promote to priority list; add custom intro; feature on city hub. |
| `strengthen_internal_links` | Tier-1 ZIP or hub not indexed | Add hub links; URL-inspect; verify sitemap inclusion. |
| `improve_ctr` | ≥25 impressions, CTR < 1%, position ≤ 20 | Rewrite title / meta description; consider custom intro. |
| `monitor` | indexed with no urgent signal | None — re-check next month. |
| `deprioritize` | Tier-3 ZIP with no impressions and not indexed | Consider `consolidate_candidate` band; stop spending link budget. |
| `noindex_expected` | admin / auth / dashboard / settings / preview / internal | None unless a public page is mis-flagged. |
| `investigate_canonical` | legacy www URL or alternate-canonical finding | Confirm 301 fires; confirm page emits non-www canonical; monitor recrawl. |
| `investigate_error` | server error or soft 404 | Reproduce; fix; resubmit. |

### Actionable queues

The panel surfaces 10 queues (each capped at 50 items):

1. **Tier-1 ZIPs not indexed** — manually-designated priority ZIPs that
   GSC reports as not indexed.
2. **Tier-1 ZIPs with impressions but low CTR** — title/meta rework
   candidates.
3. **City hubs with low or no impressions** — strengthen homepage +
   state-hub linking, improve copy.
4. **State hubs not indexed** — blocks crawl into the state's ZIP shard.
5. **Discovered — currently not indexed (strategic)** — Tier-1/2 ZIPs
   + hubs that GSC has seen but not indexed.
6. **Crawled — currently not indexed** — Google has the page but
   doesn't consider it index-worthy.
7. **Alternate canonical or duplicate host** — legacy `www.` URLs and
   GSC alternate-canonical findings.
8. **Noindex expected** — sanity check that admin/auth/dashboard are
   correctly excluded.
9. **Tier-2/3 ZIPs with impressions or clicks** — promotion candidates.
10. **Long-tail ZIPs with no impressions** — deprioritization candidates.

### Validation script

`scripts/verify-gsc-import.mjs` posts two inline fixture CSVs against
the live `/api/admin/system/seo-gsc-import` endpoint and asserts on
the returned report. Run **with the dev server up** (`npm run dev`)
plus an admin session cookie:

```
node scripts/verify-gsc-import.mjs --cookie 'wow_admin_session=…'
node scripts/verify-gsc-import.mjs --base https://wageronweather.com --cookie '…'
```

Coverage:

- CSV totals (indexing + performance row counts, indexed/not-indexed,
  impressions).
- URL reconciliation for state hub, city hub, Tier-1 ZIP, admin route,
  and a Wyoming "Discovered – currently not indexed" ZIP.
- www → non-www normalization (the Texas state hub CSV row is
  intentionally on `www.`).
- Sitemap shard assignment (`sitemap-states.xml`,
  `sitemap-cities.xml`, `sitemap-zips-tx.xml`).
- Recommendation taxonomy (`noindex_expected` on `/admin`,
  `tier1_not_indexed` queue present, `promote_candidates` queue
  present).
- Malformed CSV → endpoint returns 200 with `reconciledUrls === 0`
  rather than crashing.

### What remains manual

- The export step itself — Search Console does not let us shell out
  to a CSV download without OAuth.
- Choosing which queue items to act on — the dashboard ranks by
  impressions, but the operator decides whether to promote.
- Site-side changes that follow a recommendation — promotions land as
  edits to `priority-zip-content.ts` / `CITY_HUB_ROSTER` in normal
  code review. No autopilot.

### What could become automated (future)

| Step | Capability |
|---|---|
| 178 | Evidence-based featured-ZIP promotion queue (operator-confirmed UI to propose tier upgrades from GSC data). |
| 179 | Search Console API + Sitemaps API integration with scheduled imports and persisted snapshots. |
| 180 | SEO experiment tracking — A/B variants for titles, hub copy, and internal-link blocks with GSC outcome attribution. |

### Candid note

**This step does not guarantee indexing.** It helps decide where to
spend internal-linking and content-improvement effort based on real
Google data. Promotion from Tier 3 → Tier 1 may not move the needle
if the underlying content is duplicative or the topical demand is
low. Recrawl latency means most changes take 30–60 days to surface
in GSC.

## Step 178 — Sitemap namespace fix + Tier-based crawl-budget prune

Shipped 2026-07-18 after a live GSC diagnosis (property `wageronweather.com`,
domain property). GSC showed **38 indexed / ~43K not indexed**: ~38,997
`Discovered – currently not indexed` + ~3,665 `Crawled – currently not
indexed`, plus **"55 errors" on the sitemap**. Two root causes fixed:

### 1. Malformed sitemap XML namespace (the "55 errors")

`src/lib/seo/sitemap-shards.ts` emitted the namespace
`http://www.sitemaps.org/schemas/sitemap-0.9` (hyphen) in both
`renderUrlSet` and `renderSitemapIndex`. The correct namespace is
`http://www.sitemaps.org/schemas/sitemap/0.9` (slash). GSC flagged every
sitemap document (1 index + 3 top-level shards + 51 ZIP shards = **55**),
which is exactly the "55 errors" count. Google's lenient parser still
extracted URLs, so discovery worked, but the error flag stayed until this
fix. **Fixed.**

### 2. Tier-based sitemap prune (classifier finally wired in)

Steps 174–177 built the tier machinery but left it observation-only — the
sitemap still advertised **all ~41K ZIPs**. After ~5 months that produced
38 indexed pages. Step 178 wires `getZipPriorityTier` into
`buildZipShardForState` via `MAX_SITEMAP_ZIP_TIER = 2`:

| In sitemap now | Tier | ~Count |
|---|---|---|
| ✅ Hubs (pages/states/cities) | — | 65 |
| ✅ Tier 1 (priority / city-hub / major-metro ZIPs) | 1 | 2,815 |
| ✅ Tier 2 (mid-tier curated-city ZIPs) | 2 | 3,412 |
| ❌ Tier 3 (long-tail "everything else") | 3 | 34,743 (dropped) |

**Sitemap goes 41,035 → 6,292 URLs (85% cut).** All 51 state shards remain
(every state has ≥1 Tier ≤2 ZIP; no empty shards). Tier-3 ZIP pages stay
**live and crawlable (HTTP 200, not noindexed)** — they are simply no
longer force-fed to Google, concentrating crawl budget on pages that can
realistically index/rank. To promote a Tier-3 ZIP back into the sitemap,
add it to `priority-zip-content.ts`, a city hub (`CITY_HUB_ROSTER` +
us-cities), or bump its city's tier in `us-cities.ts` — driven by GSC
impression data (Step 177 reconciliation panel).

This is reversible: raise `MAX_SITEMAP_ZIP_TIER` to 3 to restore the full
long tail. The admin SEO health dashboard reads the same helper, so its
counts stay in sync automatically.

## Step 179 — Crawl-efficiency: de-duplicate island forecast payload

**Problem (unaddressed by Steps 173–178).** Every ZIP page mounts ~9
`client:only` React islands (WeatherHero, TodaysWeather, HourlyForecast,
TemperatureChart, WindChart, PrecipChart, ForecastMaps, HumidityDewPointCard,
SportsMetrics) that each need the full `hourly` array; two also need `daily`.
Astro serializes **every island's props into the HTML**, so the same ~200 KB
forecast array was written into the page ~9–10 times (HTML-escaped, `"`→`&quot;`
= 6× inflation). Result: **~1.9 MB per ZIP page**, of which ~99% is duplicated
JSON that renders **no server content** (the islands are client-only) — pure
crawl-budget waste on a domain whose dominant GSC status is *Discovered –
currently not indexed* (a crawl-budget/authority signal, not a content one).

**Fix.** The forecast arrays are now emitted **once** per page as
`<script type="application/json" id="wow-forecast-data">` (in `[...slug].astro`,
just inside the main content `div`). Islands read `hourly`/`daily` via
`sharedHourly()` / `sharedDaily()` from `src/lib/client/shared-forecast.ts`,
which returns the caller's prop when provided (so `/map`, `/forecast/[location]`
and any other caller passing the arrays inline are unchanged) and otherwise
parses the shared payload once (module-level cache). The `hourly`/`daily` props
were dropped from those island invocations on the ZIP page only.

Expected: **~1.9 MB → ~0.2–0.3 MB per ZIP page** (single forecast copy + small
`current`/`today`/`alerts` props + markup), no SEO content lost (islands never
rendered server HTML), no UX change (data still inlined — no new fetch/spinner).

**Files:** `src/lib/client/shared-forecast.ts` (new); the 10 forecast components
above; `src/pages/[...slug].astro` (payload emit + prop removal).

**Verify:** after the Vercel preview builds, fetch a ZIP page and confirm (a) it
renders the hero/hourly/charts/maps, (b) total HTML dropped ~7–9×. Then
`node scripts/verify-seo-routing.mjs --base <preview-url>` before promoting to
`master`.

## Step 180 — Venue game-day-weather pages (niche/betting SEO surface)

**Strategic rationale.** Ranking generic `/united-states-…-{zip}` forecast pages
means competing head-on with Weather.com for forecast-seekers who never wager —
unwinnable for a new domain and the wrong audience. The product's real audience
is **sports bettors**, and the beatable niche is **weather-for-bettors / venue
game-day weather** (the NFLWeather.com / RotoGrinders tier — beatable sites, not
weather giants). The `/venues` surface existed only as scaffolding: the hub +
league pages were real, but **`/venues/[venue]` merely 301-redirected to the ZIP
page** — no venue destination, no game-day weather, no indexable venue content.

**What changed.** `/venues/[venue].astro` is now a **real server-rendered
(indexable) page**, not a redirect. Per venue it renders: a unique intro (team,
city, capacity, roof type), **live current conditions**, **roof/dome context**
(open-air → weather matters; retractable → depends on roof; indoor → climate-
controlled, weather is not a factor — itself a game-day signal), **factual
"how weather affects play" notes** (wind/temp/precip impact by sport), a **7-day
outlook table**, a link to the full ZIP forecast, and related same-league venues
(internal linking). Unlike the ZIP pages, the venue content is **server-rendered
HTML**, so it's directly indexable.

**Compliance (CLAUDE.md "no betting advice").** The venue page does NOT use
`betting-weather.ts` output (which contains "Under"/"Over value"/"lean" advice
framing). It renders neutral, factual weather-impact copy only, labeled "Not
betting advice." ⚠️ Note for a future step: `SportsMetrics` (on ZIP pages) *does*
render `analyzeBettingWeather`'s advice strings publicly — worth a compliance
review against the no-advice rule.

**SEO wiring.** All ~90+ major-league venue pages added to `sitemap-pages.xml`
(`buildPagesShard`, priority 0.6). `StadiumOrArena` + `BreadcrumbList` JSON-LD,
non-www canonical via BaseLayout, breadcrumb Home ▸ Venues ▸ {League} ▸ {Venue}.
The hub search + league lists already link to `/venues/{id}`, which now resolve
to real pages instead of redirects.

**Files:** `src/pages/venues/[venue].astro` (redirect → real page);
`src/lib/seo/sitemap-shards.ts` (venue URLs in pages shard).

**Next:** weekly NFL/MLB "Week N weather" recap pages (recurring, link-worthy);
wire embeddable location markets onto venue pages once traffic arrives.

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
