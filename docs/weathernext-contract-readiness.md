# WeatherNext Contract Readiness Checklist

**Status: NOT READY FOR LIVE INFERENCE**

WeatherNext production inference remains disabled in this build. The Step 135 Vertex AI client foundation is in place; the inference body is not implemented and `tryWeatherNextForecast` returns `failureMode: 'endpoint_unconfirmed'` for every call. Open-Meteo continues to serve every customer request.

This document tracks what must be confirmed, from authoritative Google / Google Cloud / DeepMind sources, before Step 142 can implement the live request body. **Items marked `UNCONFIRMED` must not be filled in from guesses** — the harness's fail-closed posture is the safer default until real documentation is read directly.

---

## 1. Access path

| Item | Status | Notes |
|---|---|---|
| Vertex AI is the recommended access path | Confirmed (Step 134) | Decision matrix: Vertex AI 172, BigQuery prod 149, Earth Engine 88. Vertex AI is the only path with a request shape native to per-location SSR. |
| BigQuery production WeatherNext tables | Available as fallback (per Step 134 plan); production-table dataset path **UNCONFIRMED** | The legacy `bigquery-public-data.weathernext.sample` is preserved as research-only. Production tables exist per Google's public materials but the exact dataset ID has not been verified here. **Step 142 added a `weathernext-bigquery-production` provider id, a `weathernext-bigquery-readiness.ts` config helper (gated by `WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED = false`), and a fail-closed `weathernext-bigquery-production-client.ts` stub. No query body exists in this build.** When the production dataset/table/schema are confirmed, populate `WEATHERNEXT_BIGQUERY_PROJECT` / `_DATASET` / `_TABLE`, flip the contract constant to `true`, and implement the query body. |
| Earth Engine | Excluded for live request paths (Step 134) | Reserved for future spatial features (e.g., weather map page). |

---

## 2. Vertex AI contract details

| Item | Status | Notes |
|---|---|---|
| Standard inference URL shape | Confirmed (Vertex AI convention) | `POST https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/endpoints/{ENDPOINT_ID}:predict` is the documented Vertex AI online prediction shape. The endpoint may also be accessed through a Publisher Model URL (`/publishers/google/models/{MODEL_ID}:predict`) — see next row. |
| **Whether WeatherNext is exposed as a deployed Endpoint or as a Publisher Model in Model Garden** | **UNCONFIRMED** | This determines whether `WEATHERNEXT_VERTEX_ENDPOINT_ID` is a numeric Endpoint resource id, a `publishers/google/models/...` model id, or both. Has direct impact on the env-var schema. |
| Exact model ID / endpoint ID | **UNCONFIRMED** | Must be read from current Vertex AI Model Garden documentation for WeatherNext / WeatherNext 2 / GenCast. |
| Region(s) where WeatherNext is published | **UNCONFIRMED** | Check Vertex AI Model Garden's "Locations" or "Region availability" panel for the model. Aim: a region close to Vercel runtime (us-central1 or us-east4 preferred). |
| Auth — standard SA → Bearer token via `google-auth-library` | Confirmed (Vertex AI convention) | Same posture WagerOnWeather already uses for BigQuery: service account JSON in `GCP_CREDENTIALS_BASE64`, decoded server-side, never sent to the browser. |
| IAM role required | Likely `roles/aiplatform.user` or finer-grained `aiplatform.endpoints.predict` permission | **UNCONFIRMED** for WeatherNext specifically — confirm against the model's "Permissions" docs. |
| Quota model | **UNCONFIRMED** | Vertex AI generally exposes per-region per-model QPS quotas. Current default for WeatherNext and quota-raise lead time both need confirmation. |
| Documented latency (p50 / p99) | **UNCONFIRMED** | The 1500 ms hard timeout in `tryWeatherNextForecast` must be sized against real measurements once available. |
| Pricing per prediction | **UNCONFIRMED** | Read from the Vertex AI pricing page for the specific model. Budget against the seeded-batch + customer traffic shape (`12 cities × 4 daily seeded runs + ad-hoc admin runs + customer page renders` ≈ low thousands per day at launch). |
| Attribution requirements | **UNCONFIRMED** | Source-line text in `forecast-source.ts` currently reads "WeatherNext". If Google requires a specific attribution string or link, update before launch. |

### Request body schema

**UNCONFIRMED.** The Step 135 client harness has a placeholder commented body. Before Step 142 wires up the actual `fetch`, confirm:

