# WeatherNext Integration Plan

**Status:** Step 135 — Vertex AI client foundation in place; happy-path inference body intentionally not implemented because the endpoint contract is not yet confirmed against authoritative Google docs. Open-Meteo remains the safe public default and will continue to serve every request until Step 135's `endpoint_unconfirmed` skeleton is replaced with a real call against a confirmed schema. The legacy `bigquery-public-data.weathernext.sample` path is preserved as an explicit research opt-in.

## 1. Strategic intent

WagerOnWeather wants to use **Google DeepMind WeatherNext / WeatherNext 2** as its preferred forecast source once production-quality access is validated.

WeatherNext 2 is Google's state-of-the-art weather forecasting model family. Public materials describe it as available through:

- Vertex AI
- BigQuery (production tables)
- Earth Engine

WeatherNext 2 is described as generating six-hour forecasts four times daily, with hour-by-hour forecast data.

This is the *preferred strategic source*. It is **not** the current source — see §2 and §3.

## 2. Current state (as of Step 133)

The active forecast source on the public weather page is **Open-Meteo**. Open-Meteo's default `/v1/forecast` endpoint blends ECMWF IFS + GFS + HRRR + ICON, refreshed hourly, and returns the full set of fields the UI needs (real `precipitation_probability`, real `uv_index`, real `visibility`, real wind gusts).

Open-Meteo is the safe default because:

- It is hourly, fresh, and complete.
- The Step 129–132 forecast intelligence layer (confidence, volatility, trend, revision tracking, market context) operates on the active forecast — empty / fabricated fields would visibly degrade those surfaces.
- It does not require a credentials-gated path that could silently break on misconfiguration.

A second path also exists: the BigQuery `bigquery-public-data.weathernext.sample` table. This is the **research / preview** dataset. It is downsampled, updates roughly once per day, and does not carry several fields the UI needs (UV, real precip-probability, visibility) — the legacy code filled those with formulaic placeholders. **It is unsuitable as a public default.** It is preserved as an opt-in for A-B research only.

## 3. Forecast provider selection

`src/lib/forecast-source.ts` is the single source of truth. The provider is resolved from env in this priority order:

1. `FORECAST_PROVIDER` (preferred; explicit).
2. Legacy `USE_BIGQUERY_FORECAST=true` → maps to `weathernext-bigquery-sample`.
3. Default → `open-meteo`.

Recognized `FORECAST_PROVIDER` values:

| Value | Meaning |
|---|---|
| `open-meteo` | Default. Live source. |
| `weathernext-bigquery-sample` | Research / A-B only. The downsampled public sample table. |
| `weathernext-production` | **Stub today.** Strategic target. Currently logs a warning and falls back to Open-Meteo. |

Unknown values fall back to `open-meteo` with a warning.

## 4. Critical boundary: settlement is unaffected

Forecast source determines **what users see on the weather page**, including the Step 129–132 forecast intelligence layer.

**It does not determine how markets resolve.** Markets resolve via the official observation pathway (`src/lib/nws-grading.ts`, `src/lib/nws-observations.ts`). This boundary holds regardless of which forecast provider is active. Switching to WeatherNext does not change settlement. This is enforced by code path separation, not just convention.

## 5. Production WeatherNext access — evaluation criteria

Before promoting WeatherNext production to the public default, each candidate access channel must be evaluated against the following:

- **Update frequency.** Hourly or 6-hourly? How fresh does the latest run land?
- **Hourly forecast fields.** Hour-by-hour temperature, humidity, dew point, precipitation probability, precipitation amount, wind speed, wind direction, wind gust, cloud cover, surface pressure, apparent temperature, UV index, visibility, weather code.
- **Precipitation probability.** Real probabilistic field, not a derived placeholder.
- **Wind gust.** Real gust field, not `windSpeed × 1.4`.
- **UV / visibility / humidity / dew point.** Real fields. (The sample table fakes these.)
- **Geographic resolution.** Grid spacing — fine enough for city-scale forecasts (target: ≤ ~10 km).
- **Latency.** End-to-end fetch + normalize on a typical Vercel server response.
- **Cost.** Per-1k-request pricing if applicable; BigQuery query cost; Vertex AI inference cost.
- **API quota / reliability.** Rate limits; SLA; historical uptime.
- **Commercial usage constraints.** Can WagerOnWeather use this as the live source for a paid product?
- **Attribution requirements.** Required UI labels, links, or disclosures.
- **Schema stability.** How often does Google revise the schema? Migration cost?

