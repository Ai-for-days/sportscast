# Forecast Divergence Intelligence Engine (Step 165)

**Admin-only operator intelligence. Not customer-facing. Not betting advice.**

A deterministic, side-effect-free engine that compares forecast snapshots for a `(location, target date, metric)` series and produces a structured signal an operator can use to decide whether a weather market warrants a closer look.

## What it answers

> "For Columbia, SC, the high temperature on 2026-06-01: how much have forecasts disagreed? How volatile has the trajectory been? How risky would settlement be? Is this an opportunity to surface in the daily brief?"

## Non-goals (load-bearing)

- **No autonomous publishing / pricing / grading / settlement / market creation.** The engine is read-only.
- **No customer surface.** The API + page sit behind `requireAdmin`. The Step 159 / 160 brief + digest do not (yet) consume this signal — future steps can wire it in non-invasively.
- **No external API calls, no AI / LLM, no mailer.** Pure scoring + a Redis read from the existing Step-132 snapshot store.
- **No new persistence.** The engine only **reads** the existing `forecast-revision-snapshot:*` store. It does not write to it.
- **No replacement of Step 156 interestingness scoring or Step 160 generation modes.** Divergence is an *additional* signal, not a substitute.

## Architecture

```
src/lib/forecast-divergence.ts                   ← pure scoring engine + types
src/pages/api/admin/system/forecast-divergence.ts ← admin API (analyze / analyze-stored)
src/components/admin/ForecastDivergenceCard.tsx   ← presentational result card
src/components/admin/ForecastDivergenceInspector.tsx ← inspector page UI
src/pages/admin/system/forecast-divergence.astro  ← admin page
```

## Data flow

1. Operator opens `/admin/system/forecast-divergence`.
2. Picks `stored` mode (default) → enters `zip` (or lat/lon) + target date + metric.
3. UI calls `POST /api/admin/system/forecast-divergence` with `action=analyze-stored`.
4. API resolves the `locationKey` via the existing `forecast-revision-store.locationKey()` helper, reads up to 12 (configurable to 30) snapshots via `listSnapshots(locKey)`.
5. Each stored `ForecastSnapshot` is projected to a `(forecastTime, value)` pair by pulling `daily[targetDate].{highF | lowF | precipProbability | windSpeedMph}` depending on the metric.
6. `calculateForecastDivergence(input)` runs deterministically — no further I/O.
7. Result is returned + rendered in `ForecastDivergenceCard`.

For ad-hoc what-if analysis, operators can switch to `manual` mode and supply up to 30 `(forecastTime, value)` rows directly.

## Scoring

### Per-metric thresholds (verbatim from Step 165 spec)

| Metric | low | moderate | high | severe |
|---|---|---|---|---|
| `high_temp` / `low_temp` | ≤ 2°F | ≤ 5°F | ≤ 9°F | > 9°F |
| `precipitation_probability` | ≤ 10 pp | ≤ 25 pp | ≤ 40 pp | > 40 pp |
| `wind_speed` | ≤ 4 mph | ≤ 9 mph | ≤ 15 mph | > 15 mph |

### Raw magnitudes

- `spread = max(values) − min(values)` across the snapshot series.
- `volatility = mean(|consecutive_revisions|)` (snapshots sorted by `forecastTime` ascending).
- `revisionMagnitude = max(|consecutive_revisions|)`.

### 0–100 normalization

Each raw magnitude is converted to a 0-100 score by the metric's saturation point:

| Metric | Score formula | Saturates at |
|---|---|---|
| `high_temp` / `low_temp` | `min(100, magnitude × 10)` | 10°F |
| `precipitation_probability` | `min(100, magnitude × 2.5)` | 40 pp |
| `wind_speed` | `min(100, magnitude × 6.25)` | 16 mph |

### Stability label

| Score (max of divergence/volatility) | Label |
|---|---|
| 0–24 | `stable` |
| 25–49 | `watch` |
| 50–74 | `unstable` |
| 75–100 | `highly_unstable` |

### Settlement risk

Driven by `max(divergence, volatility) + horizon_bonus + noise_bonus`:

- `horizon_bonus = max(0, min(20, (daysUntilTarget − 1) × 4))` — uncertainty stays high when the target is far off.
- `noise_bonus`: precipitation = +15, wind = +8, temperature = 0 — precipitation is the historically noisiest metric.

Thresholds: `≥ 70 → high`, `≥ 40 → medium`, else `low`.

### Opportunity signal

`base = (divergence + volatility) / 2`.

- When `settlementRisk === 'high'`: capped at `medium` (`≥70 → medium`, otherwise `low`) — the operator can't price an opportunity cleanly when the settlement is operationally unclear.
- Otherwise: `≥ 65 → high`, `≥ 35 → medium`, else `low`.

### Explanation + reasons

`buildForecastDivergenceExplanation(result)` composes a single sentence summarizing the stability label + metric + city + date, the spread/volatility/max-revision numbers, and the settlement-risk / opportunity-signal pair.

`reasons[]` is an ordered bullet list of *why* each classifier landed where it did. Always present; suppressed only when the input has fewer than two snapshots (then `reasons = ['insufficient_snapshots']`).

## Graceful degradation

- Fewer than 2 snapshots → returns a fully-shaped result with `stable / low / low` defaults and `reasons: ['insufficient_snapshots']`. UI surfaces an amber strip explaining why.
- Snapshot store read failure → API returns `500 snapshot_store_failed` cleanly; the inspector renders the error.
- Stored snapshots exist but none have a matching `daily[targetDate]` entry → engine still runs against the empty projected list and degrades to insufficient-data defaults.

## Safety greps

```
no `createWager | voidWager | gradeWager | publishWager | settleWagerBets | markDraftPublished`
no `walletConnect | sendTransaction | privateKey | createOrder | placeOrder`
no `nodemailer | sendgrid | mailgun | resend | smtp`
no `crypto-paper | crypto_paper | cryptokie | crypto-trade`
no prohibited gambling vocabulary: `edge | profit | value bet | should bet | likely winner | easy money | lock`
```

All zero hits in `src/lib/forecast-divergence.ts`, `src/pages/api/admin/system/forecast-divergence.ts`, and both React components.

## Out of scope (deferred)

- Cross-provider divergence (WeatherNext vs Open-Meteo) — engine accepts a `source` field per snapshot, but the snapshot store currently stamps only the live default provider's `generatedAt`. When WeatherNext is wired into the snapshot pipeline, multi-source divergence will surface naturally with no engine change.
- Automatic integration into the Step 159 daily brief / Step 160 digest. Step 165 ships the engine + standalone inspector; future steps can wire `calculateForecastDivergence` into the brief's section builders.
- Auto-fetch of fresh forecasts to seed an empty snapshot series — the engine works against whatever the existing snapshot pipeline has captured.
- Snowfall metric — not in the snapshot daily schema today.
