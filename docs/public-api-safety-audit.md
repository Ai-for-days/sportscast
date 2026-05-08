# Public API Safety Audit

**Last updated:** Step 135 (commit reference at the top of `project_wageronweather` memory).

This document enumerates every customer/public-facing route on the platform, the sanitizer protecting each one, the fields that are intentionally public, and the fields that must never cross the trust boundary.

It does NOT cover admin routes (everything under `/admin/*` and `/api/admin/*`); those are gated by `requireAdmin` and may surface internal data by design.

---

## Trust boundary

- **Public surface:** `/`, `/wagers`, `/wagers/[id]`, `/venues/*`, and any `*.astro` page that lacks `requireAdmin` / `requireUser`. Plus every `*.ts` API route under `src/pages/api/` that is not under `api/admin/`. These are reachable by anonymous browsers.
- **Authenticated user surface:** `/api/auth/*`, `/api/bets*`, `/api/payments/*`. Gated by `requireUser`. May expose user-private data (their own balance, their own bets) but not admin-only data.
- **Admin surface:** Everything under `/admin/*` and `/api/admin/*`, gated by `requireAdmin`. Allowed to expose any internal data to authenticated admins.

The canonical public-safe wager object is **`PublicWagerView`** (`src/lib/public-wager-view.ts`). Raw `Wager` records must NEVER cross the public surface.

---

## Customer-facing routes (anonymous)

| Route | Method | Sanitizer | Notes |
|---|---|---|---|
| `/api/wagers` | GET | `listPublicWagers` + `serializePublicWagers` | Public wager list. **Hardened in Step 120 Part A** — previously returned raw `Wager` objects from `listWagers`. |
| `/api/wagers/[id]` | GET | `getPublicWager` + `serializePublicWager` | Public wager detail. **Hardened in Step 120 Part A** — previously returned the raw `Wager` from `getWager`. |
| `/wagers` (Astro page) | SSR | `listPublicWagers` (server-rendered) | Page renders from the sanitized view; never spreads a raw `Wager` into props. |
| `/wagers/[id]` (Astro page) | SSR | `getPublicWager` | Same. |
| `/` (Astro page) | prerender=true | n/a (static) | Hero + sports forecast CTA + weather-markets sections (`HomeHero`, `FeaturedMarkets`, `HowItWorks`, `TrustSafetyStrip`). `FeaturedMarkets` is a client island that hits `/api/wagers?status=open&limit=6` (sanitized). |
| `/api/forecast`, `/api/historical`, `/api/geocode`, `/api/reverse-geocode`, `/api/openaq`, `/api/records`, `/api/venues`, `/api/map-grid`, `/api/weather/historical-averages` | GET | n/a (no wager data) | These are public weather/geo endpoints; they do not touch the wager store. |

---

## Authenticated user routes

These require `requireUser`. They may expose user-private data but must not expose admin-only fields belonging to other users or markets.

| Route | Sanitizer / scope |
|---|---|
| `/api/bets` POST/GET | **Hardened in Step 121 Part A.** GET pipes `getUserBetsEnriched` through `serializeCustomerBets`; POST pipes `placeBet` through `buildCustomerBetView`. The raw `Wager` carried by `EnrichedBet.wager` is replaced with a `PublicWagerView`. Customer-safe fields only — see `SafeCustomerBetView` in `src/lib/customer-bet-view.ts`. |
| `/api/bets/[id]` | **Hardened in Step 121 Part A.** Returns `SafeCustomerBetView` via `buildCustomerBetView` + `getPublicWager`. Forbidden cross-user reads via the existing `bet.userId !== user.id` gate. |
| `/api/payments/*` | User payment ledger; not in Step 120 scope. |
| `/api/auth/*` | Session lifecycle; no wager fields. |

---

## PublicWagerView — canonical public schema

Defined in `src/lib/public-wager-view.ts`. The allow-list is **`PUBLIC_WAGER_VIEW_KEYS`**. Public APIs MUST run their output through `serializePublicWager` / `serializePublicWagers` so any stray field is dropped at the JSON boundary.

### Intentionally public (allowed on every public response)

```
id, ticketNumber, title, description, kind, status,
metric, targetDate, targetTime, lockTime,
locationSummary, termsSummary, outcomes, displayedOdds,
resolutionRules, weatherDataExplanation,
winConditionSummary, tieOrPushSummary, lockSummary, resolutionSourceSummary,
responsiblePlayNote, lastUpdatedAt, createdAt,
resolvedAt?, voidedAt?,
winningOutcome?, observedValue?, observedValueA?, observedValueB?
```

`outcomes[]` carries only `{ label, displayedOdds?, isWinner? }` — no pricing model, no opening/closing snapshot, no internal naming.

### Forbidden on public responses

These fields exist on the raw `Wager` record but are stripped by `toPublicWagerView` and deliberately omitted from `PublicWagerView`:

- `voidReason` — operator-authored free text. Use the generic "This market was cancelled before resolution." copy instead.
- `internalName` — admin-facing market name.
- `pricingSnapshot` — model output at creation time.
- `openingLineSnapshot`, `closingLineSnapshot` — line history.
- `lineHistory` — admin line-move audit trail.

These artifacts live in adjacent admin systems and must NEVER be referenced on a public response:

- Settlement previews (`wager-settlement-preview.ts`)
- House exposure snapshots (`house-exposure.ts`)
- Market integrity reports (`market-integrity.ts`)
- Audit log entries (`audit-log.ts`, `audit-investigation.ts`)
- Disputes / incidents (`dispute-workflow.ts`, `incident-management.ts`)
- Operator notes / runbooks (`daily-operator-runbook.ts`)
- Operator certifications / RBAC (`operator-certification.ts`, `operator-rbac-review.ts`)
- Pricing recommendations / margin engine (`wager-pricing-engine.ts`)
- Market design reviews (`wager-market-design.ts`)
- Internal confidence scores (anywhere)
- Raw weather evidence records (`weather-evidence.ts`)
- Kalshi market data, comparisons, hedge reviews (`kalshi-*.ts`, `manual-hedge-review.ts`)

