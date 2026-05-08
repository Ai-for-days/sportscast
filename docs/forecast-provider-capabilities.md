# Forecast Provider Capabilities

**Status:** Step 134. Reference table for the three forecast providers WagerOnWeather knows about. Capability metadata only — see `docs/weathernext-integration-plan.md` and `docs/weathernext-decision-matrix.md` for the integration roadmap and the access-path scoring.

The runtime mirror of this table lives in `src/lib/forecast-provider-metadata.ts`. Keep them in sync.

## Comparison

| Capability | Open-Meteo | WeatherNext (sample) | WeatherNext (production, planned) |
|---|---|---|---|
| **Field: temperature** | Real | Real | Real |
| **Field: humidity** | Real | Real | Real |
| **Field: dew point** | Real | Derived from temp + humidity | Real |
| **Field: precipitation amount** | Real | Real | Real |
| **Field: precipitation probability** | Real | Fabricated (`precipMm × 30`) | Real |
| **Field: wind speed** | Real | Real (from u/v components) | Real |
| **Field: wind direction** | Real | Real (from u/v components) | Real |
| **Field: wind gust** | Real | Fabricated (`windSpeed × 1.4`) | Real |
| **Field: cloud cover** | Real | Real | Real |
| **Field: surface pressure** | Real | Real | Real |
| **Field: apparent temperature ("feels like")** | Real | Derived | Real |
| **Field: UV index** | Real | Hardcoded (`isNight ? 0 : 5`) | Real |
| **Field: visibility** | Real | Hardcoded (`10` mi) | Real |
| **Field: weather code** | Real (WMO) | Derived from temp/humidity/precip/wind/cloud | Real |
| **Update cadence** | Hourly | ~Daily | Six-hourly (4 runs/day) |
| **Forecast horizon** | Up to 16 days | Up to ~10 days | Up to 10 days |
| **Geographic resolution** | 0.05–0.25° depending on model | ~0.25° | Native model resolution |
| **Reliability for live UX** | High — purpose-built API | Medium — analytics-shaped | High (planned) |
| **Schema stability** | Stable | Preview, can change | TBD |
| **Authentication** | None | `GCP_CREDENTIALS_BASE64` | `GCP_CREDENTIALS_BASE64` (Vertex AI primary) |
| **Cost model** | Free for non-commercial; paid commercial tiers available | Per-byte BigQuery scan | Per-prediction (Vertex AI primary) / per-byte (BigQuery fallback) |
| **Intended usage** | Live public weather page (default) | Research / A-B comparison only | Strategic preferred — pending validation |
| **Production-ready** | Yes (current default) | No (sample / preview) | Not yet wired — Phase 3 (Step 135) |
| **Trust level** | Live source — full intelligence layer operates here | Opt-in only — surface clearly labeled "WeatherNext (sample)" with `isResearchSample: true` | Live source once Phase 5 quality gates pass |
| **Fallback behavior** | None needed — already the safe path | Falls back to Open-Meteo via the resolver's mock branch | Falls back to Open-Meteo on any error (planned, Phase 3) |

## Why each provider is or isn't the default

### Open-Meteo (current default)

- All fields are real. The Step 129–132 forecast intelligence layer (confidence, volatility, trend, revision tracking, market context) operates on real values without fabrication.
- Hourly updates match the freshness expectation users have from competitors (weather.com, accuweather).
- Free for the volume the public site needs, zero auth surface.
- The blend underneath (ECMWF IFS + GFS + HRRR + ICON) is the same set of models powering the "good" weather sites.

### WeatherNext (sample) — research only

- Several fields aren't in the schema and were filled in with formulaic placeholders that visibly degraded the Step 129–132 intelligence output.
- Daily-ish update cadence is too slow for live UX.
- Useful for A-B comparison harnesses or research notebooks, not customer surfaces.
- Resolver labels it "WeatherNext (sample)" and sets `isResearchSample: true` so it's distinguishable from production.

### WeatherNext (production) — strategic preferred, pending validation

- Same model output as sample, with full schema and the operational cadence of the upstream model.
- Vertex AI inference endpoint is the recommended access path (see `weathernext-decision-matrix.md`). BigQuery production tables are the fallback.
- Will become the default in Phase 6 of the integration plan only after the Phase 4–5 quality gates pass.
- **Step 135 status:** the typed client harness exists at `src/lib/weathernext-client.ts` (server-only, 1500 ms timeout, fail-closed). The actual Vertex AI inference body is intentionally not implemented because the endpoint contract isn't confirmed against current Google docs — see `weathernext-integration-plan.md` §10. Until that's resolved, requesting `FORECAST_PROVIDER=weathernext-production` invokes the client, gets `failureMode: 'endpoint_unconfirmed'`, and falls back to Open-Meteo with structured `source.notes` recording the failure mode.

## Comparison harness (Step 136)

The admin-only A/B harness at `/admin/system/forecast-provider-comparison` runs side-by-side fetches against Open-Meteo (always) plus any explicitly-opted-in WeatherNext provider. Per-provider failures are isolated. Snapshots are persisted to Redis (`forecast-provider-comparison:*` + sorted set, retention 200) and audit-logged via `forecast_provider_comparison_run`. The harness scores completeness against this capability table, freshness against `generatedAt`, and pairwise numerical proximity across six core fields. **It does not claim accuracy** — no ground-truth observation comparison happens at Step 136.

## Quality gates (Step 137)

Same admin page, new "Quality Gates" tab. Reads each comparison snapshot's `providerHorizonValues` (captured at snapshot time for h0 / h6 / h12 / h24) and compares them against official NWS observations from the snapshot's NWS station once each horizon target time has elapsed (with a 10-min publication grace and a 60-min match window).

### Scored fields and thresholds

- Temperature (°F): good ≤ 2, acceptable ≤ 5, weak otherwise.
- Wind speed (mph): good ≤ 4, acceptable ≤ 8, weak otherwise.
- Wind gust (mph): good ≤ 5, acceptable ≤ 10, weak otherwise.
- Precipitation probability: **intentionally not scored** at Step 137. Calibration requires many samples — a single snapshot can't justify a verdict.
- Humidity / dew point: not scored at Step 137; NWS station observations are sparse for these and noisy enough that a single match is misleading.

### Known limitations

- Single-location, single-hour comparisons are noisy. A "weak" reading is one data point, not a verdict.
- Snapshots taken before Step 137 don't carry `providerHorizonValues` — the gate marks them all unavailable. Re-run the comparison to produce snapshots a gate can fully score.
- NWS stations occasionally publish observations 60+ minutes off the target hour or skip a cycle. The gate marks those cells unavailable rather than scoring against a stale match.
- Persisted via `forecast-quality-gate:*` + sorted set, retention 200, audit event `forecast_quality_gate_run`.

### Settlement boundary

This layer reads NWS observations for diagnostics only. `nws-grading.ts` is not called. `nws-observations.ts` is read via the same `fetchDayObservations` helper settlement uses; it is read-only and side-effect-free.

## Settlement boundary

None of these providers are on the settlement path. Markets resolve via `nws-grading.ts` / `nws-observations.ts`. Forecast provider only affects what users see on the weather page.
