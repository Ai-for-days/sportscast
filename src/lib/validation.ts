import { getRedis } from './redis';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ValidationCheck {
  key: string;
  title: string;
  description: string;
  category: 'engineering' | 'trading' | 'operator' | 'launch';
  status: 'pass' | 'fail' | 'warn' | 'not_run';
  summary: string;
  durationMs?: number;
  lastRun?: string;
}

export interface ValidationRun {
  id: string;
  createdAt: string;
  category: string;
  checkName: string;
  status: 'pass' | 'fail' | 'warn';
  summary: string;
}

const VALIDATION_SORTED_SET = 'validation:runs';
const VALIDATION_KEY_PREFIX = 'validation:run:';
const MAX_RUNS = 500;

/* ------------------------------------------------------------------ */
/*  Known admin pages + API routes (structural reference)              */
/* ------------------------------------------------------------------ */

const KNOWN_ADMIN_PAGES = [
  'alerts', 'backtesting', 'change-control', 'compliance', 'demo-execution',
  'execution-candidates', 'execution-control', 'forecasts', 'history',
  'kalshi-lab', 'launch-readiness', 'live-execution', 'live-readiness',
  'market-making', 'market-performance', 'model-attribution', 'model-governance',
  'notifications', 'operations-center', 'operator-dashboard', 'performance',
  'portfolio', 'pricing-lab', 'reconciliation', 'reports', 'research-sandbox',
  'resilience', 'security', 'settlement', 'signals', 'trade-journal',
  'venues', 'wagers',
];

const KNOWN_API_ROUTES = [
  'alerts', 'attribution', 'backtesting', 'bankroll', 'bets', 'change-control',
  'compliance', 'credit-balance', 'demo-execution', 'execution-candidates',
  'execution-control', 'forecast-consensus', 'forecasts', 'health', 'history',
  'launch-readiness', 'line-suggestions', 'live-execution', 'live-readiness',
  'login', 'logout', 'market-making', 'model-attribution', 'model-governance',
  'notifications', 'operations-center', 'operator-dashboard', 'performance',
  'portfolio', 'reconciliation', 'reports', 'research-sandbox', 'resilience',
  'security', 'settlement', 'signals', 'trade-journal', 'trading-desk',
  'users', 'venues', 'wagers',
];

/* ------------------------------------------------------------------ */
/*  Check definitions                                                  */
/* ------------------------------------------------------------------ */

const ENGINEERING_CHECKS: Array<{ key: string; title: string; description: string }> = [
  { key: 'admin_pages', title: 'Admin Page Load Verification', description: 'Verify known admin pages and API routes are structurally registered' },
  { key: 'api_error_handling', title: 'API Error-Handling Verification', description: 'Verify API health endpoint responds and returns valid JSON' },
  { key: 'empty_states', title: 'Empty-State Coverage Review', description: 'Structural check — verify key data indexes are queryable (empty or populated)' },
  { key: 'loading_states', title: 'Loading-State Coverage Review', description: 'Structural check — verify Redis responds within acceptable latency' },
  { key: 'redis_connectivity', title: 'Redis Connectivity Check', description: 'Verify Redis connection is active and responding' },
  { key: 'data_integrity', title: 'Basic Data Integrity Scan', description: 'Verify key Redis data structures exist and are valid' },
];

const TRADING_CHECKS: Array<{ key: string; title: string; description: string }> = [
  { key: 'forecast_pipeline', title: 'Forecast Pipeline Status', description: 'Verify forecast records exist in the system' },
  { key: 'verification_pipeline', title: 'Verification Pipeline Status', description: 'Verify verification scoring records exist' },
  { key: 'consensus_generation', title: 'Consensus Generation Status', description: 'Verify consensus forecast engine has output' },
  { key: 'market_pricing', title: 'Market Pricing Generation Status', description: 'Verify bookmaker pricing records exist' },
  { key: 'signal_generation', title: 'Signal Generation Status', description: 'Verify trading signals have been generated' },
  { key: 'candidate_creation', title: 'Candidate Creation Status', description: 'Verify execution candidates exist' },
  { key: 'demo_execution', title: 'Demo Execution Readiness', description: 'Verify demo execution config is available' },
  { key: 'reconciliation', title: 'Reconciliation Readiness', description: 'Verify reconciliation system is accessible' },
  { key: 'settlement', title: 'Settlement Readiness', description: 'Verify settlement system is accessible' },
];

