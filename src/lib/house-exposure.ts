// ── Step 109: Financial Exposure & House PnL Dashboard ─────────────────────
//
// Read-only aggregation over wagers + bets. Computes per-market worst-case
// house loss and best-case gain, plus realized results for graded markets.
// NEVER settles balances, moves money, mutates wagers, changes pricing, or
// grades anything. Writes confined to house-exposure-snapshot:* + audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { listAllWagers } from './wager-store';
import { getWagerBets } from './bet-store';
import type { Wager, OddsWager, WagerStatus } from './wager-types';
import type { Bet } from './bet-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type ExposureScope = 'all' | 'open' | 'locked' | 'graded' | 'date_range';

export interface RiskMarketEntry {
  wagerId: string;
  ticketNumber?: string;
  title: string;
  status: WagerStatus;
  metric: string;
  totalStake: number;            // cents
  potentialPayout: number;       // cents — sum of potentialPayoutCents across bets
  worstCaseHouseLoss: number;    // cents — most negative house result across outcomes
  bestCaseHouseGain: number;     // cents — best house result across outcomes
  realizedHouseResult?: number;  // cents — only for graded markets where winningOutcome matches
  payoutByOutcome: { label: string; payoutCents: number }[];
  participantCount: number;
  topUserStakeCents: number;
  topUserPctOfMarket: number;    // 0..100
  concentrationWarning: boolean;
}

export interface UserExposureEntry {
  userId: string;
  totalStakeCents: number;
  potentialPayoutCents: number;
  marketsTouched: number;
  pctOfTotalStake: number;       // 0..100
}

export interface ExposureSnapshot {
  id: string;
  generatedAt: string;
  generatedBy: string;
  scope: ExposureScope;
  periodStart?: string;
  periodEnd?: string;
  totalStake: number;
  totalPotentialPayout: number;
  /** Sum of worst-case house result across all in-scope markets. */
  projectedNetHouseResult: number;
  /** Sum of realized house result across in-scope graded markets. */
  realizedNetHouseResult?: number;
  /** Sum of worstCaseHouseLoss for non-graded markets (potential outflow). */
  unrealizedExposure: number;
  /** Count of markets where worstCaseHouseLoss > 0. */
  marketsAtRisk: number;
  topRiskMarkets: RiskMarketEntry[];
  topUsersByExposure: UserExposureEntry[];
  warnings: string[];
  recommendations: string[];
  status: 'snapshot_only';
  /** Diagnostics for upstream reads that failed. */
  dataGaps: string[];
}

export interface ExposureSummary {
  totalSnapshots: number;
  latestSnapshot: ExposureSnapshot | null;
  averageProjected: number | null;
  averageRealized: number | null;
}

export class HouseExposureError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ──────────────────────────────────────────────────────

const SNAPSHOT_PREFIX = 'house-exposure-snapshot:';
const SNAPSHOTS_SET = 'house-exposure-snapshots:all';
const MAX_SNAPSHOTS = 500;

// ── Constants ────────────────────────────────────────────────────────────────

const TOP_RISK_LIMIT = 10;
const TOP_USERS_LIMIT = 10;
const HIGH_LOSS_CENTS_FLAG = 50_000;       // $500 worst-case → flag market
const SINGLE_USER_CONCENTRATION_PCT = 50;   // ≥ 50% from one user → flag market
const NEGATIVE_PROJECTED_FLAG = -50_000;    // projected ≤ -$500 → recommend review

// ── Helpers ──────────────────────────────────────────────────────────────────

