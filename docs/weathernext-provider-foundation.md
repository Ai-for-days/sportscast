# WeatherNext Provider Foundation (Step 170)

Status: **Open-Meteo remains the only production forecast provider on
`wageronweather.com`.** WeatherNext is shelled out at the adapter layer
but disabled-by-default via an explicit env flag.

## What Step 170 changes

**Additive only.** No public route, no ZIP-code lookup, no public
forecast page, no market behavior (publish / price / settle / grade /
wager create), no Step 160 digest, no Step 165–169 divergence/trend
behavior is altered.

The Step 170 delta is:

1. A new formal adapter interface (`src/lib/forecast-provider.ts`).
2. A defensive `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` kill-switch
   honored by both existing WeatherNext clients.
3. New env-var roles (`PUBLIC_FORECAST_PROVIDER`,
   `WEATHER_INTELLIGENCE_PROVIDER`, `FALLBACK_FORECAST_PROVIDER`) that
   keep Open-Meteo as the safe default.

## Architecture diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ Public ZIP-code forecast flow (UNCHANGED in Step 170):           │
│                                                                  │
│   /forecast/[location].astro                                     │
│      ↓                                                           │
│   getForecast(lat, lon, days)        ← weather-queries.ts        │
│      ↓                                                           │
│   FORECAST_PROVIDER env switch       ← forecast-source.ts        │
│      ├── open-meteo → getOpenMeteoForecast (default)             │
│      ├── weathernext-production → tryWeatherNextForecast         │
│      │     ↑                                                     │
│      │     └── Step 170: feature_flag_disabled when              │
│      │         WEATHER_PROVIDER_WEATHERNEXT_ENABLED ≠ true       │
│      └── weathernext-bigquery-production → same posture          │
│                                                                  │
│   All WeatherNext failure modes fall back to Open-Meteo via the  │
│   existing Step 133/135/142 dispatch.                            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ Step 170 adapter layer (NEW, additive):                          │
│                                                                  │
│   src/lib/forecast-provider.ts                                   │
│      ProviderId = 'openmeteo' | 'weathernext'                    │
│      ForecastProviderAdapter (interface)                         │
│        ├── openMeteoAdapter   (ready, default)                   │
│        └── weatherNextAdapter (shell, feature_flag_disabled by   │
│                                default; fail-graceful)           │
│                                                                  │
│   Selection helpers:                                             │
│      getPublicForecastProvider()       → defaults 'openmeteo'    │
│      getIntelligenceForecastProvider() → null when unset         │
│      getFallbackForecastProvider()     → defaults 'openmeteo'    │
│      isWeatherNextFeatureEnabled()     → defaults false          │
└──────────────────────────────────────────────────────────────────┘
```

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` | unset → `false` | **Defensive kill switch.** Even when `FORECAST_PROVIDER=weathernext-production` is set, no Vertex AI / BigQuery production call happens unless this flag is explicitly `true` / `1` / `yes` / `on`. |
| `PUBLIC_FORECAST_PROVIDER` | unset → `openmeteo` | Coarse Step-170 id for the public forecast surface. |
| `WEATHER_INTELLIGENCE_PROVIDER` | unset → `null` | Optional admin-only intelligence provider selection. When unset, admin intelligence treats the layer as `openmeteo`. |
| `FALLBACK_FORECAST_PROVIDER` | unset → `openmeteo` | When the primary provider is unavailable, fall back to this provider. |
| `FORECAST_PROVIDER` (legacy, pre-Step-170) | unset → `open-meteo` | Drives the live `weather-queries.getForecast()` dispatch via `forecast-source.resolveForecastProvider()`. Honored unchanged for backward compatibility. |
| `USE_BIGQUERY_FORECAST=true` (very-legacy) | unset → off | Maps to `weathernext-bigquery-sample`. Honored unchanged. |
| Vertex AI config (`GCP_PROJECT_ID`, `GCP_CREDENTIALS_BASE64`, `WEATHERNEXT_VERTEX_REGION`, `WEATHERNEXT_VERTEX_ENDPOINT_ID`, `WEATHERNEXT_VERTEX_MODEL_ID`) | unset | Even when present, WeatherNext is still gated on `WEATHER_PROVIDER_WEATHERNEXT_ENABLED`. |

## Failure-mode taxonomy

The existing `WeatherNextFailureMode` and `WeatherNextBigQueryFailureMode`
unions both gain a new `feature_flag_disabled` value. Callers that
already handle the existing modes can treat `feature_flag_disabled`
the same way as `unconfigured` — fall back to Open-Meteo.

| Failure mode | When it fires | Caller posture |
|---|---|---|
| `feature_flag_disabled` (new) | `WEATHER_PROVIDER_WEATHERNEXT_ENABLED ≠ true` | Serve Open-Meteo. |
| `unconfigured` | Vertex AI / BigQuery env incomplete | Serve Open-Meteo. |
| `endpoint_unconfirmed` | Vertex AI inference body not yet wired up (current default) | Serve Open-Meteo. |
| `contract_unconfirmed` | BigQuery production schema not verified | Serve Open-Meteo. |
| `timeout` / `network_error` / `auth_rejected` / `quota_exceeded` / `upstream_error` / `schema_mismatch` | Upstream call failure modes | Serve Open-Meteo. |
| `unknown` | Anything else | Serve Open-Meteo. |

## Safety invariants

1. **The public ZIP-code forecast flow is unchanged in Step 170.**
   - `zip-lookup.ts` → `/api/geocode` → `getForecast(lat, lon, days)` →
     `getOpenMeteoForecast` (when `FORECAST_PROVIDER=open-meteo`, the
     default).
   - WeatherNext is never reached by the public path unless an operator
     explicitly sets BOTH `FORECAST_PROVIDER=weathernext-production`
     AND `WEATHER_PROVIDER_WEATHERNEXT_ENABLED=true`. Today this still
     falls back to Open-Meteo because the Vertex AI inference body is
     not implemented (`endpoint_unconfirmed`).

2. **The defensive flag is checked before any Vertex AI / BigQuery
   production call.**
   - Both `tryWeatherNextForecast` and `tryWeatherNextBigQueryForecast`
     read `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` at the top of the
     function and return `feature_flag_disabled` immediately when it
     is not `true`. The flag short-circuits even before the existing
     `unconfigured` / `contract_unconfirmed` checks.

3. **No market behavior changes.** The Step 170 module does not import
   any wager-store / publish / pricing / settlement / grading / wallet
   / Kalshi / Polymarket / mailer / crypto code. Markets continue to
   resolve via `nws-grading.ts` / `nws-observations.ts` regardless of
   forecast-provider configuration.

4. **No customer surface.** The adapter layer + the env flag posture
   are read-only / admin-facing. The public weather page reads
   `ForecastResponse.source.label` from the legacy `forecast-source.ts`
   surface (which Step 170 does not modify).

## What's deferred

- Wiring the formal adapter interface into a deeper part of the
  request path (the inspector / digest / divergence engine still go
  through the existing `weather-queries.getForecast` for now).
- Implementing the WeatherNext Vertex AI inference body (still
  `endpoint_unconfirmed`).
- Confirming the BigQuery production dataset / table / schema contract
  (still `contract_unconfirmed`).
- A `weathernext-bigquery-sample` adapter (the sample dataset is
  research-only and Step 170 keeps it on the legacy `forecast-source`
  surface where Step 142 left it).

When those land, the formal adapter interface plugs in without
changing any existing public route.
