// ── Step 117B / 118: Kalshi config helper (server-only) ─────────────────────
//
// Reads Kalshi-related env vars on the server and exposes a redacted view
// of the configuration. The private key value is intentionally NEVER
// returned, logged, or otherwise exposed to client code — callers only
// learn whether one is configured.
//
// The preferred convention is KALSHI_PRIVATE_KEY_BASE64 (base64-encoded
// PEM); the legacy KALSHI_PRIVATE_KEY (raw multi-line PEM) is also
// accepted for backward compatibility with older code paths.
//
// No network calls. Server-only — importing this module in client code
// will throw at runtime.

if (typeof window !== 'undefined') {
  throw new Error(
    'kalshi-config is server-only and must not be imported in client code',
  );
}

export type KalshiEnv = 'demo' | 'live';

export interface KalshiConfig {
  /** Kalshi API key id, if configured. Safe to display to admins only. */
  apiKeyId: string | null;
  /** Whether a private key is set (presence only — value is never returned). */
  privateKeyPresent: boolean;
  /** Selected environment. Defaults to 'demo' when unset. */
  env: KalshiEnv;
  /** Read-only guard. Defaults to true when unset; only "false" disables it. */
  readOnly: boolean;
}

function readEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function parseEnvName(raw: string | undefined): KalshiEnv {
  return raw === 'live' ? 'live' : 'demo';
}

function parseReadOnly(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  return raw.toLowerCase() !== 'false';
}

export function getKalshiConfig(): KalshiConfig {
  const apiKeyId = readEnv('KALSHI_API_KEY_ID') ?? null;
  const privateKeyPresent =
    !!readEnv('KALSHI_PRIVATE_KEY_BASE64') || !!readEnv('KALSHI_PRIVATE_KEY');
  const env = parseEnvName(readEnv('KALSHI_ENV'));
  const readOnly = parseReadOnly(readEnv('KALSHI_READ_ONLY'));
  return { apiKeyId, privateKeyPresent, env, readOnly };
}

/**
 * Server-only. Returns the decoded RSA PEM string for signing requests.
 * NEVER expose the return value through any API response or log line.
 *
 * Resolution order:
 *   1. KALSHI_PRIVATE_KEY_BASE64 — preferred. Decoded as UTF-8 PEM.
 *   2. KALSHI_PRIVATE_KEY        — legacy raw PEM. Used as-is.
 *
 * Returns null when neither is configured.
 */
export function getKalshiPrivateKeyPem(): string | null {
  const b64 = readEnv('KALSHI_PRIVATE_KEY_BASE64');
  if (b64) {
    try {
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  return readEnv('KALSHI_PRIVATE_KEY') ?? null;
}

/** Returns the API base URL for the configured environment.
 *
 *  Hosts as documented at https://docs.kalshi.com (verified May 2026):
 *  - Live:  `https://external-api.kalshi.com/trade-api/v2`
 *  - Demo:  `https://external-api.demo.kalshi.co/trade-api/v2`
 *
 *  Earlier Kalshi deployments used `trading-api.kalshi.com` and
 *  `demo-api.kalshi.co`; those are stale. The `external-api`
 *  hosts are the supported API-key-signed surface today.
 */
export function getKalshiBaseUrl(env: KalshiEnv): string {
  return env === 'live'
    ? 'https://external-api.kalshi.com/trade-api/v2'
    : 'https://external-api.demo.kalshi.co/trade-api/v2';
}
