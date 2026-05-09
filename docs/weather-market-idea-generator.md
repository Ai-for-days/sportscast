# Weather Market Idea Generator

**Status:** Step 144. Admin-only draft generator for cross-location temperature spread markets. **Idea-only — no market is ever created or published by this surface.**

## Purpose

Surface interesting cross-location pointspread market ideas (e.g., "Waco High −20°F vs Walla Walla Low") so an operator can quickly see contrasts in the forecast and decide whether to spin up a market manually. The output is a list of draft ideas with copyable title + setup notes — nothing more.

## Strict scope

- **Admin-only.** Lives behind `requireAdmin` at `/admin/system/weather-market-ideas` and `/api/admin/system/weather-market-ideas`. No public/customer surface imports the generator or its API.
- **Idea-only.** The generator returns plain data with `status: 'idea_only'`. There is **no publish button, no draft-creation API, no one-click market creation**. To actually create a market the operator copies the title + setup notes into the existing wager-creation form.
- **Read-only forecasts.** Reads forecasts via the existing `getForecast()` helper (Open-Meteo by default). Does not invoke any wager / pricing / settlement / wallet / grading code path.
- **No persistence.** Each "Generate" click recomputes from current forecasts. No store, no retention.
- **No customer copy leaks.** The generator's titles and rationale are admin-only. Nothing here renders on the public weather page.

## Inputs

- `targetDate` — `YYYY-MM-DD`. Required. Must be ≤ 5 days ahead of "today" to be considered reliable; the generator emits a warning beyond that.
- `cityIds` — optional subset of `forecast-quality-seed-cities.ts` (12 US cities). Defaults to all.
- `maxIdeas` — cap on returned ideas. Defaults to 20.

## Idea-generation logic (Step 144 v1)

For every ordered pair of selected cities and for each metric pair (high/high, low/low, high/low):

1. Pluck the daily forecast entry matching `targetDate` from each city's hourly→daily aggregation.
2. Compute `rawDifference = forecastValueA − forecastValueB`.
3. Skip pairs where `|rawDifference| < 8°F` (interestingness floor — anything tighter is too noisy to be a market).
4. Compute `suggestedSpread = -round(rawDifference)` so the higher side carries the negative spread.
5. Default odds: −110 / −110.
6. Score `interestingnessScore = |rawDifference| + (sameRegion ? -3 : +2)` so cross-region contrasts rise.

After generation, the generator sorts by `interestingnessScore` descending and returns the top `maxIdeas` ideas.

### Cross-metric pairs (high vs low)

The current `PointspreadWager` schema in `src/lib/wager-types.ts` carries a single `metric` field for the whole wager. The "Waco High vs Walla Walla Low" example needs **different metrics per side**, which the existing model can't represent. Cross-metric ideas are still generated and surfaced, but each carries a warning:

> Cross-metric spread (high vs low). The current PointspreadWager schema carries a single metric — extend the wager model before publishing this kind of market.

The operator sees the idea and can decide whether to extend the schema (a separate code change) or stick to same-metric ideas for now.

## Output shape

```ts
interface WeatherMarketIdea {
  id: string;
  title: string;                   // "Waco High -20°F vs Walla Walla Low"
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
  suggestedSpread: number;         // -rawDifference
  suggestedOddsA: number;          // -110
  suggestedOddsB: number;
  confidenceLabel: 'higher' | 'medium' | 'lower';
  rationale: string;               // One-sentence explanation
  warnings: string[];              // Cross-metric, beyond-horizon, etc.
  status: 'idea_only';
  setupNotes: string;              // Copyable block for the wager-creation form
  interestingnessScore: number;
}
```

## Limitations

- Temperature spreads only. Wind, gust, precipitation are deferred (see Future extensions).
- 12 seeded US cities only — no nationwide scan in this build.
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
- **Kalshi / Polymarket comparison-aware ranking.** Re-rank ideas by whether the same metric has an active external market — surface ideas that *don't* duplicate external venues.
- **Exposure-aware filtering.** Read recent house exposure and de-prioritize ideas that pile concentration onto a metric the book is already long.
- **One-click draft creation** behind the existing operator-approval gate. Only after confidence in the heuristic is established and after the cross-metric wager-model extension lands.

## Settlement boundary

This module reads forecasts. It writes nothing to the wager / bet / wallet / grading / settlement stores. Markets continue to resolve via `nws-grading.ts` / `nws-observations.ts` regardless of whether an idea here is acted on.
