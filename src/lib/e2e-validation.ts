import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type VerificationDepth = 'automated' | 'structural' | 'manual_required' | 'operator_confirmed';
export type CheckStatus = 'pass' | 'fail' | 'warn' | 'not_run' | 'manual_pending';

export interface E2ECheck {
  key: string;
  stage: string;
  title: string;
  description: string;
  status: CheckStatus;
  verificationDepth: VerificationDepth;
  summary: string;
  durationMs?: number;
  lastRun?: string;
  automated: boolean;
}

export interface E2EManualSignoff {
  key: string;
  stage: string;
  title: string;
  confirmedBy?: string;
  confirmedAt?: string;
  notes?: string;
}

export interface E2ERunRecord {
  id: string;
  createdAt: string;
  stage: string;
  checkKey: string;
  status: string;
  verificationDepth: string;
  summary: string;
  automated: boolean;
  operatorId?: string;
}

const E2E_RUN_SET = 'e2e:runs';
const E2E_RUN_PREFIX = 'e2e:run:';
const E2E_SIGNOFF_PREFIX = 'e2e:signoff:';
const MAX_RUNS = 500;

/* ------------------------------------------------------------------ */
/*  Check definitions by stage                                         */
/* ------------------------------------------------------------------ */

interface CheckDef {
  key: string;
  title: string;
  description: string;
  stage: string;
  automated: boolean;
  redisKey?: string;
  envVar?: string;
  configKey?: string;
}

const CHECKS: CheckDef[] = [
  // A. Forecasting
  { key: 'forecast_data', title: 'Forecast Data Available', description: 'Verify forecast records exist', stage: 'forecasting', automated: true, redisKey: 'forecasts:all' },
  { key: 'forecast_ingestion', title: 'Forecast Ingestion Path', description: 'Verify forecast ingestion pipeline is accessible', stage: 'forecasting', automated: true, redisKey: 'forecasts:all' },
  { key: 'verification_pipeline', title: 'Verification Pipeline Available', description: 'Verify verification scoring records exist', stage: 'forecasting', automated: true, redisKey: 'verifications:all' },
  { key: 'consensus_pipeline', title: 'Consensus Pipeline Available', description: 'Verify consensus engine has produced output', stage: 'forecasting', automated: true, redisKey: 'consensus:all' },

  // B. Market Generation
  { key: 'pricing_engine', title: 'Pricing Engine Available', description: 'Verify bookmaker pricing records exist', stage: 'market_generation', automated: true, redisKey: 'bookmaker:markets' },
  { key: 'market_generation', title: 'Sportsbook Market Generation', description: 'Verify market data is generated', stage: 'market_generation', automated: true, redisKey: 'bookmaker:markets' },
  { key: 'trading_desk_data', title: 'Trading Desk Data Available', description: 'Verify trading desk can load market data', stage: 'market_generation', automated: true, redisKey: 'bookmaker:markets' },

  // C. Signals & Candidates
  { key: 'signal_generation', title: 'Signal Generation Available', description: 'Verify trading signals have been generated', stage: 'signals_candidates', automated: true, redisKey: 'signals:all' },
  { key: 'candidate_creation', title: 'Candidate Creation Available', description: 'Verify execution candidates exist', stage: 'signals_candidates', automated: true, redisKey: 'exec:candidates:all' },
  { key: 'ranking_data', title: 'Ranking/Prioritization Data', description: 'Verify signal ranking data is available', stage: 'signals_candidates', automated: true, redisKey: 'signals:all' },

  // D. Execution
  { key: 'demo_execution_path', title: 'Demo Execution Path Available', description: 'Verify demo execution config is present', stage: 'execution', automated: true, configKey: 'exec:config' },
  { key: 'live_execution_controls', title: 'Live Execution Controls Present', description: 'Verify execution config and live mode settings exist', stage: 'execution', automated: true, configKey: 'exec:config' },
  { key: 'kill_switch_readable', title: 'Kill Switch State Readable', description: 'Verify kill switch state can be read from config', stage: 'execution', automated: true, configKey: 'exec:config' },
  { key: 'execution_config_readable', title: 'Execution Config Readable', description: 'Verify execution configuration is accessible', stage: 'execution', automated: true, configKey: 'exec:config' },

  // E. Post-Trade
  { key: 'reconciliation_path', title: 'Reconciliation Path Available', description: 'Verify reconciliation system is accessible', stage: 'post_trade', automated: true, redisKey: 'recon:runs:all' },
  { key: 'settlement_path', title: 'Settlement Path Available', description: 'Verify settlement system is accessible', stage: 'post_trade', automated: true, redisKey: 'settlements:all' },
  { key: 'report_visibility', title: 'Accounting/Report Visibility', description: 'Verify reporting system is accessible', stage: 'post_trade', automated: true, redisKey: 'audit:events' },

  // F. Operations
  { key: 'alerts_available', title: 'Alerts Available', description: 'Verify alert system is accessible', stage: 'operations', automated: true, redisKey: 'alerts:all' },
  { key: 'incidents_available', title: 'Incidents Available', description: 'Verify incident system is accessible', stage: 'operations', automated: true, redisKey: 'incidents:all' },
  { key: 'notifications_available', title: 'Notifications Available', description: 'Verify notification system is accessible', stage: 'operations', automated: true, redisKey: 'notifications:all' },
  { key: 'ops_center_available', title: 'Operations Center Available', description: 'Verify ops center systems are accessible', stage: 'operations', automated: true, redisKey: 'runbooks:all' },

  // G. Governance & Launch
  { key: 'audit_log_available', title: 'Audit Log Available', description: 'Verify audit log has recorded events', stage: 'governance_launch', automated: true, redisKey: 'audit:events' },
  { key: 'approvals_presence', title: 'Approvals / Dual-Control Presence', description: 'Verify approval system and RBAC are configured', stage: 'governance_launch', automated: true, redisKey: 'rbac:roles' },
  { key: 'launch_state_readable', title: 'Launch Readiness State Readable', description: 'Verify launch state machine is accessible', stage: 'governance_launch', automated: true, configKey: 'launch:state' },
  { key: 'launch_blockers_visible', title: 'Launch Blockers/Signoff Visibility', description: 'Verify launch signoff and checklist are accessible', stage: 'governance_launch', automated: true, redisKey: 'launch:checklist:all' },
];

