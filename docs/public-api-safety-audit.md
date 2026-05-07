# Public API Safety Audit

**Last updated:** Step 120 (commit reference at the top of `project_wageronweather` memory).

This document enumerates every customer/public-facing route on the platform, the sanitizer protecting each one, the fields that are intentionally public, and the fields that must never cross the trust boundary.

It does NOT cover admin routes (everything under `/admin/*` and `/api/admin/*`); those are gated by `requireAdmin` and may surface internal data by design.

---

## Trust boundary

- **Public surface:** `/`, `/wagers`, `/wagers/[id]`, `/venues/*`, and any `*.astro` page that lacks `requireAdmin` / `requireUser`. Plus every `*.ts` API route under `src/pages/api/` that is not under `api/admin/`. These are reachable by anonymous browsers.
- **Authenticated user surface:** `/api/auth/*`, `/api/bets*`, `/api/payments/*`. Gated by `requireUser`. May expose user-private data (their own balance, their own bets) but not admin-only data.
- **Admin surface:** Everything under `/admin/*` and `/api/admin/*`, gated by `requireAdmin`. Allowed to expose any internal data to authenticated admins.

The canonical public-safe wager object is **`PublicWagerView`** (`src/lib/public-wager-view.ts`). Raw `Wager` records must NEVER cross the public surface.

---

## Customer-facing routes (anonymous)

| Route | Method | Sanitizer | Notes |
|---|---|---|---|
| `/api/wagers` | GET | `listPublicWagers` + `serializePublicWagers` | Public wager list. **Hardened in Step 120 Part A** — previously returned raw `Wager` objects from `listWagers`. |
| `/api/wagers/[id]` | GET | `getPublicWager` + `serializePublicWager` | Public wager detail. **Hardened in Step 120 Part A** — previously returned the raw `Wager` from `getWager`. |
| `/wagers` (Astro page) | SSR | `listPublicWagers` (server-rendered) | Page renders from the sanitized view; never spreads a raw `Wager` into props. |
| `/wagers/[id]` (Astro page) | SSR | `getPublicWager` | Same. |
| `/` (Astro page) | prerender=true | n/a (static) | Hero + sports forecast CTA + weather-markets sections (`HomeHero`, `FeaturedMarkets`, `HowItWorks`, `TrustSafetyStrip`). `FeaturedMarkets` is a client island that hits `/api/wagers?status=open&limit=6` (sanitized). |
| `/api/forecast`, `/api/historical`, `/api/geocode`, `/api/reverse-geocode`, `/api/openaq`, `/api/records`, `/api/venues`, `/api/map-grid`, `/api/weather/historical-averages` | GET | n/a (no wager data) | These are public weather/geo endpoints; they do not touch the wager store. |

---

## Authenticated user routes

These require `requireUser`. They may expose user-private data but must not expose admin-only fields belonging to other users or markets.

| Route | Sanitizer / scope |
|---|---|
| `/api/bets` POST/GET | Operates on the user's own bets only via `placeBet` / `getUserBetsEnriched`. **Step 120 does not modify these paths.** Bets carry wager metadata that should be limited to public-safe fields; this is in-scope for a future audit, not Step 120. |
| `/api/bets/[id]` | Same scope. |
| `/api/payments/*` | User payment ledger; not in Step 120 scope. |
| `/api/auth/*` | Session lifecycle; no wager fields. |

---

## PublicWagerView — canonical public schema

Defined in `src/lib/public-wager-view.ts`. The allow-list is **`PUBLIC_WAGER_VIEW_KEYS`**. Public APIs MUST run their output through `serializePublicWager` / `serializePublicWagers` so any stray field is dropped at the JSON boundary.

### Intentionally public (allowed on every public response)

```
id, ticketNumber, title, description, kind, status,
metric, targetDate, targetTime, lockTime,
locationSummary, termsSummary, outcomes, displayedOdds,
resolutionRules, weatherDataExplanation,
winConditionSummary, tieOrPushSummary, lockSummary, resolutionSourceSummary,
responsiblePlayNote, lastUpdatedAt, createdAt,
resolvedAt?, voidedAt?,
winningOutcome?, observedValue?, observedValueA?, observedValueB?
```

`outcomes[]` carries only `{ label, displayedOdds?, isWinner? }` — no pricing model, no opening/closing snapshot, no internal naming.

### Forbidden on public responses

