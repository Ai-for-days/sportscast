// ── Step 142: BigQuery production WeatherNext readiness (server-only) ──────
//
// Pure config-presence check. Reads the env vars the planned BigQuery
// production WeatherNext path would need and reports which ones are
// missing. **Returns booleans only — never the env values themselves.**
// No network calls, no auth handshake, no query.
//
// This helper does NOT promote `weathernext-bigquery-production` to
// ready: even when every env is set, the production query path remains
// disabled because the dataset / table / schema have not been verified
// against authoritative Google docs. See
// `docs/weathernext-contract-readiness.md`.

if (typeof window !== 'undefined') {
  throw new Error(
    'weathernext-bigquery-readiness is server-only and must not be imported in client code',
  );
}

export type WeatherNextBigQueryReadinessStatus =
  /** Contract is unconfirmed AND/OR config is missing — never go live. */
  | 'not_ready_contract'
  /** Contract is unconfirmed but config is present — still don't go live. */
  | 'config_present_contract_unconfirmed'
  /** Contract is confirmed AND config is present (future state). */
  | 'ready';

export interface WeatherNextBigQueryReadiness {
  ready: boolean;
  status: WeatherNextBigQueryReadinessStatus;
  /** Customer-friendly status label safe to render in admin UI. */
  statusLabel: string;
  /** Names of env vars that are missing. Never the values. */
  missing: string[];
  /** Per-env presence booleans, no values. */
  envPresence: {
    GCP_PROJECT_ID: boolean;
    GCP_CREDENTIALS_BASE64: boolean;
    WEATHERNEXT_BIGQUERY_PROJECT: boolean;
    WEATHERNEXT_BIGQUERY_DATASET: boolean;
    WEATHERNEXT_BIGQUERY_TABLE: boolean;
  };
  /** Free-text notes for admin debug surfaces. Never contains secrets. */
  warnings: string[];
  /**
   * True when the production BigQuery dataset/table/schema have been
   * confirmed against authoritative Google docs. Hardcoded `false` until
   * the Step 143+ author flips it after resolving the readiness doc's
   * BigQuery production section.
   */
  contractConfirmed: boolean;
}

/**
 * Hardcoded gate. Flipping this to `true` is part of the rollout
 * checklist in `docs/weathernext-contract-readiness.md` and requires
 * direct verification of the production BigQuery dataset/table/schema.
 */
export const WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED = false as const;

function readEnv(name: string): boolean {
  const fromVite = (import.meta as any)?.env?.[name];
  if (typeof fromVite === 'string' && fromVite.length > 0) return true;
  if (typeof process !== 'undefined' && process.env) {
    const v = process.env[name];
    if (typeof v === 'string' && v.length > 0) return true;
  }
  return false;
}

export function getWeatherNextBigQueryReadiness(): WeatherNextBigQueryReadiness {
  const envPresence = {
    GCP_PROJECT_ID: readEnv('GCP_PROJECT_ID'),
    GCP_CREDENTIALS_BASE64: readEnv('GCP_CREDENTIALS_BASE64'),
    WEATHERNEXT_BIGQUERY_PROJECT: readEnv('WEATHERNEXT_BIGQUERY_PROJECT'),
    WEATHERNEXT_BIGQUERY_DATASET: readEnv('WEATHERNEXT_BIGQUERY_DATASET'),
    WEATHERNEXT_BIGQUERY_TABLE: readEnv('WEATHERNEXT_BIGQUERY_TABLE'),
  };

  const REQUIRED: Array<keyof typeof envPresence> = [
    'GCP_PROJECT_ID',
    'GCP_CREDENTIALS_BASE64',
    'WEATHERNEXT_BIGQUERY_DATASET',
    'WEATHERNEXT_BIGQUERY_TABLE',
  ];
  // WEATHERNEXT_BIGQUERY_PROJECT is optional because it can fall back to
  // GCP_PROJECT_ID when the production tables live in the same project.
  const missing = REQUIRED.filter((k) => !envPresence[k]);

  const warnings: string[] = [];
  if (!envPresence.WEATHERNEXT_BIGQUERY_PROJECT) {
    warnings.push(
      'WEATHERNEXT_BIGQUERY_PROJECT is not set. Falls back to GCP_PROJECT_ID at query time when the production tables live in the same GCP project.',
    );
  }
  if (!WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED) {
    warnings.push(
      'WeatherNext BigQuery production dataset/table/schema is UNCONFIRMED — the production query path is disabled. Every weathernext-bigquery-production request returns failureMode=contract_unconfirmed and falls back to Open-Meteo. See docs/weathernext-contract-readiness.md.',
    );
  }

  let status: WeatherNextBigQueryReadinessStatus;
  let statusLabel: string;
  let ready: boolean;

  if (!WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED) {
    if (missing.length === 0) {
      status = 'config_present_contract_unconfirmed';
      statusLabel =
        'Config present, contract unconfirmed — production query path still disabled until the dataset/table/schema are verified.';
      ready = false;
    } else {
      status = 'not_ready_contract';
      statusLabel =
        'Not ready: contract unconfirmed AND required env missing.';
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
    contractConfirmed: WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED,
  };
}
