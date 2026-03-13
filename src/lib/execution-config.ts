import { getRedis } from './redis';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ExecutionMode = 'disabled' | 'paper' | 'demo' | 'live';

export interface ExecutionConfig {
  mode: ExecutionMode;
  liveTradingEnabled: boolean;
  demoTradingEnabled: boolean;
  requireApproval: boolean;
  killSwitchEnabled: boolean;
}

const CONFIG_KEY = 'execution:config';

const DEFAULT_CONFIG: ExecutionConfig = {
  mode: 'paper',
  liveTradingEnabled: false,
  demoTradingEnabled: false,
  requireApproval: true,
  killSwitchEnabled: false,
};

/* ------------------------------------------------------------------ */
/*  Read / Write                                                       */
/* ------------------------------------------------------------------ */

export async function getExecutionConfig(): Promise<ExecutionConfig> {
  const redis = getRedis();
  const raw = await redis.get(CONFIG_KEY);
  if (!raw) return { ...DEFAULT_CONFIG };
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ExecutionConfig;
  return { ...DEFAULT_CONFIG, ...parsed };
}

export async function updateExecutionConfig(
  updates: Partial<ExecutionConfig>
): Promise<ExecutionConfig> {
  const current = await getExecutionConfig();
  const updated: ExecutionConfig = { ...current, ...updates };

  // Safety: live mode requires explicit liveTradingEnabled
  if (updated.mode === 'live' && !updated.liveTradingEnabled) {
    updated.mode = 'paper';
  }
  // Safety: demo mode requires demoTradingEnabled
  if (updated.mode === 'demo' && !updated.demoTradingEnabled) {
    updated.mode = 'paper';
  }

  const redis = getRedis();
  await redis.set(CONFIG_KEY, JSON.stringify(updated));
  return updated;
}

/* ------------------------------------------------------------------ */
/*  Guards                                                             */
/* ------------------------------------------------------------------ */

export async function isKillSwitchActive(): Promise<boolean> {
  const config = await getExecutionConfig();
  return config.killSwitchEnabled;
}

export async function canExecute(): Promise<{ allowed: boolean; reason?: string }> {
  const config = await getExecutionConfig();

  if (config.killSwitchEnabled) {
    return { allowed: false, reason: 'Kill switch is active' };
  }
  if (config.mode === 'disabled') {
    return { allowed: false, reason: 'Execution is disabled' };
  }
  return { allowed: true };
}

export async function canExecuteLive(): Promise<{ allowed: boolean; reason?: string }> {
  const config = await getExecutionConfig();

  if (config.killSwitchEnabled) {
    return { allowed: false, reason: 'Kill switch is active' };
  }
  if (!config.liveTradingEnabled) {
    return { allowed: false, reason: 'Live trading is not enabled' };
  }
  if (config.mode !== 'live') {
    return { allowed: false, reason: `Current mode is "${config.mode}", not "live"` };
  }
  return { allowed: true };
}