A short-form scorecard against these criteria should be added to this doc as part of Phase 2 (§6).

## 6. Integration phases

### Phase 1 — Source-mode cleanup ✅ (Step 133)

- `FORECAST_PROVIDER` env, `weathernext-production` stub, `forecast-source.ts` resolver, source metadata threaded into `ForecastResponse`.
- Open-Meteo is the explicit default.
- BigQuery sample is opt-in only.
- Subtle source label on the weather page ("Open-Meteo · Updated 18 minutes ago" with the "Markets resolve using official observation rules" footer).

### Phase 2 — Production access research ✅ (Step 134)
### Phase 5 — Observation-anchored forecast quality gates ✅ (Step 137)
- `src/lib/forecast-quality-gates.ts` — pure scoring with explicit thresholds (temp ≤2/≤5°F good/acceptable; wind ≤4/≤8mph; gust ≤5/≤10mph; precipitation conservative-skipped).
- `src/lib/forecast-quality-gate-runner.ts` (server-only) — orchestrator. Reads NWS observations via `nws-observations.ts` for diagnostics only (no settlement code touched). Per-(provider, horizon, field) isolation. "Too early" returns gracefully without erroring.
- `src/lib/forecast-quality-gate-store.ts` — Redis store, retention 200, compact result only.
- Admin API extended with `run-quality-gate` / `list-quality-gates` / `get-quality-gate` actions. Audit event `forecast_quality_gate_run`.
- Step 136 comparison snapshots gained backward-compatible `providerHorizonValues` so future gates can score +0/+6/+12/+24h horizons. Older snapshots flag the gap and re-running the comparison produces snapshots gates can fully score.

### Phase 4 — Admin A/B comparison harness ✅ (Step 136)
- `src/lib/forecast-provider-comparison.ts` (pure heuristic comparator), `forecast-provider-comparison-runner.ts` (server-only orchestrator with per-provider isolation), `forecast-provider-comparison-store.ts` (Redis store, retention 200), `/api/admin/system/forecast-provider-comparison` (requireAdmin, audit-logged), `/admin/system/forecast-provider-comparison` page, and `ForecastProviderComparisonCenter` admin UI.
- Open-Meteo always included; WeatherNext sample / WeatherNext production are explicit checkbox opt-ins.
- Per-provider failures are isolated and rendered inline; one bad provider never poisons the comparison.
- The comparison surface intentionally does **not** call any provider "ground truth" — agreement scores are numerical proximity only. A future step (Phase 5) will add NWS-observation-anchored quality gates.



- Evaluated Vertex AI, BigQuery production WeatherNext tables, and Earth Engine against the §5 criteria.
- Scorecards documented in `docs/weathernext-decision-matrix.md`.
- **Primary recommendation: Vertex AI.** Inference endpoint shape is the right fit for per-location live SSR. Lowest latency, predictable per-prediction pricing, native GCP auth.
- **Fallback recommendation: BigQuery production WeatherNext tables.** Reuses existing `GCP_CREDENTIALS_BASE64` auth; acceptable under a Redis result cache; doubles as the substrate for the Phase 4 admin A-B comparison harness.
- **Excluded: Earth Engine.** Wrong tool for per-location live request paths. Reserved for future spatial-analytics features (e.g., a regional weather-map page).
- Provider capability metadata centralized in `src/lib/forecast-provider-metadata.ts` (Step 134) and compared in `docs/forecast-provider-capabilities.md`.

### Phase 3 — Server-only WeatherNext client (Step 135 — foundation in place)

