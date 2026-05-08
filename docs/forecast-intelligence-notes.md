# Forecast Intelligence Notes

**Status:** Phase 2 live — Step 129 added confidence/volatility/trend; Step 130 added revision tracking; Step 131 added the chronological revision timeline; Step 132 connects all of the above to a neutral market-context card above the weather markets. All heuristic, public-facing, intentionally lightweight, **no betting advice ever**.

## 1. Purpose

`src/lib/forecast-intelligence.ts` derives three lightweight signals from the forecast payload we already fetch for the weather page:

- **Confidence** — `high` / `moderate` / `low`. How settled the forecast looks.
- **Volatility** — `stable` / `shifting` / `volatile`. How much hour-to-hour movement the next 24 hours carry.
- **Trend** — `warming` / `cooling` / `wetter` / `drier` / `windier` / `calming` / `stable`. Where the next several days are pointing.

Plus a freshness label and a flag for "active severe alert is shaping confidence."

## 2. Design philosophy

This is *not* meteorology tooling. It is intentionally:

- **Heuristic** — simple thresholds, no model output, no ensemble math.
- **Plain-English** — every state has a one-sentence explanation safe to render directly.
- **Calm** — a 3-tone palette (emerald / amber / orange), no neon trading-terminal aesthetics.
- **Quiet** — three small chips and two short sentences. No giant dashboard.

If we ever pretend to scientific certainty here we lose the user's trust faster than we'd gain it. Better to ship "Forecast trending warmer — highs near 78°F over the next several days" with no error bar than to invent confidence intervals we can't justify.

## 3. Heuristics in force (Step 129)

### Confidence
Starts at `high`, downgraded once per condition that fires:
- Active Severe/Extreme weather alert.
- Daily highs swing ≥ 25 °F across the visible 7-day horizon (large variance ≈ less certain).
- Hourly temperature standard deviation over the next 24 h ≥ 9 °F (near-term spread).
- Forecast `generatedAt` is more than 12 hours old.

Floor is `low`. Two downgrades from `high` lands at `low`.

### Volatility
For the next 24 h, we compute mean absolute hour-to-hour delta on temperature, precipitation probability, and wind speed. Each axis scores 0/1/2 against fixed thresholds; the maximum score wins:
- Temp delta: ≥ 4 °F → 2, ≥ 2 °F → 1.
- Precip probability delta: ≥ 20 pp → 2, ≥ 10 pp → 1.
- Wind delta: ≥ 8 mph → 2, ≥ 5 mph → 1.

Score 2 → `volatile`. Score 1 → `shifting`. Score 0 → `stable`. The dominant axis chooses the explanation copy.

### Trend
Compare day 1 to day 5 (or last available, when the daily array is shorter). Each axis emits a candidate trend if it crosses ±8 °F, ±20 pp, or ±8 mph. We sort by priority (precipitation > temperature > wind), then emit up to two. If nothing crosses, we emit a single `stable` trend.

### Freshness
`Date.now() - Date.parse(forecast.generatedAt)`, formatted to "Just updated" / "Updated X minutes ago" / "Updated X hours ago" / "Updated X days ago". Only displayed when `generatedAt` is present and parseable.

## 4. Trust boundary

Step 129 is informational/UI-only:

- No public/customer API shape changed.
- No `PublicWagerView`, `SafeCustomerBetView`, sanitizer, allow-list, grading, settlement, wallet, Kalshi, Polymarket, or admin behavior touched.
- The intelligence summary is computed server-side from the same `ForecastResponse` already fetched for the page and serialized to the React component as JSON.
- No Polymarket/Kalshi/admin/risk fields cross into this surface.

## 4b. Revision tracking (Step 130)

We persist a compact snapshot of the public forecast every time a unique upstream run is observed for a location, then compare new runs against the previous one to surface a calm "what changed" summary.

### Snapshot store

