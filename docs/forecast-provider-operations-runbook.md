# Forecast Provider Operations Runbook

**Audience:** WagerOnWeather operators making decisions about forecast-provider validation, promotion, and rollback.

**Tone:** cautious. Every threshold here is conservative on purpose. The forecast-provider apparatus is large and seductive — it's easy to mistake noisy signal for verdicts. When in doubt, do nothing.

**Primary settlement guarantee:** market resolution **never** uses any forecast provider. Settlement reads observed values from `nws-grading.ts` / `nws-observations.ts`. Switching forecast providers does not change how a single market resolves.

---

## 1. System overview

### Layers and what they do

- **Open-Meteo** — current public default. Live source for the weather page and the Step 129–132 forecast intelligence cards. Hourly updates, real fields, no auth required.
- **WeatherNext (Vertex AI)** — strategic preferred future source. Disabled today (`failureMode: 'endpoint_unconfirmed'`); requesting it falls back to Open-Meteo.
- **WeatherNext (BigQuery production)** — planned fallback path beneath Vertex AI. Disabled today (`failureMode: 'contract_unconfirmed'`); falls back to Open-Meteo.
- **WeatherNext (BigQuery sample)** — research-only public preview dataset. Opt-in via env, never default.
- **NWS observations** — the official settlement source. Read-only via `nws-observations.ts`. Used by `nws-grading.ts` for market resolution and (separately, retroactively) by the Step 137 quality gates for diagnostics.

### What changing forecast providers actually changes

- **It changes what users see on `/<city-zip>` weather pages** and the Step 129–132 intelligence cards.
- **It does NOT change market settlement.** Markets resolve on observed conditions, not forecasts.
- It changes nothing about pricing, wallet, betting, Kalshi, Polymarket, or admin operations.

If anyone ever asks "did switching providers change my market outcome?" the answer is no — by code-path separation, not by promise.

---

## 2. Tooling overview (admin)

All tooling lives at `/admin/system/forecast-provider-comparison`.

| Tab | What it does |
|---|---|
| **Run Comparison** | Manually fetch one location from Open-Meteo + opt-in WeatherNext path; surface deltas. Useful for spot-checking. |
| **Snapshots** | Browse stored comparison snapshots; open one to inspect per-field deltas. Each snapshot is an input to a quality gate. |
| **Quality Gates** | Score one snapshot against NWS observations after the target hours have elapsed. Per-(provider, horizon, field) absolute error → bucket. |
| **Batch Reports** | Run seeded comparison across the 12 seed cities, then aggregate quality gates into one rolling report. The "Scheduled automation" panel shows the last cron run state. |
| **Trend Dashboard** | Roll batch reports across 24h/7d/30d windows. Direction badges (improving/stable/degrading) are heuristic. |
| **Methodology** | Provider smoke tests, WeatherNext readiness panels, scoring details. |

Cron `vercel.json` schedules: seeded comparison every 6h (`0 */6 * * *`), quality report daily at 07:30 UTC (`30 7 * * *`).

---

## 3. Daily operator workflow

Five-minute daily check, in order:

1. **Cron status** (Methodology → "Scheduled automation"). Confirm both crons fired in the last day. A `failed` status for either is the only thing that requires immediate attention. A `skipped` status is normal during the cadence-guard window.
2. **Latest seeded report** (Batch Reports → top of Recent quality reports). Confirm `scoredCityCount` is healthy (≥8 of 12). A drop to < 6 is worth investigating; a drop to 0 with a non-empty eligible count is a serious signal.
3. **Trend dashboard at 7d** (Trend Dashboard → window selector "7d"). Scan the Insights callout. Anything with `severity: warning` deserves a second look. `severity: notice` is informational (typically "insufficient sample").
4. **City outliers** (Trend Dashboard → bottom). If the same city sits at ≥30% failure rate for 7+ days, it's likely an NWS station or geocoding issue, not a forecast-provider issue.
5. **Smoke tests as needed** (Methodology → "Provider smoke tests"). Run "Test" against Open-Meteo periodically to confirm the upstream is healthy. Don't run "Live" buttons routinely (BigQuery costs real money; Vertex AI counts against quota).

If everything's quiet: do nothing. The platform is doing its job.

---

## 4. WeatherNext validation workflow

Order matters. Skipping steps is how providers get promoted prematurely.