- New `src/lib/weathernext-client.ts` (server-only — browser-import throws). Mirrors the `kalshi-client` / `polymarket-client` posture: read-only, normalized into the existing `ForecastResponse` shape, no admin-only fields leaked.
- **Primary path: Vertex AI inference call.** Reuse `GCP_CREDENTIALS_BASE64` for auth; no new secret surface. Issue one request per `(lat, lon, days)` tuple, normalize the response into `ForecastResponse`.
- **Resilience:**
  - Wire `weathernext-production` mode to the new client.
  - Wrap every call in a fail-closed try/catch.
  - On any error (network, timeout, quota, 5xx, schema mismatch), log a structured warning and **fall back to Open-Meteo automatically** for that single request. The page never fails because WeatherNext is unavailable. The `ForecastResponse.source` field carries `provider: 'open-meteo'` and a `notes` string explaining the fallback so admin debug surfaces see the truth.
  - Optional: a short-lived (≤15 min) Redis result cache keyed by `(location-cell, run-time)` to absorb burst traffic and stay below quota during traffic spikes. Cache miss → live call. Same posture as the Step 118 Kalshi list cache.
- **Settlement guard:** the new client does not import or call `nws-grading.ts` / `nws-observations.ts`. Settlement remains observation-based.

### Phase 4 — A-B comparison

- Admin-only dashboard at `/admin/system/forecast-provider-comparison`. Side-by-side WeatherNext vs. Open-Meteo for a chosen location. Highlights field-level differences and freshness gaps.
- Optionally extend the Step 130 forecast revision store to capture both providers and surface disagreement as a third axis in the intelligence layer.

### Phase 5 — Admin-only quality dashboard

- Aggregate the A-B comparison across many locations and a rolling window. Surface where WeatherNext outperforms / underperforms. Required input before promoting it to the public default.

### Phase 6 — Carefully switch the public default

- Once Phase 5 confirms WeatherNext production is at parity or better across the metrics that matter for our use case, change the default in `forecast-source.ts` and bump the doc.
- The BigQuery sample mode and the Open-Meteo mode both remain selectable by env for fallback / ops use.

## 6b. Recommended production architecture (Step 134)

```
                           ┌──────────────────────────┐
                           │   public weather page    │
                           │  src/pages/[...slug]     │
                           └────────────┬─────────────┘
                                        │ getForecast(lat, lon, days)
                                        ▼
                       ┌────────────────────────────────────┐
                       │  src/lib/weather-queries.ts        │
                       │  resolveForecastProvider()         │
                       └────┬──────────┬───────────┬────────┘
                            │          │           │
   FORECAST_PROVIDER=open-meteo  =weathernext-production  =weathernext-bigquery-sample
                            │          │           │
                            ▼          ▼           ▼
                   ┌────────────┐  ┌──────────────────┐  ┌─────────────────────┐
                   │ Open-Meteo │  │ Vertex AI client │  │ BigQuery sample     │
                   │ (default)  │  │ (Phase 3, primary)│ │ (research only)     │
                   └────────────┘  └────────┬─────────┘  └─────────────────────┘
                                            │ on any error
                                            ▼
                                   ┌─────────────────┐
                                   │ Open-Meteo (FB) │
                                   │ + source.notes  │
                                   └─────────────────┘

      Settlement path (entirely separate):
        wager-resolution → nws-grading.ts → nws-observations.ts
        WeatherNext is NEVER on this path.
```

### Caching strategy

- Per-request (lat, lon, days) tuples are highly cacheable because WeatherNext production runs publish four times daily.
- Redis result cache keyed by `weathernext-cache:<provider>:<lat-cell>:<lon-cell>:<run-time>` with TTL ≤ 15 min.
- Lat/lon cells: round to 2 decimals (~1km). Same coarseness as the Step 130 forecast revision store's location key fallback.
- Cache miss → live Vertex AI call → write to cache. Cache hit → skip the call.
- `source.notes` records "served from cache" / "live" so admin tooling can audit hit rate.

### Server-only access requirements

- The Vertex AI client must throw at module load if imported in browser code (same posture as `kalshi-client.ts` / `polymarket-client.ts`).
- All `GCP_CREDENTIALS_BASE64` decoding happens in the same module; the decoded value never leaves the server.
- No client-side fetch of any Google Cloud endpoint — the customer's browser only ever sees the normalized `ForecastResponse` JSON the server emits.

