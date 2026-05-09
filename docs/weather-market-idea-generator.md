# Weather Market Idea Generator

**Status:** Step 144 → Step 145 → Step 146 → Step 147 → Step 148 → Step 149. Admin-only draft generator + saved-idea review queue + admin draft-wager store + explicit publish action + post-publish QA checklist. **No market is ever automatically created or published by this surface — publishing requires a confirmation modal and is gated by the same `validateCreateWager` the existing `/api/admin/wagers` POST uses. The post-publish QA checklist is operator-tracking only and never publishes / unpublishes / edits / voids / settles a live wager.**

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

- ~~**No publish path.**~~ — added in Step 148, see below. No bulk publish, no auto-publish.
- **No edit-in-place** of the draft's prepared input. To change spread/odds/title, delete the draft and re-create from the saved idea (or use the prefilled wager-create form, which the operator can already edit).
- **No public surface, no cron, no auto-publish-on-review-window.** Drafts don't grade and aren't seen by `/api/wagers` until publish runs.

## Step 148 — Publish reviewed draft wagers

Step 148 closes the loop: the Drafts tab gains an explicit **Publish Draft Wager** action that runs the draft's frozen `CreateWagerInput` through the same validator/creation path the existing `/api/admin/wagers` POST uses, then flips the draft to `status='published'` so the duplicate-publish guard catches the next click.

### Flow

```
DraftWager (status='draft')
   ↓ "Publish Draft Wager" (with confirmation modal)
   ↓ POST publish-draft-wager
   ├─ getDraftWager(id)                       → 404 if missing
   ├─ refuse if draft.status === 'published'  → 409 with publishedWagerId
   ├─ validateCreateWager(draft.input)        → 400 with errors if invalid
   ├─ createWager(draft.input)                → 500 if it throws
   ├─ markDraftPublished(draftId, wagerId)    → best-effort
   └─ logAuditEvent(weather_market_draft_wager_published)  → best-effort
   ↓
DraftWager (status='published', publishedWagerId, publishedAt)
   ↓
Live Wager visible on /api/wagers, /wagers/[id], gradable, settlable
```

### Confirmation modal

The modal explicitly states the consequences before the operator can publish:

> This creates a **real wager** in the normal wager system. Review the title, rules copy, target date, metrics, spread, and odds below before publishing. Once published, the wager enters the normal admin/manual creation lifecycle (locking, NWS-based grading, settlement, wallet payouts). There is no automatic rollback.

The modal renders the full `summary` (title, rules copy, A/B locations + per-side metrics, target date, spread, odds, source idea id, and any mapper warnings such as the cross-metric reminder) so the operator reviews the exact thing that will be created. Cancel and the draft is untouched.

### Refusals

| Condition | Response |
|---|---|
| `id` missing in body | `400 missing_id` |
| Draft not found | `404 not_found` |
| Draft already published | `409 draft_already_published` (response carries `publishedWagerId` + `publishedAt`) |
| `validateCreateWager` rejects | `400 invalid_draft_input` with `errors[]` (delete + recreate the draft, or open the prefilled wager-create form to edit by hand) |
| `createWager` throws | `500 create_wager_failed` — draft untouched |

### Failure semantics

- **Validation rejected** → no `createWager` call, draft untouched, errors returned.
- **`createWager` throws** → no draft mutation, no audit event. The operator can retry.
- **`createWager` succeeds but `markDraftPublished` fails** → 200 response with `wager.id` and a `warning` field on the body explaining the draft tracking didn't update. The live wager exists; the operator should manually delete the draft from the Drafts tab. We deliberately do **not** try to rollback the live wager — `wager-store` has no rollback API and a partial roll-forward is much worse than a stale draft record.
- **Audit event write fails** → ignored (matches Step 146/147 policy and the existing `/api/admin/wagers` POST, which does not emit an audit event of its own).

### Duplicate-publish guard

A draft tracks `status` and `publishedWagerId`. The handler refuses any second publish attempt with `409 draft_already_published` carrying the existing `publishedWagerId` so the UI can route the operator to the live wager instead of creating a duplicate. The UI further disables the **Publish Draft Wager** button when `status === 'published'` (button shows "Published ✓" with the live wager id).

### Cross-metric pointspreads survive publish

The mapper (Step 147 `buildDraftWagerInputFromIdea`) sets `metricA` / `metricB` only when they actually differ from the shared metric. The validator (Step 145) accepts those fields. `createWager` (Step 145) persists them only when supplied. NWS grading (Step 145 `gradePointspreadWagerFull`) reads `wager.metricA ?? wager.metric` per side. End-to-end the cross-metric semantics are preserved through publish without any new code in Step 148.

### What Step 148 does NOT change

- **No automatic publishing** — every publish requires an operator click + confirmation.
- **No public/customer exposure of drafts before publish** — the namespace isolation from Step 147 still holds. `/api/wagers` and `/api/wagers/[id]` only see records that landed in the live wager store via `createWager`.
- **No wallet/balance changes** — the publish action calls `createWager` only. Settlement and wallet code paths are unchanged.
- **No settlement/grading logic changes** — `nws-grading.ts` and `nws-observations.ts` continue to be the sole inputs to market resolution.
- **No pricing automation** — pricing snapshots are not attached. The published wager has the same `pricingSnapshot: undefined` shape as a wager created via `/api/admin/wagers` POST without using the Pricing Lab. The operator can edit pricing in the existing admin UI after publish if they want.
- **No Kalshi/Polymarket exposure changes** — neither store is touched.
- **No bulk publish** — every publish is one draft at a time.

