# Weather Market Idea Generator

**Status:** Step 144 → Step 145 → Step 146 → Step 147 → Step 148 → Step 149 → Step 150 → Step 151 → Step 152 → Step 153 → Step 154 → Step 155 → Step 156 → Step 157. Admin-only draft generator + saved-idea review queue + admin draft-wager store + explicit publish action + post-publish QA checklist + duplicate/correlation risk warnings + soft confirmation when proceeding past high-severity warnings + bounded expanded city universe with region filters + searchable city picker with favorite city sets + weather-personality tags and smart-discovery presets + structured operator feedback with preset tuning notes. **No market is ever automatically created or published by this surface — publishing requires a confirmation modal and is gated by the same `validateCreateWager` the existing `/api/admin/wagers` POST uses. The post-publish QA checklist, the Step 150/151 risk warnings + confirmation modal, the Step 153 picker + favorite sets, the Step 154 tags + presets, and the Step 155 feedback + tuning notes are all operator-tracking surfaces only — none publishes / unpublishes / edits / voids / settles a live wager, and none mutates a smart-discovery preset definition. Every city the generator forecasts is drawn from the static curated universe in `weather-market-city-universe.ts`; arbitrary lat/lon is never accepted, every tag is allow-listed against a 20-value taxonomy, and every feedback rating/reason is allow-listed against the Step-155 vocabularies.**

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

## Step 150 — Duplicate + correlation warnings

Step 150 wraps an advisory risk-warning helper around the four card surfaces (Generate, Saved Ideas, Drafts, Post-Publish QA) so the operator sees when a candidate market is duplicating or concentrating with other ideas/drafts/live wagers. **Operator guidance only.** No warning ever blocks a button, cancels a market, changes a price, or mutates a wallet/settlement record. The Step 147/148 hard refusals (duplicate-draft, duplicate-publish) are the only places anything is blocked; everything Step 150 surfaces is a soft signal.

### Where it lives

- **Analyzer module:** `src/lib/weather-market-risk-warnings.ts` (server-only — browser-import throws). Pure `analyzeRisk(candidate, universe, options)` returns `WeatherMarketRiskWarning[]`. Async `fetchRiskUniverse()` reads the three admin stores (saved ideas, drafts, live wagers).
- **Read shim:** `src/lib/weather-market-store-admin.ts` — re-exports only `listAllWagers` and `getWager` from `wager-store.ts`. The analyzer imports through this shim so its trust footprint is greppable: the analyzer never sees `createWager` / `voidWager` / `gradeWager` / `updateWager`.
- **API:** Same admin endpoint as the rest of the workflow (`/api/admin/system/weather-market-ideas`), all `requireAdmin`-gated. Three new POST actions:

| Method | Action | Purpose |
|---|---|---|
| POST | `analyze-risk-for-idea` | Accepts `savedIdeaId` OR a bare `idea` object (e.g. fresh from a generate response) |
| POST | `analyze-risk-for-draft` | Accepts a draft `id` |
| POST | `analyze-risk-for-wager` | Accepts a live wager `id` |

Plus warnings are precomputed and returned alongside the existing list responses (`generate`, `list-saved-ideas`, `list-draft-wagers`, `list-market-qa`) under a `riskWarnings` map keyed by source-record id, so the UI doesn't have to round-trip per card.

- **UI:** A `<RiskBadges>` component renders a compact severity chip row that expands to show the full warning details (title, description, related market ids/titles, suggested action, "Warning only — admin may still proceed."). It appears on every card across all four tabs.

### Warning types

| Type | Severity | When |
|---|---|---|
| `exact_duplicate` | **high** | Same date + same direction + same metric pair + spread within ±0.5°F |
| `same_spread_nearby_line` | **warning** | Same direction + same metrics + spread within ±2°F (excluding exact dupes) |
| `similar_market` | **warning** | Same city pair + same date with comparable spread (any direction) |
| `same_location_cluster` | **warning** | ≥ 3 active records share at least one location with this market on the same date |
| `same_location_date_metric` | info | Same metric is already being graded at one of these locations on this date |
| `correlated_temperature_spread` | info | At least one location overlaps with another active market on the same date |
| `same_date_cluster` | info | ≥ 5 other active records target the same date |
| `repeated_city_pair` | info | The same city pair appears in ≥ 2 other records anywhere in the universe |
| `high_existing_activity` | info | ≥ 3 active records on this date involve one of these locations (suppressed when `same_location_cluster` already covers the same root cause) |

Thresholds live in module-level constants (`EXACT_SPREAD_TOLERANCE_F`, `NEAR_SPREAD_TOLERANCE_F`, `SAME_LOCATION_CLUSTER_THRESHOLD`, etc.) — easy to tune without changing the schema.

### Universe scope

`fetchRiskUniverse()` pulls:

- Up to 200 saved ideas from `weather-market-idea:*`
- Up to 200 draft wagers from `weather-market-draft-wager:*`
- Up to 200 most recent wagers from `wagers:all`, filtered to `status ∈ {open, locked}` by default

Each record is normalized into a common `MarketLikeRecord` shape (lower-cased location names, wager-style metric ids — `daily_high` is mapped to `high_temp` so ideas and live wagers compare apples to apples). The candidate is excluded from its own universe.

### Failure semantics

Risk-warning fetches are **best-effort and never fatal**. If `fetchRiskUniverse()` throws (e.g. Redis blip), the list response still returns the records with `riskWarnings: {}`. The list call never 500s because of risk analysis.

### What Step 150 does *not* do

- **No automatic blocking.** Buttons remain enabled even when high-severity warnings are present. The operator decides.
- **No automatic pricing changes.** Risk warnings are advisory only — no spread, odds, or hold is recomputed.
- **No automatic market cancellation or unpublish.** Marking, rejecting, or any other action on a warning never touches the live wager.
- **No exposure-amount surfaces.** Step 150 uses count- and concentration-based heuristics. It does not read or render house exposure dollars.
- **No public/customer exposure.** `PublicWagerView` and `PUBLIC_WAGER_VIEW_KEYS` are unchanged. Risk warnings live entirely on admin endpoints and admin UI surfaces.
- **No Kalshi/Polymarket integration.** Neither external store is touched.
- **No settlement / grading / wallet / pricing modules** are imported by the analyzer or by the admin endpoint's risk handlers.

## Step 151 — High-severity confirmation modal

Step 151 adds a single soft confirmation moment when an admin tries to take a risky action on an item that carries a `severity: 'high'` warning from Step 150. **The modal is purely UX guardrail — it never blocks the action, never disables the button, never auto-rejects.** The only real refusals on the workflow remain the Step 147/148 server-side duplicate guards (`draft_already_exists`, `draft_already_published`).

