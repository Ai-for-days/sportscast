// WOW-015 K1c: the Kalshi Market Data page reads Kalshi's PUBLIC market data
// (external-api.kalshi.com, unauthenticated GETs; see kalshi-client.ts). The
// site has no Kalshi account, so whether credential variables exist must never
// decide whether the read-only buttons work. Only an in-flight action does.

export interface KalshiUiConfigStatus {
  apiKeyIdConfigured?: boolean;
  privateKeyPresent?: boolean;
}

/** Whether the Run test / Fetch buttons are enabled. Credentials are ignored. */
export function fetchButtonsEnabled(
  _config: KalshiUiConfigStatus | null | undefined,
  busy: string | null | undefined,
): boolean {
  return !busy;
}

/** What the page shows as the data source (no "demo"/"live" environments). */
export const KALSHI_PUBLIC_SOURCE_LABEL = 'public (external-api.kalshi.com)';