---

## Defensive serialization

`serializePublicWager` in `public-wager-view.ts` picks ONLY the canonical fields by name. It never spreads the input. Even if a future caller accidentally hands a raw `Wager` to the function (or merges admin fields into a `PublicWagerView`), the JSON response stays clean.

**Rule:** every new public API that returns wager data MUST call `serializePublicWager` / `serializePublicWagers` immediately before `JSON.stringify`. Type-checking alone is not enough — TypeScript will let a wider object satisfy the narrower interface and the extra fields will leak.

---

## Public components

Front-end components under `src/components/public/` consume only `PublicWagerView` typed props. They do not import from `wager-store`, `wager-types` (raw), `bet-store`, `wallet-store`, `house-exposure`, or any Kalshi/audit/integrity module. Verified components (Step 120 Part D):

- `WagerCard.tsx`
- `PublicWagerList.tsx`
- `WagerDetailPage.tsx`
- `WagerTimeline.tsx`
- `WagerRulesCard.tsx`
- `WagerFAQ.tsx`
- `WhyTrustThisMarket.tsx`
- `FeaturedMarkets.tsx`
- `HomeHero.tsx`, `HowItWorks.tsx`, `TrustSafetyStrip.tsx` (no wager data)

---

## Kalshi data boundary

Kalshi market snapshots (`kalshi-market-data.ts`), comparisons (`kalshi-market-comparison.ts`), and hedge reviews (`manual-hedge-review.ts`) live entirely behind `requireAdmin`. Their Redis keys (`kalshi-market-snapshot:*`, `kalshi-comparison:*`, `hedge-review:*`) and their API routes (`/api/admin/system/kalshi-*`, `/api/admin/system/manual-hedge-review`) are admin-only. **No public surface reads these keys, calls these routes, or imports these modules.**

`KALSHI_PRIVATE_KEY` / `KALSHI_PRIVATE_KEY_BASE64` is read only by `kalshi-config.ts` (server-only, browser-import throws). The decoded key value is never returned from any helper, never logged, and never sent in any response body.

## Polymarket data boundary (Steps 124 + 126)

Polymarket is treated as a **parallel external market-intelligence venue** alongside Kalshi. Phases live entirely behind `requireAdmin`:

- `src/lib/polymarket-config.ts` — server-side constants (`POLYMARKET_WEATHER_URL`, `POLYMARKET_GAMMA_API_BASE`). No keys, no wallet, no signing. No client-side exports of sensitive material.
- `src/lib/polymarket-client.ts` (Step 126) — server-only read-only Gamma API client. Browser-import throws. Exposes `listMarkets`, `discoverWeatherMarkets`, `normalizeMarket`. **No order, wallet, or signing methods exist on this client.**
- `src/lib/polymarket-market-store.ts` (Step 126) — server-only snapshot lifecycle in Redis (`polymarket-market-snapshot:*`, `polymarket-market-snapshots:all`, retention 200). `testPolymarketConnectivity` for the admin Status tab.
- `/api/admin/system/polymarket-market-data` (Step 126) — admin-only API gated by `requireAdmin`. Actions: `list-snapshots`, `get-snapshot`, `discover-weather-markets`, `test-connectivity`. Audit events: `polymarket_market_snapshot_fetched`, `polymarket_connectivity_test`.
- `/admin/system/polymarket-market-data` (Step 126) — admin Astro page rendering `PolymarketMarketDataCenter` (status / discover / snapshots / uses / methodology). Persistent banner: "admin-only and read-only. No wallet, no signing, no orders, no auto-hedging, no auto-mirroring."
- `docs/polymarket-integration-plan.md` — phased roadmap (config → discovery → snapshots → three-way comparison → manual review). Phase 2 implemented in Step 126.
- **No public or customer exposure of Polymarket data is permitted, ever.** No file under `src/components/public/`, `src/components/player/`, `src/components/account/`, `src/pages/api/wagers*`, or `src/pages/api/bets*` imports any `polymarket-*` module or fetches any `/api/admin/system/polymarket-*` route.

The same trust-boundary rules that apply to Kalshi apply to Polymarket: admin-only routes, server-only modules, no autonomous trading, no automatic WagerOnWeather market creation from external data, audit-logged reads via `src/lib/audit-log.ts` with `polymarket_*` event types.

---

## How to add a new public route safely

1. Decide what the route returns. If it is wager data, the answer is `PublicWagerView` (or an array of them).
2. Use `getPublicWager` / `listPublicWagers` to read from the store. Never call `getWager` / `listWagers` directly from a public route.
3. Pass the result through `serializePublicWager` / `serializePublicWagers` before `JSON.stringify`.
4. Add the route to the table at the top of this document.
5. If the route returns a different shape (not wager data), define an explicit allow-list type and a sibling `serializeXxx` helper. Apply the same "pick by name, never spread" rule.
6. Add a unit-style assertion or a comment explaining the trust boundary.

---

## Customer bet view — `SafeCustomerBetView`

Defined in `src/lib/customer-bet-view.ts`. Every authenticated bet API response uses this shape. Allowed fields:

```
id, ticketNumber?, wagerId, wagerTitle, wagerStatus,
outcomeLabel, odds, stakeCents, potentialPayoutCents,
placedAt, settledAt?, status,
publicWagerView?, resolvedOutcome?, userVisibleResult?
```

The `publicWagerView` field, when present, is a `PublicWagerView` after `serializePublicWager`.

