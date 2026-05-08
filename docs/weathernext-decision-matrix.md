# WeatherNext Production Access — Decision Matrix

**Status:** Step 134. Research and recommendation only. **No production WeatherNext code, auth, or secrets are added at this step.** Open-Meteo remains the safe public default. NWS observations remain the settlement source.

This document evaluates the three Google-published access paths for production-quality WeatherNext / WeatherNext 2 forecasts:

1. **Vertex AI** — managed inference endpoint
2. **BigQuery** — production WeatherNext analysis-ready tables (distinct from the limited public `weathernext.sample` table)
3. **Earth Engine** — geospatial analytics platform with WeatherNext assets

The objective is to pick a primary integration path and a fallback path before writing any client code in Step 135.

---

## 1. Path overviews

### 1a. Vertex AI

- **Description:** Google Cloud's managed ML platform. WeatherNext is published as an inference endpoint that accepts a request (lat/lon + time window + variable list) and returns a normalized forecast payload.
- **Auth:** Service account or Application Default Credentials (GCP standard). Vercel-friendly when the SA key is base64-encoded in env (same pattern as the existing `GCP_CREDENTIALS_BASE64`).
- **API model:** REST/gRPC inference call, request → response. Native fit for per-request server-side rendering.
- **Update cadence:** WeatherNext 2 produces six-hour forecast runs four times daily, with hour-by-hour outputs accessible. The endpoint always returns the latest available run.
- **Latency expectations:** Low single-digit seconds for a single-point request, often sub-second when warm; inference endpoints are designed for live request paths.
- **Pricing:** Pay-per-prediction. Cost scales linearly with request count, predictably.
- **Quotas:** GCP standard quota model. Per-region inference QPS limits, raisable on request.
- **Commercial-use:** Standard GCP commercial terms. Acceptable for paid SaaS.
- **Implementation complexity:** Moderate. New auth + new client + payload normalization. No new schema knowledge required (output shape is a documented variable map).
- **Reliability:** GCP regional SLA; same posture as our existing BigQuery integration.
- **Caching:** Trivially cacheable per (lat/lon, run-time) tuple — Open-Meteo and the existing forecast-revision store already cache by location.
- **Best fit for:** Live public weather page rendering. **This is the natural production replacement for Open-Meteo.**

### 1b. BigQuery production WeatherNext tables

- **Description:** Google's production WeatherNext datasets surface as queryable BigQuery tables (distinct from the `bigquery-public-data.weathernext.sample` preview already in our codebase). Schema continuity with the legacy code path is the main attraction.
- **Auth:** Same `GCP_CREDENTIALS_BASE64` / `GCP_PROJECT_ID` we already use. Zero new auth surface.
- **API model:** SQL. The legacy code already issues a parameterized query in `weather-queries.ts`. Switching to a production dataset is mostly a query rewrite + dataset id swap.
- **Update cadence:** Production WeatherNext tables are refreshed on the same six-hour cadence as the upstream model. The existing legacy code's "1× daily, sample" assumption does NOT carry over to the production tables.
- **Latency expectations:** A first BigQuery query for a fresh combination is on the order of 1–4 s; warm queries are faster. Slower than Vertex AI inference for live page loads, but cacheable.
- **Pricing:** Pay-per-byte-scanned + storage. Cost is hard to predict for ad-hoc per-request queries unless we scope `WHERE` clauses and `_PARTITIONTIME` filters carefully.
- **Quotas:** Concurrent-query quota by project. Manageable but a real concern under load spikes.
- **Commercial-use:** Standard GCP terms. Acceptable.
- **Implementation complexity:** Low. The query shape is the same as the legacy sample-table code. Mostly schema mapping + the cost guardrails.
- **Reliability:** GCP SLA. BQ is rock-solid for analytics. For per-request live UX it's serviceable, not native.
- **Caching:** Very cacheable. Best paired with a Redis result cache keyed by (lat/lon-cell, run-time).
- **Best fit for:** Bulk / batch / admin workflows; A-B comparison harness; warm cache fill. Acceptable as a fallback if Vertex AI is unavailable.

### 1c. Earth Engine

- **Description:** Google's geospatial analytics platform. WeatherNext layers are available as Earth Engine assets. Designed for raster operations across geographic grids.
- **Auth:** Service account or OAuth. New auth surface relative to our existing GCP integration.
- **API model:** Earth Engine code runs server-side on Google's compute. The client builds an `ee.Image` / `ee.ImageCollection` expression and calls `getInfo()` or exports.
- **Update cadence:** Asset publication cadence; depends on the specific WeatherNext asset.
- **Latency expectations:** Highly variable. Fine for spatial aggregation queries; awkward for "give me one point's hourly forecast." Per-point lookups go through `sample()` calls that are not optimized for low-latency live UX.
- **Pricing:** Earth Engine has a free non-commercial tier; commercial usage requires Cloud Earth Engine billing. Pricing is not as straightforward as Vertex AI's pay-per-prediction.
- **Quotas:** Earth Engine has its own task / memory / time quotas. Not designed for high-QPS live request paths.
- **Commercial-use:** Allowed via Cloud Earth Engine, with a separate contract from baseline GCP.
- **Implementation complexity:** High. New SDK, new mental model, new auth, new error handling.
- **Reliability:** Designed for analyst workflows, not for live consumer request paths.
- **Caching:** Possible but more involved.
- **Best fit for:** Future spatial analytics (e.g., a public weather map showing WeatherNext output across a region). **Not a fit for the per-location forecast page.**

---

## 2. Scored comparison

