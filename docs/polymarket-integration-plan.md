# Polymarket Integration Plan

**Status:** Foundation only (Step 124). No live trading. No external order placement. No wallet connection. No API calls implemented yet.

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

### Phase 2 — Read-only market discovery

- Server-side fetcher against `https://gamma-api.polymarket.com` (Polymarket's public Gamma API).
- Normalize Polymarket weather market metadata to an internal shape suitable for snapshotting and comparison.
- Allow-list of expected fields; defensive parsing; no spread of raw API responses into our types.
- Admin-only API route under `/api/admin/system/polymarket-*`. No public/customer route.
- Connectivity test helper with sanitized error mapping.

### Phase 3 — Snapshot persistence

- Persist Polymarket market snapshots in Redis (`polymarket-market-snapshot:*`, `polymarket-market-snapshots:all`) with a retention cap (target: 200, matching Kalshi).
- Server-side TTL list cache for repeated queries.
- Audit events `polymarket_market_snapshot_fetched`, `polymarket_connectivity_test` reusing `src/lib/audit-log.ts` (no Polymarket-specific audit system).
- Admin UI under `/admin/system/polymarket-market-data` — read-only, persistent advisory banner.

### Phase 4 — Three-way comparison

- Extend the existing comparison tooling to support a three-way analysis: WagerOnWeather internal fair price vs. Kalshi vs. Polymarket.
- Token-based market matching across all three venues by metric / location / target date.
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

## 6. Out of scope for Step 124

This step does **not** implement:

- Any Polymarket API call
- Any Polymarket data ingestion
- Any Polymarket UI surface (admin or public)
- Any three-way comparison
- Any wallet, signer, or key management

The deliverables of Step 124 are limited to: this plan document, `src/lib/polymarket-config.ts` server-only constants, an update to the Kalshi plan acknowledging Polymarket as a parallel external venue, and a Step 124 note in the public API safety audit.