function newSnapshotId(): string {
  return `expsnap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso(): string { return new Date().toISOString(); }
function isValidYmdOrIso(s: string | undefined): boolean {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}

function inScope(w: Wager, scope: ExposureScope, periodStart?: string, periodEnd?: string): boolean {
  if (scope === 'all') return true;
  if (scope === 'open') return w.status === 'open';
  if (scope === 'locked') return w.status === 'locked';
  if (scope === 'graded') return w.status === 'graded';
  if (scope === 'date_range') {
    if (!periodStart || !periodEnd) return false;
    return w.createdAt >= periodStart && w.createdAt <= periodEnd;
  }
  return false;
}

// ── Per-market risk computation ─────────────────────────────────────────────

interface PerMarketWork {
  bets: Bet[];
  totalStake: number;
  payoutByOutcome: Map<string, number>;
  participantCount: number;
  topUserStakeCents: number;
}

function computePerMarket(wager: Wager, bets: Bet[]): { entry: RiskMarketEntry; work: PerMarketWork } {
  const liveBets = bets.filter(b => b.status !== 'void');
  const totalStake = liveBets.reduce((s, b) => s + (b.amountCents || 0), 0);
  const totalPotentialPayout = liveBets.reduce((s, b) => s + (b.potentialPayoutCents || 0), 0);

  // Sum potentialPayouts grouped by outcomeLabel
  const payoutByOutcome = new Map<string, number>();
  for (const b of liveBets) {
    payoutByOutcome.set(b.outcomeLabel, (payoutByOutcome.get(b.outcomeLabel) ?? 0) + (b.potentialPayoutCents || 0));
  }

  // Determine the outcome universe — include outcomes the wager defines even if no bet exists,
  // so the worst case correctly includes "no bets on outcome X" (payout 0).
  const definedLabels = collectOutcomeLabels(wager);
  for (const label of definedLabels) {
    if (!payoutByOutcome.has(label)) payoutByOutcome.set(label, 0);
  }

  // House result if outcome X wins = totalStake - payoutByOutcome[X]
  let worstHouseResult = totalStake;
  let bestHouseResult = totalStake;
  let foundAny = false;
  for (const payout of payoutByOutcome.values()) {
    const houseResult = totalStake - payout;
    if (!foundAny) { worstHouseResult = houseResult; bestHouseResult = houseResult; foundAny = true; }
    if (houseResult < worstHouseResult) worstHouseResult = houseResult;
    if (houseResult > bestHouseResult) bestHouseResult = houseResult;
  }

  const worstCaseHouseLoss = -Math.min(0, worstHouseResult); // positive number = loss magnitude when worst < 0
  const bestCaseHouseGain = Math.max(0, bestHouseResult);

  // Realized result for graded markets
  let realizedHouseResult: number | undefined;
  if (wager.status === 'graded' && wager.winningOutcome) {
    const winningPayout = payoutByOutcome.get(wager.winningOutcome) ?? 0;
    realizedHouseResult = totalStake - winningPayout;
  } else if (wager.status === 'void') {
    // All non-void bets refund — house result is zero.
    realizedHouseResult = 0;
  }

  // Per-user concentration on this market
  const userTotals = new Map<string, number>();
  for (const b of liveBets) userTotals.set(b.userId, (userTotals.get(b.userId) ?? 0) + (b.amountCents || 0));
  const sortedUserStakes = Array.from(userTotals.values()).sort((a, b) => b - a);
  const topUserStakeCents = sortedUserStakes[0] ?? 0;
  const topUserPctOfMarket = totalStake > 0 ? Math.round((topUserStakeCents / totalStake) * 1000) / 10 : 0;

  const concentrationWarning =
    (worstCaseHouseLoss >= HIGH_LOSS_CENTS_FLAG && totalStake > 0)
    || (totalStake > 0 && topUserPctOfMarket >= SINGLE_USER_CONCENTRATION_PCT);

  const entry: RiskMarketEntry = {
    wagerId: wager.id,
    ticketNumber: (wager as any).ticketNumber,
    title: wager.title ?? wager.id,
    status: wager.status,
    metric: wager.metric,
    totalStake,
    potentialPayout: totalPotentialPayout,
    worstCaseHouseLoss,
    bestCaseHouseGain,
    realizedHouseResult,
    payoutByOutcome: Array.from(payoutByOutcome.entries())
      .map(([label, payoutCents]) => ({ label, payoutCents }))
      .sort((a, b) => b.payoutCents - a.payoutCents),
    participantCount: userTotals.size,
    topUserStakeCents,
    topUserPctOfMarket,
    concentrationWarning,
  };
  return {
    entry,
    work: { bets: liveBets, totalStake, payoutByOutcome, participantCount: userTotals.size, topUserStakeCents },
  };
}

function collectOutcomeLabels(w: Wager): string[] {
  if (w.kind === 'odds') return ((w as OddsWager).outcomes ?? []).map(o => o.label);
  if (w.kind === 'over-under') return ['over', 'under'];
  if (w.kind === 'pointspread') return ['locationA', 'locationB'];
  return [];
}

// ── Main: generate ──────────────────────────────────────────────────────────

export interface GenerateInput {
  scope: ExposureScope;
  periodStart?: string;
  periodEnd?: string;
}

export async function generateSnapshot(input: GenerateInput, actor: string): Promise<ExposureSnapshot> {
  if (!actor) throw new HouseExposureError('actor is required', 'actor_required');
  if (!['all', 'open', 'locked', 'graded', 'date_range'].includes(input.scope)) {
    throw new HouseExposureError(`Invalid scope "${input.scope}"`, 'invalid_scope');
  }
  if (input.scope === 'date_range') {
    if (!isValidYmdOrIso(input.periodStart) || !isValidYmdOrIso(input.periodEnd)) {
      throw new HouseExposureError('date_range scope requires periodStart and periodEnd', 'period_required');
    }
  }

  const dataGaps: string[] = [];

  let allWagers: Wager[] = [];
  try {
    allWagers = await listAllWagers(500);
  } catch {
    dataGaps.push('Wager store unavailable.');
  }

  const inScopeWagers = allWagers.filter(w => inScope(w, input.scope, input.periodStart, input.periodEnd));

  // Per-market results
  const marketEntries: RiskMarketEntry[] = [];
  const userTotals = new Map<string, { stake: number; potential: number; markets: Set<string> }>();
  let projectedNet = 0;
  let realizedNet = 0;
  let realizedCount = 0;
  let unrealizedExposure = 0;
  let totalStake = 0;
  let totalPotentialPayout = 0;
  let marketsAtRisk = 0;

  let betDataMissing = false;

  for (const w of inScopeWagers) {
    let bets: Bet[] = [];
    try {
      bets = await getWagerBets(w.id);
    } catch {
      betDataMissing = true;
      continue;
    }
    const { entry, work } = computePerMarket(w, bets);
    marketEntries.push(entry);

    totalStake += entry.totalStake;
    totalPotentialPayout += entry.potentialPayout;

    // Worst-case for projected: house result if every market hits its worst outcome
    const marketWorst = entry.totalStake - Math.max(...Array.from(work.payoutByOutcome.values(), v => v), 0);
    projectedNet += marketWorst;

    if (entry.realizedHouseResult != null) {
      realizedNet += entry.realizedHouseResult;
      realizedCount++;
    } else {
      unrealizedExposure += entry.worstCaseHouseLoss;
    }
    if (entry.worstCaseHouseLoss > 0) marketsAtRisk++;

    // Aggregate user totals (only for non-void bets)
    for (const b of work.bets) {
      const cur = userTotals.get(b.userId) ?? { stake: 0, potential: 0, markets: new Set<string>() };
      cur.stake += b.amountCents || 0;
      cur.potential += b.potentialPayoutCents || 0;
      cur.markets.add(w.id);
      userTotals.set(b.userId, cur);
    }
  }

  if (betDataMissing) dataGaps.push('Some wagers had unavailable bet data and were excluded from per-market totals.');

  // Top markets by worst-case loss
  const topRiskMarkets = marketEntries
    .slice()
    .sort((a, b) => b.worstCaseHouseLoss - a.worstCaseHouseLoss)
    .slice(0, TOP_RISK_LIMIT);

  // Top users by total stake
  const topUsersByExposure: UserExposureEntry[] = Array.from(userTotals.entries())
    .map(([userId, v]) => ({
      userId,
      totalStakeCents: v.stake,
      potentialPayoutCents: v.potential,
      marketsTouched: v.markets.size,
      pctOfTotalStake: totalStake > 0 ? Math.round((v.stake / totalStake) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalStakeCents - a.totalStakeCents)
    .slice(0, TOP_USERS_LIMIT);

  // Warnings + recommendations
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (inScopeWagers.length === 0) {
    warnings.push(`No wagers in scope (${input.scope}${input.scope === 'date_range' ? ` ${input.periodStart}…${input.periodEnd}` : ''}).`);
  }
  if (totalStake === 0 && inScopeWagers.length > 0) {
    warnings.push('No participant stake data on any in-scope market — exposure cannot be computed precisely.');
  }
  if (marketsAtRisk > 0) {
    warnings.push(`${marketsAtRisk} market(s) have a non-zero worst-case house loss.`);
  }
  if (projectedNet < NEGATIVE_PROJECTED_FLAG) {
    warnings.push(`Projected worst-case net house result is $${(projectedNet / 100).toFixed(2)} — review high-exposure markets.`);
    recommendations.push('Open Market Integrity to investigate concentration on high-exposure markets.');
    recommendations.push('Consider re-pricing markets where one outcome creates the largest loss exposure.');
  }
  for (const m of topRiskMarkets.slice(0, 3)) {
    if (m.concentrationWarning) {
      warnings.push(`Market ${m.ticketNumber ?? m.wagerId} flagged: worst-case loss $${(m.worstCaseHouseLoss / 100).toFixed(2)}, top user ${m.topUserPctOfMarket}%.`);
    }
  }
  if (topUsersByExposure.length > 0 && topUsersByExposure[0].pctOfTotalStake >= 25) {
    warnings.push(`User ${topUsersByExposure[0].userId} holds ${topUsersByExposure[0].pctOfTotalStake}% of in-scope stake.`);
    recommendations.push('Open User Risk Monitoring to evaluate the dominant user.');
  }
  for (const gap of dataGaps) warnings.push(`Data gap: ${gap}`);

  const id = newSnapshotId();
  const now = nowIso();
  const snap: ExposureSnapshot = {
    id,
    generatedAt: now,
    generatedBy: actor,
    scope: input.scope,
    periodStart: input.scope === 'date_range' ? input.periodStart : undefined,
    periodEnd: input.scope === 'date_range' ? input.periodEnd : undefined,
    totalStake,
    totalPotentialPayout,
    projectedNetHouseResult: projectedNet,
    realizedNetHouseResult: realizedCount > 0 ? realizedNet : undefined,
    unrealizedExposure,
    marketsAtRisk,
    topRiskMarkets,
    topUsersByExposure,
    warnings,
    recommendations,
    status: 'snapshot_only',
    dataGaps,
  };

  // Persist
  const redis = getRedis();
  await redis.set(`${SNAPSHOT_PREFIX}${id}`, JSON.stringify(snap));
  await redis.zadd(SNAPSHOTS_SET, { score: Date.now(), member: id });
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'house_exposure_snapshot_generated',
    targetType: 'house_exposure',
    targetId: id,
    summary: `Exposure snapshot ${id} (${input.scope}, ${inScopeWagers.length} markets, projected ${(projectedNet / 100).toFixed(2)}, unrealized ${(unrealizedExposure / 100).toFixed(2)})`,
    details: {
      id, scope: input.scope, marketCount: inScopeWagers.length,
      totalStakeCents: totalStake, projectedNetCents: projectedNet,
      unrealizedExposureCents: unrealizedExposure, marketsAtRisk,
      warningCount: warnings.length, dataGaps,
    },
  });

  return snap;
}

// ── Retrieval ────────────────────────────────────────────────────────────────

export async function getSnapshot(id: string): Promise<ExposureSnapshot | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = await redis.get(`${SNAPSHOT_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as ExposureSnapshot);
}