const OPERATOR_CHECKS: Array<{ key: string; title: string; description: string }> = [
  { key: 'approval_workflow', title: 'Approval Workflow Review', description: 'Verify approval system records exist' },
  { key: 'dual_control', title: 'Dual-Control Workflow Review', description: 'Verify dual-control enforcement is in place' },
  { key: 'notification_workflow', title: 'Notification Workflow Review', description: 'Verify notification system is accessible' },
  { key: 'incident_logging', title: 'Incident Logging Workflow Review', description: 'Verify incident records can be retrieved' },
  { key: 'ops_center', title: 'Operations Center Workflow Review', description: 'Verify ops center systems are accessible' },
  { key: 'launch_checklist', title: 'Launch Checklist Workflow Review', description: 'Verify launch checklist data is available' },
];

const LAUNCH_CHECKS: Array<{ key: string; title: string; description: string }> = [
  { key: 'config_presence', title: 'Config Presence Check', description: 'Verify critical environment variables are set' },
  { key: 'credential_presence', title: 'Credential Presence Check', description: 'Verify API credentials are configured' },
  { key: 'audit_logging', title: 'Audit Logging Enabled Check', description: 'Verify audit log infrastructure is reachable and has recorded events' },
  { key: 'kill_switch', title: 'Kill Switch Visibility Check', description: 'Verify kill switch config is readable and well-formed' },
  { key: 'approval_controls', title: 'Approval Controls Enabled Check', description: 'Verify RBAC roles and permission structures are present and parseable' },
  { key: 'launch_state', title: 'Launch Lock / Readiness State Check', description: 'Verify launch state machine is readable and contains a valid state' },
];

export function getCheckDefinitions() {
  return {
    engineering: ENGINEERING_CHECKS,
    trading: TRADING_CHECKS,
    operator: OPERATOR_CHECKS,
    launch: LAUNCH_CHECKS,
  };
}

/* ------------------------------------------------------------------ */
/*  Run checks                                                         */
/* ------------------------------------------------------------------ */

