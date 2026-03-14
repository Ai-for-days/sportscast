import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type IntegrityStatus = 'pass' | 'fail' | 'warn' | 'not_run';
export type CheckDepth = 'integrity_verified' | 'freshness_warning' | 'limited_coverage' | 'manual_review' | 'cross_domain' | 'state_validation';
export type ScanDepth = 'quick' | 'standard' | 'deep';
const SCAN_SIZES: Record<ScanDepth, number> = { quick: 5, standard: 25, deep: 100 };

export interface IntegrityCheck {
  key: string;
  domain: string;
  title: string;
  status: IntegrityStatus;
  depth: CheckDepth;
  summary: string;
  durationMs?: number;
  lastRun?: string;
}

export interface IntegrityScanRecord {
  id: string;
  createdAt: string;
  domain: string;
  checkName: string;
  status: string;
  summary: string;
}

const SCAN_SET = 'integrity:scans';
const SCAN_PREFIX = 'integrity:scan:';
const MAX_SCANS = 500;

/* ------------------------------------------------------------------ */
/*  Domain definitions                                                 */
/* ------------------------------------------------------------------ */

interface DomainDef {
  domain: string;
  label: string;
  indexKey: string;
  recordPrefix: string;
  requiredFields?: string[];
  freshnessThresholdHours: number;
}

const DOMAINS: DomainDef[] = [
  { domain: 'forecasts', label: 'Forecasts', indexKey: 'forecasts:all', recordPrefix: 'forecast:', requiredFields: ['id', 'createdAt', 'source'], freshnessThresholdHours: 48 },
  { domain: 'verifications', label: 'Verification Results', indexKey: 'verifications:all', recordPrefix: 'verification:', requiredFields: ['id', 'createdAt'], freshnessThresholdHours: 72 },
  { domain: 'consensus', label: 'Consensus Outputs', indexKey: 'consensus:all', recordPrefix: 'consensus:', requiredFields: ['id', 'createdAt'], freshnessThresholdHours: 72 },
  { domain: 'pricing', label: 'Market/Pricing Records', indexKey: 'bookmaker:markets', recordPrefix: 'bookmaker:market:', requiredFields: ['id'], freshnessThresholdHours: 168 },
  { domain: 'signals', label: 'Signals', indexKey: 'signals:all', recordPrefix: 'signal:', requiredFields: ['id', 'createdAt', 'source'], freshnessThresholdHours: 48 },
  { domain: 'candidates', label: 'Execution Candidates', indexKey: 'exec:candidates:all', recordPrefix: 'exec:candidate:', requiredFields: ['id', 'createdAt', 'state'], freshnessThresholdHours: 168 },
  { domain: 'demo_orders', label: 'Demo Execution', indexKey: 'kalshi:demo:orders', recordPrefix: 'kalshi:demo:order:', requiredFields: ['id', 'createdAt', 'status'], freshnessThresholdHours: 168 },
  { domain: 'live_orders', label: 'Live Execution', indexKey: 'kalshi:live:orders', recordPrefix: 'kalshi:live:order:', requiredFields: ['id', 'createdAt', 'status'], freshnessThresholdHours: 168 },
  { domain: 'reconciliation', label: 'Reconciliation', indexKey: 'recon:runs:all', recordPrefix: 'recon:run:', requiredFields: ['id', 'createdAt'], freshnessThresholdHours: 168 },
  { domain: 'settlements', label: 'Settlements', indexKey: 'settlements:all', recordPrefix: 'settlement:', requiredFields: ['id', 'createdAt'], freshnessThresholdHours: 168 },
  { domain: 'audit', label: 'Audit Log', indexKey: 'audit:events', recordPrefix: 'audit:event:', requiredFields: ['id', 'createdAt', 'eventType'], freshnessThresholdHours: 24 },
];

export function getDomainDefinitions() {
  return DOMAINS;
}

export const DOMAIN_LABELS: Record<string, string> = {};
DOMAINS.forEach(d => { DOMAIN_LABELS[d.domain] = d.label; });