1. **Contract confirmation** — read `docs/weathernext-contract-readiness.md` end to end. Resolve every UNCONFIRMED row from authoritative Google docs. Do not flip `WEATHERNEXT_CONTRACT_CONFIRMED` until §1–§4 of that doc are fully resolved.
2. **Implementation** — fill in the Step 135 client's inference body (Vertex AI) or the Step 142 client's query body (BigQuery production) only after step 1.
3. **Readiness panels** (Methodology) — confirm both badges flip to `ready` (green). If they don't, the env is incomplete.
4. **Smoke tests** (Methodology → "Provider smoke tests") — click "Live" against the provider you're validating. Confirm `live_call_ok` and a sane `responseFingerprint` (hourly count, current temp). A single failed smoke test is a hard stop until investigated.
5. **Limited seeded comparisons** — open Batch Reports → "Run seeded comparison" with the appropriate WeatherNext checkbox enabled. Wait at least 24 hours.
6. **Quality-gate accumulation** — let the daily quality-report cron fire 7+ times (~7 days) so the trend dashboard's 7d window has real signal.
7. **7d trend review** (Trend Dashboard → "7d"). Apply the §5 promotion criteria below. Do not promote on a single 7d window — wait for two consecutive weeks before considering anything beyond a "limited rollout" status.
8. **30d trend review** (Trend Dashboard → "30d"). Required before any production-default switch. The 30d window is the only one with enough sample to support a confident direction call.
9. **Operator review and signoff** — fill the `forecast-provider-promotion-checklist.md` and confirm Status before doing anything in `forecast-source.ts`.

**Never** skip steps 5–8. The whole quality apparatus exists so that step 9 happens with evidence, not vibes.

---

## 5. Promotion criteria (cautious by design)

A provider becomes eligible for **default-switch** only when **all** of the following are true:

- Contract confirmed (`WEATHERNEXT_CONTRACT_CONFIRMED = true` for Vertex; `WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED = true` for BQ production).
- Implementation: client's request/response body wired up against the confirmed schema.
- Readiness panel: ready (green).
- Smoke tests: 3+ consecutive `live_call_ok` runs at different times of day, no `live_call_failed` in the same window.
- Seeded reports: ≥ 14 daily reports in the store with the candidate provider included.
- 7d trend window: candidate provider's mean |Δtemp| within 1.5°F of Open-Meteo (or better), weak-bucket rate ≤ Open-Meteo + 5pp, unavailable rate ≤ 10%.
- 30d trend window: same thresholds. Direction labels for temp / wind / gust are not `degrading`.
- Two consecutive 7d windows showing the above (≥ 14 days of stable signal). One good week is not enough.
- No persistent schema-mismatch or auth-error failure modes in the cron state (`lastFailureSummary` empty or stale).
- City coverage: ≥ 10 of 12 seed cities scoring successfully on the most recent batch.
- Operator signoff in `forecast-provider-promotion-checklist.md`.

A provider becomes eligible for **limited rollout** (env-only opt-in for a small subset of internal traffic) at lower thresholds — typically 7+ daily reports and a single stable 7d trend window. Limited rollout is *operational practice*, not customer-facing default.

The default `forecast-source.ts` resolver default never auto-promotes. Promotion is always a deliberate code change reviewed by the operator.

---

## 6. Rollback criteria (any one triggers)

- Trend dashboard shows `degrading` on the candidate's mean |Δtemp| over a 7d window with ≥ 5 reports.
- Unavailable rate climbs above 15% over a 7d window.
- Schema-mismatch failure mode appears in the cron state.
- Smoke tests fail twice in a row at different times.
- Auth or quota errors in the cron logs.
- Latency p99 exceeds the 1500 ms client timeout consistently (forces every request through the fallback).
- Customer-visible regression (broken weather page, missing fields, stale freshness).
- Any incident response below.

**Rollback procedure** — flip the `forecast-source.ts` default back to `'open-meteo'` and redeploy. Open-Meteo is always a safe rollback target because it never went away.

---

## 7. Interpretation cautions

- **Small samples are noisy.** A 24h window with 1 report is a data point, not a verdict. The trend dashboard surfaces sample counts everywhere — read them.
- **Pairwise agreement is not correctness.** Step 136's "agreement" score is numerical proximity between providers; both could agree on the wrong number.
- **Quality-gate scores are retrospective.** They tell you how a forecast performed at one location at one hour. Single-snapshot scores are noisy by nature.
- **"Degrading" is heuristic.** The Step 140 trend direction labels are half-to-half MAE deltas with a stable band. They're useful as prompts to investigate, not statistical inference.
- **Precipitation calibration needs many samples.** The current quality gate intentionally marks precipitation `unavailable` because a single snapshot can't justify a probability calibration. Don't read absence of precipitation scoring as a problem.
- **City anomalies happen.** A specific city failing scoring is often an NWS station gap or a geocoding mismatch, not a forecast-provider issue. Investigate before reacting.
- **Forecast quality ≠ market settlement.** The two systems are separate by design. A provider being "weak" in the trend dashboard does not affect any market resolution.

