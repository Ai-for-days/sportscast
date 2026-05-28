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

## Step 166 — Integration with the daily brief + digest

Step 166 wires the Step 165 engine into the Step 159 daily brief + Step 160 digest renderer **without rewriting either**. New module:

```
src/lib/forecast-divergence-watch.ts   ← bounded helper: top-N watch entries
```

`buildForecastDivergenceWatch({ now? })` reads up to 50 recent active saved ideas (Step 146), filters to those with `targetDate` ≤ 10 days out, then for each side (A + B) of the idea:

1. Builds a `locationKey` from the side's `(lat, lon)` via the existing `forecast-revision-store.locationKey` helper.
2. Reads up to 12 snapshots via `listSnapshots(locKey)` (per-locationKey memoized within the build).
3. Projects each snapshot's `daily[targetDate].{highF | lowF | precipProbability | windSpeedMph}` to the requested metric.
4. Runs `calculateForecastDivergence` — the unchanged Step 165 engine.
5. Drops "trivial" results (every signal at the calmest setting).
6. Returns the top 8 entries sorted per Step 166 spec: opportunity high first → unstable first → divergence desc → volatility desc → low settlement risk first on ties.

Hard caps: `MAX_IDEAS_TO_ANALYZE=15`, `MAX_WATCH_RESULTS=8`, `SNAPSHOTS_PER_LOCATION=12`. Per-locationKey snapshot memoization avoids paying the Redis cost twice for ideas sharing a city. The helper never throws — Redis failures degrade to an empty list.

### Daily brief integration (`weather-market-daily-brief.ts`)

- New `forecastDivergenceWatch: BriefItem[]` field on `WeatherMarketDailyBrief`.
- New `divergenceWatch` entry in `counts` + `subsystemStatus`.
- New `loadDivergenceWatch(now)` runs in parallel with the existing six subsystem loaders inside `Promise.all`.
- New `buildForecastDivergenceSection(entries)` maps each watch entry to a `BriefItem` with title `"<city> · <metric> · <date>"`, subtitle `"<stability> · div N/100 · vol N/100 · settlement L · opportunity L"`, and meta showing `spread`, `maxRevision`, `snapshots`, `side`. Link points to `/admin/system/forecast-divergence`.
- React component renders a new "3b. Forecast Divergence Watch" section right after Risk Alerts, plus a new "Divergence watch" chip in the counts strip.

### Digest renderer integration (`weather-market-digest-renderer.ts`)

- New `forecastDivergenceWatch` entry added to the `SECTIONS` table — same HTML + plaintext rendering path as every other section. Title "Forecast Instability Highlights"; empty copy "No actionable divergence signals right now."
- `buildSubject` appends `· N divergence` when `counts.divergenceWatch > 0`.

### What Step 166 does *not* change

- **No engine logic changes.** `calculateForecastDivergence` and friends in `src/lib/forecast-divergence.ts` are imported as-is. Scoring formulas, threshold tables, stability classifiers, settlement risk classifier, opportunity classifier — all unchanged.
- **No rewrite of the Step 160 generation modes / diversity re-ranker / digest renderer.** A new section is appended to the existing `SECTIONS` table.
- **No new persistence.** The watch helper only reads from the existing `weather-market-idea-store` (Step 146) and `forecast-revision-store` (Step 132).
- **No new API endpoint.** Step 165's `/api/admin/system/forecast-divergence` already serves the inspector; the daily brief calls the watch helper directly from its server-side aggregator.
- **No customer surface.** Watch entries flow through `BriefItem`s that the brief admin page already renders behind `requireAdmin`. The digest preview page (`/admin/system/weather-market-daily-digest`) is also admin-gated.

## Out of scope (still deferred)

- Cross-provider divergence (WeatherNext vs Open-Meteo) — engine accepts a `source` field per snapshot, but the snapshot store currently stamps only the live default provider's `generatedAt`. When WeatherNext is wired into the snapshot pipeline, multi-source divergence will surface naturally with no engine change.
- Saved idea / draft review screen integration — Step 166 spec marks this optional; the daily brief + digest paths are the load-bearing surfaces. A compact `ForecastDivergenceMiniCard` for embedded display can be added in a later step when a saved-idea or draft review page is identified as the right host.
- Auto-fetch of fresh forecasts to seed an empty snapshot series — the engine works against whatever the existing snapshot pipeline has captured.
- Snowfall metric — not in the snapshot daily schema today.
