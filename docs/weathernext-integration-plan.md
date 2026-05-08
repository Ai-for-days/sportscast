# WeatherNext Integration Plan

**Status:** Step 133 — strategic posture established. Open-Meteo remains the safe public default. Production WeatherNext access has not yet been wired up. The legacy `bigquery-public-data.weathernext.sample` path is preserved as an explicit research opt-in.

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

### Phase 2 — Production access research

- Evaluate Vertex AI, BigQuery production WeatherNext tables, and Earth Engine against §5.
- Document scorecards in this file.
- Pick a preferred channel.

### Phase 3 — Server-only WeatherNext client

- New `src/lib/weathernext-client.ts` (server-only — browser-import throws). Mirrors the `kalshi-client` / `polymarket-client` posture: read-only, normalized into the existing `ForecastResponse` shape, no admin-only fields leaked.
- Wire `weathernext-production` mode to the new client. The fallback-to-Open-Meteo behavior remains for any error path.

### Phase 4 — A-B comparison

- Admin-only dashboard at `/admin/system/forecast-provider-comparison`. Side-by-side WeatherNext vs. Open-Meteo for a chosen location. Highlights field-level differences and freshness gaps.
- Optionally extend the Step 130 forecast revision store to capture both providers and surface disagreement as a third axis in the intelligence layer.

### Phase 5 — Admin-only quality dashboard

- Aggregate the A-B comparison across many locations and a rolling window. Surface where WeatherNext outperforms / underperforms. Required input before promoting it to the public default.

### Phase 6 — Carefully switch the public default

- Once Phase 5 confirms WeatherNext production is at parity or better across the metrics that matter for our use case, change the default in `forecast-source.ts` and bump the doc.
- The BigQuery sample mode and the Open-Meteo mode both remain selectable by env for fallback / ops use.

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