- Is the request `instances: [{ ... }]` (Vertex AI standard envelope)?
- How is the location encoded — `lat`/`lon` floats, GeoJSON, or model-specific tile identifier?
- How is time encoded — ISO 8601, epoch ms, or relative-hours from the current run?
- Is the forecast horizon implicit from the model run, or specified per request?
- Is the variable list explicit per request, or implicit?
- Are there required fields beyond location + time?

### Response body schema

**UNCONFIRMED.** Confirm:

- Is the response `predictions: [...]` (Vertex AI standard envelope)?
- Per-hour records, per-variable arrays, or some other shape?
- Field names — must be mapped into the `ForecastPoint` shape WagerOnWeather already uses.
- Units — Celsius vs Fahrenheit, m/s vs mph, mm vs in. The `open-meteo.ts` normalizer already handles unit conversion; mirror its pattern for WeatherNext.
- Are missing-data fields encoded as `null`, omitted entirely, or sentinel values?

---

## 3. Forecast variables — required vs available

WagerOnWeather's `ForecastPoint` shape requires these to render the public weather page and the Step 129–132 forecast intelligence layer:

| Variable | Required | WeatherNext availability |
|---|---|---|
| Hourly temperature (°F) | Yes | Likely yes — **confirm units** |
| Daily high / low | Derivable from hourly | Yes |
| Precipitation probability | Yes (Step 129 confidence + Step 132 market context need this) | **UNCONFIRMED** — sample table did not expose it; production tables/endpoint may. |
| Precipitation amount (mm or in) | Yes | Likely yes |
| Wind speed | Yes | Likely yes (sample table exposed u/v components — production may expose magnitude directly) |
| Wind gust | Yes (Step 137 quality gate scores this) | **UNCONFIRMED** |
| Humidity | Yes | Likely yes |
| Dew point | Derivable from temp + humidity if not native | Likely yes |
| Visibility | Yes | **UNCONFIRMED** |
| Cloud cover | Yes | Likely yes |
| UV index | Yes | **UNCONFIRMED** — sample table did not expose it. |
| Forecast generation time | Yes (Step 129 freshness, Step 130 revision dedup by `generatedAt`) | Likely yes |
| Forecast horizon (hours) | Yes — must cover ≥ 24h for the Step 137 h0–h24 quality gate | **UNCONFIRMED** range |

