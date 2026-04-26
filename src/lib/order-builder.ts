import { getExecutionConfig, type ExecutionMode } from './execution-config';
import { runPreTradeRiskChecks, type PreTradeRiskResult, type PreTradeInput } from './pretrade-risk';
import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import type { RankedSignal } from './signal-ranking';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type CandidateState = 'draft' | 'candidate' | 'blocked' | 'approved' | 'sent' | 'cancelled';

export interface DryRunOrder {
  source: 'kalshi' | 'sportsbook';
  mode: ExecutionMode;
  ticker: string;
  title: string;
  side: string;
  price: number;
  quantity: number;
  maxNotionalCents: number;
  pretradeRisk: PreTradeRiskResult;
  ready: boolean;
}

export interface ExecutionCandidate {
  id: string;
  createdAt: string;
  updatedAt: string;
  signalId: string;
  source: 'kalshi' | 'sportsbook';
  ticker: string;
  title: string;
  side: string;
  signalScore: number;
  edge: number;
  confidence: string;
  sizingTier: string;
  recommendedStakeCents: number;
  locationName?: string;
  metric?: string;
  targetDate?: string;
  state: CandidateState;
  dryRunOrder?: DryRunOrder;
  riskResult?: PreTradeRiskResult;
  blockReason?: string;
  notes?: string;
  // Schema v2 fields (Step 66) — signal-time market snapshot
  marketSnapshot?: {
    marketProbYes?: number;
    marketProbNo?: number;
    modelProbYes?: number;
    modelProbNo?: number;
    capturedAt: string;
  };
  // Forward evaluation tag
  evalTag?: string;
  // Step 84: optional pilot tagging — backward compatible
  pilotId?: string;
  pilotName?: string;
  strategyId?: string;
  strategyName?: string;
}

const CANDIDATE_KEY_PREFIX = 'exec:candidate:';
const CANDIDATE_SORTED_SET = 'exec:candidates:all';

/* ------------------------------------------------------------------ */
/*  Build Dry-Run Order                                                */
/* ------------------------------------------------------------------ */

export async function buildDryRunOrder(
  signal: RankedSignal,
  stakeCents: number
): Promise<DryRunOrder> {
  const config = await getExecutionConfig();

  const riskInput: PreTradeInput = {
    orderSizeCents: stakeCents,
    edge: signal.edge,
  };

  const pretradeRisk = await runPreTradeRiskChecks(riskInput);

  const order: DryRunOrder = {
    source: signal.source as 'kalshi' | 'sportsbook',
    mode: config.mode,
    ticker: signal.id,
    title: signal.title,
    side: signal.source === 'kalshi' ? 'yes' : 'over',
    price: Math.round((signal.edge + 0.5) * 100), // rough estimate
    quantity: 1,
    maxNotionalCents: stakeCents,
    pretradeRisk,
    ready: pretradeRisk.allowed && !config.killSwitchEnabled && config.mode !== 'disabled',
  };

  await logAuditEvent({
    actor: 'admin',
    eventType: 'dry_run_order_created',
    targetType: 'signal',
    targetId: signal.id,
    summary: `Dry-run order built for ${signal.title} — ${order.ready ? 'READY' : 'BLOCKED'}`,
    details: { mode: config.mode, stakeCents, riskPassed: pretradeRisk.allowed },
  });

  return order;
}

/* ------------------------------------------------------------------ */
/*  Candidate CRUD                                                     */
/* ------------------------------------------------------------------ */

export async function createCandidate(
  signal: RankedSignal,
  stakeCents: number,
  notes?: string
): Promise<ExecutionCandidate> {
  const redis = getRedis();
  const id = `ec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  // Run risk checks
  const riskInput: PreTradeInput = {
    orderSizeCents: stakeCents,
    edge: signal.edge,
  };
  const riskResult = await runPreTradeRiskChecks(riskInput);

  // Build dry-run order
  const dryRunOrder = await buildDryRunOrder(signal, stakeCents);

  const state: CandidateState = riskResult.allowed ? 'candidate' : 'blocked';

  const candidate: ExecutionCandidate = {
    id,
    createdAt: now,
    updatedAt: now,
    signalId: signal.id,
    source: signal.source as 'kalshi' | 'sportsbook',
    ticker: signal.id,
    title: signal.title,
    side: signal.source === 'kalshi' ? 'yes' : 'over',
    signalScore: signal.signalScore,
    edge: signal.edge,
    confidence: signal.confidence,
    sizingTier: signal.sizingTier,
    recommendedStakeCents: stakeCents,
    locationName: signal.locationName,
    metric: signal.metric,
    targetDate: signal.targetDate,
    state,
    dryRunOrder,
    riskResult,
    blockReason: riskResult.allowed ? undefined : riskResult.reason,
    notes,
    // Step 66: capture signal-time market snapshot where available
    marketSnapshot: (signal as any).marketProbYes != null ? {
      marketProbYes: (signal as any).marketProbYes,
      marketProbNo: (signal as any).marketProbNo,
      modelProbYes: (signal as any).modelProbYes,
      modelProbNo: (signal as any).modelProbNo,
      capturedAt: now,
    } : undefined,
    evalTag: `forward-${now.slice(0, 10)}`,
  };

  await redis.set(`${CANDIDATE_KEY_PREFIX}${id}`, JSON.stringify(candidate));
  await redis.zadd(CANDIDATE_SORTED_SET, { score: Date.now(), member: id });

  await logAuditEvent({
    actor: 'admin',
    eventType: state === 'blocked' ? 'candidate_blocked' : 'candidate_created',
    targetType: 'execution-candidate',
    targetId: id,
    summary: state === 'blocked'
      ? `Candidate blocked: ${signal.title} — ${riskResult.reason}`
      : `Candidate created: ${signal.title}`,
    details: { signalId: signal.id, stakeCents, state },
  });

  return candidate;
}

export async function listCandidates(): Promise<ExecutionCandidate[]> {
  const redis = getRedis();
  const ids = await redis.zrange(CANDIDATE_SORTED_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];

  const candidates: ExecutionCandidate[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${CANDIDATE_KEY_PREFIX}${id}`);
    if (raw) {
      candidates.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ExecutionCandidate);
    }
  }
  return candidates;
}

export async function getCandidate(id: string): Promise<ExecutionCandidate | null> {
  const redis = getRedis();
  const raw = await redis.get(`${CANDIDATE_KEY_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ExecutionCandidate;
}

export async function updateCandidateState(
  id: string,
  newState: CandidateState,
  reason?: string
): Promise<ExecutionCandidate | null> {
  const candidate = await getCandidate(id);
  if (!candidate) return null;

  const redis = getRedis();
  candidate.state = newState;
  candidate.updatedAt = new Date().toISOString();
  if (reason) candidate.blockReason = reason;

  // If approving, re-check risk and update dry-run order readiness
  if (newState === 'approved' && candidate.dryRunOrder) {
    candidate.dryRunOrder.ready = true;
  }
  if (newState === 'blocked' || newState === 'cancelled') {
    if (candidate.dryRunOrder) candidate.dryRunOrder.ready = false;
  }

  await redis.set(`${CANDIDATE_KEY_PREFIX}${id}`, JSON.stringify(candidate));

  await logAuditEvent({
    actor: 'admin',
    eventType: `candidate_${newState}`,
    targetType: 'execution-candidate',
    targetId: id,
    summary: `Candidate ${candidate.title} → ${newState}${reason ? ': ' + reason : ''}`,
  });

  return candidate;
}