- `src/lib/forecast-revision-store.ts` (server-only). Redis-backed. Browser-import throws.
- Keys: `forecast-revision-snapshot:<id>` (JSON record) + `forecast-revision-snapshots:<locationKey>` (sorted set, score = capture timestamp ms).
- Location key: postal-code preferred (`us:29209`); falls back to coarsely-rounded coordinates (`coord:34.00,-81.03`) so nearby Use-My-Location reads collapse to one series.
- Retention: latest 30 snapshots per location. Roughly 1 KB per snapshot ⇒ ~30 KB per location.
- Snapshot payload is intentionally compact: next-7-day daily highs/lows, precip probability, wind speed, plus the Step 129 intelligence summary and a single severe-alert boolean. **No raw weather payload, no PII, no betting data, no admin or external-venue fields.**
- Deduplicated by upstream `generatedAt` — repeated views of the same forecast run never produce extra writes.

### Comparison thresholds

`diffSnapshots(prior, current)` checks five axes and emits up to ten distinct change kinds:

| Axis | Threshold | Kinds emitted |
|---|---|---|
| Severe alerts | presence add/remove | `severe_added` / `severe_removed` |
| Combined stability (confidence + volatility) | direction change | `more_stable` / `less_stable` |
| 3-day max precipitation probability | ±15 pp | `wetter` / `drier` |
| 3-day average wind speed | ±4 mph | `windier` / `calming` |
| 3-day average daily high | ±4 °F | `warming` / `cooling` |

`buildRevisionSummary(prior, current)` priority-sorts the kinds, keeps the top three, and produces a friendly headline ("Rain chances increased since this morning."). `comparedLabel` resolves the prior capture time to a narrative phrase ("in the last hour" / "since this morning" / "since yesterday" / "X days ago").

### Surface

`src/components/forecast/ForecastRevisionSummary.tsx` mounts directly beneath `ForecastIntelligenceCard` on `[...slug].astro`. It renders nothing on the very first observation for a location (no prior snapshot = no useful comparison). When prior exists but the upstream `generatedAt` is unchanged, it shows "No new forecast run … outlook unchanged." When real changes are detected, it shows a chip strip + headline + optional bullet list.

The capture/compare runs in the page frontmatter; if Redis is unreachable in this environment we silently fall back to `isInitial` and the component renders nothing — page never fails because of revision tracking.

## 4c. Revision timeline (Step 131)

Step 130 surfaces "what changed in the most recent run." Step 131 surfaces "what came before that," as a calm chronological list under the revision card.

### Where the data comes from

- `src/lib/forecast-revision-store.ts` gained `listSnapshots(locKey, limit)` — bounded latest-first retrieval. The slug page asks for the last 12 snapshots per location. The same `MAX_SNAPSHOTS_PER_LOCATION = 30` retention enforced in Step 130 is the hard ceiling.
- `src/lib/forecast-timeline.ts` walks consecutive snapshot pairs (newest first). Each pair is diffed via the same `diffSnapshots` heuristic from Step 130. Pairs with zero meaningful changes are skipped — the timeline is intentionally sparse, not noisy.

### What the timeline shows

- By default the most-recent pair (`s[0]`, `s[1]`) is **skipped** because the Step 130 ForecastRevisionSummary card already covers that delta. Callers can override via `skipMostRecentPair: false`.
- Up to 6 entries are surfaced. Each entry has `{ relativeLabel, headline, detail (≤2 bullets), importance, primaryKind, changes }`.
- A one-line `narrativeSummary` lead summarizes the chain. Examples:
  - "Severe weather risk has shaped the recent forecast."
  - "Forecast volatility has been increasing recently."
  - "Forecast has been stabilizing over recent updates."
  - "Recent forecast updates have trended warmer."
  - "Forecast has remained relatively steady recently." (when nothing meaningful in the chain)

### Importance buckets

- `high` — any `severe_added`.
- `medium` — `less_stable`, `severe_removed`, `wetter`, `windier`.
- `low` — everything else.

