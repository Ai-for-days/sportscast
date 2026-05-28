# Crypto Paper Portfolio (Step 161)

**Paper trading only. Research only. Not financial advice.**

A side-effect-free $100,000 model bankroll for hypothetically running crypto signals through a sized, risk-gated portfolio. Lives under `/admin/system/crypto-paper-portfolio`. **Admin-only.**

## Hard non-goals (load-bearing)

- **No exchange or broker APIs.** No Coinbase / Binance / Kraken / FTX / Gemini / Bybit / OKX SDK is imported anywhere in this module.
- **No wallet code.** No private-key handling, no signing, no `walletConnect` / `web3` / `ethers` / `viem` import.
- **No order routing.** No `createOrder` / `placeOrder` / `submitOrder` / `sendTransaction` call anywhere.
- **No outbound email.** No SMTP / SES / SendGrid / Resend / Mailgun / Postmark / nodemailer client is configured in this build.
- **No customer or public surface.** Everything sits behind `requireAdmin`. The state key (`crypto-paper-portfolio:state`) is in its own Redis namespace.
- **No effect on the wager / weather-market workflow.** This module imports zero `wager-store` / `nws-grading` / `settlement` / `wallet` / `pricing` code.

## Architecture

```
src/lib/crypto-paper-portfolio.ts          ← types, Redis store, pure helpers
src/lib/crypto-paper-trade-simulator.ts    ← simulateSignal(state, signal)
src/lib/crypto-trade-alert-renderer.ts     ← HTML + plaintext renderer
src/pages/api/admin/system/crypto-paper-portfolio.ts    ← admin API
src/pages/admin/system/crypto-paper-portfolio.astro     ← portfolio dashboard
src/pages/admin/system/crypto-paper-alert-preview.astro ← alert preview
```

## State

Single Redis record at key `crypto-paper-portfolio:state` with the shape:

```ts
{
  startingBankroll: 100_000,
  cashBalance: number,
  totalEquity: number,
  realizedPnl: number,
  unrealizedPnl: number,
  cumulativeReturnPct: number,
  exposurePct: number,
  openPositions: PaperPosition[],
  closedPositions: PaperPosition[],  // capped at 200
  trades: PaperTrade[],              // capped at 500
  riskSettings: RiskSettings,
  mode: 'paper',
  createdAt, updatedAt,
  lastAlert?: AlertPayload,          // most recent simulation result
}
```

Bounded retention: `MAX_TRADES = 500`, `MAX_CLOSED_POSITIONS = 200`, `MAX_OPEN_POSITIONS = 25`.

## Default risk settings

| Setting | Value |
|---|---|
| `maxRiskPerTradePct` | 1.5% |
| `maxSinglePositionPct` | 15% |
| `maxTotalExposurePct` | 80% |
| `minCashPct` | 20% |
| `feePct` | 0.10% |
| `slippagePct` | 0.05% |

## Trade sizing

```
riskAmount    = totalEquity × maxRiskPerTradePct
riskPerUnit   = entryPrice − stopLoss               (must be > 0)
quantity      = riskAmount ÷ riskPerUnit
positionValue = quantity × entryPrice
// Cap by maxSinglePositionPct:
maxPosition   = totalEquity × maxSinglePositionPct
if (positionValue > maxPosition) clamp quantity to fit.
// Fees + slippage:
filledEntry   = entryPrice × (1 + slippagePct)
fee           = positionValue × feePct
totalCost     = quantity × filledEntry + fee
```

## Risk gates (block reasons)

| Reason | Trigger |
|---|---|
| `invalid_signal` | Required fields missing / non-numeric / non-positive entry. |
| `unsizable` | Stop ≥ entry or zero risk-per-unit. |
| `low_signal_score` | `recommendation==='buy'` AND `score < 75`. |
| `max_open_positions_exceeded` | Already at the 25-position cap. |
| `max_total_exposure_exceeded` | Projected exposure would exceed `maxTotalExposurePct`. |
| `min_cash_violated` | Projected cash would fall below `minCashPct`. |
| `position_not_found` | Sell / trim signal for a symbol with no open position. |
| `recommendation_not_actionable` | `recommendation === 'hold'` (no-op). |

The simulator returns the same `AlertPayload` shape for applied, blocked, and no-op outcomes — the only difference is `action` (the trade kind, `'blocked'`, or `'no_op'`) and the presence of `blockedReason`.

## API

`/api/admin/system/crypto-paper-portfolio`

| Method | Action | Effect |
|---|---|---|
| `GET` | `bootstrap` | Returns the current state (with derived fields recomputed) + risk settings + limits. |
| `GET` | `latest-alert` | Returns the most recently persisted `AlertPayload`, or `null`. |
| `POST` | `reset` | Resets state to the initial $100,000 / zero-position document. |
| `POST` | `simulate-signal` | Runs the simulator against `body.signal`. Persists by default (`persist: false` to dry-run). |
| `POST` | `simulate-sample-signal` | Same as above but uses the built-in `SAMPLE_SIGNAL` constant. Used by the alert-preview page's "Simulate sample signal (persist)" button. |

Every POST emits a corresponding audit event (`crypto_paper_trade_simulated` / `crypto_paper_trade_blocked` / `crypto_paper_signal_no_op` / `crypto_paper_portfolio_reset`) tagged with `system: 'crypto_paper_trading'` and `mode: 'paper'`.

## Renderer

`renderCryptoTradeAlertHTML(payload, options?)` — inline-styled HTML body.
`renderCryptoTradeAlertPlainText(payload, options?)` — multi-line plain text.
`renderCryptoTradeAlertPayload(payload, options?)` — `{ subject, html, text, generatedAt, recipient, action }` envelope.

Subject: `WagerOnWeather paper trade · PAPER BUY BTC-USD` (or `BLOCKED <symbol>` etc.).

Every renderer output stamps **"Paper trading only. Research only. Not financial advice. No real funds, exchanges, broker APIs, custody, wallets, or order execution are involved."** in both the header chip and the footer.

## Admin pages

### `/admin/system/crypto-paper-portfolio`

Six-card KPI strip (starting bankroll, current equity, cash, exposure%, realized P&L, cumulative return%), open-positions table, trade ledger (last 50), risk-settings strip. Refresh = page reload. Amber banner says **"Paper trading only. Research only. Not financial advice."**

### `/admin/system/crypto-paper-alert-preview`

Side-by-side HTML + plaintext preview of `state.lastAlert` (or `SAMPLE_SIGNAL` rendered in dry-run when no alert has been simulated yet). "Simulate sample signal (persist)" button POSTs `simulate-sample-signal`. **No "Send test email" button** — no mailer is configured.

## Safety greps (Step 161 acceptance)

Run against the new files; expected: **zero hits** in non-comment code.

```
privateKey
walletConnect
createOrder
placeOrder
sendTransaction
nodemailer
resend
sendgrid
mailgun
smtp
```

The strings only appear in the docstrings / banners declaring that this module *does not* import or call those things.

## Out of scope (deferred)

- Real-time price feeds (positions mark-to-market off `currentPrice` set on entry until a real source is wired).
- Outbound email / chat / push delivery of alerts.
- Subscriber list, multi-recipient delivery, scheduling.
- Multi-account / multi-strategy support.
- Strategy back-testing.