## Step 149 — Post-publish market QA checklist

Step 149 wraps a checklist around every wager born from the idea-generator → draft → publish flow so an operator can verify the published market is clear, correct, and safe before relying on it. **The checklist is pure operator tracking — toggling boxes, changing QA status, editing notes never publishes / unpublishes / edits / voids / settles the live wager.** Real changes to a published market continue to flow through the existing admin wager-detail page.

### Where it lives

- **Store module:** `src/lib/weather-market-qa-store.ts` (server-only — browser import throws). Redis-backed at keys `weather-market-qa:<id>` plus a sorted set `weather-market-qas:all`. Bounded retention `MAX_QA_RECORDS = 300`. Operator note capped at `QA_OPERATOR_NOTE_MAX_LEN = 1000`. The store imports nothing from wager-store / settlement / grading / wallet / pricing modules. Every customer code path (`/api/wagers`, `/api/wagers/[id]`, `getPublicWager`, `serializePublicWager`) reads only from the live wager namespace and the `PublicWagerView` allow-list — neither of which contains any QA fields.
- **API:** Same admin endpoint as the rest of the workflow (`/api/admin/system/weather-market-ideas`), all admin-gated. New actions:

| Method | Action | Purpose |
|---|---|---|
| GET | `list-market-qa` | Optional `status` filter, `limit` ≤ 300 |
| GET | `get-market-qa` | Single record by `id` or by `wagerId` |
| POST | `update-market-qa` | Persist checklist booleans + operator note. `reviewedAt` + `reviewedBy` auto-stamped |
| POST | `update-market-qa-status` | One of `pending` / `passed` / `needs_changes` / `rejected`. Audit-logged |

- **UI:** A new **Post-Publish QA** tab in `WeatherMarketIdeaGenerator.tsx`. Each card carries the snapshot fields, a public-page link, an admin-wagers link, the nine-item checklist with help copy, an inline operator note, status-change buttons that swap based on current state, and provenance metadata (qa id / draft id / idea id).

### Auto-creation on publish

`handlePublishDraft` already runs `createWager` and then `markDraftPublished`. Step 149 inserts a third best-effort step: `createMarketQA(...)` with `status: 'pending'`, an empty checklist, and a frozen snapshot of the relevant `CreateWagerInput` fields. The publish response now includes `qa: MarketQA` and the response `warnings[]` carries the QA-create error string when this best-effort step fails. **A QA-create failure does not roll back the live wager** (per the spec: "if QA creation fails after wager publish, do NOT roll back wager") — the operator can manually create or re-run the QA write later if needed.

### QA status workflow

| Status | Meaning |
|---|---|
| `pending` | Auto-assigned at publish. The card shows a "Published but QA pending" banner |
| `passed` | Operator has reviewed and the market is acceptable |
| `needs_changes` | Operator has reviewed and noted at least one issue to fix in the live admin UI |
| `rejected` | Operator concluded the published market should not be used / promoted. **Note: rejecting a QA record does not void or delete the live wager** — that has to be done from the admin wager UI |

### The nine checklist items

Operator-facing copy lives in the UI (`CHECKLIST_ITEMS` in `WeatherMarketIdeaGenerator.tsx`) so the wording can be revised without bumping the schema. Booleans are the only thing persisted.

| Item | Help copy |
|---|---|
| Title | Title clearly states both sides and the target date |
| Locations | City/state and weather stations are correct for both sides |
| Metrics | metricA / metricB are correct and rendered clearly (e.g. "High" vs "Low") |
| Spread | Line matches the intended forecast difference and direction |
| Odds | Odds are correct, intentional, and balanced for the desired hold |
| Rules | Push / tie / inclusive-boundary language is clear and unambiguous |
| Resolution source | Authoritative observation source (NWS) is referenced and visible |
| Public page | Public detail page renders correctly and is understandable to a customer |
| Mobile display | Market is readable and the bet flow is usable on mobile |

### Persisted fields

```ts
interface MarketQA {
  id: string;                          // wmqa-* — distinct from wagerId
  wagerId: string;                     // live wager id this QA reviews
  sourceDraftId: string;
  sourceIdeaId: string;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'passed' | 'needs_changes' | 'rejected';
  checklist: {
    titleReviewed, locationsReviewed, metricsReviewed,
    spreadReviewed, oddsReviewed, rulesReviewed,
    resolutionSourceReviewed, publicPageReviewed, mobileDisplayReviewed: boolean
  };
  snapshot: {                          // frozen at publish; usable post-edit
    title, targetDate, metric, metricA?, metricB?,
    locationAName?, locationBName?, spread?, locationAOdds?, locationBOdds?
  };
  operatorNote?: string;               // ≤ 1000 chars
  reviewedBy?: string;                 // operator id auto-stamped on each save/status change
  reviewedAt?: string;
}
```

### What QA does *not* control

- **No publish or unpublish.** The QA tab has zero create/publish/void/edit-wager controls. Marking `rejected` does not remove the live market.
- **No settlement / grading / wallet / pricing changes.** The QA store is read/write-isolated from those code paths.
- **No public exposure.** `PublicWagerView` does not contain any QA fields. `serializePublicWager` would drop them even if a future caller accidentally merged a QA shape onto a wager response. `/api/wagers` and `/api/wagers/[id]` never read from `weather-market-qa:*`.
- **No automatic re-checks.** QA records are written only on publish; the operator drives every subsequent change.
- **No Kalshi/Polymarket interaction.** Neither store is touched.

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