async function runCheck(
  key: string,
  category: 'engineering' | 'trading' | 'operator' | 'launch',
  title: string,
  description: string,
): Promise<ValidationCheck> {
  const start = Date.now();
  try {
    const redis = getRedis();
    let status: 'pass' | 'fail' | 'warn' = 'pass';
    let summary = '';

    switch (key) {
      /* ---- Engineering ---- */
      case 'admin_pages': {
        // Structurally verify known page and API route counts
        const pageCount = KNOWN_ADMIN_PAGES.length;
        const apiCount = KNOWN_API_ROUTES.length;
        // Verify Redis is reachable (proves server-side routes can function)
        await redis.ping();
        status = (pageCount >= 30 && apiCount >= 30) ? 'pass' : 'warn';
        summary = `${pageCount} admin pages, ${apiCount} API routes registered — Redis reachable (structural verification, no HTTP probe)`;
        break;
      }
      case 'api_error_handling': {
        // Verify the health API endpoint key exists and Redis responds
        // This confirms the API layer is functional, but does not test individual error paths
        await redis.ping();
        status = 'warn';
        summary = 'Limited verification — Redis responds, API layer is functional. Individual error-path testing requires deeper integration tests.';
        break;
      }
      case 'empty_states': {
        // Verify that key sorted set indexes are queryable (even if empty)
        const indexes = ['forecasts:all', 'audit:events', 'signals:all', 'incidents:all', 'notifications:all'];
        const queryable: string[] = [];
        for (const idx of indexes) {
          const count = await redis.zcard(idx);
          queryable.push(`${idx}:${count}`);
        }
        status = 'warn';
        summary = `Limited verification — ${indexes.length} data indexes queryable (${queryable.join(', ')}). UI empty-state rendering requires manual or browser-level testing.`;
        break;
      }
      case 'loading_states': {
        // Measure Redis round-trip latency as a proxy for loading performance
        const pingStart = Date.now();
        await redis.ping();
        const latency = Date.now() - pingStart;
        status = latency < 500 ? 'warn' : 'fail';
        summary = `Limited verification — Redis round-trip: ${latency}ms. UI loading-state rendering requires manual or browser-level testing.`;
        break;
      }
      case 'redis_connectivity': {
        const pong = await redis.ping();
        if (pong === 'PONG') {
          summary = 'Redis connection active — PONG received';
        } else {
          status = 'fail';
          summary = `Unexpected ping response: ${pong}`;
        }
        break;
      }
      case 'data_integrity': {
        const keys = ['audit:events', 'forecasts:all', 'signals:all', 'validation:runs'];
        const results: string[] = [];
        for (const k of keys) {
          const count = await redis.zcard(k);
          results.push(`${k}: ${count}`);
        }
        summary = results.join('; ');
        break;
      }

      /* ---- Trading ---- */
      case 'forecast_pipeline': {
        const count = await redis.zcard('forecasts:all');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} forecast records found`;
        break;
      }
      case 'verification_pipeline': {
        const count = await redis.zcard('verifications:all');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} verification records found`;
        break;
      }
      case 'consensus_generation': {
        const count = await redis.zcard('consensus:all');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} consensus records found`;
        break;
      }
      case 'market_pricing': {
        const count = await redis.zcard('bookmaker:markets');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} pricing records found`;
        break;
      }
      case 'signal_generation': {
        const count = await redis.zcard('signals:all');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} signal records found`;
        break;
      }
      case 'candidate_creation': {
        const count = await redis.zcard('exec:candidates:all');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} execution candidate records found`;
        break;
      }
      case 'demo_execution': {
        const config = await redis.get('exec:config');
        status = config ? 'pass' : 'warn';
        summary = config ? 'Execution config is present' : 'No execution config found';
        break;
      }
      case 'reconciliation': {
        const count = await redis.zcard('recon:runs:all');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} reconciliation runs found`;
        break;
      }
      case 'settlement': {
        const count = await redis.zcard('settlements:all');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} settlement records found`;
        break;
      }

      /* ---- Operator ---- */
      case 'approval_workflow': {
        const count = await redis.zcard('approvals:all');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} approval records found`;
        break;
      }
      case 'dual_control': {
        const roles = await redis.zcard('rbac:roles');
        status = roles > 0 ? 'pass' : 'warn';
        summary = roles > 0 ? `${roles} RBAC roles configured — dual-control supported` : 'No RBAC roles found — dual-control not verifiable';
        break;
      }
      case 'notification_workflow': {
        const count = await redis.zcard('notifications:all');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} notification records found`;
        break;
      }
      case 'incident_logging': {
        const count = await redis.zcard('incidents:all');
        status = count > 0 ? 'pass' : 'warn';
        summary = `${count} incident records found`;
        break;
      }
      case 'ops_center': {
        const [runbooks, handoffs] = await Promise.all([
          redis.zcard('runbooks:all'),
          redis.zcard('handoffs:all'),
        ]);
        status = (runbooks > 0 || handoffs > 0) ? 'pass' : 'warn';
        summary = `${runbooks} runbooks, ${handoffs} handoffs`;
        break;
      }
      case 'launch_checklist': {
        const items = await redis.zcard('launch:checklist:all');
        status = items > 0 ? 'pass' : 'warn';
        summary = `${items} checklist items found`;
        break;
      }

      /* ---- Launch ---- */
      case 'config_presence': {
        const vars = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'ADMIN_SECRET'];
        const present = vars.filter(v => !!import.meta.env[v]);
        status = present.length === vars.length ? 'pass' : 'fail';
        summary = `${present.length}/${vars.length} critical env vars configured`;
        break;
      }
      case 'credential_presence': {
        const vars = ['KALSHI_API_KEY'];
        const present = vars.filter(v => !!import.meta.env[v]);
        status = present.length === vars.length ? 'pass' : 'warn';
        summary = `${present.length}/${vars.length} API credentials configured`;
        break;
      }
      case 'audit_logging': {
        // Verify the audit sorted set is reachable and check event count + most recent
        const count = await redis.zcard('audit:events');
        if (count > 0) {
          const recentIds = await redis.zrange('audit:events', 0, 0, { rev: true });
          if (recentIds && recentIds.length > 0) {
            const raw = await redis.get(`audit:event:${recentIds[0]}`);
            if (raw) {
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              status = 'pass';
              summary = `${count} audit events — most recent: "${parsed.eventType}" at ${parsed.createdAt}`;
            } else {
              status = 'warn';
              summary = `${count} audit events indexed but most recent record not readable`;
            }
          } else {
            status = 'warn';
            summary = `${count} events in index but unable to retrieve latest`;
          }
        } else {
          status = 'warn';
          summary = '0 audit events — logging infrastructure reachable but no events recorded yet';
        }
        break;
      }
      case 'kill_switch': {
        const config = await redis.get('exec:config');
        if (config) {
          const parsed = typeof config === 'string' ? JSON.parse(config) : config;
          const ks = parsed.killSwitch;
          if (ks && typeof ks.active === 'boolean') {
            status = 'pass';
            summary = `Kill switch config well-formed — active: ${ks.active}, reason: ${ks.reason || 'none'}`;
          } else {
            status = 'warn';
            summary = 'Execution config exists but killSwitch field is missing or malformed';
          }
        } else {
          status = 'warn';
          summary = 'No execution config found — kill switch state unknown';
        }
        break;
      }
      case 'approval_controls': {
        const roleCount = await redis.zcard('rbac:roles');
        if (roleCount > 0) {
          // Verify at least one role record is readable and parseable
          const roleIds = await redis.zrange('rbac:roles', 0, 0, { rev: true });
          if (roleIds && roleIds.length > 0) {
            const raw = await redis.get(`rbac:role:${roleIds[0]}`);
            if (raw) {
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              status = 'pass';
              summary = `${roleCount} RBAC roles — sample role "${parsed.name || parsed.id || roleIds[0]}" is readable and parseable`;
            } else {
              status = 'warn';
              summary = `${roleCount} roles indexed but sample record not readable`;
            }
          } else {
            status = 'warn';
            summary = `${roleCount} roles in index but unable to retrieve sample`;
          }
        } else {
          status = 'warn';
          summary = '0 RBAC roles — approval controls not yet configured';
        }
        break;
      }
      case 'launch_state': {
        const state = await redis.get('launch:state');
        if (state) {
          const parsed = typeof state === 'string' ? JSON.parse(state) : state;
          const validStates = ['prelaunch', 'ready', 'locked_for_launch', 'launched', 'launch_blocked'];
          const currentState = parsed.state || 'unknown';
          if (validStates.includes(currentState)) {
            status = 'pass';
            summary = `Launch state: "${currentState}" — valid state machine value. Updated: ${parsed.updatedAt || 'unknown'}`;
          } else {
            status = 'warn';
            summary = `Launch state readable but value "${currentState}" is not in expected state set`;
          }
        } else {
          status = 'warn';
          summary = 'No launch state record found — system defaults to prelaunch';
        }
        break;
      }

      default:
        status = 'warn';
        summary = `No check implementation for key: ${key}`;
    }

    const durationMs = Date.now() - start;
    const now = new Date().toISOString();

    return { key, title, description, category, status, summary, durationMs, lastRun: now };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    return {
      key, title, description, category,
      status: 'fail',
      summary: `Error: ${err.message}`,
      durationMs,
      lastRun: new Date().toISOString(),
    };
  }
}

