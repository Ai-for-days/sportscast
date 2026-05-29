# WeatherNext Activation Plan (Step 171)

**Status: Open-Meteo remains the only production forecast provider on
`wageronweather.com`. WeatherNext is shelled out, gated behind two
explicit env flags, and probed only via the admin-only contract-probe
endpoint.** The public ZIP-code forecast flow is untouched.

This document is the operator-facing guide to safely activating
WeatherNext step-by-step. It complements
`docs/weathernext-provider-foundation.md` (Step 170 foundation) and
`docs/weathernext-integration-plan.md` (longer-term strategic notes).

## Current state

| Component | Status |
|---|---|
| `forecast-source.ts` resolver | Step 133. Live. Defaults to `open-meteo`. |
| `weather-queries.getForecast()` dispatch | Live. Falls back to Open-Meteo on any WeatherNext failure. |
| `weathernext-client.ts` Vertex AI client | Step 135. Skeleton. Returns `endpoint_unconfirmed` until the inference body is implemented. |
| `weathernext-bigquery-production-client.ts` | Step 142. Stub. Returns `contract_unconfirmed`. |
| Step 170 provider foundation | `ForecastProviderAdapter` interface + Open-Meteo / WeatherNext adapters + selection helpers + `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` defensive kill switch. Live. |
| **Step 171 contract probe** | `/admin/system/weathernext-probe` + `/api/admin/system/weathernext-probe`. **NEW.** Admin-only. Fires at most one Vertex AI call per POST, only when both kill switches are true. Public flow untouched. |

## Environment variables

### Required to enable the probe

| Variable | Value | Purpose |
|---|---|---|
| `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` | `true` | Step 170 kill switch. Without it, the probe (and any other WeatherNext attempt) returns `disabled`. |
| `WEATHERNEXT_VERTEX_PROBE_ENABLED` | `true` | Step 171 probe-specific kill switch. Without it, the probe returns `probe_disabled`. |
| `GCP_PROJECT_ID` | your GCP project id | Used to build the Vertex AI predict URL. |
| `GCP_CREDENTIALS_BASE64` | base64(`key.json`) | Service-account JSON. The probe decodes + uses it via `google-auth-library` (already a transitive dep of `@google-cloud/bigquery`). |
| `WEATHERNEXT_VERTEX_REGION` | e.g. `us-central1` | Vertex AI region hosting the endpoint. |
| `WEATHERNEXT_VERTEX_ENDPOINT_ID` | numeric endpoint id | The deployed endpoint to call. |

### Optional probe tuning

| Variable | Default | Purpose |
|---|---|---|
| `WEATHERNEXT_VERTEX_API_VERSION` | `v1` | Vertex AI API version in the URL path. |
| `WEATHERNEXT_VERTEX_TEST_LAT` | `40.7128` | Default probe latitude (New York City). |
| `WEATHERNEXT_VERTEX_TEST_LON` | `-74.006` | Default probe longitude. |
| `WEATHERNEXT_VERTEX_MODEL_ID` | unset | Optional. Some endpoints embed the model id; the probe doesn't require it. |

## Probe result statuses

The probe response always carries one of:

| `status` | Meaning | What to do next |
|---|---|---|
| `disabled` | `WEATHER_PROVIDER_WEATHERNEXT_ENABLED ≠ true`. | Set the flag explicitly. |
| `probe_disabled` | `WEATHERNEXT_VERTEX_PROBE_ENABLED ≠ true`. | Set the flag explicitly. |
| `missing_config` | One or more required env vars missing. | Populate the missing values on the Vercel deployment. |
| `credentials_invalid` | `google-auth-library` rejected the credentials, or `GCP_CREDENTIALS_BASE64` didn't decode to a service-account JSON. | Re-issue the service-account key, confirm Vertex AI is enabled, ensure `roles/aiplatform.user` is granted. |
| `endpoint_unreachable` | Network error, timeout, 404 (project/region/endpoint id wrong), or 5xx. | Verify region + endpoint id; check Vertex AI console. |
| `contract_rejected` | 400/422. Endpoint reached, but the probe request body doesn't match the model's expected `instances` schema. | Read the structured error notes; update `buildWeatherNextProbeRequest` in `weathernext-client.ts` to match the deployed model's expected input shape; re-run. |
| `contract_confirmed` | 200 OK with forecast-like field names in the response. | Use `responseShapeSummary` to drive the inference body implementation in `tryWeatherNextForecast`. |
| `unexpected_response` | 200 OK but no forecast-like fields found, or a status code the probe doesn't classify. | Compare `topLevelKeys` to the WeatherNext model card; update the probe handler if a new code needs classification. |

## How to safely run a probe

1. **Verify Open-Meteo is healthy first.** The public ZIP-code page should render normally. Step 171 has no effect on this path even at worst.
2. **Set the env vars on the Vercel project.** Both kill switches plus the four required GCP vars.
3. **GET `/admin/system/weathernext-probe`.** Confirm the readiness panel shows `ready_to_probe`. No network call is made.
4. **Click "Send one probe".** The panel POSTs once. The result, status, and sanitized response shape render inline. An audit event (`weathernext_vertex_probe`) is written.
5. **Read the `nextAction` field.** It tells you exactly which file / config to update before the next probe.

## What never happens during a probe

- No public route is touched. ZIP-code → lat/lon → forecast remains Open-Meteo.
- No market behavior changes (publishing / pricing / settlement / grading / wager-create are all unaffected).
- No raw credentials, OAuth tokens, endpoint ids, or full response payloads are returned. The response shape summary is capped at 8 top-level keys + 24 field types; long error strings are sanitized + truncated.
- No retries, no loops, no concurrent probes. One POST = one Vertex AI call.

## What still has to land before WeatherNext becomes the public default

Even after `contract_confirmed`:

1. **Implement the inference body in `tryWeatherNextForecast`.** Today it returns `endpoint_unconfirmed` regardless of config. Replace the deliberate early-return with a real call mirroring the probe.
2. **Normalize the response to the existing `ForecastResponse` shape.** Reuse `forecast-provider-metadata.ts` for field-level capabilities.
3. **Decide who sees WeatherNext.** Step 170's `PUBLIC_FORECAST_PROVIDER` is the lever — keep it as `openmeteo` for the public surface unless a deliberate operator decision flips it.
4. **Wire WeatherNext into the snapshot pipeline** so the divergence engine + cross-provider comparison can use it.
5. **Run the Step 143 provider-comparison harness** to verify accuracy + stability against Open-Meteo before flipping any public surface.

Until all of those are done, Open-Meteo continues to serve the public ZIP-code experience.
