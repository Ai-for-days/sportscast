# Polymarket Integration Plan

**Status:** Phase 2 live (Steps 124 + 126). Read-only weather market discovery against the public Gamma API, admin-only UI/API/snapshots. No live trading. No external order placement. No wallet connection.

## 1. Purpose

Polymarket is treated as an **external prediction-market intelligence source** alongside Kalshi — not a partner or customer-facing feature. WagerOnWeather will use Polymarket data to:

- Monitor weather-market activity at <https://polymarket.com/weather>
- Capture rules / resolution methodology for each Polymarket weather market
- Snapshot prices, implied probabilities, and (when available) volume / liquidity metadata
- Compare Polymarket weather markets against WagerOnWeather and Kalshi for stale lines, ambiguous rules, or mispricing
- Inform manual operator decisions about local market design and risk posture

The integration is intentionally a long, gated build-out. Each phase ships behind read-only / admin-only gates and is reviewed before the next phase begins.

## 2. Safety model

The platform-wide rules continue to apply — humans remain in control, no autonomous trading, no automatic wager creation, no automatic grading/voiding/settlement. Polymarket-specific rules:

### Allowed (read-only)

- Market discovery (list, single market lookup)
- Rules / resolution methodology capture
- Price and probability snapshots
- Volume / liquidity metadata when exposed by Polymarket's public APIs
- Three-way comparison: WagerOnWeather internal fair price vs. Kalshi vs. Polymarket
- Admin-only review surfaces

### Forbidden

- **No order placement.** WagerOnWeather will not submit orders to Polymarket.
- **No wallet connection.** No Web3 wallet, no signer, no key custody, no transaction signing.
- **No private-key handling.** No signing material is loaded, stored, or referenced anywhere in the codebase.
- **No auto-trading, auto-hedging, or auto-mirroring.** Every trading decision remains human-initiated and human-confirmed outside the platform if it happens at all.
- **No automatic WagerOnWeather market creation** based on Polymarket data.
- **No public/customer exposure.** No Polymarket data is rendered on any anonymous or `requireUser`-gated page or API. All Polymarket surfaces are admin-only.
- **No background jobs that trade.** Schedulers may fetch metadata; they may not place or sign anything.

## 3. Planned phases

### Phase 1 — Config + docs (this step)

- `docs/polymarket-integration-plan.md` (this file)
- `src/lib/polymarket-config.ts` — server-only constants. No secrets, no signing helpers, no client-side exports.
- `docs/kalshi-integration-plan.md` updated to acknowledge Polymarket as a parallel external venue.
- `docs/public-api-safety-audit.md` updated to document the read-only, admin-only posture.

### Phase 2 — Read-only market discovery (implemented in Step 126)

- ✅ Server-side fetcher against `https://gamma-api.polymarket.com` (Polymarket's public Gamma API) — `src/lib/polymarket-client.ts`. Browser-import throws.
- ✅ Normalize Polymarket weather market metadata to an internal shape suitable for snapshotting and comparison — `PolymarketMarketSummary` (id, question, slug, url, category, active/closed/archived/acceptingOrders, endDate, outcomes, outcomePrices, volumeUsd, liquidityUsd, tags, rawSource).
- ✅ Allow-list of expected fields; defensive parsing; no spread of raw API responses into our types — `normalizeMarket()` picks fields by name and parses JSON-string outcome arrays defensively.
- ✅ Admin-only API route — `/api/admin/system/polymarket-market-data` (`requireAdmin`-gated). Actions: `list-snapshots`, `get-snapshot`, `discover-weather-markets`, `test-connectivity`. No public/customer route.
- ✅ Connectivity test helper with sanitized error mapping — `testPolymarketConnectivity` returns `ok / polymarket_error / network_error` codes only.
- ✅ Persistent snapshot store — `src/lib/polymarket-market-store.ts` writes to Redis `polymarket-market-snapshot:*` + sorted set `polymarket-market-snapshots:all`, retention 200 (matching Kalshi).
- ✅ Audit events `polymarket_market_snapshot_fetched`, `polymarket_connectivity_test` via `src/lib/audit-log.ts` (no Polymarket-specific audit system).
- ✅ Admin UI under `/admin/system/polymarket-market-data` — `PolymarketMarketDataCenter.tsx` with Status / Discover / Snapshots / Uses / Methodology tabs and a persistent advisory banner.

### Phase 3 — Three-way comparison foundation (deferred)

- Cache layer (TTL list cache) and historical depth/orderbook capture.
- Token-based market matching across all three venues by metric / location / target date.

### Phase 4 — Three-way comparison UI

- Extend the existing comparison tooling to support a three-way analysis: WagerOnWeather internal fair price vs. Kalshi vs. Polymarket.
- Confidence scoring; pricing-gap detection; advisory verdicts only.
- Admin-only UI; read-only.

### Phase 5 — Manual operator review

- Surface Polymarket findings in the existing manual hedge review and market-design review workflows.
- All recommendations advisory-only. Any external action is taken outside the platform by the operator.
- No order placement, no auto-execution, no signing — even in this phase.

## 4. Required future safety gates

Before any phase that *could* place external orders (none planned, but documented for posterity):

- **READ_ONLY mode** — environment flag (`POLYMARKET_READ_ONLY`) defaults to `true`; mutating Polymarket calls are physically blocked when set.
- **No background jobs that sign.** Scheduled tasks may read; only operator-driven flows could ever sign.
- **Explicit operator confirmation** — every external order would require per-order operator confirmation; no batch placement without per-item review.
- **Audit logging** — every Polymarket call (read or write) is recorded with operator identity, timestamp, request shape (no secrets), and outcome.

## 5. Conventions

### Endpoint constants

- `POLYMARKET_WEATHER_URL` = `https://polymarket.com/weather` — the human-facing landing page operators use to identify markets to track.
- `POLYMARKET_GAMMA_API_BASE` = `https://gamma-api.polymarket.com` — Polymarket's public read-only metadata API. No authentication required for reads.

### No credentials format

There are no Polymarket credentials. Reading the Gamma API does not require authentication. There is no `POLYMARKET_PRIVATE_KEY`, no `POLYMARKET_API_KEY`, no wallet seed.

### Audit logging

- Phase 3 will reuse `src/lib/audit-log.ts` (`logAuditEvent`) — no Polymarket-specific audit system. Event types are namespaced (`polymarket_market_snapshot_fetched`, etc.) so investigators can filter on them.

## 6. Out of scope for Step 126

Step 126 implements Phase 2 — read-only weather discovery, snapshot persistence, admin UI/API. It does **not** implement:

- Any Polymarket order, wallet, or signing code (forbidden indefinitely)
- Three-way comparison UI (Phase 4)
- Manual hedge-review linkage to Polymarket findings (Phase 5)
- Historical / orderbook depth capture
- TTL list cache for repeated discovery queries (deferred — current snapshots are written every run)

The Step 126 deliverables are: `src/lib/polymarket-client.ts`, `src/lib/polymarket-market-store.ts`, `/api/admin/system/polymarket-market-data` admin API, `PolymarketMarketDataCenter.tsx` admin UI, `/admin/system/polymarket-market-data.astro` page, `SystemNav` entry, and updates to this plan, `docs/kalshi-integration-plan.md`, and `docs/public-api-safety-audit.md`.