### Soft vs hard guards (the distinction)

| Guard | Where it lives | What happens |
|---|---|---|
| **Hard duplicate guards** (Steps 147/148) | Server-side, in the action handlers | Action is *refused* with `409` + the existing record id. Operator must take a different path (delete the prior record, restore the saved-idea status, etc.). |
| **Soft confirmation modal** (Step 151) | Client-side, before the action handler is called | Modal opens. Operator clicks **Cancel** (action does not run) or **Continue anyway** (action runs exactly as if no modal had appeared). Server is unchanged. |

The two layers compose: a soft confirmation can fire *before* a hard refusal, so the operator may confirm past warnings only to be refused at the server because the underlying record already exists. That's correct — soft confirmations are about giving the human a moment, not about predicting server state.

### Where the soft modal fires

Only on actions where committing past a high-severity warning has lasting consequences:

| Action | Card surface | Severity-checked against |
|---|---|---|
| **Save idea** | Generate tab | `generateRiskMap[idea.id]` |
| **Create Draft Wager** | Saved Ideas tab | `savedRiskMap[savedIdea.id]` |
| **Publish Draft Wager** | Drafts tab | `draftRiskMap[draft.id]` |
| **Mark QA passed** | Post-Publish QA tab | `qaRiskMap[qa.id]` |

The QA gating only fires on the `passed` transition. Marking `needs_changes`, `rejected`, or reverting to `pending` never opens the modal — those statuses are inherently more cautious and a confirmation prompt would just be noise.

The modal does **not** fire on harmless actions: copy title, copy setup notes, open prefill link, view details, edit notes, delete saved idea / draft / QA record, change non-`passed` QA status, change saved-idea status. Those continue to fire instantly.

### Modal contents

- Title: "High-severity market warnings"
- Red banner: "These warnings do not prevent <action>, but they may indicate duplicate or correlated markets. Review before continuing."
- The candidate item's title for context
- Per-warning bullets: title, description, related market titles (truncated to 4 with "+N more")
- Buttons: **Cancel** | **Continue anyway** (red)

### Override metadata audit trail

When the operator clicks **Continue anyway**, the action payload sent to the server includes:

```json
{
  "riskOverride": {
    "confirmed": true,
    "types": ["exact_duplicate", "same_spread_nearby_line"],
    "count": 2
  }
}
```

The server validates the shape (`parseRiskOverride`), threads it into the existing audit-event details, and adds a one-line tag to the audit-event summary (`[risk override: 2 high-severity warning(s) acknowledged]`). Audit events affected: `weather_market_idea_saved`, `weather_market_draft_wager_created`, `weather_market_draft_wager_published`, `weather_market_qa_status_changed`. **No new audit event types, no new persistence surface, no schema bump on `MarketQA` / `DraftWager` / `SavedWeatherMarketIdea`.**

### What Step 151 does *not* do

- **No hard blocking.** Both buttons exist; **Continue anyway** is always live.
- **No button disabling keyed to severity.** Verified by grep: no `disabled=` in the UI is keyed off any risk field.
- **No auto-rejection.** The operator is the only decider. Cancelling the modal aborts only the click that opened it.
- **No new public/customer surface.** The modal is admin-UI only; the `riskOverride` payload travels only on the existing admin endpoints.
- **No settlement / pricing / wallet / Kalshi / Polymarket changes.** The override is metadata on an already-existing audit event.
- **No weakening of the Step 147/148 hard duplicate guards** — they still refuse with `409` regardless of whether the operator confirmed past warnings.

## Step 152 — Bounded expanded city universe

Step 152 lets an admin run target-difference searches across a curated ~75-city US set rather than the original 12 seed cities. **The expanded universe is static, allow-listed, and bounded.** The generator never fetches city lists from the network, never accepts arbitrary lat/lon from the operator, and never scans more than `MAX_EXPANDED_CITIES = 100` candidates per run regardless of what was requested.

### Where it lives

- **Module:** `src/lib/weather-market-city-universe.ts` — pure data + `resolveCityUniverse()`. No `getRedis`, no `fetch`, no external API. Hard ceiling `MAX_EXPANDED_CITIES = 100`; default expanded cap `DEFAULT_EXPANDED_MAX = 75`.
- **Generator:** `weather-market-idea-generator.ts` consumes the universe via the new selector. The legacy `FORECAST_QUALITY_SEED_CITIES` import is gone; the seed-12 cities still flow through the same code path because the universe re-projects them into the same shape (their existing ids remain stable, so saved ideas / drafts / QA records that reference seed-city ids continue to resolve).
- **API:** `/api/admin/system/weather-market-ideas` bootstrap response gained `cityUniverseOptions`, `regionOptions`, `expandedUsCityCount`, `expandedRegionCounts`, `limits.maxCandidateCitiesCap`, `limits.defaultExpandedCandidateCities`. The `generate` action validates `cityUniverse`, `region`, and `maxCandidateCities` against allow-lists.
- **UI:** New universe selector + region filter (visible only when `expanded_us` is selected) + a `maxCandidateCities` input. The post-generation header now shows the universe + region used + `successful/candidate cities forecasted` counters and any forecast-failure count.

### City universe modes + region filters

| Mode | Cities | Notes |
|---|---|---|
| `seed_12` | 12 (the original seed list) | Backward-compatible default. Per-city checkbox grid still shown |
| `expanded_us` | ~75 curated US cities | Region filter + `maxCandidateCities` instead of per-city checkboxes |

| Region filter | Cities |
|---|---|
| `all_expanded` | All cities in the chosen universe (no region filter) |
| `northeast`, `southeast`, `midwest`, `plains`, `mountain`, `southwest`, `west_coast`, `pacific_northwest`, `texas`, `florida` | Per-region slice |

The expanded set deliberately mixes top US population centers with weather-diverse outliers (mountain, desert, plains, coastal, Great Lakes, deep south, pacific northwest). Mainland US only — Alaska/Hawaii forecast handling is left for a later step.

### Bounded scan semantics

- The resolver's hard ceiling is `MAX_EXPANDED_CITIES = 100`. `maxCandidateCities` is clamped to that ceiling; values outside `[1, 100]` are rejected with `400 invalid_max_candidate_cities`.
- Default expanded cap is 75. A region filter applied to `expanded_us` further narrows the pool before the cap.
- Per-city forecast-fetch failures are isolated (the existing per-city try/catch). Forecast concurrency stays at 4 (cap 8). The result carries:
  - `candidateCityCount` — how many cities the resolver returned
  - `successfulForecastCount` — how many returned a usable forecast for the target date
  - `failedForecastCount` — how many failed forecast fetch (network / rate-limit / etc.)
  - `cityCountCappedTo` — only set when truncation actually happened
