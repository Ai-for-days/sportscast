# Weather Market Idea Generator

**Status:** Step 144 → Step 145. Admin-only draft generator for cross-location temperature spread markets. **Idea-only — no market is ever created or published by this surface.**

## Purpose

Surface interesting cross-location pointspread market ideas (e.g., "Dallas High −20°F vs Seattle Low") so an operator can quickly see contrasts in the forecast and decide whether to spin up a market manually. The output is a list of draft ideas with copyable title + setup notes plus a one-click "Use this idea →" link that opens the existing wager-creation form pre-filled — the operator still has to review and click Create Wager.

Step 145 added a **target-difference search workflow**: instead of "show me the most interesting spreads", the operator can ask "find me a forecasted temperature difference around 20 °F" and the generator returns city pairs whose forecasted |Δ| sits within a tolerance of the requested value, ranked by closeness.

## Strict scope

- **Admin-only.** Lives behind `requireAdmin` at `/admin/system/weather-market-ideas` and `/api/admin/system/weather-market-ideas`. No public/customer surface imports the generator or its API.
- **Idea-only.** The generator returns plain data with `status: 'idea_only'`. There is **no publish button, no draft-creation API, no one-click market creation**. To actually create a market the operator either copies the title + setup notes into the existing wager-creation form, or follows the "Use this idea" link, which opens the form pre-filled but still requires manual submission.
- **Read-only forecasts.** Reads forecasts via the existing `getForecast()` helper (Open-Meteo by default). Does not invoke any wager / pricing / settlement / wallet / grading code path.
- **No persistence.** Each "Generate" click recomputes from current forecasts. No store, no retention.
- **No customer copy leaks.** The generator's titles and rationale are admin-only. Nothing here renders on the public weather page.

## Inputs

| Field | Type | Required | Notes |
|---|---|---|---|
| `targetDate` | `YYYY-MM-DD` | one of `targetDate`/`dayOffset` | Must be within 5 days of "today" to be considered reliable; the generator emits a warning beyond that. |
| `dayOffset` | integer | one of `targetDate`/`dayOffset` | Resolved against UTC noon. Capped 0–14 by the API. |
| `targetDifferenceF` | number | optional | Switches to target-difference search. Range 0–80. |
| `toleranceF` | number | optional | °F window around `targetDifferenceF`. Range 0–20. Defaults to 3. |
| `metricPair` | enum | optional | One of `any_temperature_pair` (default), `high_vs_high`, `low_vs_low`, `high_vs_low`. |
| `cityIds` | string[] | optional | Subset of `forecast-quality-seed-cities.ts` (12 US cities). Defaults to all. |
| `maxResults` / `maxIdeas` | number | optional | Cap on returned ideas. Range 1–100. Defaults to 20. |

## Modes

### 1. "Most interesting" mode (legacy, Step 144)

When `targetDifferenceF` is unset:

1. Pluck the daily forecast entry matching `targetDate` from each city's hourly→daily aggregation.
2. Compute `rawDifference = forecastValueA − forecastValueB`.
3. Skip pairs where `|rawDifference| < 8°F`.
4. Score `interestingnessScore = |rawDifference| + (sameRegion ? -3 : +2)` so cross-region contrasts rise.
5. Sort by `interestingnessScore` descending and return the top `maxResults` ideas.

### 2. Target-difference search (Step 145)

When `targetDifferenceF` is set:

1. Same per-pair candidate generation.
2. Filter to pairs where `|absDelta − targetDifferenceF| ≤ toleranceF`.
3. Rank by closeness (smaller distance from target wins). The legacy `interestingnessScore` field is repurposed to `−closenessToTarget × 10 + region_bonus` so callers that sort descending still see the closest pair first.
4. Each idea also carries a literal `closenessToTarget: number` (°F off the requested target) for the UI.

### Metric pair option

| Value | Pairs considered |
|---|---|
| `high_vs_high` | A.high vs B.high |
| `low_vs_low` | A.low vs B.low |
| `high_vs_low` | A.high vs B.low (cross-metric) |
| `any_temperature_pair` | all three of the above |

