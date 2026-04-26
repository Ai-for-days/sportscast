// ── Step 77: Strategy mode control ──────────────────────────────────────────
//
// Three operating styles:
//   decision_support      Signals are informational only. Operator decides
//                         everything manually.
//   operator_approved     System highlights validated opportunities and
//                         recommends actions, but operator approval is
//                         required before any candidate or execution action.
//   systematic_research   System tags signals as "systematic eligible," but
//                         still does NOT auto-execute live trades.
//
// Storage: Redis. Current config at `strategy-mode:current`. Audit history
// (last N changes) in sorted set `strategy-mode:history`.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

export type StrategyMode = 'decision_support' | 'operator_approved' | 'systematic_research';

export const STRATEGY_MODES: StrategyMode[] = [
  'decision_support',
  'operator_approved',
  'systematic_research',
];

export interface StrategyModeConfig {
  mode: StrategyMode;
  updatedAt: string;
  updatedBy: string;
  notes?: string;
}

export const STRATEGY_MODE_DESCRIPTIONS: Record<StrategyMode, string> = {
  decision_support:
    'Signals are informational only. The operator manually decides everything. ' +
    'No systematic eligibility emphasis is shown.',
  operator_approved:
    'System highlights validated opportunities and recommends actions, but ' +
    'operator approval is required before any candidate or execution action. ' +
    'No automatic candidate creation, ever.',
  systematic_research:
    'System tags signals as "systematic eligible" based on Edge Validation ' +
    'verdicts and Step 71 calibration thresholds. Live execution remains ' +
    'manual; this mode is research/labeling only.',
};

export const STRATEGY_MODE_SAFETY: Record<StrategyMode, string[]> = {
  decision_support: [
    'Lowest-risk default. Use when calibration data is sparse or you want full manual control.',
  ],
  operator_approved: [
    'No automatic order submission.',
    'No automatic candidate creation.',
    'Validated-edge highlights are advisory only.',
  ],
  systematic_research: [
    'Live execution still requires explicit operator action.',
    'systematicEligible is a label, not a trade trigger.',
    'Use Edge Validation + Calibration Backtest to monitor segments before changing parameters.',
  ],
};

const KEY_CURRENT = 'strategy-mode:current';
const SET_HISTORY = 'strategy-mode:history';
const HIST_PREFIX = 'strategy-mode:history:';
const HISTORY_MAX = 200;

const DEFAULT_CONFIG: StrategyModeConfig = {
  mode: 'decision_support',
  updatedAt: new Date(0).toISOString(),
  updatedBy: 'system-default',
  notes: 'Default — no operator change recorded yet.',
};

// Module-level memo so signal-ranking calls don't hit Redis on every signal.
let cached: { cfg: StrategyModeConfig; loadedAt: number } | null = null;
const CACHE_MS = 30_000;

export async function getStrategyMode(force = false): Promise<StrategyModeConfig> {
  const now = Date.now();
  if (!force && cached && now - cached.loadedAt < CACHE_MS) return cached.cfg;
  const redis = getRedis();
  const raw = await redis.get(KEY_CURRENT);
  let cfg: StrategyModeConfig = DEFAULT_CONFIG;
  if (raw) {
    try {
      cfg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as StrategyModeConfig;
    } catch {
      cfg = DEFAULT_CONFIG;
    }
  }
  cached = { cfg, loadedAt: now };
  return cfg;
}

export async function setStrategyMode(input: {
  mode: StrategyMode;
  updatedBy: string;
  notes?: string;
}): Promise<StrategyModeConfig> {
  if (!STRATEGY_MODES.includes(input.mode)) {
    throw new Error(`Invalid mode: ${input.mode}`);
  }
  const previous = await getStrategyMode(true);
  const cfg: StrategyModeConfig = {
    mode: input.mode,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy,
    notes: input.notes,
  };
  const redis = getRedis();
  await redis.set(KEY_CURRENT, JSON.stringify(cfg));

  // Audit history (sorted-set index + per-record key)
  const histId = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await redis.set(`${HIST_PREFIX}${histId}`, JSON.stringify({
    ...cfg,
    previousMode: previous.mode,
    id: histId,
  }));
  await redis.zadd(SET_HISTORY, { score: Date.now(), member: histId });

  // Auto-trim
  const total = await redis.zcard(SET_HISTORY);
  if (total > HISTORY_MAX) {
    const overflow = total - HISTORY_MAX;
    const oldest = await redis.zrange(SET_HISTORY, 0, overflow - 1);
    if (oldest && oldest.length > 0) {
      await redis.zremrangebyrank(SET_HISTORY, 0, overflow - 1);
      for (const oldId of oldest) await redis.del(`${HIST_PREFIX}${oldId}`);
    }
  }

  await logAuditEvent({
    actor: input.updatedBy,
    eventType: 'strategy_mode_changed',
    targetType: 'system',
    targetId: 'strategy-mode',
    summary: `Strategy mode: ${previous.mode} → ${input.mode}${input.notes ? ` — ${input.notes}` : ''}`,
    details: { previous: previous.mode, next: input.mode, notes: input.notes },
  });

  cached = { cfg, loadedAt: Date.now() };
  return cfg;
}

export async function listStrategyModeHistory(limit = 50): Promise<Array<StrategyModeConfig & { previousMode: StrategyMode; id: string }>> {
  const redis = getRedis();
  const total = await redis.zcard(SET_HISTORY);
  if (total === 0) return [];
  const ids = await redis.zrange(SET_HISTORY, 0, Math.min(total, limit) - 1, { rev: true });
  const out: any[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${HIST_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}
