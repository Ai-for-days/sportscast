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

## Batch quality reports (Step 138)

Same admin page, new "Batch Reports" tab. Two operations:

1. **Seeded batch comparison** — runs a fresh provider-comparison against every city in `forecast-quality-seed-cities.ts` (12 cities by default). Concurrency 3 to keep upstream providers happy. Each snapshot is tagged `seedCityId` so the report runner can pair them later.
2. **Batch quality report** — for each seed city, picks the most recent comparison snapshot whose h0 horizon has elapsed (with the 10-min publication grace), runs the Step 137 quality gate, and aggregates per-(provider, horizon, field, bucket) into a compact `BatchQualityReport`. Includes per-provider mean |error|, top issues, per-city outcomes, and warnings. Persisted via `forecast-quality-report:*` + sorted set, retention 90.

### Methodology and limitations

- Provider aggregate `meanTempErrorF` is the average absolute temperature error across every (city, horizon) cell where both a forecast value and a matched NWS observation exist. Sample size is reported alongside.
- Per-(field, horizon) tables also show their cell counts so the operator can judge how much weight to put on each cell.
- "Top issues" are heuristic flags: ≥30% weak buckets for a provider, or mean temp error ≥5°F across the cities scored. These are not verdicts — they are prompts to investigate.
- Single-day reports across 12 cities are still a small sample. **Wait for multiple days of reports before drawing conclusions** about a provider. The retention 90 in the store is sized to support exactly this — a quarter of rolling daily reports.
- Audit events `forecast_seeded_batch_comparison_run` and `forecast_batch_quality_report_run` provide a paper trail for who ran what and when.
- Future scheduling: the API actions are admin-gated and operator-triggered today. A future Vercel Cron endpoint can call them on a schedule once a stable cadence is decided. Not added in Step 138 to avoid an unauthenticated cron surface.

## Scheduled automation (Step 139)

`/api/cron/forecast-quality` is a secret-protected cron endpoint that drives the Step 138 pipeline on a Vercel Cron schedule:

- **Seeded comparison every 6 hours** (`0 */6 * * *`).
- **Quality report once a day** at 07:30 UTC (`30 7 * * *`), 30 minutes after `grade-wagers` so NWS observations are fresh.

Auth: `Authorization: Bearer <secret>`, where `secret` is `FORECAST_QUALITY_CRON_SECRET` (preferred, feature-isolated) or `CRON_SECRET` (existing project-wide convention). The endpoint refuses every request when neither secret is set. Cadence guards (4 h seeded, 22 h report) prevent accidental re-runs even if the cron fires twice; `?force=true` bypasses with a valid secret. Skipped runs respond `200 { status: "skipped", reason: "cadence_guard" }` so Vercel Cron doesn't see them as failures.

See `docs/forecast-quality-cron-setup.md` for the full deployment recipe, manual curl examples, and security notes.

## Trend dashboard (Step 140)

Same admin page, new "Trend Dashboard" tab. Aggregates the Step 138 batch reports over a rolling window (24h / 7d / 30d) without persisting any new data. Per-provider summaries surface:

- **Mean |Δtemp|** in the window with a half-to-half direction (improving / stable / degrading).
- **Weak-bucket %** of (good + acceptable + weak) cells, with direction.
- **Unavailable %** of all cells, with direction. Climbing unavailability flags upstream/observation reliability.
- **Per-field** mean |error| (temperature / wind / gust) split by half.
- **Per-horizon** mean |error| (h0 / h6 / h12 / h24) split by half.
- **City outliers** (top 5 by failure rate when ≥1 failure exists).
- **Insights** — descriptive sentences derived from the metrics ("X temperature accuracy improved from Y°F to Z°F over the last 7d", "X +24h forecast quality weakened", "City Y failed scoring in N of M reports — investigate observation availability").

### Methodology

- Half-to-half delta on rolling MAE drives the direction badge. Stable band: changes within ±5% (and below an absolute floor of 0.3°F for temp / 1.5pp for rates) are reported as `stable` rather than `improving` / `degrading`.
- `improving` / `degrading` is a **prompt to investigate**, not a verdict. Two days of noisy data can flip the badge.
- Sample counts (`reportCount`, `totalCells`, `appearanceCount`) appear everywhere so the operator can judge how much weight to put on a reading.
- Provider with `reportCount === 0` produces an "Insufficient data" notice; provider with `reportCount < 3` produces a "trend signal is weak" notice.
- No provider is ever called "best." The dashboard is descriptive only.

### Limitations

- The aggregator pulls up to 90 reports from the store. With the cron firing daily, that's ~3 months of history. The 24h window typically holds 1 report; the 7d window holds 7; the 30d window holds 30. Direction signal is weakest on the 24h window — set expectations accordingly.
- Precipitation calibration is still **unavailable** at the gate level (Step 137 conservative-skip carries through to the trend), so precipitation is not in the per-field trend table.
- Half-to-half splits give half the sample to each side; with very few reports, both halves can be empty (returns `insufficient_data` rather than fabricating a verdict).
- This is admin-only operational signal. None of it leaks to public/customer surfaces or affects market settlement.

## Settlement boundary

None of these providers are on the settlement path. Markets resolve via `nws-grading.ts` / `nws-observations.ts`. Forecast provider only affects what users see on the weather page.