If precipitation probability, wind gust, visibility, or UV are **absent** from the production WeatherNext schema, the right move is **not** to fabricate them (the legacy sample-table code's mistake). Either:

- Mark those fields `derived` or `absent` in `forecast-provider-metadata.ts` so the comparison harness, intelligence layer, and quality gate accurately report what's missing; or
- Defer the public-default switch until those fields are real.

---

## 4. Commercial / production constraints

| Item | Status | Notes |
|---|---|---|
| Commercial use allowed | **UNCONFIRMED** | Read the model's terms-of-service / acceptable-use page on the Vertex AI Model Garden listing. |
| Attribution required | **UNCONFIRMED** | If required, update the Step 133 source label and/or add a footer link on the weather page. |
| Quota request process | **UNCONFIRMED** | Document expected lead time. WagerOnWeather expects spiky traffic across many US cities; an early quota raise may be necessary. |
| Billing setup | **UNCONFIRMED** | Confirm GCP billing account is attached and Vertex AI service is enabled in the project. |
| Production-readiness language from Google | **UNCONFIRMED** | Some Model Garden entries explicitly say "Preview" or "GA". Confirm WeatherNext is GA before treating it as a live source. |

---

## 5. Required env vars (current Step 135 schema)

The Step 135 client expects:

- `GCP_PROJECT_ID` — already present in WagerOnWeather's env (used by BigQuery).
- `GCP_CREDENTIALS_BASE64` — already present, base64-encoded service account JSON.
- `WEATHERNEXT_VERTEX_REGION` — placeholder.
- `WEATHERNEXT_VERTEX_ENDPOINT_ID` — placeholder.
- `WEATHERNEXT_VERTEX_MODEL_ID` — placeholder; **may not be needed** if the endpoint id implies the model.

If the actual contract requires a Publisher Model URL instead of a deployed Endpoint id, the env schema needs to evolve to either:

- `WEATHERNEXT_VERTEX_MODEL_PATH` (e.g., `publishers/google/models/weathernext-2`), or
- Both `WEATHERNEXT_VERTEX_PUBLISHER` and `WEATHERNEXT_VERTEX_MODEL_ID`.

This is a Step 142 decision after the contract is confirmed.

---

## 6. Field mapping into `ForecastResponse`

The Step 135 client must return a value compatible with `src/lib/types.ts#ForecastResponse`. The mapping target is identical to what `src/lib/open-meteo.ts` already produces:

- `current: ForecastPoint` — pick from the inference response's first hour or "nowcast" record.
- `hourly: ForecastPoint[]` — at least the next 48 h, ideally up to 168 h to feed the Step 129 confidence and Step 130 revision tracking.
- `daily: DailyForecast[]` — derived from the hourly array (high/low/avg) using the same logic as `weather-queries.ts` (or returned by the model if available).
- `alerts: WeatherAlert[]` — leave empty (`[]`); customer-facing alerts continue to come from `nws-observations.ts` / NWS alerts API. WeatherNext does not produce alerts.
- `airQuality?`, `allergyData?` — leave undefined; sourced separately.
- `utcOffsetSeconds` — derive from lat/lon as Open-Meteo does, or accept the model's value if provided.
- `generatedAt: string` — model run timestamp. **This must be real**, not `new Date().toISOString()` — Step 130 deduplicates revision snapshots by `generatedAt`.
- `source: ForecastSource` — populated by `weather-queries.ts` via `getWeatherNextSuccessSource()`.

---

## 7. Fallback behavior (already implemented, Step 135 + 136)

- On any failure mode (`endpoint_unconfirmed`, `unconfigured`, `timeout`, `auth_rejected`, `quota_exceeded`, `upstream_error`, `schema_mismatch`, `network_error`, `unknown`), `weather-queries.ts` falls back to Open-Meteo with `source.notes` recording the failure.
- The 1500 ms `AbortController` timeout in `tryWeatherNextForecast` enforces an upper bound on customer page latency. **The timeout value must be re-tuned once real Vertex AI p50/p99 are measured.**
- The page never fails because WeatherNext is unavailable.

---

## 8. Test plan (for Step 142)

1. **Smoke test against a single Vertex AI prediction** for one lat/lon, in a server-side admin debug route, with verbose logging (no secrets in logs). Validate:
   - Auth handshake succeeds.
   - Response schema matches the documented shape.
   - `ForecastResponse` shape after mapping is well-formed.
   - End-to-end p50 latency under target.
2. **Run the seeded batch comparison with `?includeWeatherNextProduction=true`** against the 12 seed cities. Validate per-city success rate, latency distribution, and field completeness against `forecast-provider-metadata.ts`.
3. **Trigger a quality gate** against the resulting snapshot once h0 has elapsed. Validate per-(provider, horizon, field) cell population.
4. **Watch the Step 140 trend dashboard** for 7+ days. Compare WeatherNext vs Open-Meteo per-axis.
5. **Promote** the public default in `forecast-source.ts` only after Phase 5 quality gates pass (multiple weeks of consistent improvement, no degradation).

---

## 9. Rollout checklist (Step 142+)

- [ ] All "UNCONFIRMED" items in §1–§4 resolved from authoritative sources.
- [ ] Env schema decision (deployed Endpoint vs Publisher Model) made and `.env.example` updated.
- [ ] `forecast-provider-metadata.ts` updated with the actual field-quality breakdown for production WeatherNext.
- [ ] Inference body implemented in `weathernext-client.ts`.
- [ ] Smoke test passes (admin debug route).
- [ ] Seeded batch comparison succeeds for ≥ 90% of seed cities.
- [ ] Quality gate produces non-`unavailable` cells for temp / wind / gust at h0–h24.
- [ ] Trend dashboard shows ≥ 1 week of stable behavior.
- [ ] Operator review + sign-off.
- [ ] Public default flip in `forecast-source.ts`.

---

## 10. Go / no-go criteria

**Go** requires *all* of:

- Every "UNCONFIRMED" in §1, §2, and §3 resolved.
- Smoke test green.
- Quality gate produces real (not `unavailable`) cells for the four core fields × four horizons.
- Trend dashboard shows mean |Δtemp| comparable to or better than Open-Meteo over a 7-day window.
- Mean weak-bucket rate not higher than Open-Meteo's.
- No active commercial / attribution / billing blocker.

**No-go** if any of:

- Endpoint contract still UNCONFIRMED.
- Required field absent from the response (precip probability, wind gust, UV, visibility) and not derivable.
- p99 latency exceeds 1500 ms after timeout retuning.
- Quota too low to cover expected traffic without raise.
- Pricing materially exceeds the budget allocation for forecast inference.
- Attribution requirement cannot be met by current UI surface.

---

## 11. Settlement boundary (immutable)

Settlement remains observation-based via `nws-grading.ts` / `nws-observations.ts`. No matter which forecast provider is active, market resolution does **not** read from any forecast source. This boundary holds before, during, and after the WeatherNext switch.
