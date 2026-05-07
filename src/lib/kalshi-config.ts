// ── Step 117B: Kalshi config helper (server-only) ───────────────────────────
//
// Reads Kalshi-related env vars on the server and exposes a redacted view
// of the configuration. The private key itself is intentionally NEVER
// returned, logged, or otherwise exposed — callers only learn whether one
// is configured. No network calls. No client-side use.

export type KalshiEnv = 'demo' | 'live';

export interface KalshiConfig {
  /** Kalshi API key id, if configured. Safe to display to admins only. */
  apiKeyId: string | null;
  /** Whether KALSHI_PRIVATE_KEY is set (presence only — value is never returned). */
  privateKeyPresent: boolean;
  /** Selected environment. Defaults to 'demo' when unset. */
  env: KalshiEnv;
  /** Read-only guard. Defaults to true when unset; only "false" disables it. */
  readOnly: boolean;
}

function readEnv(name: string): string | undefined {
  // Process env on the server. Astro/Vercel both expose runtime env via
  // process.env on the server side. This module must not be bundled into
  // client output — gated by .ts only being imported from server contexts.
  if (typeof process === 'undefined' || !process.env) return undefined;
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function parseEnvName(raw: string | undefined): KalshiEnv {
  return raw === 'live' ? 'live' : 'demo';
}

function parseReadOnly(raw: string | undefined): boolean {
  // Default fail-safe: read-only is true unless explicitly set to "false".
  if (raw === undefined) return true;
  return raw.toLowerCase() !== 'false';
}

export function getKalshiConfig(): KalshiConfig {
  const apiKeyId = readEnv('KALSHI_API_KEY_ID') ?? null;
  const privateKeyPresent = !!readEnv('KALSHI_PRIVATE_KEY');
  const env = parseEnvName(readEnv('KALSHI_ENV'));
  const readOnly = parseReadOnly(readEnv('KALSHI_READ_ONLY'));
  return { apiKeyId, privateKeyPresent, env, readOnly };
}