export async function listSnapshots(limit = 100): Promise<ExposureSnapshot[]> {
  const redis = getRedis();
  const total = await redis.zcard(SNAPSHOTS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(SNAPSHOTS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: ExposureSnapshot[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${SNAPSHOT_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function getExposureSummary(): Promise<ExposureSummary> {
  const snaps = await listSnapshots(100);
  if (snaps.length === 0) {
    return { totalSnapshots: 0, latestSnapshot: null, averageProjected: null, averageRealized: null };
  }
  const latestSnapshot = snaps[0];
  const projected = snaps.map(s => s.projectedNetHouseResult).filter(Number.isFinite);
  const realized = snaps.map(s => s.realizedNetHouseResult).filter((x): x is number => Number.isFinite(x as any));
  const avg = (xs: number[]) => xs.length === 0 ? null : Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
  return {
    totalSnapshots: snaps.length,
    latestSnapshot,
    averageProjected: avg(projected),
    averageRealized: avg(realized),
  };
}

// ── Trim ─────────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(SNAPSHOTS_SET);
  if (total <= MAX_SNAPSHOTS) return;
  const overflow = total - MAX_SNAPSHOTS;
  const oldest = await redis.zrange(SNAPSHOTS_SET, 0, overflow - 1) as string[];
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(SNAPSHOTS_SET, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${SNAPSHOT_PREFIX}${oldId}`);
  }
}