### Fallback behavior

| Failure mode | Behavior |
|---|---|
| `GCP_CREDENTIALS_BASE64` not set | Log "credentials missing", serve Open-Meteo, source.notes = "vertex-ai unconfigured" |
| Vertex AI 5xx / timeout / network error | Log structured error, serve Open-Meteo, source.notes = "vertex-ai error: <code>" |
| Vertex AI quota exceeded (429) | Log "quota exceeded", serve Open-Meteo, source.notes = "vertex-ai quota; consider raising QPS or extending cache TTL" |
| Schema-mismatch / missing required field | Log "schema mismatch", serve Open-Meteo, source.notes = "vertex-ai schema mismatch" |
| Cache hit | Serve cached normalized payload, source.notes = "served from cache" |

In every fallback case the page **never fails** because of WeatherNext. The user sees Open-Meteo data with the existing source label.

### Resilience expectations

- p99 page render must remain bounded by Open-Meteo's latency, not by Vertex AI's.
- Concretely: hard timeout of 1500 ms on the Vertex AI call; on timeout, abort and serve Open-Meteo. The current weather page's perceived performance does not depend on WeatherNext being healthy.

### Phased rollout guidance

1. Ship the Vertex AI client behind `FORECAST_PROVIDER=weathernext-production` (Phase 3) — opt-in only, no env change in production.
2. Build the admin-only A-B comparison dashboard (Phase 4). Compare WeatherNext (Vertex AI) vs Open-Meteo per location, per axis (temperature, precipitation, wind, gust, UV, visibility), per forecast horizon. Surface field-level disagreement and freshness gaps.
3. Aggregate the Phase 4 comparison across many locations and a rolling window (Phase 5). Define explicit quality gates ("WeatherNext within X% / Y°F / Z mph of Open-Meteo on average for short-range; better than Open-Meteo on medium-range"). Only after gates are met does Phase 6 promote the default.
4. Phase 6 default-switch is a one-line change in `forecast-source.ts` (the resolver default). Open-Meteo and BigQuery sample modes both remain selectable via env for ops fallback.

## 7. Forbidden actions (until Phase 6 ships)

- Do not silently route any traffic through `bigquery-public-data.weathernext.sample` again — it must remain explicit opt-in via env.
- Do not change `nws-grading.ts` / `nws-observations.ts` to use a forecast source. Settlement uses official observations.
- Do not present `weathernext-bigquery-sample` as production WeatherNext in any UI label, log line, or admin surface — the source label always reads "WeatherNext (sample)" with `isResearchSample: true`.

## 8. Out of scope for Step 133

- Any production WeatherNext API call.
- Any A-B comparison UI.
- Any change to the live default.
- Any change to grading or settlement.

The deliverables of Step 133 are this plan, the `forecast-source.ts` resolver, the `FORECAST_PROVIDER` env, the `ForecastSource` metadata on `ForecastResponse`, the subtle source label on the weather page, and the corresponding entries in `docs/forecast-intelligence-notes.md` and `docs/public-api-safety-audit.md`.

## 10. Endpoint contract — open questions before the inference body lands

Step 135 ships the typed harness (`src/lib/weathernext-client.ts`) but **deliberately does not implement the actual Vertex AI request body**. The function returns `failureMode: 'endpoint_unconfirmed'` even when all four `WEATHERNEXT_VERTEX_*` env variables are set. Reason: filling in the body from guesses would either silently degrade users to a wrong-shape response or fail every call with `upstream_error`. Both end at the Open-Meteo fallback, but the second is less risky than the first because it doesn't leak partially-mislabeled data into the public page.

The following must be confirmed against current Google / Vertex AI / DeepMind documentation before the body is wired up:

