# Forecast Intelligence Notes

**Status:** Phase 1 (Step 129) — heuristic, public-facing, intentionally lightweight.

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

## 5. Future expansion

When this surface earns its place, the obvious upgrades are:

- **Ensemble disagreement.** Pull a second model (GFS vs. ECMWF, say) and surface their spread as a confidence input. The `confidence` token already accommodates this — we'd just feed an additional factor into `computeConfidence`.
- **Forecast revision tracking.** Snapshot daily `highF`/`precipProbability` per location and surface "Tomorrow's high revised down 6°F since yesterday's run." Requires a Redis snapshot keyspace; still admin-/server-only inputs, customer-only output.
- **Volatility history.** Same snapshot store enables "Forecast for Saturday has been moving around for three days" — a meta-stability signal.
- **Confidence-aware market tooling.** Operator-only: surface confidence/volatility next to wager pricing recommendations. This is admin-only and lives behind `requireAdmin`.

None of these change the public trust boundary — they all extend the heuristic with more inputs while keeping the same `ForecastIntelligenceSummary` shape.

## 6. What this is not

- Not a basis for grading or settlement. Markets resolve on the documented observation source (NWS / Open-Meteo / etc.), not on confidence heuristics.
- Not a basis for automated trading or hedging on Kalshi/Polymarket.
- Not a forecast in itself. It's a *summary* of the forecast we already show.
