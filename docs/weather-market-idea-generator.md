# Weather Market Idea Generator

**Status:** Step 144 → Step 145 → Step 146 → Step 147. Admin-only draft generator + saved-idea review queue + admin draft-wager store for cross-location temperature spread markets. **No market is ever automatically created or published by this surface — every step still requires explicit operator action through the existing wager-create form.**

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

## Step 146 — Saved idea review queue

Step 146 added a persistent admin-only queue so generated ideas survive page reloads and become an actual operator workflow (generate → save → review → mark used → publish via the existing form).

### Where it lives

- **Store module:** `src/lib/weather-market-idea-store.ts` (server-only — browser import throws). Redis-backed at keys `weather-market-idea:<id>` plus a sorted set `weather-market-ideas:all`. Bounded retention: **300 saved ideas** (oldest get trimmed). The store imports nothing from wager / bet / wallet / settlement / grading / pricing / publish modules.
- **API:** Same endpoint as the generator (`/api/admin/system/weather-market-ideas`), all admin-gated. New actions:

| Method | Action | Purpose |
|---|---|---|
| GET | `bootstrap` (default) | Seed cities + metric pair options + saved-idea statuses + limits |
| GET | `list-saved-ideas` | Optional `status` filter, `limit` ≤ 300 |
| GET | `get-saved-idea` | Single saved idea by id |
| POST | `generate` | Step 144/145 generator (unchanged) |
| POST | `save-idea` | Persist a generated idea + optional `operatorNote` + optional `searchContext` |
| POST | `update-saved-idea-status` | One of `saved` / `reviewed` / `rejected` / `used` |
| POST | `update-saved-idea-note` | Update operator note (≤ 1000 chars) |
| POST | `delete-saved-idea` | Remove permanently |

- **UI:** `WeatherMarketIdeaGenerator.tsx` gained a tab switcher (Generate / Saved Ideas). The Generate tab now has a **Save idea** button next to the existing Copy / Use-this-idea actions. The Saved Ideas tab shows all ideas with status filters, an inline note editor, status-change buttons, the same Use-this-idea prefill link, and a Delete control.

### Status workflow

| Status | Meaning | Effect on duplicate detection |
|---|---|---|
| `saved` | Newly persisted, awaiting review | Counts as active — blocks identical save |
| `reviewed` | An admin has read it but not yet decided | Counts as active — blocks identical save |
| `rejected` | Decided not to publish; kept for the audit trail | **Cleared from duplicate check** — re-saving the same shape will create a new record |
| `used` | An admin published a wager from this idea | Counts as active — blocks identical save (so accidental duplicate publishes are caught) |

Status changes are recorded as audit events (`weather_market_idea_status_changed`).

### Duplicate handling

On `save-idea`, the store computes a fingerprint:

```
targetDate | locationA.id | locationB.id | metricA | metricB | suggestedSpread
```

The pair direction is preserved (A vs B ≠ B vs A) and different spreads on the same pair count as distinct ideas. If an active (non-rejected) saved idea with the same fingerprint already exists, the API returns `200 { savedIdea, isDuplicate: true, existingId }` instead of creating a second record. The UI flashes "Already saved" so the operator knows. To re-save the same shape, mark the existing one as `rejected` first.

### Quality metadata preserved

The full `WeatherMarketIdea` is frozen into the saved record at save time, including:

- `confidenceLabel` (`higher` / `medium` / `lower`)
- `rationale` (one-sentence explanation)
- `warnings` (cross-metric, beyond-horizon, etc.)
- `closenessToTarget` (when target-difference search produced it)
- `prefillQuery` (so the Use-this-idea link still works after a refresh)

The store never re-fetches forecasts. A saved idea's forecast values are accurate as of save time only — when the operator returns hours later they are reading a snapshot, not a live recompute. The UI shows the timestamps so this is unambiguous.

### Manual creation flow (still the only way to publish)

```
Generate ideas
   ↓
Save idea         ← persists snapshot only
   ↓
[review later]
   ↓
Mark reviewed / rejected / used
   ↓
Use this idea →   ← opens /admin/wagers prefilled
   ↓
Operator reviews + clicks Create Wager  ← the only place a market actually exists
```

There is no path on the saved-idea queue (or anywhere in the generator surface) that touches `createWager`, `publishWager`, `wager-store`, wallet, settlement, grading, or pricing modules. Saving an idea is a Redis write into `weather-market-idea:<id>`. Nothing else.

### What's *not* in Step 146