/* ------------------------------------------------------------------ */
/*  Run checks                                                         */
/* ------------------------------------------------------------------ */

async function runDomainChecks(def: DomainDef, depth: ScanDepth = 'quick'): Promise<IntegrityCheck[]> {
  const redis = getRedis();
  const results: IntegrityCheck[] = [];

  // 1. Index presence + count
  const indexStart = Date.now();
  try {
    const count = await redis.zcard(def.indexKey);
    results.push({
      key: `${def.domain}_index_count`,
      domain: def.domain,
      title: `${def.label} Index Count`,
      status: count > 0 ? 'pass' : 'warn',
      depth: count > 0 ? 'integrity_verified' : 'limited_coverage',
      summary: `${count} entries in ${def.indexKey}`,
      durationMs: Date.now() - indexStart,
      lastRun: new Date().toISOString(),
    });

    if (count === 0) {
      // No data — skip further checks for this domain
      results.push({
        key: `${def.domain}_freshness`,
        domain: def.domain,
        title: `${def.label} Freshness`,
        status: 'warn',
        depth: 'limited_coverage',
        summary: 'No records — freshness check skipped',
        lastRun: new Date().toISOString(),
      });
      return results;
    }

    // 2. Freshness — check most recent record
    const freshStart = Date.now();
    const recentIds = await redis.zrange(def.indexKey, 0, 0, { rev: true });
    if (recentIds && recentIds.length > 0) {
      const raw = await redis.get(`${def.recordPrefix}${recentIds[0]}`);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
        const createdAt = parsed.createdAt || parsed.timestamp;
        if (createdAt) {
          const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
          const isStale = ageHours > def.freshnessThresholdHours;
          results.push({
            key: `${def.domain}_freshness`,
            domain: def.domain,
            title: `${def.label} Freshness`,
            status: isStale ? 'warn' : 'pass',
            depth: isStale ? 'freshness_warning' : 'integrity_verified',
            summary: `Most recent: ${createdAt} (${Math.round(ageHours)}h ago). Threshold: ${def.freshnessThresholdHours}h.`,
            durationMs: Date.now() - freshStart,
            lastRun: new Date().toISOString(),
          });
        } else {
          results.push({
            key: `${def.domain}_freshness`,
            domain: def.domain,
            title: `${def.label} Freshness`,
            status: 'warn',
            depth: 'limited_coverage',
            summary: 'Most recent record has no createdAt/timestamp field',
            durationMs: Date.now() - freshStart,
            lastRun: new Date().toISOString(),
          });
        }
      } else {
        // Index entry points to missing record — orphaned index
        results.push({
          key: `${def.domain}_freshness`,
          domain: def.domain,
          title: `${def.label} Freshness`,
          status: 'fail',
          depth: 'integrity_verified',
          summary: `Index entry "${recentIds[0]}" points to missing record at ${def.recordPrefix}${recentIds[0]}`,
          durationMs: Date.now() - freshStart,
          lastRun: new Date().toISOString(),
        });
      }
    }

    // 3. Sample integrity — check records for required fields and readability
    const sampleStart = Date.now();
    const sampleSize = Math.min(count, SCAN_SIZES[depth]);
    const sampleIds = await redis.zrange(def.indexKey, 0, sampleSize - 1, { rev: true });
    let readable = 0;
    let malformed = 0;
    let missingFields = 0;
    let orphanedIndex = 0;

    for (const id of sampleIds) {
      const raw = await redis.get(`${def.recordPrefix}${id}`);
      if (!raw) {
        orphanedIndex++;
        continue;
      }
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
        readable++;
        if (def.requiredFields) {
          for (const field of def.requiredFields) {
            if (parsed[field] === undefined && parsed[field] !== null) {
              // Only count truly missing (not just falsy)
              if (!(field in parsed)) {
                missingFields++;
              }
            }
          }
        }
      } catch {
        malformed++;
      }
    }

    let sampleStatus: IntegrityStatus = 'pass';
    let sampleSummary = `Sampled ${sampleSize} records: ${readable} readable`;
    if (malformed > 0) { sampleStatus = 'fail'; sampleSummary += `, ${malformed} malformed`; }
    if (orphanedIndex > 0) { sampleStatus = 'fail'; sampleSummary += `, ${orphanedIndex} orphaned index entries`; }
    if (missingFields > 0) { sampleStatus = 'warn'; sampleSummary += `, ${missingFields} missing required fields`; }

    results.push({
      key: `${def.domain}_sample_integrity`,
      domain: def.domain,
      title: `${def.label} Record Integrity`,
      status: sampleStatus,
      depth: sampleStatus === 'pass' ? 'integrity_verified' : 'limited_coverage',
      summary: sampleSummary,
      durationMs: Date.now() - sampleStart,
      lastRun: new Date().toISOString(),
    });

  } catch (err: any) {
    results.push({
      key: `${def.domain}_error`,
      domain: def.domain,
      title: `${def.label} Check Error`,
      status: 'fail',
      depth: 'limited_coverage',
      summary: `Error: ${err.message}`,
      lastRun: new Date().toISOString(),
    });
  }

  return results;
}