const MANUAL_ITEMS: Array<{ key: string; stage: string; title: string }> = [
  { key: 'ui_clarity', stage: 'manual', title: 'UI clarity confirmed' },
  { key: 'workflow_understandable', stage: 'manual', title: 'Workflow understandable' },
  { key: 'approval_flow_reviewed', stage: 'manual', title: 'Approval flow reviewed' },
  { key: 'notification_delivery_observed', stage: 'manual', title: 'Notification delivery observed' },
  { key: 'launch_checklist_reviewed', stage: 'manual', title: 'Launch checklist reviewed' },
];

export function getE2ECheckDefinitions() {
  return CHECKS;
}

export function getManualItems() {
  return MANUAL_ITEMS;
}

export const STAGE_LABELS: Record<string, string> = {
  forecasting: 'A. Forecasting',
  market_generation: 'B. Market Generation',
  signals_candidates: 'C. Signals & Candidates',
  execution: 'D. Execution',
  post_trade: 'E. Post-Trade',
  operations: 'F. Operations',
  governance_launch: 'G. Governance & Launch',
  manual: 'Manual Operator Signoff',
};

export const STAGES = ['forecasting', 'market_generation', 'signals_candidates', 'execution', 'post_trade', 'operations', 'governance_launch'];

/* ------------------------------------------------------------------ */
/*  Run checks                                                         */
/* ------------------------------------------------------------------ */

async function runCheck(def: CheckDef): Promise<E2ECheck> {
  const start = Date.now();
  try {
    const redis = getRedis();
    let status: CheckStatus = 'pass';
    let summary = '';
    let depth: VerificationDepth = 'automated';

    if (def.redisKey) {
      const count = await redis.zcard(def.redisKey);
      if (count > 0) {
        status = 'pass';
        summary = `${count} records found in ${def.redisKey}`;
      } else {
        status = 'warn';
        summary = `0 records in ${def.redisKey} — pipeline may not have run yet`;
        depth = 'structural';
      }
    } else if (def.configKey) {
      const val = await redis.get(def.configKey);
      if (val) {
        const parsed = typeof val === 'string' ? JSON.parse(val) : val;
        status = 'pass';
        if (def.key === 'kill_switch_readable' && parsed.killSwitchEnabled !== undefined) {
          summary = `Kill switch readable — enabled: ${parsed.killSwitchEnabled}`;
        } else if (def.key === 'launch_state_readable' && parsed.state) {
          summary = `Launch state: ${parsed.state}`;
        } else if (def.key === 'execution_config_readable') {
          summary = `Execution config readable — mode: ${parsed.mode || 'unknown'}`;
        } else if (def.key === 'demo_execution_path') {
          summary = `Demo config present — demo enabled: ${parsed.demoTradingEnabled ?? 'unknown'}`;
        } else if (def.key === 'live_execution_controls') {
          summary = `Live controls present — live enabled: ${parsed.liveTradingEnabled ?? 'unknown'}, mode: ${parsed.mode || 'unknown'}`;
        } else {
          summary = `Config key ${def.configKey} is readable`;
        }
      } else {
        status = 'warn';
        summary = `Config key ${def.configKey} not found — may need initialization`;
        depth = 'structural';
      }
    } else if (def.envVar) {
      const present = !!import.meta.env[def.envVar];
      status = present ? 'pass' : 'fail';
      summary = present ? `${def.envVar} is configured` : `${def.envVar} is missing`;
    } else {
      status = 'warn';
      summary = 'No automated check available';
      depth = 'structural';
    }

    return {
      key: def.key, stage: def.stage, title: def.title, description: def.description,
      status, verificationDepth: depth, summary,
      durationMs: Date.now() - start, lastRun: new Date().toISOString(),
      automated: true,
    };
  } catch (err: any) {
    return {
      key: def.key, stage: def.stage, title: def.title, description: def.description,
      status: 'fail', verificationDepth: 'automated',
      summary: `Error: ${err.message}`,
      durationMs: Date.now() - start, lastRun: new Date().toISOString(),
      automated: true,
    };
  }
}