The component dot tone follows the importance × primary-kind cross-product: orange for high (severe), emerald for stabilizers, amber for less-stable, sky for everyday movement. No neon trading-terminal aesthetics.

### Surface

`ForecastTimeline.tsx` mounts directly under `ForecastRevisionSummary` on `[...slug].astro`. First three entries visible; "Show N more / Show less" toggle expands the rest. Renders nothing when the timeline has zero entries — the page stays breathable for first-time visitors and locations with quiet forecasts.

The capture/list is wrapped in the same defensive try/catch from Step 130; Redis-unreachable falls through to an empty timeline.

## 4d. Market context (Step 132)

A small card sits directly above the weather markets on the slug page and explains, in plain English, when recent forecast movement may matter for the markets shown. **Strictly informational** — never advice.

### Language guardrails

The `weather-market-context.ts` module enforces by construction:

- No string says or implies the user should bet.
- No reference to "edge", "profit", "value", "expected value", or "mispriced".
- No claim that any market is more or less likely to win.
- Every output carries the disclaimer "This is forecast context, not betting advice."

### Branch logic (priority-ordered)

1. **Quiet fallback.** No history, high confidence, stable volatility, no severe alert → `isEmpty: true` → component renders nothing.
2. **Severe-weather signal** (active alert or `severe_added` in revision/timeline) → tone `uncertain`, "Conditions may be changing quickly". Affected kinds: severe + temperature + precipitation + wind.
3. **Volatile / low confidence** → tone `uncertain`, "Forecast has been shifting". Affected kinds derived from the dominant axes that have moved.
4. **Single-axis movement** — checked in priority order:
   - Wetter or drier → tone `watch`, "Rain timing may matter" / "Drier trend may matter". Affected: precipitation.
   - Warming or cooling → tone `watch`, "Temperatures trending warmer/cooler". Affected: temperature.
   - Windier or calming → tone `watch`, "Wind forecast strengthening/easing". Affected: wind.
5. **Default steady** → tone `steady`, "Forecast has been relatively steady". A calm reassurance — useful even when nothing is moving.

### Surface

`WeatherMarketContextCard.tsx` mounts above `ForecastWagers`. Three tone surfaces (stable / soft-amber / soft-orange) match the chip palette used by the Step 129–131 cards. Renders nothing on `isEmpty`. The disclaimer is part of the component, not a prop, so it can never be omitted by accident.

### What this is *not*

- It does not consume `PublicWagerView`, pricing, odds, or any market metadata. The context summary is purely forecast-derived.
- It does not adjust grading, settlement, wallet, or any operator/admin behavior.
- It does not surface Kalshi or Polymarket data on a public page.

## 5. Future expansion

When this surface earns its place, the obvious upgrades are:

- **Ensemble disagreement.** Pull a second model (GFS vs. ECMWF, say) and surface their spread as a confidence input. The `confidence` token already accommodates this — we'd just feed an additional factor into `computeConfidence`.
- **Public revision-history visualization.** The Step 131 timeline is text-only. The 30-snapshot store also supports a sparkline view per axis ("Saturday's forecast high has been climbing all week"). Same data; different presentation.
- **Line movement intelligence (operator-only).** Cross-reference snapshot deltas with WagerOnWeather's posted lines and Kalshi/Polymarket's external prices. Admin-only, behind `requireAdmin`.
- **Volatility-aware wager pricing.** Operator-only: feed the volatility level into pricing recommendations. Admin-only — never exposed on customer surfaces.
- **Operator volatility alerts.** When a location's stability score drops two levels between runs, fire an admin notification through the existing audit/inbox stack.

None of these change the public trust boundary — they all extend the heuristic with more inputs while keeping the same `ForecastIntelligenceSummary` shape.

## 6. What this is not

- Not a basis for grading or settlement. Markets resolve on the documented observation source (NWS / Open-Meteo / etc.), not on confidence heuristics.
- Not a basis for automated trading or hedging on Kalshi/Polymarket.
- Not a forecast in itself. It's a *summary* of the forecast we already show.
