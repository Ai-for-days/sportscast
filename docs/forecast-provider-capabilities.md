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
- Until then, requesting `FORECAST_PROVIDER=weathernext-production` logs a warning and serves Open-Meteo. This guard exists in `forecast-source.ts` today.

## Settlement boundary

None of these providers are on the settlement path. Markets resolve via `nws-grading.ts` / `nws-observations.ts`. Forecast provider only affects what users see on the weather page.