- No public/customer surface reads or writes saved ideas. The `/api/wagers` and `/api/bets` endpoints don't know about this store.
- No automatic forecast re-evaluation — saved ideas are snapshots.
- No saved-idea-driven cron job. The queue is purely operator-pulled.
- No bulk save / bulk publish — every save is per-idea, every publish is a manual round-trip through the wager-create form.

## Step 147 — Admin draft wagers (idea → draft, not idea → live)

Step 147 lets an operator promote a saved idea into an **admin draft wager**: a frozen `CreateWagerInput` plus provenance metadata, persisted to its own Redis namespace. **Drafts are not published.** Drafts cannot be reached by `/api/wagers`, `/api/wagers/[id]`, the public list, the customer bet path, the grading cron, the settlement workflow, or any wallet code path. The only thing a draft does is make the prepared input available to the operator for review until they take a separate explicit action to publish (out of scope for Step 147).

### Why a separate Redis namespace?

The customer-facing wager APIs read from `wager:<id>` plus the `wagers:by-status:*` and `wagers:all` indices. If drafts lived in the same namespace, every public read path would have to remember to filter `status === 'draft'` out — a single regression in the future could leak a draft to customers.

Drafts instead live at:

```
weather-market-draft-wager:<id>             ← compact JSON
weather-market-draft-wagers:all             ← sorted set, retention 200
```

No public/customer code path reads these keys. Isolation by namespace, not by filter.

### Flow

```
Saved idea (status ∈ {saved, reviewed, used}; rejected refused)
   ↓ "Create Draft Wager" (with confirmation modal)
   ↓ admin API → buildDraftWagerInputFromIdea() → createDraftWager()
DraftWager persisted at weather-market-draft-wager:<id>
   ↓ saved idea status auto-bumped to 'used'
   ↓ audit event weather_market_draft_wager_created
[review later in Drafts tab]
   ↓ "Open in wager-create form →"  ← still the only path that touches createWager
Operator reviews + clicks Create Wager  ← live market exists
```

### What gets persisted

```ts
interface DraftWager {
  id: string;                          // wmdraft-* — distinct from any live Wager id
  createdAt: string;
  updatedAt: string;
  status: 'draft';                     // never any other value in this build
  input: CreateWagerInput;             // ready to hand to createWager when published
  summary: {
    title, description, kind, metric,
    metricA?, metricB?,                // cross-metric per-side (Step 145)
    targetDate, locationAName, locationBName,
    spread, locationAOdds, locationBOdds,
    rulesCopy: string,                 // operator-facing summary from the mapper
    warnings: string[],                // cross-metric reminder, beyond-horizon, etc.
  };
  provenance: {
    savedIdeaId: string;
    ideaId: string;                    // generator-issued at save time
    ideaFingerprint: string;           // for the duplicate-draft guard
  };
  operatorNote?: string;               // ≤ 1000 chars
}
```

### Refusals

| Condition | Response |
|---|---|
| Saved idea not found | `404 not_found` |
| Saved idea status === `rejected` | `409 idea_rejected` — restore status first |
| A draft already exists for this saved idea | `409 draft_already_exists` (response carries `existingDraftId`) — delete the old draft first to recreate |

Status auto-update is best-effort: if the draft write succeeds but the saved-idea status update transiently fails, the draft still exists and the operator can mark the idea `used` from the Saved Ideas tab. The reverse never happens — a Redis failure on the draft write does not advance the saved-idea status.

### API actions added in Step 147

| Method | Action | Purpose |
|---|---|---|
| GET | `list-draft-wagers` | List draft wagers (cap 200) |
| GET | `get-draft-wager` | Single draft by id |
| POST | `create-draft-wager-from-idea` | Build a `CreateWagerInput` from a saved idea, persist as draft, mark source idea `used`, audit log |
| POST | `delete-draft-wager` | Remove a draft. Does not affect any published wager. |

All admin-gated. The route never publishes. The mapper is a pure function (`src/lib/weather-market-idea-to-draft.ts`) and could be reused by future automation, but Step 147 only wires the human-confirmed path.

### What's *not* in Step 147

- **No publish path.** The Drafts tab has no Publish button. The only way to actually create a market is for the operator to take the prefilled link to the existing wager-create form and click Create Wager themselves.
- **No edit-in-place** of the draft's prepared input. To change spread/odds/title, delete the draft and re-create from the saved idea (or use the prefilled wager-create form, which the operator can already edit).
- **No public surface, no cron, no auto-publish-on-review-window.** Drafts don't grade and aren't seen by `/api/wagers`.

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