The legacy `EnrichedBet.userId` field is **not** carried into the customer view (a user can already infer it; we don't echo it). The raw `Wager` is replaced with `publicWagerView` and is never spread.

### Client adapter for legacy consumers

The `adaptSafeBetToLegacyEnriched` shim was removed in Step 123 once all customer/account bet rendering had been consolidated onto `<MyBets />` and `SafeCustomerBetView`. There is no longer an `EnrichedBet`-shaped intermediate on the customer trust boundary — the API returns `SafeCustomerBetView` and customer components consume it directly.

---

## Customer-component import audit (Step 122 Part F)

Verified that no file under `src/components/player/`, `src/components/account/`, or `src/components/public/` imports any of the following admin/internal modules:

- `kalshi-*`, `manual-hedge-review`, `audit-log`, `market-integrity`, `house-exposure`, `wager-settlement-preview`, `dispute-workflow`, `incident-management`, `operator-rbac-review`, `operator-certification`, `admin-auth`, `kalshi-config`, `kalshi-client`.

Astro pages under `src/pages/wagers/` and `src/pages/account/` were checked for the same patterns; no leakage.

**Compatibility shim removed (Step 123):** `adaptSafeBetToLegacyEnriched` was deleted from `src/lib/customer-bet-view.ts`. No customer or account caller depended on it after the Step 122 consolidation.

## Step 123 cleanup notes

- `PlayerDashboard.tsx` legacy bet-rendering helpers were physically removed: `BetCardSettled`, `PreviousWagersTab`, `getPickNameBet`, `getPickDescriptionBet`, `getWagerSpecsBet`, `getLocationNameBet`, `BET_STATUS_STYLES`, `KIND_LABELS`, `METRIC_LABELS_BET`, `METRIC_UNITS`, `formatOddsBet`, `formatDateBet`, plus their dead-only imports (`WagerStatus`, `OddsWager`, `OverUnderWager`, `PointspreadWager`, `Bet`, `BetStatus`, `EnrichedBet`). The file dropped from ~1210 to ~660 lines.
- `formatDateTimeBet` was renamed to `formatDateTime` because its only remaining caller is the live transactions tab (`TransactionGroups`); the `Bet` suffix was misleading. `formatMonthLabel` is also live-only via `TransactionGroups`. No transaction-tab behavior changed.
- `adaptSafeBetToLegacyEnriched` was deleted from `src/lib/customer-bet-view.ts`. No call sites remained after Step 122.
- `AccountDashboard.tsx` was inspected and consumes only sanitized data: `/api/auth/me`, `/api/payments/balance`, `/api/payments/transactions`, plus `<BetHistory />` (a thin wrapper around `<MyBets />`). It imports no raw `Wager`, `Bet`, or `EnrichedBet` types and reads no admin-only fields.
- No admin/Kalshi/risk fields were added to any public or customer surface in this step. No grading, settlement, or wallet/balance behavior changed.

### Known carry-over (out of scope for Step 123)

`PlayerDashboard.useState<Wager[]>([])` types the open-markets state as raw `Wager[]` even though `/api/wagers` returns sanitized `PublicWagerView[]` data. This is a type-annotation widening, not a runtime leak — the JSON only carries public-safe fields. Tightening the annotation to `PublicWagerView[]` is a follow-up that needs `WagerCard` to accept the sanitized prop shape.

## Step 124 cleanup notes

- `PlayerDashboard.tsx` open-markets state is now typed `useState<PublicWagerView[]>([])`, aligning the type boundary with the sanitized `/api/wagers` response. The previous `Wager[]` annotation was a type widening over the actual runtime data (no leak, but a misleading shape).
- `src/components/wagers/WagerCard.tsx` (the legacy bet-placement card used by `PlayerDashboard`) still reads raw `Wager` nested fields (`wager.locationA.name`, `wager.over.odds`, `wager.outcomes[i].odds`, etc.). The `PublicWagerView` shape exposes the same data via flat fields (`locationAName`, `outcomes[i].displayedOdds`) and computed strings (`locationSummary`). Step 124 retains a documented `as unknown as Wager` cast at the two `<WagerCard>` call sites in `PlayerDashboard` to preserve current rendering behavior pending the renderer-alignment follow-up. There is a parallel `src/components/public/WagerCard.tsx` that already accepts `PublicWagerView` (read-only navigation only — no inline bet slip), used by `PublicWagerList` and `FeaturedMarkets`.
- Polymarket integration foundation added — `src/lib/polymarket-config.ts` (server-only constants only; no keys, no wallet, no signing) and `docs/polymarket-integration-plan.md`. The Kalshi integration plan was updated to acknowledge Polymarket as a parallel external venue.
- No Polymarket data, helper, or import is referenced from any public, anonymous, or `requireUser`-gated surface.

### Known follow-ups after Step 124

- **Latent rendering mismatch in PlayerDashboard's open-markets tab.** `src/components/wagers/WagerCard.tsx` and its three sub-components (`OddsDisplay`, `OverUnderDisplay`, `PointspreadDisplay`) read raw `Wager` nested fields that don't exist on the `PublicWagerView` instances PlayerDashboard now (correctly) feeds them. Symptom: when an open wager is rendered to a logged-in user, the card may throw or render `undefined` for location names, odds, lines, and spreads. Hidden in environments with no open wagers. Two resolution paths for a future step: (a) refactor `wagers/WagerCard` + the three Display components to accept `PublicWagerView` directly (preserves the inline bet-slip flow), or (b) point `PlayerDashboard` at `public/WagerCard` (loses the inline bet-slip; users would navigate to the detail page first).

> **Resolved in Step 125** via path (a). The Step 124 follow-up above is preserved here for historical reference.

## Step 125 cleanup notes

- `src/components/wagers/WagerCard.tsx`, `OddsDisplay.tsx`, `OverUnderDisplay.tsx`, and `PointspreadDisplay.tsx` were refactored to accept `PublicWagerView` (and `PublicOutcome[]` via `wager.outcomes`) instead of raw `Wager` / `OddsWager` / `OverUnderWager` / `PointspreadWager`. Renderers now read only sanitized fields: `wager.locationName` / `locationAName` / `locationBName` (with `locationSummary` fallback), `wager.line`, `wager.spread`, `wager.outcomes[i].displayedOdds`, `wager.outcomes[i].isWinner`, `wager.observedValueA` / `observedValueB`. Inline outcome buttons, bet-slip click flow, graded-result banner, and void notice all preserved.
- `PlayerDashboard.tsx` no longer casts to `Wager` — the two `<WagerCard>` call sites pass `PublicWagerView` directly. The `Wager` type import was dropped (only the cast referenced it).
- `WagerBoard.tsx` and `ForecastWagers.tsx` (the other two callers of the inline bet card) were also retyped from `Wager[]` to `PublicWagerView[]`. `ForecastWagers.matchesCity` now reads `locationName` / `locationAName` / `locationBName` instead of raw nested `wager.location.name` / `wager.locationA.name` (which would have rendered `undefined` against the sanitized API response).
- The latent rendering mismatch flagged after Step 124 is resolved. Every customer-facing wager renderer now reads exclusively from sanitized public-safe fields. No admin caller of `wagers/WagerCard` remained — all three callers were already consuming `/api/wagers`, so no admin-side adapter was needed.
- No admin / Kalshi / Polymarket / risk fields were added to any public or customer surface in this step. No grading, settlement, or wallet/balance behavior changed.

## Step 135 cleanup notes

- Added the **typed harness** for the production WeatherNext Vertex AI client. Foundation only — the Vertex AI HTTP body is deliberately not implemented because the endpoint contract is not yet confirmed against authoritative Google docs (`weathernext-integration-plan.md` §10 lists the unknowns). **Open-Meteo remains the live public default. Settlement still uses NWS observations.** No public/customer trust-boundary, pricing, betting, wallet, Kalshi, Polymarket, admin, grading, or `PublicWagerView`/`SafeCustomerBetView` behavior was touched.
- `src/lib/weathernext-client.ts` (new) — server-only (browser-import throws), no client imports, no secrets in any return value. Exports `WeatherNextFailureMode` taxonomy (`unconfigured`, `endpoint_unconfirmed`, `timeout`, `network_error`, `auth_rejected`, `quota_exceeded`, `upstream_error`, `schema_mismatch`, `unknown`), `WeatherNextResult` discriminated union, `WeatherNextConfigStatus`, `isWeatherNextConfigured()`, `getWeatherNextConfigStatus()` (server-only diagnostic — returns booleans only, never the values themselves), and `tryWeatherNextForecast(lat, lon, days)` which **never throws** and is bounded by a 1500 ms `AbortController` timeout. The current happy-path body returns `failureMode: 'endpoint_unconfirmed'` so the resolver always falls back to Open-Meteo until the inference body is filled in against a confirmed contract.
- `src/lib/forecast-source.ts` gained `getWeatherNextSuccessSource()` (returns the real `WeatherNext` source for the success path) and `getWeatherNextFallbackSource(failureMode, extraNotes)` (returns an Open-Meteo source with structured notes recording why the WeatherNext call didn't happen). Legacy `getForecastSource('weathernext-production')` stub behavior is preserved for any caller that doesn't know about the success/failure split.
- `src/lib/weather-queries.ts` — when `FORECAST_PROVIDER=weathernext-production`, `getForecast` now actually invokes `tryWeatherNextForecast`. On `result.ok` it returns the WeatherNext-sourced response; on `!result.ok` (today: always) it serves Open-Meteo with `source.notes` recording the failure mode. The other branches (default Open-Meteo, BigQuery sample opt-in) are unchanged.
- `.env.example` — three new placeholder variables (`WEATHERNEXT_VERTEX_REGION`, `WEATHERNEXT_VERTEX_ENDPOINT_ID`, `WEATHERNEXT_VERTEX_MODEL_ID`) documented with the explicit caveat that even when all are set, the client still returns `failureMode: 'endpoint_unconfirmed'` until Step 136+ confirms the contract. `GCP_PROJECT_ID` + `GCP_CREDENTIALS_BASE64` are reused — no new secret.
- `docs/weathernext-integration-plan.md` — Phase 3 marked "foundation in place" (not "complete" — that's after the body lands). New §10 enumerates the eight contract unknowns that must be resolved before the inference body is wired up. New §11 documents what's in / out of scope for Step 135.
- `docs/forecast-provider-capabilities.md` — WeatherNext (production) section updated with Step 135 status and the explicit "client harness exists, body intentionally not implemented" note.
- No customer-facing copy change. The Step 133 source line still reads "Open-Meteo · Updated X minutes ago" because every WeatherNext request is currently falling back. The italic "Markets resolve using official observation rules" footer is unchanged.

## Step 134 cleanup notes

- WeatherNext production-access **research and architecture** completed. Step 134 is documentation + a pure-data metadata module — **no Vertex AI client, no service-account handling, no production WeatherNext request, no new env, no change to the public default, no change to grading/settlement.** Open-Meteo remains the safe default; markets continue to resolve via `nws-grading.ts` / `nws-observations.ts`.
- `docs/weathernext-decision-matrix.md` (new) — formal weighted scoring of Vertex AI / BigQuery production / Earth Engine across 13 criteria. Vertex AI scores 172, BigQuery production 149, Earth Engine 88. **Primary recommendation: Vertex AI** (purpose-built per-request inference, lowest latency, predictable per-prediction pricing, native GCP auth via existing `GCP_CREDENTIALS_BASE64`). **Fallback: BigQuery production tables** (schema continuity with the legacy code, doubles as the substrate for the Phase 4 admin A-B harness). Earth Engine excluded for live request paths; reserved for future spatial-analytics features.
- `docs/weathernext-integration-plan.md` extended with a new §6b "Recommended production architecture" section: ASCII flow diagram, caching strategy (Redis cache keyed by `(provider, lat-cell, lon-cell, run-time)`, TTL ≤ 15 min), server-only access requirements (browser-import throws, `GCP_CREDENTIALS_BASE64` decoding stays on the server, no client-side fetch of any GCP endpoint), explicit fallback-to-Open-Meteo behavior on every failure mode (credentials missing, 5xx/timeout/network, quota 429, schema mismatch, cache hit), 1500 ms hard timeout, phased rollout guidance through Phase 6.
- `docs/forecast-provider-capabilities.md` (new) — side-by-side capability table for the three providers across 14 fields + cadence/horizon/resolution/auth/cost/intended-usage/production-readiness/trust-level/fallback. Mirrored at runtime by `src/lib/forecast-provider-metadata.ts`.
- `src/lib/forecast-provider-metadata.ts` (new) — pure-data module. Exports `FieldQuality` ('real' / 'derived' / 'fabricated' / 'absent'), `ForecastProviderFieldSupport`, `ForecastProviderCapabilities`, `FORECAST_PROVIDER_CAPABILITIES` registry, `getForecastProviderCapabilities()`, `isProviderProductionReady()`. **No network calls, no auth, no secrets.** Sets up Step 135 by giving the future Vertex AI client a way to know which fields are first-class vs. derived without re-asking the schema.
- Open-Meteo metadata: `productionReady: true`, `intendedUsage: 'public-default'`, all 14 fields `'real'`. WeatherNext sample: `productionReady: false`, `intendedUsage: 'research-only'`, six fields are `'fabricated'` or `'derived'`. WeatherNext production: `productionReady: false` (strategic, not yet wired), `intendedUsage: 'planned-strategic'`, all fields planned `'real'`.
- No `PublicWagerView`, `SafeCustomerBetView`, sanitizer, allow-list, customer/anonymous request handler, admin route, Kalshi, Polymarket, grading, settlement, wallet, or pricing logic was touched. The metadata module imports only from `forecast-source` (the type-only `ForecastProvider`). It is reachable from the server via `weather-queries.ts` once Step 135 wires it in; today nothing imports it.

## Step 133 cleanup notes

- Established WeatherNext as the **strategic preferred** forecast source while keeping Open-Meteo as the **current safe default**. Informational/UI-only scope. **No grading/settlement changes — markets continue to resolve via `nws-grading.ts` / `nws-observations.ts`.** No betting/pricing/wallet/Kalshi/Polymarket/admin/trust-boundary changes.
- `src/lib/forecast-source.ts` (new) — single source of truth for forecast-provider resolution. Exports `ForecastProvider` (`'open-meteo' | 'weathernext-bigquery-sample' | 'weathernext-production'`), `ForecastSource` (`{ provider, label, isResearchSample, notes? }`), `resolveForecastProvider()`, `getForecastSource()`, `shouldExecuteBigQuerySample()`. Reads `FORECAST_PROVIDER` first, falls through to legacy `USE_BIGQUERY_FORECAST=true` (mapped to `weathernext-bigquery-sample`), defaults to `open-meteo`. Unknown values warn and fall back to `open-meteo`. `weathernext-production` is a **stub** today: logs a clear warning and serves Open-Meteo so traffic never silently lands on the public sample table.
- `src/lib/types.ts` — `ForecastResponse.source?: ForecastSource` added (optional so existing callers still typecheck).
- `src/lib/weather-queries.ts` — replaced `shouldUseBigQueryForecast()` with the new resolver. Both `getForecast` and `getMapGrid` use `resolveForecastProvider()` + `shouldExecuteBigQuerySample()`. Both code paths populate `forecast.source` so admin/debug surfaces always know which provider produced the response.
- `src/components/forecast/ForecastIntelligenceCard.tsx` — accepts an optional `sourceLabel` prop and renders "Open-Meteo · Updated 18 minutes ago" alongside the freshness line, plus an italic "Markets resolve using official observation rules." footer that makes the settlement boundary explicit on the weather page itself.
- `src/pages/[...slug].astro` — passes `forecast.source?.label` into `ForecastIntelligenceCard`. No other component reads source metadata yet (deliberately minimal; Phase 4 admin A-B dashboard will be the second consumer).
- `.env.example` — `FORECAST_PROVIDER` documented with all three values and behavior; `USE_BIGQUERY_FORECAST` retained and explicitly marked legacy.
- `docs/weathernext-integration-plan.md` (new) — strategic posture, current state, evaluation criteria for production access (update frequency, hourly fields, precip probability, gusts, UV / visibility / humidity / dew point, geographic resolution, latency, cost, quota, commercial constraints, attribution, schema stability), six-phase roadmap (source-mode cleanup ✅ → production access research → server-only WeatherNext client → A-B comparison → admin quality dashboard → switch public default), forbidden-actions list, out-of-scope statement.
- `docs/forecast-intelligence-notes.md` — new §4e documenting that forecast intelligence operates on the active provider; current default Open-Meteo; strategic target WeatherNext production; sample path is research-only; settlement boundary is enforced by code-path separation, not just policy.
- No customer-facing copy, sanitizer, allow-list, `PublicWagerView`, `SafeCustomerBetView`, grading, settlement, wallet, Kalshi, Polymarket, or admin behavior was touched. The new `source` field is optional metadata on `ForecastResponse` consumed only by the public weather page's source-label line.

## Step 132 cleanup notes

- Added a neutral weather-market context card on the public weather page. Informational/UI-only — no data-shape, API, trust-boundary, grading, settlement, wallet, Kalshi, Polymarket, or admin changes. **No betting advice anywhere in the new copy.**
- `src/lib/weather-market-context.ts` (new) — pure-function module. `buildWeatherMarketContext({ intelligence, revision, timeline })` derives a `WeatherMarketContextSummary` `{ isEmpty, headline, tone, bullets, affectedMarketKinds, disclaimer }` from the existing Step 129/130/131 outputs. Five tone-mapped branches (severe-active → uncertain · volatile/low-confidence → uncertain · wetter/drier → watch · warming/cooling → watch · windier/calming → watch · default → steady). Quiet-fallback when nothing is moving and no history yet — `isEmpty: true` so the component renders nothing. **Language guardrails enforced at the source**: never says or implies the user should bet, never references "edge"/"profit"/"value"/"expected value"/"mispriced", never claims any market is more or less likely to win. Disclaimer "This is forecast context, not betting advice." is always present.
- `src/components/forecast/WeatherMarketContextCard.tsx` (new) — pure presentational React island. Three tone surfaces (steady = stable card, watch = soft amber tint, uncertain = soft orange tint). Headline + chip + bullets + always-on disclaimer footer. Renders nothing when `context.isEmpty`.
- `src/pages/[...slug].astro` builds the context server-side from the same intelligence/revision/timeline objects already on the page. Mounted directly above `<ForecastWagers />` so the context reads as a lead-in to the market section. Server-rendered so the card hydrates with stable copy on first paint.
- `docs/forecast-intelligence-notes.md` updated with the §4d market-context section: language guardrails, branch logic, surface placement, and the rule that the card stays out of `PublicWagerView` / pricing / odds / grading territory.
- Banned-language grep on the new module and component returned only the negation-comments — no banned phrase appears in any user-facing string.
- No `PublicWagerView`, `SafeCustomerBetView`, sanitizer, allow-list, or admin/Kalshi/Polymarket field is read by, written to, or referenced from the new code. The context module imports only from `forecast-intelligence`, `forecast-revision-analysis`, and `forecast-timeline`.

## Step 131 cleanup notes

- Added a chronological forecast revision timeline. Informational/UI-only — no data-shape, API, trust-boundary, grading, settlement, wallet, Kalshi, Polymarket, or admin changes.
- `src/lib/forecast-revision-store.ts` gained a bounded `listSnapshots(locKey, limit)` helper. Newest-first; `limit` is clamped to the existing `MAX_SNAPSHOTS_PER_LOCATION = 30` retention. Returns `[]` when nothing is recorded yet. Refactored snapshot parsing into a shared `parseSnapshot` helper. Same server-only guard, same compact payload shape — no new fields persisted.
- `src/lib/forecast-timeline.ts` (new) — pure-function module. `buildForecastTimeline(snapshots, options)` walks consecutive snapshot pairs (newest-first), runs each pair through `diffSnapshots`, and emits a `ForecastTimelineEntry[]`. By default it skips the most-recent pair so it doesn't duplicate the Step 130 ForecastRevisionSummary headline. Caps at 6 entries. Each entry carries `{ id, capturedAt, relativeLabel, headline, detail, importance, primaryKind, changes }`. `narrativeSummary` is a one-line lead derived from the chain ("Severe weather risk has shaped the recent forecast", "Forecast volatility has been increasing recently", "Recent forecast updates have trended warmer.").
- `src/components/forecast/ForecastTimeline.tsx` (new) — pure presentational React island. Vertical timeline (timestamp chip → dot → headline → optional bullets). First three entries visible by default; "Show N more / Show less" toggle for the rest. Calm dot palette (sky/emerald/amber/orange) matching the Step 130 component. Inherits the Step 128 stable card surface. Renders nothing when the timeline is empty so the page stays breathable for first-time visitors.
- `src/pages/[...slug].astro` calls `listSnapshots(locKey, 12)` inside the same `try/catch` that already protects `captureRevision`. Mounts `<ForecastTimeline />` directly under `<ForecastRevisionSummary />`. Redis-unreachable falls back to an empty timeline; component renders nothing; page never fails.
- `docs/forecast-intelligence-notes.md` updated with the timeline philosophy, retention/display strategy, and an extended Phase 4+ expansion list (operator volatility alerts, line-movement intelligence, ensemble disagreement, public revision-history visualization, confidence-aware pricing).
- No customer/anonymous request handler reads or writes the snapshot store directly — only the public weather slug page invokes the store server-side. No public component imports `forecast-revision-store` (the server-only guard would throw at module load); only `forecast-revision-analysis` and `forecast-timeline` (pure functions) are reachable from a client island, and only via serialized props. No `PublicWagerView`, `SafeCustomerBetView`, sanitizer, or allow-list was touched.

## Step 130 cleanup notes

- Added forecast revision tracking. Informational/UI-only — no data-shape, API, trust-boundary, grading, settlement, wallet, Kalshi, Polymarket, or admin changes.
- `src/lib/forecast-revision-store.ts` — server-only Redis snapshot store (browser-import throws). Keys: `forecast-revision-snapshot:<id>` (JSON record) + `forecast-revision-snapshots:<locationKey>` (sorted set, score = capture ms). Retention 30 snapshots per location. `locationKey()` prefers postal-code (`us:29209`) and falls back to coarsely-rounded coords (`coord:34.00,-81.03`) so nearby Use-My-Location lookups collapse to the same series. Snapshot payload is **compact**: next-7-day daily highs/lows/precip-probability/wind-speed only, plus the Step 129 intelligence summary, plus a single severe-alert boolean. No raw weather payload, no PII, no betting data, no admin/Kalshi/Polymarket fields. `recordSnapshotIfNew` deduplicates by upstream `generatedAt` — same forecast run = no new write.
- `src/lib/forecast-revision-analysis.ts` — pure heuristic comparator. `diffSnapshots(prior, current)` emits up to ten kinds (`severe_added`, `severe_removed`, `less_stable`, `more_stable`, `wetter`, `drier`, `windier`, `calming`, `warming`, `cooling`) on these thresholds: 3-day avg high Δ ≥ 4 °F, 3-day max precip-probability Δ ≥ 15 pp, 3-day avg wind Δ ≥ 4 mph, severe-alert add/remove, combined confidence + volatility delta. `buildRevisionSummary(prior, current)` returns `{ priorCapturedAt, comparedLabel, generatedAtUnchanged, isInitial, isUnchanged, changes, headline }`; `comparedLabel` is human-friendly ("since this morning" / "in the last hour" / "since yesterday" / "X days ago").
- `src/components/forecast/ForecastRevisionSummary.tsx` — pure presentational React island; renders nothing on `isInitial`. Inherits the Step 128 stable card (`border-border bg-surface dark:bg-surface-dark-alt shadow-sm`). Calm chip palette (sky for movement, emerald for stabilization/cleared, amber for less-stable, orange for severe-added). Headline + bullet list — no charts, no dashboards.
- `src/pages/[...slug].astro` mounts the card directly under `ForecastIntelligenceCard`. The capture/compare runs in the page frontmatter; if Redis is unreachable the page falls back to an `isInitial` summary and the component silently renders nothing — no degraded user experience, no thrown errors.
- `docs/forecast-intelligence-notes.md` updated with the revision-tracking philosophy, retention policy, and Phase 3+ expansion roadmap (ensemble disagreement, line-movement intelligence, revision-history timelines, operator volatility alerts, confidence-aware pricing).
- No PII enters the snapshot store. Customer/anonymous request handlers don't touch the store directly — only the public weather slug page invokes it server-side. No public component imports `forecast-revision-store` (server-only guard would throw); only `forecast-revision-analysis` (pure functions) is reachable from a client island, and only via a serialized summary prop. No `PublicWagerView`, `SafeCustomerBetView`, sanitizer, or allow-list was touched.

## Step 129 cleanup notes

- Added a heuristic forecast confidence / volatility / trend summary layer. Informational/UI-only — no data-shape, API, trust-boundary, grading, settlement, wallet, Kalshi, Polymarket, or admin changes.
- `src/lib/forecast-intelligence.ts` — pure derivation from the existing `ForecastResponse` shape (no new data sources, no model calls). Exports `ForecastConfidenceLevel`, `ForecastVolatilityLevel`, `ForecastTrendDirection`, `ForecastTrend`, `ForecastIntelligenceSummary`, and `buildForecastIntelligence(forecast)`. Heuristics: confidence starts high and downgrades on severe alerts, large 7-day high spread, hourly temp standard deviation, or stale `generatedAt`; volatility scores temp/precip/wind axes 0–2 against fixed thresholds and takes the max; trend compares day 1 vs. day 5 across the same three axes and emits up to two prioritized chips. See `docs/forecast-intelligence-notes.md`.
- `src/components/forecast/ForecastIntelligenceCard.tsx` — pure presentational React component. Renders three small chips (Confidence / Stability / up to two trend chips), a 1–3 line plain-English explanation, and an optional "Updated X minutes ago" line. Inherits the Step 128 stable-card surface (`border-border bg-surface dark:bg-surface-dark-alt shadow-sm`). Calm three-tone palette (emerald / amber / orange) — no neon, no badges-of-badges.
- Mounted in `src/pages/[...slug].astro` immediately under `WeatherAlerts` and above `ForecastWagers`. The summary is computed server-side in the page frontmatter and serialized into the client island as JSON, so the card hydrates with stable text on first paint.
- `docs/forecast-intelligence-notes.md` (new) — design philosophy, heuristic thresholds in force, trust-boundary statement, future-expansion roadmap (ensemble disagreement, forecast revision tracking, volatility history, confidence-aware market tooling — all keep the same public summary shape).
- No Polymarket / Kalshi / admin / risk / pricing field is read by, written to, or referenced from any of the new files. No `PublicWagerView`, `SafeCustomerBetView`, sanitizer, or allow-list was touched.

## Step 128 cleanup notes

- Weather page (`src/pages/[...slug].astro`) surface-hierarchy + contrast pass. CSS-only — no data-shape, API, trust-boundary, grading, settlement, wallet, Kalshi, or Polymarket changes.
- **Atmospheric styling reserved for the hero.** `[...slug].astro` no longer passes `skyGradient` / `isLight` to the eight detail cards (`UVIndexCard`, `SunriseSunsetCard`, `AirQualityCard`, `HumidityDewPointCard`, `CloudCeilingCard`, `VisibilityCard`, `PressureCard`, `CloudCoverCard`). They now render with the stable card style. Only the top WeatherHero (and the alert banners, which have their own severity palette) keep dynamic-sky treatment. The 8 cards' atmospheric branch in `WeatherDetailCards.tsx` remains intact for any caller that explicitly opts in — no callers do today.
- **Stable card surface hardened.** `WeatherDetailCards.tsx` `DetailCard` fallback: `bg-surface/80 backdrop-blur-sm dark:bg-surface-dark-alt/80` → `bg-surface dark:bg-surface-dark-alt`. Fully opaque, no blur — clear card vs page separation.
- **Translucent panels solidified.** `RecordTemps`, `AllergyOutlook`, `TemperatureChart` summary cells, `SportsMetrics` 4-up condition tiles + impact-table header, and the four `ForecastMaps` overlays (timeline, controls, color-scale legends, mode legend): `bg-surface-alt/50` / `bg-surface/95 backdrop-blur-sm` / `bg-surface-dark/5 dark:bg-surface/5` patterns swapped to opaque `bg-surface-alt` / `bg-surface` / `bg-surface-dark` with explicit `border-border` so each tile has a clear edge against the page.
- **Chart axis/tick/grid colors are now theme-aware.** Added `src/components/forecast/useChartTheme.ts` — a tiny client-side hook that watches `<html>`'s `dark` class via a `MutationObserver` and returns a stable `ChartThemeColors` palette. `TemperatureChart`, `WindChart`, `PrecipChart` now read `tickPrimary`, `tickSecondary`, `axis`, `grid`, `tooltipBg`, `tooltipText` from the hook instead of the hardcoded slate-800 / slate-600 / slate-200 quartet that became near-invisible in dark mode.
- **Faint text bumped.** `DailyForecast` "—" precip placeholder no longer at `text-text-muted/40`; "Night: ..." secondary line drops `opacity-70`. `RecordTemps` data-coverage caption drops `/60`. `ForecastMaps` tiny date and AQI labels drop `/60` and `/70`. All collapse to the standard muted token, which already meets readable contrast on opaque cards.
- No public/customer API shape, sanitizer, allow-list, grading, settlement, wallet, Kalshi, Polymarket, or admin behavior was touched. Hero remains atmospheric — the brand feel is preserved.

## Step 127 cleanup notes

- Weather page (`src/pages/[...slug].astro` — `/columbia-sc-29201` etc.) readability hardening. CSS-only — no data-shape, API, trust-boundary, grading, settlement, wallet, Kalshi, or Polymarket changes.
- `WeatherHero.tsx`: kept the dynamic `skyGradient` background; added a contextual readability scrim (bottom-darkening for white text on dark skies, top-lightening for dark text on bright/snow/fog skies); added `text-shadow` so white text remains legible where the sky gradient fades to near-white at the bottom (e.g. partly-cloudy daytime `#1d4ed8 → #bfdbfe`); bumped muted-text contrast (`text-white/70 → text-white/85`, `text-gray-600 → text-gray-700`, `text-gray-800 → text-gray-900`).
- `WeatherDetailCards.tsx`: same scrim + `text-shadow` + contrast bump in the shared `skyC()` palette and `DetailCard` wrapper, applied to the eight sky-themed cards (UV, Sun & Moon, Air Quality, Humidity & Dew Point, Cloud Ceiling, Visibility, Pressure, Cloud Cover).
- `ForecastWagers.tsx`: replaced the translucent blue tint card (`border-field/30 bg-field/5`) with the standard opaque card surface (`border-border bg-surface ... dark:border-border-dark dark:bg-surface-dark-alt`) so muted body text is no longer "gray on faint blue."
- `SportsMetrics.tsx` Verdict card: same swap to opaque surface.
- No public/customer API shape changed. No `PublicWagerView`, `SafeCustomerBetView`, allow-list, or sanitizer was touched. No admin or external-venue surface (Kalshi / Polymarket) was touched.

## Step 126 cleanup notes

- Added `src/lib/polymarket-client.ts` — server-only read-only client for the Polymarket Gamma API. Browser-import throws. No order, wallet, signing, or private-key code exists on this module. Timeout 8 s; structured `PolymarketResponse<T>` so raw `fetch` errors and headers never propagate.
- Added `src/lib/polymarket-market-store.ts` — bounded snapshot lifecycle (Redis `polymarket-market-snapshot:*` + sorted set `polymarket-market-snapshots:all`, retention 200). `discoverWeatherMarkets` tries the Gamma `tag_slug=weather` filter first, then falls back to a keyword scan over active markets (`weather, temperature, rain, snow, hurricane, storm, climate, forecast, tornado, wind, heatwave, flood, cold front, cyclone`). `testPolymarketConnectivity` returns sanitized `ok / polymarket_error / network_error` codes.
- Added admin API at `/api/admin/system/polymarket-market-data` — `requireAdmin`-gated. Actions: `list-snapshots`, `get-snapshot`, `discover-weather-markets`, `test-connectivity`. Audit events `polymarket_market_snapshot_fetched` and `polymarket_connectivity_test` reuse the platform-wide `audit-log.ts`.
- Added admin UI `PolymarketMarketDataCenter.tsx` + page `/admin/system/polymarket-market-data.astro`. Five tabs: Status / Discover / Snapshots / Bookmaking Uses / Methodology. Persistent banner: "admin-only and read-only. No wallet, no signing, no orders, no auto-hedging, no auto-mirroring." No betting or trading controls anywhere on the surface.
- `SystemNav.tsx` got a "Polymarket Market Data" entry next to the Kalshi entry under Execution & Economics.
- `docs/polymarket-integration-plan.md` updated to mark Phase 2 implemented; `docs/kalshi-integration-plan.md` updated with one sentence noting Polymarket discovery is now live as a parallel read-only source.
- No Polymarket data, helper, or import is referenced from any public, anonymous, or `requireUser`-gated surface. No grading, settlement, wallet, or trading behavior changed.

## Pretend-user / pretend-bet sandbox isolation (Step 121 Part E)

The pretend-user testing harness and pretend-bet sandbox are admin-only and isolated from production by both namespace and ID prefix:

- **Redis keyspaces:** `pretend-user-session:*`, `pretend-user-sessions:all`, `pretend-user-session:active:<id>`, `pretend-bet:*`, `pretend-bets:all`, `pretend-bets:session:*`, `pretend-bets:wager:*`. Production keyspaces (`balance:*`, `transaction:*`, `bet:*`, `bets:by-user:*`) are never written or read by the sandbox.
- **ID prefixes:** `puts-` (sessions), `pretend-` (pretend users), `pbet-` (pretend bets). Production users use `user:*` and bets use `bet_*`. No accidental key collision is possible.
- **Auth:** every pretend route lives under `/api/admin/system/` and is gated by `requireAdmin`. No public, authenticated-user, or anonymous surface can read or write pretend data.
- **Code boundary:** `pretend-bet-store.ts` never imports `wallet-store`, `bet-store`, or any settlement helper. `applyTestBalanceDelta` is the only function that mutates a session's virtual balance and only writes to the session record.
- **Read coupling is one-way:** the pretend-bet placer reads `Wager` via `getWager` for outcome/odds validation; it never writes back.

---

## Known gaps / follow-ups

- The `Wager` record's `voidReason` is occasionally read by admin views (and intentionally so). Audit any new admin component to confirm it is rendered only behind `requireAdmin`.
- Future: a "load-more" pagination UX on `/wagers` would pair well with the existing `cursor` parameter on `/api/wagers`.
- Future: a strictly scoped "view-as-user" admin session shim could allow operators to walk the live customer flow as a fake user. Currently the pretend-bet sandbox is the only customer-flow simulation surface.
