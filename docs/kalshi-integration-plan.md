# Kalshi Integration Plan

**Status:** Read-only Phase A live (Steps 117B–119). No live trading. No external order placement.

**Step 124 update:** WagerOnWeather now treats Kalshi and Polymarket as **parallel external market-intelligence venues**. Future comparison tooling should support a three-way analysis: WagerOnWeather internal fair price vs. Kalshi vs. Polymarket. All external-venue workflows remain read-only / manual-only unless separately approved per-venue. See `docs/polymarket-integration-plan.md` for the Polymarket counterpart plan.

## 1. Purpose

Kalshi is treated as an **external market / competitor venue**, not a partner or customer-facing feature. Integration on WagerOnWeather is intended to support, in future phased steps:

- External weather-market data ingestion (markets, prices, order books)
- Market comparison between Kalshi weather markets and WagerOnWeather markets
- Arbitrage monitoring (advisory only)
- Personal trading decision support for the operator (private/admin-only)
- Optional manual hedging analysis
- Future market mirroring review (operator-curated, never automatic)

The integration is intentionally a long, gated build-out. Each phase ships behind read-only / demo gates and is reviewed before the next phase begins.

## 2. Safety model

The platform-wide rules from prior steps continue to apply — humans remain in control, no autonomous trading, no automatic wager creation from analytics, no automatic grading/voiding/settlement, no automatic RBAC changes. Kalshi-specific rules:

- **Read-only first.** All initial work fetches data; no orders are placed.
- **Manual trading only.** Any future trading must require an explicit operator confirmation flow.
- **No autonomous external order placement.**
- **No automatic hedging.** Hedging is presented as analysis; execution is manual.
- **No automatic WagerOnWeather market creation.** Mirroring requires human approval.
- **No automatic mirroring.** Operators choose which Kalshi markets, if any, inspire local markets.
- **No client-side secrets.** Credentials live server-side only; the private key is never sent to the browser, returned from APIs, or written to logs.
- **No background jobs that trade.** Schedulers may fetch data; they may not place or cancel orders.

## 3. Planned phases

### Phase A — Read-only Kalshi data ingestion
- Fetch Kalshi markets (list, single)
- Fetch order books / prices
- Normalize Kalshi market data to an internal shape
- Store snapshots (Redis or BigQuery) for downstream comparison
- No orders, no auth-protected mutating endpoints

### Phase B — Market comparison
- Compare Kalshi weather markets to WagerOnWeather markets by metric/location/target date
- Compare implied probabilities (Kalshi mid vs. WagerOnWeather posted odds)
- Flag pricing gaps for operator review
- Display in admin-only UI

### Phase C — Arbitrage monitoring
- Identify potential mispricing across the two venues
- Advisory dashboard only — no order placement, no automatic alerts that initiate action
- Operator decides whether to act outside the platform

### Phase D — Personal trading tools
- Private admin-only trading dashboard for the operator's own account
- Manual decision support — no customer-facing signals or recommendations
- Personal-trading data is segregated from platform liability and from public-facing surfaces

### Phase E — Hedging analysis
- Suggest possible hedge ideas given current platform exposure
- Show estimated risk reduction
- No hedge execution — analysis only

### Phase F — Market mirroring review
- Identify Kalshi markets that could inspire WagerOnWeather markets
- Require human approval before any local market is created
- Approval workflow logs the inspiration source for audit

### Phase G — Manual external trading workflow
- Future step only; not in scope for this foundation
- Explicit human confirmation per order
- Behind READ_ONLY/test-mode gates first
- Demo mode required before live trading is considered

## 4. Required future safety gates

Before any phase that places external orders, the following gates must be in place and active:

- **READ_ONLY mode** — environment flag (`KALSHI_READ_ONLY`) defaults to `true`; mutating Kalshi calls are physically blocked when set
- **Demo mode before live** — `KALSHI_ENV=demo` is the default; live mode requires an explicit configuration change and a separate audit trail
- **Explicit operator confirmation** — every external order requires a per-order operator confirmation; no batch placement without per-item review
- **Audit logging** — every Kalshi call (read or write) is recorded with operator identity, timestamp, request shape (no secrets), and outcome
- **No background jobs that trade** — scheduled tasks may read; only operator-driven flows may write
- **No automatic order placement** — under any condition, order placement requires a human in the loop

## 5. Conventions

### Credentials format
- Prefer `KALSHI_PRIVATE_KEY_BASE64`: base64-encoded PEM (single-line value, decoded server-side). Multi-line PEMs in `.env` files are routinely mangled by loaders.
- `KALSHI_PRIVATE_KEY` (raw PEM) remains accepted for backward compatibility with older code paths.
- The decoded private key value is never returned from any helper, logged, or shipped to the browser.

### Audit logging
- Phase A reuses the existing `src/lib/audit-log.ts` (`logAuditEvent`) — no Kalshi-specific audit system. Event types are namespaced (`kalshi_market_snapshot_fetched`, etc.) so investigators can filter on them in the existing audit timeline.

## 6. Out of scope for Step 117B

This step does **not** implement:

- Any Kalshi API call
- Any external order placement
- Any auto-hedging
- Any auto-market mirroring
- Any automatic WagerOnWeather market creation
- Any UI surface for Kalshi (admin or public)

The deliverables of Step 117B are limited to: this plan document, `.env.example` placeholders, and an optional server-only config helper that exposes presence of credentials without leaking the private key.
