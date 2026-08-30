// ── Is anything we depend on quietly dark? ─────────────────────────────────
//
// Built 2026-08-29 after two failures in one evening that had one shape in
// common: an upstream stopped answering, a fallback caught it, and nobody was
// told.
//
//   ESPN answered 403 to every scoreboard request from our servers for hours.
//   The Weatherboard fell through to The Odds API, which carries no period or
//   clock, so live games read "In Progress" and /college-football-weather
//   rendered its no-games state mid-slate. It surfaced only because Derek
//   asked for a feature that already existed.
//
//   Open-Meteo rate-limited us. The fallback for that INVENTS a forecast, and
//   the market engines priced against it. It surfaced only because someone
//   happened to read a cron's logs.
//
// Both were visible in the logs the whole time. Logs are not an alarm: nobody
// reads them until something else has already gone wrong. A fallback that
// works is exactly what makes an outage invisible, so the fallback itself has
// to be the thing that reports.
//
// Cheap on purpose. One Redis write per failure, and at most one per source
// every 30 seconds on the success path (a pricing run fetches about 30 venues,
// and 30 identical "still fine" writes tell us nothing the first one did not).
// Every function here swallows its own errors: health bookkeeping must never
// be the reason a page or a cron fails.

import { getRedis } from './redis';
import { raiseAlert } from './alerts';

/** Every upstream whose silence would change what the site shows. */
export type DataSource =
  | 'espn'
  | 'espn-primary-host'
  | 'open-meteo'
  | 'nws'
  | 'odds-api';

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  espn: 'ESPN scoreboard (scores, period, clock)',
  'espn-primary-host': 'ESPN canonical host (site.api.espn.com)',
  'open-meteo': 'Open-Meteo (base forecast)',
  nws: 'NWS (forecast blend + settlement observations)',
  'odds-api': 'The Odds API (lines, fallback schedule)',
};

/** What a source going dark actually costs, in the alert an operator reads. */
const CONSEQUENCE: Record<DataSource, string> = {
  espn: 'Live scores, quarter/half and game clock disappear from the Weatherboards and the weekly football pages; the boards fall back to The Odds API, which has no period or clock.',
  'espn-primary-host': 'No customer-visible effect yet, because the mirror host is serving. Worth knowing because it is the early warning for ESPN going fully dark.',
  'open-meteo': 'The base forecast is unavailable. Pages serve the last real forecast we hold and the market engines skip rather than price. Nothing is invented, but the site stops getting fresher.',
  nws: 'The consensus loses its US anchor, and settlement observations may be unavailable at grading time.',
  'odds-api': 'Sportsbook lines and rotation numbers go missing from the boards, and the schedule loses its fallback when ESPN is also down.',
};

const KEY_PREFIX = 'srchealth:';
const RECORD_TTL_SECONDS = 7 * 86400;

/**
 * Consecutive failures before an alert. Three is deliberate: one is noise
 * (every upstream blips), two is bad luck, three in a row on a source that is
 * retried every few minutes is an outage.
 */
export const FAILURE_ALERT_THRESHOLD = 3;

/** Skip a repeat "still healthy" write within this window, per instance. */
const SUCCESS_WRITE_THROTTLE_MS = 30_000;

/**
 * Sources that are RECORDED but never alert.
 *
 * A degraded path the site is already surviving belongs on the dashboard, not
 * in someone's alerts. ESPN's canonical host has been blocking our egress
 * since 2026-08-29 with no sign of changing, while the mirror serves every
 * request: alerting on it would fire every ten minutes, forever, about a
 * condition with no customer impact and no action to take. That is how an
 * alarm gets muted, and a muted alarm is worse than none, because the next
 * real one is muted too.
 *
 * The rule: alert when a customer would notice. Record everything else.
 */
const RECORD_ONLY: ReadonlySet<DataSource> = new Set<DataSource>(['espn-primary-host']);

/** Does a failure of this source page anyone, or just colour a row? */
export function alertsOnFailure(source: DataSource): boolean {
  return !RECORD_ONLY.has(source);
}

const lastSuccessWriteAt = new Map<DataSource, number>();

export interface SourceHealthRecord {
  source: DataSource;
  label: string;
  /** Consecutive failures. 0 means the last attempt succeeded. */
  consecutiveFailures: number;
  firstFailureAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  lastSuccessAt?: string;
  status: 'ok' | 'degraded' | 'dark' | 'unknown';
}