export async function runAllIntegrityChecks(depth: ScanDepth = 'quick'): Promise<IntegrityCheck[]> {
  const all: IntegrityCheck[] = [];
  for (const def of DOMAINS) {
    const checks = await runDomainChecks(def, depth);
    all.push(...checks);
  }
  // Add cross-domain checks
  const crossChecks = await runCrossDomainChecks(depth);
  all.push(...crossChecks);
  // Add state validation
  const stateChecks = await runStateValidation(depth);
  all.push(...stateChecks);
  return all;
}

export async function runDomainIntegrityChecks(domain: string, depth: ScanDepth = 'quick'): Promise<IntegrityCheck[]> {
  const def = DOMAINS.find(d => d.domain === domain);
  if (!def) return [];
  return runDomainChecks(def, depth);
}

/* ------------------------------------------------------------------ */
/*  Cross-domain checks                                                */
/* ------------------------------------------------------------------ */

interface CrossDomainDef {
  key: string;
  title: string;
  childIndex: string;
  childPrefix: string;
  parentField: string;
  parentPrefix: string;
}

const CROSS_DOMAIN_CHECKS: CrossDomainDef[] = [
  { key: 'candidate_signal', title: 'Candidate → Signal Reference', childIndex: 'exec:candidates:all', childPrefix: 'exec:candidate:', parentField: 'signalId', parentPrefix: 'signal:' },
  { key: 'verification_forecast', title: 'Verification → Forecast Reference', childIndex: 'verifications:all', childPrefix: 'verification:', parentField: 'forecastId', parentPrefix: 'forecast:' },
  { key: 'demo_order_candidate', title: 'Demo Order → Candidate Reference', childIndex: 'kalshi:demo:orders', childPrefix: 'kalshi:demo:order:', parentField: 'candidateId', parentPrefix: 'exec:candidate:' },
  { key: 'live_order_candidate', title: 'Live Order → Candidate Reference', childIndex: 'kalshi:live:orders', childPrefix: 'kalshi:live:order:', parentField: 'candidateId', parentPrefix: 'exec:candidate:' },
  { key: 'settlement_order', title: 'Settlement → Order Reference', childIndex: 'settlements:all', childPrefix: 'settlement:', parentField: 'orderId', parentPrefix: 'kalshi:demo:order:' },
];