These fields exist on the raw `Wager` record but are stripped by `toPublicWagerView` and deliberately omitted from `PublicWagerView`:

- `voidReason` — operator-authored free text. Use the generic "This market was cancelled before resolution." copy instead.
- `internalName` — admin-facing market name.
- `pricingSnapshot` — model output at creation time.
- `openingLineSnapshot`, `closingLineSnapshot` — line history.
- `lineHistory` — admin line-move audit trail.

These artifacts live in adjacent admin systems and must NEVER be referenced on a public response:

- Settlement previews (`wager-settlement-preview.ts`)
- House exposure snapshots (`house-exposure.ts`)
- Market integrity reports (`market-integrity.ts`)
- Audit log entries (`audit-log.ts`, `audit-investigation.ts`)
- Disputes / incidents (`dispute-workflow.ts`, `incident-management.ts`)
- Operator notes / runbooks (`daily-operator-runbook.ts`)
- Operator certifications / RBAC (`operator-certification.ts`, `operator-rbac-review.ts`)
- Pricing recommendations / margin engine (`wager-pricing-engine.ts`)
- Market design reviews (`wager-market-design.ts`)
- Internal confidence scores (anywhere)
- Raw weather evidence records (`weather-evidence.ts`)
- Kalshi market data, comparisons, hedge reviews (`kalshi-*.ts`, `manual-hedge-review.ts`)

---

## Defensive serialization

`serializePublicWager` in `public-wager-view.ts` picks ONLY the canonical fields by name. It never spreads the input. Even if a future caller accidentally hands a raw `Wager` to the function (or merges admin fields into a `PublicWagerView`), the JSON response stays clean.

**Rule:** every new public API that returns wager data MUST call `serializePublicWager` / `serializePublicWagers` immediately before `JSON.stringify`. Type-checking alone is not enough — TypeScript will let a wider object satisfy the narrower interface and the extra fields will leak.

---

## Public components

Front-end components under `src/components/public/` consume only `PublicWagerView` typed props. They do not import from `wager-store`, `wager-types` (raw), `bet-store`, `wallet-store`, `house-exposure`, or any Kalshi/audit/integrity module. Verified components (Step 120 Part D):

- `WagerCard.tsx`
- `PublicWagerList.tsx`
- `WagerDetailPage.tsx`
- `WagerTimeline.tsx`
- `WagerRulesCard.tsx`
- `WagerFAQ.tsx`
- `WhyTrustThisMarket.tsx`
- `FeaturedMarkets.tsx`
- `HomeHero.tsx`, `HowItWorks.tsx`, `TrustSafetyStrip.tsx` (no wager data)

---

## Kalshi data boundary

Kalshi market snapshots (`kalshi-market-data.ts`), comparisons (`kalshi-market-comparison.ts`), and hedge reviews (`manual-hedge-review.ts`) live entirely behind `requireAdmin`. Their Redis keys (`kalshi-market-snapshot:*`, `kalshi-comparison:*`, `hedge-review:*`) and their API routes (`/api/admin/system/kalshi-*`, `/api/admin/system/manual-hedge-review`) are admin-only. **No public surface reads these keys, calls these routes, or imports these modules.**

`KALSHI_PRIVATE_KEY` / `KALSHI_PRIVATE_KEY_BASE64` is read only by `kalshi-config.ts` (server-only, browser-import throws). The decoded key value is never returned from any helper, never logged, and never sent in any response body.

---

## How to add a new public route safely

1. Decide what the route returns. If it is wager data, the answer is `PublicWagerView` (or an array of them).
2. Use `getPublicWager` / `listPublicWagers` to read from the store. Never call `getWager` / `listWagers` directly from a public route.
3. Pass the result through `serializePublicWager` / `serializePublicWagers` before `JSON.stringify`.
4. Add the route to the table at the top of this document.
5. If the route returns a different shape (not wager data), define an explicit allow-list type and a sibling `serializeXxx` helper. Apply the same "pick by name, never spread" rule.
6. Add a unit-style assertion or a comment explaining the trust boundary.

---

## Known gaps / follow-ups

- `/api/bets` and `/api/bets/[id]` return enriched bet records that include wager metadata. Verify the wager fields they expose are a subset of `PublicWagerView` (or restrict them explicitly). Out of scope for Step 120; capture as a future hardening step.
- The `Wager` record's `voidReason` is occasionally read by admin views (and intentionally so). Audit any new admin component to confirm it is rendered only behind `requireAdmin`.