- The generator emits a warning when truncation kicks in, and the audit-event summary echoes `universe`, `region`, and the success/candidate counters so the audit trail makes the cost obvious.

### Pair-count discipline

For `expanded_us` at 75 cities × 3 metric pairs the candidate-pair set is large but bounded; the existing `MAX_RESULTS_CAP = 100` keeps the returned-idea count under control. We do not need an explicit pair-count cap — the metric-pair generator iterates ordered pairs, and the final ranking + `slice(0, maxIdeas)` handles the rest.

### Target-difference search benefits

Step 145 added "find me a forecasted temperature difference around X °F". With only 12 seed cities the answer set was often empty for tight tolerances or unusual targets. With 75 cities and region filters, the operator can ask "find me a 25 °F spread between a Mountain city and a Florida city for next Saturday" and actually get hits.

### What Step 152 does *not* change

- **No automatic publishing or market creation.** The Step 145 prefill link, Step 147 draft creation, Step 148 publish, and Step 149 QA checklist all still require explicit operator action.
- **No automatic pricing activation.** Suggested odds are still default −110 / −110 unless the operator edits.
- **No public/customer exposure.** The expanded city universe is admin-only; nothing here renders on `/api/wagers`, `/api/wagers/[id]`, or any customer surface.
- **No uncontrolled external API scan.** Every city in the universe is hard-coded in the module — typos or hostile input cannot trigger a lookup.
- **No unbounded forecast fetch loop.** `maxCandidateCities` ≤ 100, default 75, region filter further narrows.
- **No settlement / grading / wallet / Kalshi / Polymarket changes.** None of those modules are imported by the city universe or the generator.
- **No weakening of the Step 147/148/151 confirmation flows or the Step 146 saved-idea duplicate guard.** Expanded-city ideas flow through the exact same save / draft / publish / QA / risk-warning / high-severity-confirmation pipeline.

## Step 153 — Searchable city picker + favorite city sets

Step 153 turns the expanded-mode city selector from "use the whole region or nothing" into a real operator workstation: search the curated universe, multi-select specific cities, save the selection as a named favorite, reuse it later. **Every city the generator forecasts is still drawn exclusively from the static `weather-market-city-universe.ts` catalog — selected ids are validated server-side, and arbitrary lat/lon is never accepted.**

### Where it lives

- **Universe helpers** (`weather-market-city-universe.ts`): `listExpandedUniverse()`, `findExpandedCityById(id)`, `validateExpandedCityIds(ids)`. The first powers the picker UI, the second/third gate any API path that accepts city ids.
- **Favorite-set store** (`src/lib/weather-market-city-set-store.ts`, new): server-only Redis store at `weather-market-city-set:<id>` + sorted set `weather-market-city-sets:all`. Bounded retention `MAX_CITY_SETS = 100`. Caps: `CITY_SET_NAME_MAX_LEN = 80`, `CITY_SET_NOTE_MAX_LEN = 500`, `MAX_CITY_IDS_PER_SET = 100`, `MAX_CITY_SET_TAGS = 8` × `CITY_SET_TAG_MAX_LEN = 32`. CRUD + duplicate-detection by normalized name + optional `upsert`. The store imports nothing from wager-store / settlement / grading / wallet / pricing / publish / Kalshi / Polymarket / forecast modules.
- **API:** Same admin endpoint as the rest of the workflow (`/api/admin/system/weather-market-ideas`), `requireAdmin`-gated. New GET actions: `list-city-sets`, `get-city-set`. New POST actions: `create-city-set` (with `upsert?: boolean`), `update-city-set`, `delete-city-set`. Plus `handleGenerate` now hard-rejects unknown `cityIds` with `400 invalid_city_ids` and rejects `cityIds.length > MAX_EXPANDED_CITIES` (= 100) with `400 too_many_city_ids`.
- **UI:** In expanded mode, the existing region selector + max-cap input is joined by a searchable picker (filters by city name, state, region) + selected-city chips with × remove + Clear/Select-all-visible buttons + an inline favorite-set panel (load / save current / delete with `window.confirm`). Selecting any city overrides the region filter for the next Generate run; the bounded-scan amber copy explicitly tells the operator that.

### City-id validation flow

1. Operator clicks a city in the picker → `selectedExpandedCityIds` array updates client-side.
2. Operator clicks Generate → request body's `cityIds` is the selection; the server's `handleGenerate`:
   - rejects with `400 too_many_city_ids` if `cityIds.length > 100`,
   - rejects with `400 invalid_city_ids` (response carries up to 10 unknown ids + `totalInvalid` count) if any id is not in the static universe,
   - else passes the `cityIds` to `generateWeatherMarketIdeas`, which the resolver further filters / caps via `maxCandidateCities`.
3. `create-city-set` and `update-city-set` apply the same validation before persisting.
4. The store re-validates at write time as defense-in-depth — if the universe ever shrinks, a stale id silently degrades on `load`.

### Favorite-set duplicate handling

- New record's `normalizedName = name.trim().toLowerCase()`.
- On `create-city-set`, if a record with the same `normalizedName` exists:
  - default behavior: return `200 { isDuplicate: true, existingId, citySet }` without writing,
  - if `upsert: true`: update the existing record's name / cityIds / note / tags and return `201 { upserted: true, citySet, existingId }`.
- The UI's "Update existing if name matches" checkbox on the inline save form is the operator-facing knob.

### Examples (the kind of sets this is for)

- **"Texas heat cities"** — Houston, Dallas, San Antonio, Austin, El Paso, Lubbock (region: texas, tags: `summer`, `heat`)
- **"Mountain cold cities"** — Denver, Salt Lake City, Boise, Helena, Cheyenne (region: mountain, tags: `winter`, `cold`)
- **"NFL-style city set"** — operator-curated cross-region pair list (LA, NY, Chicago, Dallas, Green Bay, ...)
- **"Severe weather city set"** — Plains + Midwest tornado-corridor cities (Oklahoma City, Wichita, Tulsa, Fargo, Lincoln, ...)
- **"Personal favorites"** — anything the operator wants, capped at 100 cities.

### Audit-event additions

Three new event types via the existing `logAuditEvent` (no new persistence surface):

- `weather_market_city_set_created` — fired when a new set is persisted
- `weather_market_city_set_create_duplicate` — fired when a duplicate-create attempt was blocked (no `upsert`)
- `weather_market_city_set_updated` — fired on `update-city-set` *or* on a successful `upsert: true` create
- `weather_market_city_set_deleted` — fired on delete