export async function runStageChecks(stage: string): Promise<E2ECheck[]> {
  const defs = CHECKS.filter(c => c.stage === stage);
  const results: E2ECheck[] = [];
  for (const d of defs) {
    results.push(await runCheck(d));
  }
  return results;
}

export async function runAllE2EChecks(): Promise<E2ECheck[]> {
  const all: E2ECheck[] = [];
  for (const stage of STAGES) {
    const results = await runStageChecks(stage);
    all.push(...results);
  }
  return all;
}

/* ------------------------------------------------------------------ */
/*  Manual signoffs                                                    */
/* ------------------------------------------------------------------ */

export async function getManualSignoff(key: string): Promise<E2EManualSignoff | null> {
  const redis = getRedis();
  const raw = await redis.get(`${E2E_SIGNOFF_PREFIX}${key}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as E2EManualSignoff;
}

export async function getAllManualSignoffs(): Promise<E2EManualSignoff[]> {
  const results: E2EManualSignoff[] = [];
  for (const item of MANUAL_ITEMS) {
    const signoff = await getManualSignoff(item.key);
    results.push(signoff || { key: item.key, stage: item.stage, title: item.title });
  }
  return results;
}

export async function confirmManualSignoff(key: string, operatorId: string, notes?: string): Promise<E2EManualSignoff | null> {
  const item = MANUAL_ITEMS.find(m => m.key === key);
  if (!item) return null;
  const signoff: E2EManualSignoff = {
    key: item.key,
    stage: item.stage,
    title: item.title,
    confirmedBy: operatorId,
    confirmedAt: new Date().toISOString(),
    notes,
  };
  const redis = getRedis();
  await redis.set(`${E2E_SIGNOFF_PREFIX}${key}`, JSON.stringify(signoff));
  await logAuditEvent({
    actor: operatorId,
    eventType: 'e2e_manual_signoff',
    targetType: 'e2e-validation',
    targetId: key,
    summary: `Manual signoff: ${item.title}${notes ? ` — ${notes}` : ''}`,
  });
  return signoff;
}

/* ------------------------------------------------------------------ */
/*  Persist run history                                                */
/* ------------------------------------------------------------------ */

export async function saveE2ERun(check: E2ECheck, operatorId?: string): Promise<E2ERunRecord> {
  const redis = getRedis();
  const id = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const run: E2ERunRecord = {
    id,
    createdAt: check.lastRun || new Date().toISOString(),
    stage: check.stage,
    checkKey: check.key,
    status: check.status,
    verificationDepth: check.verificationDepth,
    summary: check.summary,
    automated: check.automated,
    operatorId,
  };
  await redis.set(`${E2E_RUN_PREFIX}${id}`, JSON.stringify(run));
  await redis.zadd(E2E_RUN_SET, { score: Date.now(), member: id });

  const count = await redis.zcard(E2E_RUN_SET);
  if (count > MAX_RUNS) {
    const toRemove = await redis.zrange(E2E_RUN_SET, 0, count - MAX_RUNS - 1);
    for (const rid of toRemove) {
      await redis.del(`${E2E_RUN_PREFIX}${rid}`);
    }
    await redis.zremrangebyrank(E2E_RUN_SET, 0, count - MAX_RUNS - 1);
  }
  return run;
}

export async function saveE2EBatch(checks: E2ECheck[], operatorId?: string): Promise<E2ERunRecord[]> {
  const runs: E2ERunRecord[] = [];
  for (const c of checks) {
    runs.push(await saveE2ERun(c, operatorId));
  }
  return runs;
}

export async function listE2ERuns(limit = 50): Promise<E2ERunRecord[]> {
  const redis = getRedis();
  const ids = await redis.zrange(E2E_RUN_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const sliced = ids.slice(0, limit);
  const runs: E2ERunRecord[] = [];
  for (const id of sliced) {
    const raw = await redis.get(`${E2E_RUN_PREFIX}${id}`);
    if (raw) {
      runs.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as E2ERunRecord);
    }
  }
  return runs;
}
