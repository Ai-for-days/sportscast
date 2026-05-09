# Forecast Provider Promotion Checklist

**Status: NOT READY**

Default status is `NOT READY` and cannot be flipped without a human filling this checklist out and an operator signoff. The default in `src/lib/forecast-source.ts` (`'open-meteo'`) is the safe baseline; promoting any other provider to default requires deliberate code change after this checklist clears.

Settlement always uses NWS observations (`nws-grading.ts` / `nws-observations.ts`) regardless of forecast-provider state. This checklist exists to govern *what users see on the weather page*, not how markets resolve.

---

## Status definitions

| Status | What it means | What you can do |
|---|---|---|
| **NOT READY** | Default state. Critical contract or implementation work remains. | Continue Step 141 / 142 / 143 documentation work. No env or code change. |
| **CONDITIONAL** | Contract resolved + client implemented + smoke tests passing but quality signal still accumulating. | Validate via the comparison harness; do not change `forecast-source.ts` default. |
| **READY FOR LIMITED ROLLOUT** | Quality signal stable for one 7d window across the seed cities. | Operators may set `FORECAST_PROVIDER=<candidate>` on internal/staging environments only — no customer-facing change. |
| **READY FOR DEFAULT SWITCH** | Two consecutive 7d windows + a 30d window of stable signal, no rollback triggers active. | Eligible to flip the default in `forecast-source.ts`. Requires operator signoff in this doc. |

---

## Candidate

- Provider id: ___________________________________
- Date opened: ___________________________________
- Operator: ______________________________________

---

## §1 Contract confirmation

- [ ] Every UNCONFIRMED row in `docs/weathernext-contract-readiness.md` §1 is now Confirmed against authoritative Google / Vertex AI / DeepMind documentation (links recorded in the readiness doc, not assumed).
- [ ] §2 (Vertex AI request URL, auth, IAM, quota, latency) confirmed.
- [ ] §3 (forecast variables) confirmed; each required UI field is present in the production schema (or the field is explicitly marked `derived`/`absent` in `forecast-provider-metadata.ts`).
- [ ] §4 (commercial terms, attribution, billing) confirmed.
- [ ] `WEATHERNEXT_CONTRACT_CONFIRMED` (Vertex AI) or `WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED` (BQ production) flipped to `true` only because §1–§4 are resolved — not as a workaround.

## §2 Implementation

- [ ] Inference / query body implemented in `src/lib/weathernext-client.ts` or `src/lib/weathernext-bigquery-production-client.ts`.
- [ ] Field mapping into `ForecastResponse` mirrors `open-meteo.ts` (every required field populated; units converted; `generatedAt` is the *real* model run timestamp, not `new Date().toISOString()`).
- [ ] `forecast-provider-metadata.ts` updated to reflect *real* per-field quality (`'real'` only when the production response actually carries the field).
- [ ] 1500 ms client timeout retuned against measured p99 if needed.

## §3 Readiness panel (Methodology tab)

- [ ] WeatherNext readiness badge: green (`ready`).
- [ ] WeatherNext BigQuery readiness badge: green (`ready`) — only required if BQ production is the candidate.
- [ ] Both `contractConfirmed` flags read `yes`.

## §4 Smoke tests

- [ ] At least 3 consecutive `live_call_ok` results at different times of day.
- [ ] No `live_call_failed` in the same window.
- [ ] `responseFingerprint` shows sane values (hourly count > 24, current temp within plausible range for the location).
- [ ] No schema-mismatch or auth-error notes in the latest result.

## §5 Seeded reports

- [ ] ≥ 14 daily quality reports in the store that include the candidate provider.
- [ ] Latest report: ≥ 10 of 12 seed cities scoring successfully on the candidate.
- [ ] No persistent failures concentrated on a single seed city for the candidate that aren't also affecting Open-Meteo (rules out provider-specific regional bugs).

## §6 7d trend (Trend Dashboard → 7d window)

- [ ] Candidate's mean |Δtemp| within 1.5°F of Open-Meteo (or better).
- [ ] Candidate's weak-bucket rate ≤ Open-Meteo + 5pp.
- [ ] Candidate's unavailable rate ≤ 10%.
- [ ] Mean |Δtemp| direction label is not `degrading`.
- [ ] Wind / gust direction labels not `degrading`.
- [ ] No `severity: warning` insights for the candidate.

## §7 30d trend (Trend Dashboard → 30d window)

- [ ] Same thresholds as §6, computed over 30 days.
- [ ] Two consecutive 7d windows have already passed §6 (the 30d window is the third confirmation, not the only one).

## §8 Cron state

- [ ] `lastSeededComparisonStatus`: `ran` (or `skipped` for legitimate cadence-guard reasons).
- [ ] `lastQualityReportStatus`: `ran`.
- [ ] `lastFailureSummary`: empty, or stale (older than the last successful run on both axes).

## §9 Rollback plan

- [ ] Documented one-line rollback step: edit `src/lib/forecast-source.ts` default from the candidate back to `'open-meteo'`, push.
- [ ] Confirmed Open-Meteo continues to render correctly when the candidate env is unset.
- [ ] Cron + customer page tested with the candidate set on staging.

## §10 Operator signoff

- [ ] Reviewed by: ___________________________________
- [ ] Date: __________________________________________
- [ ] Status set to: NOT READY / CONDITIONAL / READY FOR LIMITED ROLLOUT / READY FOR DEFAULT SWITCH
- [ ] Acknowledgement: "I have read `docs/forecast-provider-operations-runbook.md` §5–§8 (promotion criteria, rollback, interpretation cautions, safety rules) and confirm the candidate meets every applicable threshold. I understand that NWS observations remain the settlement source regardless of forecast-provider state."

---

## What this checklist does NOT cover

- Anything about market settlement. `nws-grading.ts` is governed separately.
- Anything about pricing, wallet, betting, Kalshi, or Polymarket.
- Customer-facing copy changes (handled in the per-step audit notes).
- Public-default for non-WeatherNext providers — Open-Meteo is the live default and any change to it should follow the same checklist with the candidate replaced.