---

## 8. Operational safety rules (never break these)

1. **Never change the settlement source from NWS observations.** `nws-grading.ts` / `nws-observations.ts` are immutable in this respect.
2. **Never promote a provider from one good day.** Two consecutive 7d windows minimum.
3. **Never bypass fail-closed fallback behavior.** The Step 135/142 stubs and the resolver fallbacks exist precisely so that bad upstream behavior degrades to Open-Meteo, not to wrong-shape data.
4. **Never expose unfinished provider paths publicly.** Any new provider lives behind `requireAdmin` until it passes §5.
5. **Never treat the trend dashboard as automated truth.** It is a prompt for human review. Auto-promotion based on trend direction is an explicit non-feature.
6. **Never check secrets into the repo.** All secrets live in Vercel env. Smoke tests and readiness checks return booleans only.
7. **Never run BigQuery "Live" smoke tests on a loop.** Each query costs real money per byte scanned. The Step 142 UI requires a separate explicit click for live; respect it.

---

## 9. Incident response

| Symptom | First action |
|---|---|
| Cron `failed` status (either action) | Open the cron log, find the structured error in the audit log under `forecast_seeded_batch_comparison_run` / `forecast_batch_quality_report_run`. Re-run with `?force=true` and a valid bearer secret to confirm. |
| Provider outage (Open-Meteo down) | Page renders OK because `getOpenMeteoForecast` falls through to mock data. No customer impact unless mock fallback also breaks. Watch for upstream recovery. |
| Missing observations (NWS gaps) | Quality gates mark cells `unavailable` and the gate result persists with a warning. Acceptable — wait for next cycle. |
| Schema mismatch from a candidate provider | Smoke test the provider; if `schema_mismatch` reproduces, immediately revert any in-progress promotion work and re-read the contract. |
| Quota exhaustion | Smoke tests / cron will start returning `quota_exceeded`. Request a quota raise from the GCP console. Customer pages continue serving Open-Meteo. |
| Readiness regression (env got removed) | Methodology readiness panel flips from green to amber. No customer impact. Restore env. |
| Customer reports forecast looks wrong | First check `/admin/system/forecast-provider-comparison` to confirm the active provider is what you expect. Then check Open-Meteo source-line freshness on the actual page. Then compare against weather.com / NWS for ground truth. |

In every case: customer pages continue serving the safe default. Take the time to investigate properly rather than reacting.

---

## 10. Future phases

Documented in `docs/weathernext-integration-plan.md`. Highlights:

- Implement Vertex AI inference body once the Step 141 readiness checklist is fully resolved.
- Implement BigQuery production query body once §1 of the readiness doc is resolved.
- Ensemble-provider comparison: surface WeatherNext + Open-Meteo + (optionally) Polymarket pricing alongside each other for the same metric/location/time.
- Confidence-aware pricing research: feed the Step 140 trend signal into operator-facing pricing recommendations (admin-only; never automatic).
- Operator alerting: send a notification when the trend dashboard flips a provider's mean |Δtemp| to `degrading` for two consecutive 7d windows.
- Forecast confidence calibration: extend the Step 137 quality gate to score precipitation probability calibration once enough samples accumulate (likely 90+ days).
- Probabilistic provider scoring: replace heuristic direction labels with proper statistical tests (Brier scores for probabilities, RMSE confidence intervals for continuous fields).

None of these change the settlement source. NWS observations remain authoritative for market resolution forever.

---

## 11. Where to find related docs

- `docs/forecast-provider-promotion-checklist.md` — fill before any default switch.
- `docs/weathernext-contract-readiness.md` — Confirmed/UNCONFIRMED ledger.
- `docs/weathernext-integration-plan.md` — phased roadmap and architecture.
- `docs/forecast-provider-capabilities.md` — per-provider capability table.
- `docs/forecast-quality-cron-setup.md` — cron deployment recipe.
- `docs/public-api-safety-audit.md` — trust-boundary ledger across all forecast surfaces.