Each carries `cityCount` and (when present) `tags` in the audit `details`. No new audit field besides those.

### What Step 153 does *not* do

- **No arbitrary location scanning.** The generator and every API path reject any city id that isn't in the static universe. Lat/lon is never accepted from the UI.
- **No external geocode / city-list lookup.** The picker reads the bootstrap-supplied catalog only; no `fetch` from the universe module or the city-set store.
- **No automatic publishing or market creation.** Loading a set just populates the selection; the operator still goes through Save → Draft → Publish → QA exactly as before.
- **No public/customer exposure.** Favorite sets live at `weather-market-city-set:*` and are never read by `/api/wagers`, `/api/wagers/[id]`, `/api/bets*`, or any customer surface.
- **No settlement / grading / wallet / pricing / Kalshi / Polymarket changes.** None of those modules are imported by the new universe helpers, the city-set store, or the new API handlers.
- **No weakening of any prior safety rail.** Bounded scans (Step 152), risk warnings (Step 150), high-severity confirmation (Step 151), draft duplicate guard (Step 147), publish duplicate guard (Step 148), and post-publish QA (Step 149) all continue to apply to picker-driven generations exactly as they do to region-only generations.

## Step 154 — Weather personality tags + smart discovery presets

Step 154 turns "find me hot-weather city spreads" / "find me windy city ideas" / "find me severe-weather pairings" into single-click queries. Each city in the curated universe gets a small static set of climatological tags (e.g. `hot`, `dry`, `desert`, `urban_heat`, `heat_index` for Phoenix), and the generator gains a `weatherTags + tagMode` filter. A handful of named **smart-discovery presets** then bundle tag selections + metric-pair + target difference + day offset into one operator click.

### Where it lives

