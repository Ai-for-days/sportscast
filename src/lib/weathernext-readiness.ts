// ── Step 141: WeatherNext readiness helper (server-only, no network) ────────
//
// Pure config-presence check. Reads the env vars the Step 135 Vertex AI
// client expects and reports which ones are missing. **Returns booleans
// only — never the env values themselves.** No network calls, no auth
// handshake, no inference. Safe to call from any server-side admin
// surface.
//
// This helper does NOT promote `weathernext-production` to ready: even
// when every env is set, the Step 135 client still returns
// `failureMode: 'endpoint_unconfirmed'` because the actual Vertex AI
// contract has not been verified against authoritative Google docs.
// See docs/weathernext-contract-readiness.md.

if (typeof window !== 'undefined') {
  throw new Error(
    'weathernext-readiness is server-only and must not be imported in client code',
  );
}

export type WeatherNextReadinessStatus =
  /** Contract is unconfirmed AND/OR config is missing — never go live. */
  | 'not_ready_contract'
  /** Contract is unconfirmed but config is present — still don't go live. */
  | 'config_present_contract_unconfirmed'
  /** Contract is confirmed AND config is present (future state, Step 142+). */
  | 'ready';

export interface WeatherNextReadiness {
  /** True only when both the contract and the config are confirmed/present. */
  ready: boolean;
  status: WeatherNextReadinessStatus;
  /** Customer-friendly status label safe to render in admin UI. */
  statusLabel: string;
  /** Names of env vars that are missing. Never the values. */
  missing: string[];
  /** Per-env presence booleans, no values. */
  envPresence: {
    GCP_PROJECT_ID: boolean;
    GCP_CREDENTIALS_BASE64: boolean;
    WEATHERNEXT_VERTEX_REGION: boolean;
    WEATHERNEXT_VERTEX_ENDPOINT_ID: boolean;
    WEATHERNEXT_VERTEX_MODEL_ID: boolean;
  };
  /** Free-text notes for admin debug surfaces. Never contains secrets. */
  warnings: string[];
  /**
   * True when the *contract* is verified against authoritative Google docs.
   * Hardcoded `false` until the Step 142 author flips it after reading
   * `docs/weathernext-contract-readiness.md` and resolving every
   * UNCONFIRMED item.
   */
  contractConfirmed: boolean;
}

/**
 * The single source of truth for "has the WeatherNext production contract
 * been confirmed against authoritative Google docs?". Hardcoded `false`
 * until Step 142 lands. Flipping this to `true` is part of the rollout
 * checklist in `docs/weathernext-contract-readiness.md` §9.
 */
export const WEATHERNEXT_CONTRACT_CONFIRMED = false as const;

function readEnv(name: string): boolean {
  // Vite / Astro env at SSR time.
  const fromVite = (import.meta as any)?.env?.[name];
  if (typeof fromVite === 'string' && fromVite.length > 0) return true;
  // Node runtime env.
  if (typeof process !== 'undefined' && process.env) {
    const v = process.env[name];
    if (typeof v === 'string' && v.length > 0) return true;
  }
  return false;
}

export function getWeatherNextReadiness(): WeatherNextReadiness {
  const envPresence = {
    GCP_PROJECT_ID: readEnv('GCP_PROJECT_ID'),
    GCP_CREDENTIALS_BASE64: readEnv('GCP_CREDENTIALS_BASE64'),
    WEATHERNEXT_VERTEX_REGION: readEnv('WEATHERNEXT_VERTEX_REGION'),
    WEATHERNEXT_VERTEX_ENDPOINT_ID: readEnv('WEATHERNEXT_VERTEX_ENDPOINT_ID'),
    WEATHERNEXT_VERTEX_MODEL_ID: readEnv('WEATHERNEXT_VERTEX_MODEL_ID'),
  };

  const REQUIRED: Array<keyof typeof envPresence> = [
    'GCP_PROJECT_ID',
    'GCP_CREDENTIALS_BASE64',
    'WEATHERNEXT_VERTEX_REGION',
    'WEATHERNEXT_VERTEX_ENDPOINT_ID',
  ];
  // MODEL_ID is treated as optional because the actual contract may
  // imply the model from the endpoint. See readiness doc §5.
  const missing = REQUIRED.filter((k) => !envPresence[k]);

  const warnings: string[] = [];
  if (!envPresence.WEATHERNEXT_VERTEX_MODEL_ID) {
    warnings.push(
      'WEATHERNEXT_VERTEX_MODEL_ID is not set. May or may not be required — the actual contract may imply the model from the endpoint id. See docs/weathernext-contract-readiness.md §5.',
    );
  }
  if (!WEATHERNEXT_CONTRACT_CONFIRMED) {
    warnings.push(
      'WeatherNext production contract is UNCONFIRMED — every weathernext-production request still returns failureMode=endpoint_unconfirmed and falls back to Open-Meteo. See docs/weathernext-contract-readiness.md.',
    );
  }

  let status: WeatherNextReadinessStatus;
  let statusLabel: string;
  let ready: boolean;

  if (!WEATHERNEXT_CONTRACT_CONFIRMED) {
    if (missing.length === 0) {
      status = 'config_present_contract_unconfirmed';
      statusLabel =
        'Config present, contract unconfirmed — live inference still disabled until docs/weathernext-contract-readiness.md is resolved.';
      ready = false;
    } else {
      status = 'not_ready_contract';
      statusLabel =
        'Not ready: contract unconfirmed AND required config missing. See docs/weathernext-contract-readiness.md.';
      ready = false;
    }
  } else if (missing.length > 0) {
    status = 'not_ready_contract';
    statusLabel = `Contract confirmed but ${missing.length} required env var(s) missing.`;
    ready = false;
  } else {
    status = 'ready';
    statusLabel = 'Ready: contract confirmed and all required env vars present.';
    ready = true;
  }

  return {
    ready,
    status,
    statusLabel,
    missing,
    envPresence,
    warnings,
    contractConfirmed: WEATHERNEXT_CONTRACT_CONFIRMED,
  };
}