async function runCrossDomainChecks(depth: ScanDepth = 'quick'): Promise<IntegrityCheck[]> {
  const redis = getRedis();
  const results: IntegrityCheck[] = [];
  const sampleSize = SCAN_SIZES[depth];

  for (const def of CROSS_DOMAIN_CHECKS) {
    const start = Date.now();
    try {
      const count = await redis.zcard(def.childIndex);
      if (count === 0) {
        results.push({
          key: def.key, domain: 'cross_domain', title: def.title,
          status: 'warn', depth: 'limited_coverage',
          summary: `No records in ${def.childIndex} — cross-domain check skipped`,
          durationMs: Date.now() - start, lastRun: new Date().toISOString(),
        });
        continue;
      }

      const ids = await redis.zrange(def.childIndex, 0, Math.min(count, sampleSize) - 1, { rev: true });
      let checked = 0;
      let orphans = 0;
      let missingField = 0;

      for (const id of ids) {
        const raw = await redis.get(`${def.childPrefix}${id}`);
        if (!raw) continue;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
        checked++;

        const parentId = parsed[def.parentField];
        if (!parentId) { missingField++; continue; }

        const parent = await redis.get(`${def.parentPrefix}${parentId}`);
        if (!parent) { orphans++; }
      }

      let status: IntegrityStatus = 'pass';
      let summary = `Checked ${checked} records`;
      if (orphans > 0) { status = 'warn'; summary += `, ${orphans} orphaned references`; }
      if (missingField > 0) { summary += `, ${missingField} missing ${def.parentField} field`; }
      if (orphans === 0 && missingField === 0) { summary += ' — all references valid'; }

      results.push({
        key: def.key, domain: 'cross_domain', title: def.title,
        status, depth: 'cross_domain',
        summary: `${summary} (sample: ${checked}/${count})`,
        durationMs: Date.now() - start, lastRun: new Date().toISOString(),
      });
    } catch (err: any) {
      results.push({
        key: def.key, domain: 'cross_domain', title: def.title,
        status: 'fail', depth: 'limited_coverage',
        summary: `Error: ${err.message}`,
        durationMs: Date.now() - start, lastRun: new Date().toISOString(),
      });
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/*  State validation                                                   */
/* ------------------------------------------------------------------ */

async function runStateValidation(depth: ScanDepth = 'quick'): Promise<IntegrityCheck[]> {
  const redis = getRedis();
  const results: IntegrityCheck[] = [];
  const sampleSize = SCAN_SIZES[depth];

  // Validate candidate states
  const candStart = Date.now();
  try {
    const validStates = ['pending', 'approved', 'rejected', 'sent', 'filled', 'cancelled', 'expired'];
    const count = await redis.zcard('exec:candidates:all');
    const ids = await redis.zrange('exec:candidates:all', 0, Math.min(count, sampleSize) - 1, { rev: true });
    let checked = 0;
    let suspicious = 0;
    let futureTimestamps = 0;
    const now = Date.now();

    for (const id of ids) {
      const raw = await redis.get(`exec:candidate:${id}`);
      if (!raw) continue;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
      checked++;
      if (parsed.state && !validStates.includes(parsed.state)) suspicious++;
      if (parsed.createdAt && new Date(parsed.createdAt).getTime() > now + 60000) futureTimestamps++;
    }

    let status: IntegrityStatus = 'pass';
    let summary = `Checked ${checked} candidates`;
    if (suspicious > 0) { status = 'warn'; summary += `, ${suspicious} invalid states`; }
    if (futureTimestamps > 0) { status = 'warn'; summary += `, ${futureTimestamps} future timestamps`; }
    if (suspicious === 0 && futureTimestamps === 0) summary += ' — all states valid';

    results.push({
      key: 'candidate_state_validation', domain: 'state_validation', title: 'Candidate State Validation',
      status, depth: 'state_validation',
      summary: `${summary} (sample: ${checked}/${count})`,
      durationMs: Date.now() - candStart, lastRun: new Date().toISOString(),
    });
  } catch (err: any) {
    results.push({
      key: 'candidate_state_validation', domain: 'state_validation', title: 'Candidate State Validation',
      status: 'fail', depth: 'limited_coverage', summary: `Error: ${err.message}`,
      durationMs: Date.now() - candStart, lastRun: new Date().toISOString(),
    });
  }

  // Validate execution config state
  const configStart = Date.now();
  try {
    const raw = await redis.get('exec:config');
    if (raw) {
      const config = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
      const validModes = ['disabled', 'paper', 'demo', 'live'];
      let issues: string[] = [];
      if (config.mode && !validModes.includes(config.mode)) issues.push(`invalid mode: ${config.mode}`);
      if (config.mode === 'live' && !config.liveTradingEnabled) issues.push('live mode set but liveTradingEnabled is false');
      if (typeof config.killSwitchEnabled !== 'boolean') issues.push('killSwitchEnabled is not boolean');

      results.push({
        key: 'exec_config_state', domain: 'state_validation', title: 'Execution Config State',
        status: issues.length > 0 ? 'warn' : 'pass',
        depth: 'state_validation',
        summary: issues.length > 0 ? `Issues: ${issues.join('; ')}` : `Valid — mode: ${config.mode}, kill switch: ${config.killSwitchEnabled}`,
        durationMs: Date.now() - configStart, lastRun: new Date().toISOString(),
      });
    } else {
      results.push({
        key: 'exec_config_state', domain: 'state_validation', title: 'Execution Config State',
        status: 'warn', depth: 'limited_coverage',
        summary: 'No execution config found — defaults will apply',
        durationMs: Date.now() - configStart, lastRun: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    results.push({
      key: 'exec_config_state', domain: 'state_validation', title: 'Execution Config State',
      status: 'fail', depth: 'limited_coverage', summary: `Error: ${err.message}`,
      durationMs: Date.now() - configStart, lastRun: new Date().toISOString(),
    });
  }

  // Validate launch state
  const launchStart = Date.now();
  try {
    const raw = await redis.get('launch:state');
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
      const validStates = ['prelaunch', 'ready', 'locked_for_launch', 'launched', 'launch_blocked'];
      const isValid = validStates.includes(parsed.state);
      results.push({
        key: 'launch_state_validation', domain: 'state_validation', title: 'Launch State Validation',
        status: isValid ? 'pass' : 'warn', depth: 'state_validation',
        summary: isValid ? `Valid state: ${parsed.state}` : `Suspicious state value: "${parsed.state}"`,
        durationMs: Date.now() - launchStart, lastRun: new Date().toISOString(),
      });
    } else {
      results.push({
        key: 'launch_state_validation', domain: 'state_validation', title: 'Launch State Validation',
        status: 'pass', depth: 'state_validation',
        summary: 'No launch state record — defaults to prelaunch (valid)',
        durationMs: Date.now() - launchStart, lastRun: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    results.push({
      key: 'launch_state_validation', domain: 'state_validation', title: 'Launch State Validation',
      status: 'fail', depth: 'limited_coverage', summary: `Error: ${err.message}`,
      durationMs: Date.now() - launchStart, lastRun: new Date().toISOString(),
    });
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Persist scan history                                               */
/* ------------------------------------------------------------------ */

export async function saveScanRecord(check: IntegrityCheck): Promise<IntegrityScanRecord> {
  const redis = getRedis();
  const id = `iscan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const record: IntegrityScanRecord = {
    id,
    createdAt: check.lastRun || new Date().toISOString(),
    domain: check.domain,
    checkName: check.key,
    status: check.status,
    summary: check.summary,
  };
  await redis.set(`${SCAN_PREFIX}${id}`, JSON.stringify(record));
  await redis.zadd(SCAN_SET, { score: Date.now(), member: id });

  const count = await redis.zcard(SCAN_SET);
  if (count > MAX_SCANS) {
    const toRemove = await redis.zrange(SCAN_SET, 0, count - MAX_SCANS - 1);
    for (const rid of toRemove) { await redis.del(`${SCAN_PREFIX}${rid}`); }
    await redis.zremrangebyrank(SCAN_SET, 0, count - MAX_SCANS - 1);
  }
  return record;
}

export async function saveScanBatch(checks: IntegrityCheck[]): Promise<IntegrityScanRecord[]> {
  const records: IntegrityScanRecord[] = [];
  for (const c of checks) { records.push(await saveScanRecord(c)); }
  return records;
}

export async function listScanHistory(limit = 50): Promise<IntegrityScanRecord[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SCAN_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const sliced = ids.slice(0, limit);
  const records: IntegrityScanRecord[] = [];
  for (const id of sliced) {
    const raw = await redis.get(`${SCAN_PREFIX}${id}`);
    if (raw) { records.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as IntegrityScanRecord); }
  }
  return records;
}