- **Universe module** (`weather-market-city-universe.ts`): adds the 20-value `WeatherPersonalityTag` taxonomy, a per-city tag overlay (`CITY_TAGS_BY_ID`), helpers (`listWeatherPersonalityTags`, `validateWeatherPersonalityTags`, `getCitiesByTags(tags, mode)`, `getTagLabel(tag)`, `expandedCityCountsByTag`), and the `SMART_DISCOVERY_PRESETS` array + `getSmartDiscoveryPreset(id)` / `listSmartDiscoveryPresets()`. **Pure data and pure functions; no `fetch`, no `getRedis`, no network.**
- **Generator** (`weather-market-idea-generator.ts`): `GenerateIdeasOptions` gains `weatherTags?: WeatherPersonalityTag[]` + `tagMode?: 'any' | 'all'`. Filter applies after the region narrowing and before the candidate cap, only when `cityIds` is empty. `result.resolved` echoes `weatherTags`, `tagMode`, `tagFilteredCityCount`. A warning fires when the tag filter narrows the universe to fewer than 2 cities.
- **API**: bootstrap returns `weatherPersonalityTags`, `tagModes`, `expandedCityCountsByTag`, `smartDiscoveryPresets`. `handleGenerate` validates `weatherTags` (`400 invalid_weather_tags` with up to 10 unknown tags + total count) and `tagMode` (`400 invalid_tag_mode`) and `presetId` (`400 invalid_preset_id`). Audit-event summary now tags itself with `tags=[…]:any|all` and (when present) `preset=<id>`; `details` carries `weatherTags`, `tagMode`, `tagFilteredCityCount`, `presetId`.
- **UI**: a new "Smart discovery" panel sits above the picker in expanded mode. Preset dropdown applies tags + region + cityIds + metric pair + target difference + tolerance + day offset in one click (and switches to expanded mode if the operator wasn't there yet). Below it, a tag-chip row with per-tag city counts + a `tagMode` selector + a Clear-tags button. Selected cities still override tags ("Active city selection overrides tags for this run." amber notice).

### Tag taxonomy (20 tags, allow-listed)

| Tag | Meaning |
|---|---|
| `hot` | Hot summers / persistently warm baseline |
| `cold` | Cold winters / persistently cool baseline |
| `humid` | High dewpoints / muggy summers |
| `dry` | Low humidity / arid baseline |
| `desert` | Desert-classified climate |
| `mountain` | Significant elevation / mountain climate |
| `coastal` | Direct ocean / Great Lakes coastal moderation |
| `plains` | Open-plains climate |
| `windy` | Persistently windy |
| `snowy` | Significant snow accumulation |
| `rainy` | Persistently wet (PNW etc.) |
| `storm_prone` | Frequent thunderstorm activity |
| `hurricane_exposed` | Atlantic / Gulf hurricane risk |
| `lake_effect` | Great Lakes lake-effect zones |
| `high_variability` | Big day-to-day swings |
| `big_diurnal_swing` | Big day-to-night swings |
| `heat_index` | High heat-index / muggy heat |
| `freeze_risk` | Below-freezing risk in cool months |
| `severe_weather` | Tornado / severe-storm corridors |
| `urban_heat` | Significant urban-heat island |

Tags are **non-scientific and curated** — they exist to make discovery intuitive, not to be a climatological reference. New tags are added by extending `WeatherPersonalityTag`, the `TAG_LABELS` map, and the relevant per-city entries.

### Smart discovery presets

| id | Description | Tags / cityIds | Suggested mode + target |
|---|---|---|---|
| `hot_vs_cold` | Hot-tagged vs cold-tagged contrast | `[hot, cold]` (any) | high vs high · 30 ± 5 °F |
| `desert_vs_mountain` | Desert heat vs mountain cold | `[desert, mountain]` (any) | high vs high · 25 ± 5 °F |
| `humid_vs_dry` | Humid vs dry contrast | `[humid, dry]` (any) | high vs high · 15 ± 5 °F |
| `windy_markets` | Windy-tagged cities | `[windy]` | high vs high · 15 ± 5 °F |
| `snow_risk` | Snowy + freeze-risk | `[snowy, freeze_risk]` (any) | low vs low · 20 ± 5 °F |
| `severe_weather_watch` | Severe-weather + storm-prone | `[severe_weather, storm_prone]` (any) | any temperature pair |
| `coastal_vs_inland` | Coastal cities (operator pairs against inland) | `[coastal]` | high vs high · 10 ± 5 °F |
| `big_temperature_swing` | Big-diurnal-swing cities | `[big_diurnal_swing]` | high vs low |
| `texas_heat` | Hot-tagged Texas cities | `[hot]` + region `texas` | high vs high · 10 ± 5 °F |
| `nfl_weather_cities` | Curated cold/wind/snow NFL-stadium cities | `cityIds=[buffalo, chicago, pittsburgh, cleveland, denver, seattle, boston, minneapolis, kansas-city, philadelphia, detroit]` | low vs low |

Each preset is read-only metadata. Picking one sets the controls; the operator can edit any field afterwards (which clears the preset attribution but keeps the values).

### Filtering precedence

When the generator runs in expanded mode, the candidate-city pool is built in this exact order:

1. Universe = `expanded_us` (or `seed_12` if seed mode is selected).
2. **Region filter** (`region` ∈ `northeast | southeast | midwest | plains | mountain | southwest | west_coast | pacific_northwest | texas | florida | all_expanded`).
3. **Selected cities override:** if `cityIds[]` is non-empty, region + tags are *both* ignored; the operator's exact selection IS the candidate pool.
4. **Tag filter** (`weatherTags[]` + `tagMode`): keeps cities whose static tag overlay matches per the mode. **Skipped when `cityIds[]` is non-empty.**
5. **Hard cap** (`maxCandidateCities`, ≤ `MAX_EXPANDED_CITIES = 100`).

The audit event summary echoes `tags=[…]:mode` so the trail is unambiguous about which controls drove the run.

### What Step 154 does *not* do

- **No arbitrary tag acceptance.** The API rejects any tag not in the static taxonomy with `400 invalid_weather_tags` (response carries the offending tags).
- **No external climatology fetch.** Tags are hard-coded in the universe module — no network call, no ML inference, no third-party climatology service.
- **No automatic publishing or market creation.** Choosing a preset / applying tags only changes which cities are scanned; Save → Draft → Publish → QA still requires explicit operator action.
- **No public/customer exposure.** Tags + presets live entirely on admin endpoints and admin UI surfaces. `PublicWagerView` is unchanged.
- **No settlement / grading / wallet / pricing / Kalshi / Polymarket changes.** None of those modules are imported by the universe extensions or the API handlers.
- **No weakening of any prior safety rail.** Bounded scans (Step 152), city-id validation (Step 153), risk warnings (Step 150), high-severity confirmation (Step 151), draft duplicate guard (Step 147), publish duplicate guard (Step 148), and post-publish QA (Step 149) all continue to apply to tag- and preset-driven generations exactly as they do to region-only generations.
- **No automatic tag re-derivation from forecasts.** Tags are static metadata about the city's typical climate, not a dynamic property of the next forecast cycle.

## Step 155 — Operator feedback + preset tuning notes

Step 155 lets an admin record structured feedback ("useful / not useful + reason") on every generated idea, then aggregates that feedback into advisory tuning notes per preset / tag / metric pair / target-difference bucket. **No machine learning, no automatic preset mutation, no automatic market action.** The Step-154 presets stay hard-coded in `weather-market-city-universe.ts`; the summary just helps an operator decide when (and how) to manually edit them.

### Where it lives

- **Feedback store** (`src/lib/weather-market-idea-feedback-store.ts`, new): server-only Redis store at `weather-market-idea-feedback:<id>` + sorted set `weather-market-idea-feedbacks:all`. Bounded retention `MAX_FEEDBACK_RECORDS = 1000`. Note cap `FEEDBACK_NOTE_MAX_LEN = 500`. Exposes `FeedbackRating` (3 values) + `FeedbackReason` (9 values) + `WeatherMarketIdeaFeedback` shape with a frozen `ideaSummary` snapshot. Functions: `submitFeedback`, `listFeedback({ limit, presetId, rating, metricPair })`, `getFeedback`. **Imports zero wager-store / settlement / grading / wallet / pricing / publish / Kalshi / Polymarket / forecast modules.** Customer code paths cannot reach `weather-market-idea-feedback:*` keys.
- **Summary aggregator** (`src/lib/weather-market-idea-feedback-summary.ts`, new): pure function `summarizeFeedback(records)` returning per-preset / per-tag / per-metric-pair / per-target-difference-bucket / per-reason counts, useful rates, top negative reasons, and one-sentence advisory tuning notes. Heuristics: ≥ 5 sample → editorialize; useful rate ≥ 60% → "keep current"; ≤ 35% → "consider tuning" with a specific suggestion based on the dominant negative reason; in-between → "borderline, watch the trend". No I/O, no wager imports.
- **API** (`/api/admin/system/weather-market-ideas`, all admin-gated): bootstrap returns `feedbackRatings` + `feedbackReasons` + new caps `feedbackRecordsCap` / `feedbackNoteMaxLen`. New GET actions `list-idea-feedback` (optional `presetId` / `rating` / `metricPair` filters) + `get-feedback-summary` (runs the aggregator over up to 1000 most-recent records). New POST action `submit-idea-feedback` (validates rating + reason allow-lists, requires `ideaSummary` snapshot, caps note length, audits via existing `logAuditEvent` with the new event type `weather_market_idea_feedback_submitted`). **No new persistence beyond the feedback store; no new audit event types beyond the one above; presets remain unchanged.**
- **UI** (`WeatherMarketIdeaGenerator.tsx`): on each generated idea card, a compact feedback row appears below the existing "Use this idea" / "Save idea" controls. Three buttons (Useful / Not useful / Neutral) — clicking "Not useful" reveals a reason dropdown + optional note input + Submit / Cancel. After submission the row collapses to "Feedback recorded: <rating> [· <reason>]" so the operator can see what they marked. In the Smart Discovery panel a "Preset tuning notes" sub-panel shows top-level notes + per-preset rollups (counts, useful rate, top negatives, advisory tuning sentence) + per-tag chips (key: useful% (n)). Refresh button triggers `get-feedback-summary`.

### Feedback reasons (allow-listed vocabulary)

| Reason | Meaning |
|---|---|
| `good_candidate` | Auto-attached to "Useful" ratings — positive signal |
| `too_boring` | Spread too small / market not interesting enough |
| `too_extreme` | Spread too large / market unrealistic / unlikely fill |
| `bad_city_pair` | Cities don't make sense together for the operator's purpose |
| `unclear_market` | Title or rules would confuse a customer |
| `duplicate` | Already similar to an existing live or saved market |
| `wrong_metric_pair` | High-vs-high / low-vs-low / high-vs-low choice was off |
| `poor_forecast_confidence` | Target date too far out / forecast unreliable |
| `other` | Anything else (use `operatorNote` to describe) |

### Tuning-note heuristics (advisory, never auto-applied)

| Condition | Note |
|---|---|
| `total === 0` | "no feedback yet — keep collecting before tuning." |
| `total < 5` | "only N record(s) — keep collecting before tuning (need ≥ 5)." |
| `useful rate ≥ 60%` | "N% useful rate over M record(s) — keep current settings." |
| `35% < useful rate < 60%` | "N% useful rate over M record(s) — borderline, watch the trend." |
| `useful rate ≤ 35%` + dominant `too_boring` | "many marked too boring; consider widening target difference or relaxing the tag filter." |
| `useful rate ≤ 35%` + dominant `too_extreme` | "many marked too extreme; consider lowering target difference or tightening the tolerance." |
| `useful rate ≤ 35%` + dominant `bad_city_pair` | "many marked bad city pair; review the cities the preset / tag set is matching." |
| `useful rate ≤ 35%` + dominant `unclear_market` | "many marked unclear; review the title template / metric pair on the preset." |
| `useful rate ≤ 35%` + dominant `duplicate` | "many marked duplicate of existing markets; tighten the city set or adjust spread granularity." |
| `useful rate ≤ 35%` + dominant `wrong_metric_pair` | "many marked wrong metric pair; consider changing the preset's suggested metric pair." |
| `useful rate ≤ 35%` + dominant `poor_forecast_confidence` | "many marked poor forecast confidence; shorten the day-offset window." |

These notes live in `weather-market-idea-feedback-summary.ts` and are easy to revise. They're advisory only — the operator still picks up `weather-market-city-universe.ts` and edits the `SMART_DISCOVERY_PRESETS` array by hand to actually change a preset.

### Manual preset adjustment workflow

1. Run a preset (e.g. `windy_markets`) for a few days.
2. Mark each generated idea Useful / Not useful (with reason).
3. Open the "Preset tuning notes" panel and click Refresh.
4. Read the per-preset note, e.g. *"windy_markets: 22% useful rate over 18 record(s) — many marked too boring; consider widening target difference or relaxing the tag filter."*
5. Open `src/lib/weather-market-city-universe.ts`, find the `windy_markets` entry in `SMART_DISCOVERY_PRESETS`, edit `targetDifferenceF` / `toleranceF` / `tags` / etc., and ship the change. **No runtime mutation — preset edits are code edits.**

### What Step 155 does *not* do

- **No automatic preset mutation.** The summary's tuning note is a sentence in English. The preset definitions live in code; updating them requires a code change + deploy.
- **No automatic publishing or market creation.** Submitting feedback is purely a Redis write. No `createWager` / `publishWager` call anywhere in the new files.
- **No public/customer exposure.** Feedback records live at `weather-market-idea-feedback:*` and are never read by `/api/wagers`, `/api/wagers/[id]`, `/api/bets*`, or any customer surface. `PublicWagerView` / `PUBLIC_WAGER_VIEW_KEYS` unchanged.
- **No settlement / grading / wallet / pricing / Kalshi / Polymarket changes.** The feedback store and summary aggregator import zero modules from those layers.
- **No idea-action coupling.** Marking an idea Useful does not save it / draft it / publish it. The only effect of feedback is a row in Redis + an audit event.
- **No double-submit guard at the server.** The local UI tracks which ideas you've already rated this session and disables re-rating to prevent accidental spam, but the API will accept multiple feedback records for the same `ideaId` (intentional — operators sometimes change their mind, and the per-rating timestamps make the trail clear).
- **No weakening of any prior safety rail.** Bounded scans (Step 152), city-id validation (Step 153), risk warnings (Step 150), high-severity confirmation (Step 151), draft duplicate guard (Step 147), publish duplicate guard (Step 148), and post-publish QA (Step 149) all continue to apply unchanged.

## Step 156 — Historical outcome memory + interestingness scoring

Step 156 gives the generator a lightweight historical memory: a compact normalized record per resolved / voided wager + a similarity heuristic that, for each generated idea, summarizes how comparable historical markets actually finished (close / blowout / push / void) and combines that with the Step-155 useful-feedback rate into a single 0–100 **operator interestingness** score. **This is admin-only idea-ranking metadata. It is NOT betting advice, NOT a win probability, NOT pricing automation, and NOT predictive modeling.** Banned vocabulary in code/UI: *edge*, *profit*, *value bet*, *should bet*, *likely winner*, *advantage*.

### Where it lives

- **Outcome-memory module** (`src/lib/weather-market-outcome-memory.ts`, new): pure normalizer + scorer + best-effort async loader. **Server-only** for the loader; the normalizer + scorer are pure functions.
  - `normalizeWagerToMemory(w)` — turns a live `Wager` into a compact `WeatherMarketOutcomeMemory` (kind, metricPair, location names, spread bucket, observed values, final margin vs line, close-finish / near-push / blowout / void flags). Only retains `status === 'graded'` or `'void'`. Drops everything else.
  - `fetchOutcomeMemory({ maxScan? })` — async loader that pulls up to `maxScan` (default 200, max 500) wagers via the read-only `weather-market-store-admin` shim. **Best-effort and never throws.**
  - `summarizeSimilarMarkets(idea, memory, options)` — pure rollup. Same kind + same metric pair (any direction) + (same city pair OR same spread bucket). Returns `SimilarMarketOutcomeSummary` with sample count + close/near-push/blowout/void rates + Step 155 useful-feedback rate when supplied.
  - `scoreInterestingness(idea, similar)` — pure scorer. Starts at 50, adds `closeFinishRate × 30` + `nearPushRate × 10` + ±10 for feedback alignment, subtracts `blowoutRate × 20` + `voidRate × 30`, subtracts 25 when sample < 3, clamps to [0, 100]. Label: ≥75 high_interest, ≥60 promising, ≥40 neutral, else low_signal — *unless* sample < 3 in which case the label is `insufficient_history` regardless of score.
  - `scoreIdeaAgainstMemory(idea, memory, feedbackRate?, feedbackSampleCount?)` — convenience wrapper that runs the rollup + score in one call.
  - `fetchFeedbackUsefulRate({ presetId?, metricPair? })` — best-effort feedback-rate lookup keyed by preset (preferred) or metric pair (fallback). Reads via `weather-market-idea-feedback-store`.
  - **Imports zero settlement / grading / wallet / pricing / publish / Kalshi / Polymarket / forecast modules.** The only `wager-store`-shaped import is `listAllWagers` via the read-only shim.
- **Generator integration** (`weather-market-idea-generator.ts`):
  - `WeatherMarketIdea.outcomeInterestingness?: { score, label, reasons[], sampleCount }` is the new field. Always optional.
  - After ranking + slicing, the generator runs `await Promise.all([fetchOutcomeMemory(), fetchFeedbackUsefulRate({ metricPair })])` and scores each top idea. **Wrapped in try/catch** — on failure, ideas are emitted without the score and a single warning is appended.
  - When memory loads but is empty (no resolved markets yet), every idea gets `label: 'insufficient_history'` + a single explanatory reason rather than no field at all.
- **API:** No new actions. The existing `generate` response carries the new field on each idea — clients see it under `result.ideas[i].outcomeInterestingness`.
- **UI:** Each generated idea card gains an `<details>` interestingness badge (color-coded label + score `N/100` + sample count) that expands to show the reason bullets + the static caption "Admin-only idea ranking. Not betting advice." A **Sort** selector above the grid lets the operator switch between Default ranking / Closest to target Δ / Highest interestingness without re-running generation.

### Score components (component → effect)

| Component | Effect |
|---|---|
| `closeFinishRate × 30` | +0 to +30 — historically close finishes mean operationally interesting |
| `nearPushRate × 10` | +0 to +10 — small bonus for near-push frequency |
| Feedback useful rate ≥ 60% (n>0) | +10 — operator validation of similar generator runs |
| Feedback useful rate ≤ 30% (n>0) | −10 — operator pushback on similar generator runs |
| `blowoutRate × 20` | −0 to −20 — historically blowouts are boring |
| `voidRate × 30` | −0 to −30 — historically problematic / unsettleable |
| Sample < `MIN_HISTORY_SAMPLE` (3) | −25 + label flips to `insufficient_history` |
| Idea has beyond-horizon warning | −10 — forecast confidence will be lower |
| Floor / ceiling | clamp to [0, 100] |

The numbers are advisory and easy to tune in `weather-market-outcome-memory.ts` — they're constants at the top of the file.

### Sample-size caution

Below `MIN_HISTORY_SAMPLE = 3` matches the label is `insufficient_history` regardless of score. The reasons list always tells the operator how many records the score is built on so a sample of 1 cannot be confused with a sample of 50. The summary helper additionally returns up to 5 example wager ids for hover/expansion in a future step.

### Prohibited language

The score and reasons are deliberately framed as **operator interestingness**, not market value. Code reviewers and the docs explicitly prohibit:

- *edge*, *profit*, *value bet*, *should bet*, *likely winner*, *advantage*

These words are checked by grep at validation time. The actual score copy talks about close finishes, blowouts, voids, operator feedback rates, and sample size — never about "this is a winner" or "we have an edge."

### What Step 156 does *not* do

- **No automatic publishing or market creation.** The score only reorders the ideas the operator sees.
- **No customer exposure.** `PublicWagerView` is unmodified; the new field never enters the public allow-list.
- **No settlement / grading / wallet / pricing changes.** The outcome-memory loader uses the read-only `weather-market-store-admin` shim; no mutator import.
- **No predictive modeling / ML.** The score is a 6-component weighted sum over compact heuristic features. Adding a real model would be a separate, explicitly-flagged step.
- **No win-probability claims.** The label vocabulary (`high_interest` / `promising` / `neutral` / `low_signal` / `insufficient_history`) is operator-workflow language, not bet-evaluation language.
- **No idea-action coupling.** A high score does not auto-save / auto-draft / auto-publish anything. The operator still goes through Save → Draft → Publish → QA exactly as before.
- **No mutation of the historical wager records.** The loader is read-only; settlement remains the sole way `observedValueA` / `observedValueB` get set.

## Step 157 — Operator-facing explanation layer

Step 157 consolidates the signals already on a generated idea (target-difference closeness, smart preset / tag context, cross-metric / horizon caveats, Step-150 risk warnings, Step-156 interestingness) into a short, four-section explanation the operator can read in a glance. **Admin-only operator guidance. Never customer-facing. Never betting advice.** Banned vocabulary (`edge`, `profit`, `value bet`, `should bet`, `likely winner`, `easy money`, `lock`) is checked by grep at validation time.

### Where it lives

- **Builder** (`src/lib/weather-market-idea-explanations.ts`, new): single pure function `buildIdeaExplanation(idea, options)` returning `WeatherMarketIdeaExplanation`. No I/O, no mutation, no imports beyond types. Inputs: the idea + optional `riskWarnings[]` + optional `presetId` / `weatherTags[]` / `targetDifferenceF` / `toleranceF`.
- **API integration** (`/api/admin/system/weather-market-ideas` `handleGenerate`): after the Step-150 risk-warning analysis runs, the API calls `buildIdeaExplanation(idea, { riskWarnings, presetId, weatherTags, targetDifferenceF, toleranceF })` for each idea and attaches the result to `idea.explanation`. **Wrapped in try/catch** — non-fatal; ideas still ship without explanations on any error.
- **UI**: per-card `<details>` block. The summary row shows a caution chip (low / medium / high) + the one-line `operatorSummary`. Expanding reveals four bullet groups: **Why suggested**, **What makes it interesting**, **Risks to review** (amber), **Before creating, check**. Footer: "Admin-only idea guidance. Not betting advice."

### Fields

```ts
interface WeatherMarketIdeaExplanation {
  whySuggested: string[];
  whyInteresting: string[];
  riskSummary: string[];
  preCreationChecklist: string[];
  operatorSummary: string;            // one-line collapsed-card header
  cautionLevel: 'low' | 'medium' | 'high';
}
```

### Caution-level rules

| Trigger | Caution |
|---|---|
| Any Step-150 risk warning at `severity: 'high'` | **high** |
| Any Step-150 warning at `severity: 'warning'` (no high) | **medium** |
| Step-156 sample < 3 (`insufficient_history`) | **medium** |
| Idea carries a beyond-horizon warning | **medium** |
| Cross-metric pair (high vs low) | **medium** |
| None of the above | **low** |

### Content rules

The bullets are templated in `weather-market-idea-explanations.ts` and easy to revise. They speak the operator's language:

- ✅ "Forecasted difference is within 1.5°F of your requested target of 20°F."
- ✅ "This uses a clear high-vs-low contrast across different weather regions."
- ✅ "Historical sample is below the 3-record threshold — interestingness is based mostly on forecast contrast, not history."
- ✅ "High-severity duplicate warnings are present; review related markets before publishing."
- ✅ "Confirm the spread sign matches the intended side (+22°F on the A side)."

Prohibited (grep-enforced):

- ❌ *edge*, *profit*, *value bet*, *should bet*, *likely winner*, *easy money*, *lock*
- ❌ Any customer-facing gambling-advice language

### Signal → explanation mapping (the rules the builder applies)

| Signal | Goes into |
|---|---|
| `closenessToTarget ≤ toleranceF` | whySuggested ("within N°F of your requested target") |
| `presetId` | whySuggested ("Surfaced by the … smart-discovery preset") |
| `weatherTags[]` | whySuggested ("Filtered by the tags …") |
| `absDifference ≥ 20` | whyInteresting ("Large forecasted spread …") |
| Cross-region pair | whyInteresting ("Cross-region pair (… vs …)") |
| Cross-metric (high vs low) | whyInteresting + preCreationChecklist (cross-metric reminder) |
| `outcomeInterestingness.label !== insufficient_history` | whyInteresting (score + sample size, with "not betting advice" disclaimer) |
| Step-150 `severity: 'high'` count | riskSummary (+ caution=high) |
| Step-150 `severity: 'warning'` count | riskSummary (+ caution=medium) |
| `insufficient_history` | riskSummary ("sample below 3-record threshold …") |
| `voidRate` reason on the interestingness | riskSummary (echoes the void-rate sentence) |
| Beyond-horizon warning | riskSummary ("beyond reliable forecast horizon") |
| Always | preCreationChecklist (spread-sign verification + city/date verification) |
| Cross-metric | preCreationChecklist (verify metricA/metricB labels in wager preview) |
| `severity: 'high' \| 'warning'` present | preCreationChecklist (open related markets before publishing) |

### What Step 157 does *not* do

- **No betting advice / no "likely winner" / no value language.** Vocabulary is grep-enforced.
- **No public/customer surface.** `explanation` is admin-only and never enters the `PublicWagerView` allow-list.
- **No automatic publishing or market creation.** The explanation is text that shows up on the card; it changes no behavior.
- **No new persistence surface.** Saved ideas / drafts / QA records do not currently capture an explanation snapshot — the explanation is recomputed from the live idea fields each generation. Capturing it on save is a Step-158+ candidate when the operator asks for it.
- **No settlement / grading / wallet / pricing changes.** The explanation builder imports no modules from those layers.
- **No mutation of any existing field.** The builder only sets `idea.explanation` to a new object; everything else on the idea is untouched.

## Step 159 — Admin daily market brief

Step 159 adds a single-screen operator overview at `/admin/system/weather-market-daily-brief`. **Admin-only situational awareness.** The brief is a read-only summary — it never publishes, creates, voids, grades, settles, prices, or modifies anything. It does not change any existing workflow.

### Where it lives

- **Aggregator** (`src/lib/weather-market-daily-brief.ts`, new): single async `buildDailyBrief()` function. Reads from the existing stores in parallel via `Promise.all`: `listSavedIdeas`, `listDraftWagers`, `listMarketQA`, `listFeedback`, `fetchRiskUniverse`, and the read-only `listAllWagers` shim from Step 150. **Each store call is wrapped in `try/catch`** so a failure in one subsystem does not 500 the brief — the affected sections come back empty and `subsystemStatus.<name>` is set to `'failed'`. Imports zero `createWager` / `publishWager` / `voidWager` / `gradeWager` / `settleWagerBets` / `markDraftPublished` / wallet / settlement / Kalshi / Polymarket modules.
- **API** (`src/pages/api/admin/system/weather-market-daily-brief.ts`, new): GET-only, admin-gated via `requireAdmin`. Returns `{ brief: WeatherMarketDailyBrief }` with `Cache-Control: private, max-age=30`.
- **UI** (`src/components/admin/WeatherMarketDailyBrief.tsx`, new): React component fetching the API and rendering eight scannable sections.
- **Page** (`src/pages/admin/system/weather-market-daily-brief.astro`, new): Astro shell + `SystemNav`.
- **Nav**: a new entry in the Execution & Economics group right after **Weather Market Ideas**.

### Sections

| Section | Source | Cap | Tone |
|---|---|---|---|
| Today's highlights | Saved ideas created in the last 24h, ranked by Step-156 interestingness score | 8 | positive when label is `high_interest` / `promising` |
| Interesting markets | Active saved ideas with label `high_interest` or `promising` | 8 | positive / info |
| Risk alerts | Saved ideas / drafts / QA-targeted wagers carrying severity:'high' warnings from `analyzeRisk` | 8 | high |
| QA queue | `MarketQA` records in `pending` or `needs_changes`, with `stuck` flag when pending > 72h | 8 | needs_changes → high; stuck pending → warning |
| Drafts awaiting action | Drafts older than 48h still in `status='draft'`, sorted oldest first | 8 | warning |
| Recently published | Drafts marked `published` in the last 48h | 8 | positive |
| Feedback signals | `summarizeFeedback().byPreset` per-preset rollups (useful rate + tuning note) | 8 | positive ≥60% useful, warning ≤35% useful |
| Tuning signals | `summarizeFeedback().topLevelNotes` advisory sentences | 8 | info |
| Operational notes | Plain-text bullets (insufficient-history rate, beyond-horizon rate, stuck QA, stale-draft counts, failed subsystems) | n/a | info |

### Headline

A one-line summary built from the section counts. Examples:

- "3 high-interest idea(s) saved today; 2 draft wager(s) awaiting action; 1 high-severity risk warning(s)."
- "Quiet day — no high-interest ideas, drafts, QA, or risk alerts surfacing right now."
- "...; (some subsystems failed to load)" — appended when any subsystem returned `failed`.

### Counts strip

Six metrics shown as colored chips above the headline: active ideas, active drafts, QA pending, QA needs-changes, high-severity warnings, recently published. Colors switch tone when a counter is non-zero (warning / high) so the operator's eye finds the alerting numbers without reading the sections.

### Graceful failure

The brief is intentionally a *partial* surface. Each store loader catches its own failure and returns an empty array; the section builders run on whatever data they were given. A non-zero failed-subsystem set surfaces an amber strip ("Partial degradation: …") above the sections and the operational-notes block also lists the failed subsystem names. **A single Redis flake never causes a 500 from the daily-brief endpoint.**

### What Step 159 does *not* do

- **No public/customer surface.** The brief is admin-gated by `requireAdmin` and uses a `private` cache header.
- **No automatic publishing or market creation.** The aggregator and the API call zero of: `createWager`, `voidWager`, `gradeWager`, `updateWager`, `lockExpiredWagers`, `settleWagerBets`, `markDraftPublished`.
- **No automatic dismissal of warnings or auto-resolution of QA.** All workflow state changes still happen through the Step 146/147/148/149/150/151/155 surfaces in the existing Weather Market Ideas admin page.
- **No new persistence.** Every read is on an existing store. No new Redis namespace, no new audit event types.
- **No wallet / balance / settlement / grading / Kalshi / Polymarket changes.** Trust footprint is the read-only stores + the Step-150 read-only wager shim.
- **No betting advice.** The same prohibited vocabulary policy from Step 157 applies — the brief surfaces operator-tracking signals, never gambling guidance.
- **No new public exposure of admin notes.** Section subtitles reference snapshot fields only; raw operator notes from saved ideas / drafts / QA are not rendered.

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
