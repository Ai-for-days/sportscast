# WeatherNext Probe Runbook (Step 172)

**This is the operator runbook for safely running the Step 171
WeatherNext Vertex AI contract probe.** It is a step-by-step companion
to `docs/weathernext-activation-plan.md`. Pair them: the activation
plan explains the architecture; this runbook walks an operator through
exactly what to do.

**Safety posture (unchanged across this whole runbook):**

- Public ZIP-code forecast flow stays on Open-Meteo.
- WeatherNext is disabled by default. Two explicit env flags are
  required before any Vertex AI call is even attempted.
- The probe makes **at most one** Vertex AI call per POST.
- All outputs are sanitized. The runbook never asks you to copy raw
  credentials, tokens, or endpoint ids anywhere.

## Pre-flight (read this first)

Before changing any Vercel env var, confirm:

- The public site still loads forecasts for a known ZIP code (e.g.
  `29209`). The page should show "Open-Meteo" as the source.
- The Step 159 admin daily brief / Step 160 digest page still
  renders for an admin.
- `git log --oneline -1` on `master` shows `bc0c4ac` (Step 171) or
  later. Step 172 (`<this commit>`) layers on top.

If anything above is broken, **stop**. Do not flip any flag until the
baseline is healthy again.

## Step 1 — Set Vercel environment variables

Open the Vercel project → Settings → Environment Variables. Add or
update (Production scope):

### Required to enable the probe

| Variable | Value | Purpose |
|---|---|---|
| `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` | `true` | Step 170 kill switch (defensive). |
| `WEATHERNEXT_VERTEX_PROBE_ENABLED` | `true` | Step 171 probe-specific kill switch. |
| `GCP_PROJECT_ID` | your GCP project id | Builds the Vertex AI predict URL. |
| `GCP_CREDENTIALS_BASE64` | base64-encoded service-account JSON | OAuth token issuance via `google-auth-library`. |
| `WEATHERNEXT_VERTEX_REGION` | e.g. `us-central1` | Vertex AI region hosting the endpoint. |
| `WEATHERNEXT_VERTEX_ENDPOINT_ID` | numeric endpoint id | The deployed Vertex AI endpoint. |

### Must remain safe (do not change)

| Variable | Required value |
|---|---|
| `PUBLIC_FORECAST_PROVIDER` | `openmeteo` or unset (which defaults to openmeteo) |
| `FALLBACK_FORECAST_PROVIDER` | `openmeteo` or unset (which defaults to openmeteo) |

If `PUBLIC_FORECAST_PROVIDER` is anything other than `openmeteo`, the
readiness verdict will return `unsafe_config_public_provider_not_openmeteo`
and the probe button will warn explicitly. Revert it before running.

After saving, re-deploy the project so the new env vars take effect on
the running deployment.

## Step 2 — Verify readiness (zero network calls)

1. Visit `/admin/system/weathernext-probe` (admin-gated).
2. The page calls `GET /api/admin/system/weathernext-probe` on load.
3. The readiness checklist should show every item with state `OK`. The
   verdict banner should read **"Ready to run one manual probe"** in
   green.
4. If any item is `MISSING` or `UNSAFE`, the **Next** callout under
   that item tells you exactly which Vercel env var to fix. Fix it,
   re-deploy, and refresh the page.

**Verdict semantics:**

| Verdict | Meaning |
|---|---|
| `ready_to_run_one_probe` | All env present + both flags true + public provider safe. Safe to click "Send one probe". |
| `not_ready_missing_config` | At least one of `GCP_*` / `WEATHERNEXT_VERTEX_*` is missing. |
| `not_ready_probe_disabled` | One or both of the kill switches is not `true`. |
| `unsafe_config_public_provider_not_openmeteo` | `PUBLIC_FORECAST_PROVIDER` is set to a non-`openmeteo` value. **Revert before probing.** |

## Step 3 — Run one probe

1. With the verdict green (`Ready to run one manual probe`), click
   **Send one probe** on the page.
2. The browser POSTs `/api/admin/system/weathernext-probe` once. The
   server fires **exactly one** authenticated POST to
   `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/endpoints/${endpointId}:predict`
   with the probe body `initial_vertex_weather_forecast_probe_v1` and a
   hard 8-second timeout.