1. **Exact endpoint name / model ID for production WeatherNext on Vertex AI.** Specifically: is `WEATHERNEXT_VERTEX_ENDPOINT_ID` (a numeric Vertex AI endpoint id) the right resource type, or does WeatherNext expose a Publisher Model that uses a different request shape?
2. **Request body schema.** What does the `:predict` body look like? `{ instances: [{ lat, lon, time, ... }] }`? An array of point objects? Time encoded as ISO string or epoch ms? Variable list explicit or implicit from the model? Forecast horizon — number of hours, days, or fixed by run?
3. **Response schema.** Are predictions returned as a flat per-point list, a per-variable array of grids, or hour-indexed records? Do field names match what `forecast-provider-metadata.ts` already declares, or do they need translation?
4. **Auth shape.** Does the standard Google service-account → access-token flow work, or is there a model-specific auth handshake? Is `aiplatform.endpoints.predict` IAM permission sufficient?
5. **Region availability.** Which regions publish the model today? Is `us-central1` available, given that's where most other GCP weather datasets land?
6. **Pricing.** Per-prediction cost? Bulk / batch discount? Free tier or trial credits?
7. **Quota / SLO.** Per-region inference QPS limits? Documented p50 / p99? What's the lead time for a Vercel-traffic-sized quota raise request?
8. **Attribution.** Required UI labels, links, or disclosures? (Today the Step 133 source label reads "WeatherNext" — confirm that's acceptable.)

Once those are confirmed, the body in `tryWeatherNextForecast` becomes a routine fetch + parse against the documented contract. The harness already handles timeout, abort, network, auth, quota, schema-mismatch, and unknown failure modes — none of those need new code.

The `getWeatherNextConfigStatus()` helper exists today as a server-only diagnostic. A future admin page can render its booleans (no values, just presence) so the operator can confirm config readiness without exposing secrets.

## 9. Out of scope for Step 134

Step 134 is **research and architecture preparation only**. It does NOT add:

- Any Vertex AI client code.
- Any service-account / Application Default Credentials handling.
- Any production WeatherNext request, even read-only.
- Any new env variable beyond what already existed at Step 133.
- Any customer-facing copy change.
- Any change to the live default (still Open-Meteo).
- Any change to grading or settlement (still NWS observations).
- Any new admin route or admin component.

The deliverables of Step 134 are: this architecture section, `docs/weathernext-decision-matrix.md`, `docs/forecast-provider-capabilities.md`, `src/lib/forecast-provider-metadata.ts` (capability metadata only — no network calls), and the corresponding entry in `docs/public-api-safety-audit.md`. Step 135 implements the actual server-only client.

## 11. Out of scope for Step 135

Step 135 is the **client foundation spike**. It adds:

- `src/lib/weathernext-client.ts` — typed `WeatherNextResult`, `tryWeatherNextForecast()` with 1500 ms timeout / fail-closed plumbing, `isWeatherNextConfigured()` / `getWeatherNextConfigStatus()` server-only diagnostics. Skeleton-only inference body returning `failureMode: 'endpoint_unconfirmed'`.
- `getWeatherNextSuccessSource()` / `getWeatherNextFallbackSource(failureMode, notes)` helpers in `forecast-source.ts`.
- `weathernext-production` mode wired through `weather-queries.ts` to actually call the client and fall back gracefully on failure.
- Four placeholder env variables (`WEATHERNEXT_VERTEX_REGION`, `WEATHERNEXT_VERTEX_ENDPOINT_ID`, `WEATHERNEXT_VERTEX_MODEL_ID` plus reuse of `GCP_PROJECT_ID` + `GCP_CREDENTIALS_BASE64`).

It does NOT add:

- Any actual Vertex AI HTTP call. The skeleton always returns a failure mode and the caller serves Open-Meteo.
- Any new secret. The Vertex AI access path reuses `GCP_CREDENTIALS_BASE64`.
- Any new admin route or admin UI.
- Any change to the live default. Open-Meteo remains the default for both the unset case and `FORECAST_PROVIDER=weathernext-production` (because the client always fails today).
- Any Redis cache. Skipped per the "if straightforward" guidance — the cache becomes worth adding once real responses exist to cache.
- Any change to grading or settlement. NWS observations remain the resolution source.

The next deliverable is a confirmed endpoint contract (§10), after which the inference body in `tryWeatherNextForecast` can be filled in.
