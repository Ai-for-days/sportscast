// ── Polymarket integration foundation (Step 124) ────────────────────────────
//
// Read-only, server-side constants for monitoring Polymarket weather markets
// as external market intelligence alongside Kalshi.
//
// Strict posture:
//   - No order placement.
//   - No wallet connection.
//   - No signing helpers.
//   - No private-key or API-key handling.
//   - No automatic trading, auto-hedging, or auto-mirroring.
//   - No automatic WagerOnWeather market creation from Polymarket data.
//   - No public or customer exposure of Polymarket data — admin surfaces only.
//
// See docs/polymarket-integration-plan.md for the phased roadmap and the
// platform-wide safety model.

/** Human-facing landing page operators use to identify markets to track. */
export const POLYMARKET_WEATHER_URL = 'https://polymarket.com/weather';

/** Polymarket's public Gamma API — read-only market metadata. No auth required. */
export const POLYMARKET_GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