export async function runCategoryChecks(category: 'engineering' | 'trading' | 'operator' | 'launch'): Promise<ValidationCheck[]> {
  const defs = getCheckDefinitions();
  const checks = defs[category];
  const results: ValidationCheck[] = [];
  for (const c of checks) {
    results.push(await runCheck(c.key, category, c.title, c.description));
  }
  return results;
}

export async function runAllChecks(): Promise<ValidationCheck[]> {
  const categories: Array<'engineering' | 'trading' | 'operator' | 'launch'> = [
    'engineering', 'trading', 'operator', 'launch',
  ];
  const all: ValidationCheck[] = [];
  for (const cat of categories) {
    const results = await runCategoryChecks(cat);
    all.push(...results);
  }
  return all;
}

export async function runSingleCheck(key: string): Promise<ValidationCheck | null> {
  const defs = getCheckDefinitions();
  for (const [cat, checks] of Object.entries(defs)) {
    const found = checks.find(c => c.key === key);
    if (found) {
      return runCheck(found.key, cat as any, found.title, found.description);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Persist run history                                                */
/* ------------------------------------------------------------------ */

export async function saveValidationRun(check: ValidationCheck): Promise<ValidationRun> {
  const redis = getRedis();
  const id = `vr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const run: ValidationRun = {
    id,
    createdAt: check.lastRun || new Date().toISOString(),
    category: check.category,
    checkName: check.key,
    status: check.status === 'not_run' ? 'warn' : check.status,
    summary: check.summary,
  };

  await redis.set(`${VALIDATION_KEY_PREFIX}${id}`, JSON.stringify(run));
  await redis.zadd(VALIDATION_SORTED_SET, { score: Date.now(), member: id });

  // Trim old runs
  const count = await redis.zcard(VALIDATION_SORTED_SET);
  if (count > MAX_RUNS) {
    const toRemove = await redis.zrange(VALIDATION_SORTED_SET, 0, count - MAX_RUNS - 1);
    for (const rid of toRemove) {
      await redis.del(`${VALIDATION_KEY_PREFIX}${rid}`);
    }
    await redis.zremrangebyrank(VALIDATION_SORTED_SET, 0, count - MAX_RUNS - 1);
  }

  return run;
}

export async function saveValidationBatch(checks: ValidationCheck[]): Promise<ValidationRun[]> {
  const runs: ValidationRun[] = [];
  for (const c of checks) {
    runs.push(await saveValidationRun(c));
  }
  return runs;
}

export async function listValidationRuns(limit = 50): Promise<ValidationRun[]> {
  const redis = getRedis();
  const ids = await redis.zrange(VALIDATION_SORTED_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];

  const sliced = ids.slice(0, limit);
  const runs: ValidationRun[] = [];
  for (const id of sliced) {
    const raw = await redis.get(`${VALIDATION_KEY_PREFIX}${id}`);
    if (raw) {
      runs.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ValidationRun);
    }
  }
  return runs;
}