Cross-metric pairs (high vs low) are now first-class. With Step 145 the `PointspreadWager` schema supports per-side `metricA` / `metricB`, so the operator can publish a market like "Dallas High vs Seattle Low" without extending the model. The generator emits a soft warning on cross-metric ideas reminding the operator to verify both per-side metrics are populated when they hit Create Wager.

## Output shape

```ts
interface WeatherMarketIdea {
  id: string;
  title: string;                   // "Dallas High -20°F vs Seattle Low"
  description: string;             // Long-form draft description
  kind: 'pointspread';
  locationA: { id, label, lat, lon, region };
  locationB: { id, label, lat, lon, region };
  metricA: 'daily_high' | 'daily_low';
  metricB: 'daily_high' | 'daily_low';
  targetDate: string;              // YYYY-MM-DD
  forecastValueA: number;          // °F, rounded
  forecastValueB: number;
  rawDifference: number;           // signed (A - B), rounded
  absDifference: number;           // |rawDifference|, rounded
  suggestedSpread: number;         // -rawDifference
  suggestedOddsA: number;          // -110
  suggestedOddsB: number;
  confidenceLabel: 'higher' | 'medium' | 'lower';
  rationale: string;               // One-sentence explanation
  warnings: string[];              // Cross-metric, beyond-horizon, etc.
  status: 'idea_only';
  setupNotes: string;              // Copyable block for the wager-creation form
  interestingnessScore: number;    // Sort key (mode-dependent — see above)
  closenessToTarget?: number;      // Step 145: only set in target mode (°F off)
  prefillQuery: string;            // Step 145: querystring for /admin/wagers
}
```

## Assisted manual creation

Step 145 added a "Use this idea →" link on every idea card. The link points at `/admin/wagers?<prefillQuery>` and opens the existing wager-creation form prefilled with:

- `prefillKind=pointspread`
- `prefillMetric` + `prefillMetricA` + `prefillMetricB` (per-side metrics for cross-metric markets)
- `prefillLocationA` / `prefillLocationB` + their lat/lon
- `prefillSpread`, `prefillLocationAOdds`, `prefillLocationBOdds`
- `prefillDate`, `prefillTitle`

The operator must still review the form and click **Create Wager** — there is no auto-publish.

## Limitations

- Temperature spreads only. Wind, gust, precipitation are deferred (see Future extensions).
- 12 seeded US cities only — no nationwide scan in this build. The `resolveCandidateCities` helper accepts a `set` argument so future expansion (`top-50`, `all-supported`, region filters) plugs in without changing the generator's hot path.
- Forecast horizon ≤ 5 days. Beyond that, ideas carry a warning.
- No exposure-aware filtering — the generator doesn't know whether a similar market already exists.
- No Kalshi/Polymarket comparison-aware ranking yet.
- No exact-integer-push avoidance (`-20°F` exactly will result in a push if observed Δ is exactly 20°F). Operator can adjust manually at creation time.
- Single-snapshot forecast — no revision-aware ranking.

## Future extensions

When the generator earns its place, the obvious upgrades are:

- **Rain spreads.** Probability or accumulation contrasts between cities.
- **Wind spreads.** Sustained or gust contrasts.
- **City rivalry templates.** Predefined city pairs with custom storylines (e.g., NFL rival cities for Sunday weather contrasts).
- **Top-50 / all-supported candidate sets.** Wire `resolveCandidateCities({ set: 'top-50' })` once the city catalog is curated.
- **Kalshi / Polymarket comparison-aware ranking.** Re-rank ideas by whether the same metric has an active external market — surface ideas that *don't* duplicate external venues.
- **Exposure-aware filtering.** Read recent house exposure and de-prioritize ideas that pile concentration onto a metric the book is already long.
- **One-click draft creation** behind the existing operator-approval gate. Only after confidence in the heuristic is established.

## Settlement boundary

This module reads forecasts. It writes nothing to the wager / bet / wallet / grading / settlement stores. Markets continue to resolve via `nws-grading.ts` / `nws-observations.ts` regardless of whether an idea here is acted on.

Step 145 added a per-side metric lookup in `gradePointspreadWagerFull` so cross-metric pointspreads grade correctly: side A reads `wager.metricA ?? wager.metric` and side B reads `wager.metricB ?? wager.metric`. The NWS observation source, observation aggregation, settlement mutation workflow, wallet/balance workflow, and grading approval process are all unchanged.