Scoring scale: 5 = excellent, 4 = good, 3 = acceptable, 2 = weak, 1 = poor. **Weight** is the relative importance of the criterion to WagerOnWeather's per-location live weather UX (1 = nice-to-have, 3 = critical).

| Criterion | Weight | Vertex AI | BigQuery prod | Earth Engine |
|---|---:|---:|---:|---:|
| Forecast quality (output is the same WeatherNext model) | 3 | 5 | 5 | 5 |
| Hourly granularity | 3 | 5 | 5 | 4 |
| Field completeness (real precip-prob, gusts, UV, visibility) | 3 | 5 | 4 | 4 |
| Update frequency (six-hourly runs, latest available) | 3 | 5 | 5 | 3 |
| Latency for one-point live request | 3 | 5 | 3 | 1 |
| Implementation complexity (new code surface) | 2 | 4 | 5 | 2 |
| Operational reliability for live UX | 3 | 5 | 4 | 2 |
| Cost predictability | 2 | 5 | 3 | 2 |
| Quota friendliness for spiky public traffic | 3 | 4 | 3 | 1 |
| Scalability | 3 | 5 | 4 | 2 |
| Observability / debuggability | 2 | 4 | 5 | 3 |
| Ease of caching | 2 | 5 | 5 | 3 |
| Compatibility with the Step 129–133 forecast intelligence layer | 2 | 5 | 5 | 3 |

### Weighted totals

- **Vertex AI:** 5·3 + 5·3 + 5·3 + 5·3 + 5·3 + 4·2 + 5·3 + 5·2 + 4·3 + 5·3 + 4·2 + 5·2 + 5·2 = **172**
- **BigQuery prod:** 5·3 + 5·3 + 4·3 + 5·3 + 3·3 + 5·2 + 4·3 + 3·2 + 3·3 + 4·3 + 5·2 + 5·2 + 5·2 = **149**
- **Earth Engine:** 5·3 + 4·3 + 4·3 + 3·3 + 1·3 + 2·2 + 2·3 + 2·2 + 1·3 + 2·3 + 3·2 + 3·2 + 3·2 = **88**

### Rationale highlights

- All three return WeatherNext model output, so **forecast quality is identical** at the source. The differences are entirely in *access*.
- **Latency** is the deciding criterion for a public per-location page. Vertex AI's inference-endpoint model is purpose-built for this; BigQuery is acceptable with caching; Earth Engine is the wrong shape.
- **Quota friendliness** matters because traffic is spiky and city-distributed. Vertex AI scales horizontally on inference. BigQuery's per-project concurrency limit is a real ceiling we'd hit during burst traffic without aggressive caching.
- **Implementation complexity** narrowly favors BigQuery (we already speak that protocol), but the long-term cost of a sub-optimal latency path on the live page outweighs the one-time savings.

---

## 3. Recommendation

### Primary: **Vertex AI**

- Best match for live per-location SSR rendering on Vercel.
- Lowest latency, predictable cost, native auth model.
- Cleanly replaces the Open-Meteo path once validated against the §5 evaluation criteria of `weathernext-integration-plan.md`.

### Fallback: **BigQuery production WeatherNext tables**

- Use when Vertex AI is degraded, rate-limited, or geographically unavailable.
- Reuses the existing `GCP_CREDENTIALS_BASE64` auth and BigQuery client.
- Acceptable latency under a Redis-backed result cache keyed by (location-cell, run-time).
- Also the right fit for an admin-only A-B comparison harness (Phase 4) — running batch queries to compare WeatherNext's published runs against Open-Meteo's hourly output without going through inference quota.

### Excluded: **Earth Engine**

- Wrong tool for live per-location request paths. Reserved for future spatial-analytics features (e.g., a public weather map page rendering WeatherNext fields across a region).

---

## 4. Open questions for the Phase 2 → Phase 3 transition

These need confirmation against current Google documentation before Step 135 commits to a specific Vertex AI integration:

1. **Exact endpoint name / model ID** for production WeatherNext on Vertex AI. Is it `weathernext` or a versioned model id?
2. **Per-prediction pricing.** Confirm the public pricing page; budget against Vercel's expected QPS for a launch market.
3. **Regional availability.** Is the model published in the regions closest to our Vercel runtime (US-East / US-Central)?
4. **Quota raise process.** What's the lead time for a Vercel-traffic-sized quota raise?
5. **Output schema.** Confirm the variable list (`temperature_2m`, `relative_humidity_2m`, `dew_point_2m`, `precipitation_probability`, `precipitation`, `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `cloud_cover`, `surface_pressure`, `apparent_temperature`, `uv_index`, `visibility`, `weather_code`) — at least temperature, precipitation probability, wind, gusts, and humidity must be first-class fields, not derived.
6. **Latency commitment.** What's the documented p50 / p99 for a single-point inference?

These are not blockers for Step 134's research output — they are blockers for the Step 135 client implementation.

---

## 5. Non-objectives for Step 134

- No Vertex AI auth code.
- No service-account key handling.
- No production WeatherNext requests.
- No new env variables beyond the existing `FORECAST_PROVIDER`.
- No change to the public default (still Open-Meteo).
- No change to grading/settlement (still NWS observations).
- No customer-facing copy change beyond the Step 133 source label.

The deliverables of Step 134 are this matrix, the architecture section in `weathernext-integration-plan.md`, the provider-capability comparison in `forecast-provider-capabilities.md`, the (optional) `forecast-provider-metadata.ts` capability module, and the corresponding `public-api-safety-audit.md` entry.