3. An audit event `weathernext_vertex_probe` records the structured
   status (never raw values).

## Step 4 — Read the result

The probe panel will show a status chip with one of:

| Status | What it means | What to do next |
|---|---|---|
| `contract_confirmed` | 200 OK and forecast-like field names found in the response. | Move on to implementation. The response shape summary is the contract you'll wire up in `tryWeatherNextForecast`. |
| `contract_rejected` | 400/422 from Vertex AI — endpoint reached, schema doesn't match. | Read the structured `notes` for the error message. Update `buildWeatherNextProbeRequest` in `weathernext-client.ts` to match the deployed model's expected `instances` shape. Re-run. |
| `credentials_invalid` | 401/403 or token issuance failed. | Re-issue the service-account key. Confirm `roles/aiplatform.user` and that Vertex AI is enabled for the project. |
| `endpoint_unreachable` | 404 / 5xx / network error / timeout. | Re-check `WEATHERNEXT_VERTEX_REGION` + `WEATHERNEXT_VERTEX_ENDPOINT_ID`; verify outbound HTTPS from the deployment. |
| `unexpected_response` | 200 OK but no forecast-like fields, or a status code the probe doesn't classify. | Compare `topLevelKeys` to the WeatherNext model card. |
| `missing_config` / `probe_disabled` / `disabled` | Gate failed. | Step 2 above tells you what to set. |

## Step 5 — Copy the sanitized result

Click **Copy sanitized result** on the probe panel. It places a
structured JSON blob on the clipboard. Paste it into ChatGPT / Claude
when asking for help implementing the inference body or interpreting
an error.

**The copied JSON contains** (and only contains):

- `status`, `ok`, `httpStatus`
- `config` (booleans only — never raw values)
- `endpoint.regionPresent` + `endpoint.endpointIdPresent` (booleans
  only — the actual region and endpoint id are never copied)
- `requestShapeAttempted` (stable label, e.g.
  `initial_vertex_weather_forecast_probe_v1`)
- `responseShapeSummary` (top-level keys + sample field types + names
  of forecast-like fields — no raw values)
- `notes` (sanitized — base64 / JWT blobs redacted, capped at 240
  chars)
- `nextAction`
- `copiedAt`
- `publicForecastFlow: 'unchanged_open_meteo'`

**The copied JSON never contains**: credentials, OAuth tokens, raw
project id, raw endpoint id, raw region values, request/response
headers, or full Vertex AI response payloads.

## Step 6 — Rollback (anytime)

Set on the Vercel project (Production scope):

```
WEATHER_PROVIDER_WEATHERNEXT_ENABLED=false
WEATHERNEXT_VERTEX_PROBE_ENABLED=false
PUBLIC_FORECAST_PROVIDER=openmeteo   # or leave unset; both behave the same
FALLBACK_FORECAST_PROVIDER=openmeteo # or leave unset
```

Re-deploy. The probe will return `disabled` immediately on any POST.
The public ZIP-code forecast flow continues to be served by Open-Meteo
regardless.

## What this runbook never touches

- `src/lib/weather-queries.ts`, `src/lib/open-meteo.ts`,
  `src/lib/forecast-source.ts`, `src/lib/zip-lookup.ts`,
  `src/pages/api/geocode.ts`, `src/pages/forecast/[location].astro`.
- Any market behavior (publishing, pricing, settlement, grading,
  wager creation, public market visibility).
- Step 159 / 160 admin brief + digest behavior.
- Step 165–169 forecast divergence + trend behavior.

## After the probe returns `contract_confirmed`

The probe alone does not activate WeatherNext for users. Next steps,
in order (defer to the activation plan for details):

1. Implement the inference body in `tryWeatherNextForecast` using the
   confirmed shape — replace the deliberate `endpoint_unconfirmed`
   early-return with a real call mirroring the probe.
2. Normalize the response into the existing `ForecastResponse` shape.
3. Decide who sees WeatherNext via `PUBLIC_FORECAST_PROVIDER`. Keep it
   as `openmeteo` (the default) until accuracy / stability have been
   validated against Open-Meteo.
4. Run the Step 143 provider-comparison harness over real data before
   flipping any public surface.