function failKey(source: DataSource): string {
  return `${KEY_PREFIX}fail:${source}`;
}
function okKey(source: DataSource): string {
  return `${KEY_PREFIX}ok:${source}`;
}

/** Upstash hands back either a string or an already-parsed object (CLAUDE.md). */
function parse<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  try {
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
  } catch {
    return null;
  }
}

interface FailureRecord {
  count: number;
  firstAt: string;
  lastAt: string;
  error?: string;
}

/**
 * A source answered. Clears any failure streak, and raises nothing: recovery
 * is visible in the health table, and an alert per recovery would train
 * operators to ignore this alert type.
 */
export async function recordSourceSuccess(source: DataSource): Promise<void> {
  try {
    const now = Date.now();
    const last = lastSuccessWriteAt.get(source) ?? 0;
    if (now - last < SUCCESS_WRITE_THROTTLE_MS) return;
    lastSuccessWriteAt.set(source, now);
    const redis = getRedis();
    await Promise.all([
      redis.set(okKey(source), new Date(now).toISOString(), { ex: RECORD_TTL_SECONDS }),
      redis.del(failKey(source)),
    ]);
  } catch {
    /* health bookkeeping must never break the caller */
  }
}

/**
 * A source did not answer. Counts the streak and raises an alert at the
 * threshold; `raiseAlert` already dedupes the same type and severity inside a
 * 10-minute window, so an ongoing outage re-announces itself about every ten
 * minutes rather than once per failed request.
 */
export async function recordSourceFailure(
  source: DataSource,
  error: string,
  severity: 'critical' | 'warning' = 'critical',
): Promise<void> {
  try {
    const redis = getRedis();
    lastSuccessWriteAt.delete(source);
    const prev = parse<FailureRecord>(await redis.get(failKey(source)));
    const nowIso = new Date().toISOString();
    const record: FailureRecord = {
      count: (prev?.count ?? 0) + 1,
      firstAt: prev?.firstAt ?? nowIso,
      lastAt: nowIso,
      error: String(error).slice(0, 300),
    };
    await redis.set(failKey(source), JSON.stringify(record), { ex: RECORD_TTL_SECONDS });

    if (record.count < FAILURE_ALERT_THRESHOLD) return;
    if (!alertsOnFailure(source)) return;

    const minutesDark = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(record.firstAt)) / 60000));
    await raiseAlert(
      severity,
      severity === 'critical' ? 'data_source_dark' : 'data_source_degraded',
      `${DATA_SOURCE_LABELS[source]} is not answering`,
      `${record.count} consecutive failures over ${minutesDark} minute(s). Last error: ${record.error}. ${CONSEQUENCE[source]}`,
      '/admin/system/health',
      { source, consecutiveFailures: record.count, since: record.firstAt },
    );
  } catch {
    /* health bookkeeping must never break the caller */
  }
}

/**
 * Decide a source's status from its stored counters. Pure, so the thresholds
 * are testable without Redis.
 */
export function statusFor(consecutiveFailures: number, hasEverSucceeded: boolean): SourceHealthRecord['status'] {
  if (consecutiveFailures >= FAILURE_ALERT_THRESHOLD) return 'dark';
  if (consecutiveFailures > 0) return 'degraded';
  return hasEverSucceeded ? 'ok' : 'unknown';
}

/** Every tracked source's current state, for the admin health page. */
export async function getDataSourceHealth(): Promise<SourceHealthRecord[]> {
  const sources = Object.keys(DATA_SOURCE_LABELS) as DataSource[];
  return Promise.all(
    sources.map(async (source): Promise<SourceHealthRecord> => {
      try {
        const redis = getRedis();
        const [failRaw, okRaw] = await Promise.all([
          redis.get(failKey(source)),
          redis.get(okKey(source)),
        ]);
        const fail = parse<FailureRecord>(failRaw);
        const lastSuccessAt = typeof okRaw === 'string' ? okRaw : undefined;
        return {
          source,
          label: DATA_SOURCE_LABELS[source],
          consecutiveFailures: fail?.count ?? 0,
          firstFailureAt: fail?.firstAt,
          lastFailureAt: fail?.lastAt,
          lastError: fail?.error,
          lastSuccessAt,
          status: statusFor(fail?.count ?? 0, !!lastSuccessAt),
        };
      } catch {
        return {
          source,
          label: DATA_SOURCE_LABELS[source],
          consecutiveFailures: 0,
          status: 'unknown',
        };
      }
    }),
  );
}
