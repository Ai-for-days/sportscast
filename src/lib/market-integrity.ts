// ── Step 100: Market Integrity & Abuse Monitoring Center ────────────────────
//
// Read-only surveillance over wagers, bets, settlement previews, and audit
// events. Produces an IntegrityReport with concentration / pricing /
// participant / operational signals, an integrity score, and a verdict.
//
// SAFETY: never bans users, never freezes markets, never voids wagers, never
// changes pricing, never auto-settles, never moves money. Writes are
// confined to integrity-report:* and the audit log.

import { getRedis } from './redis';
import { logAuditEvent, listAuditEvents } from './audit-log';
import { getWager, listAllWagers } from './wager-store';
import { getWagerBets } from './bet-store';
import { getLatestSettlementPreviewForWager } from './wager-settlement-preview';
import { impliedProbability } from './wager-pricing-engine';
import type { Wager, OddsWager, OverUnderWager, PointspreadWager } from './wager-types';
import type { Bet } from './bet-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type IntegritySeverity = 'info' | 'warning' | 'critical';
export type IntegrityVerdict = 'healthy' | 'monitor' | 'elevated_risk';

export interface ConcentrationMetrics {
  topUserPct: number;             // 0..100
  top5Pct: number;                // 0..100
  herfindahlIndex: number | null; // sum of squared shares ∈ [0, 1] (or null if no participants)
  uniqueUsers: number;
}

export interface PricingSignals {
  impliedHoldPct: number | null;
  unusualOddsMovement: boolean;
  stalePricingWarning: boolean;
  negativeHoldWarning: boolean;
  /** Diagnostic detail for the UI. */
  notes: string[];
}

export interface ParticipantSignals {
  repeatedOneSidedAction: boolean;
  excessiveLongshotExposure: boolean;
  correlatedAccountsWarning: boolean;
  rapidBettingSpike: boolean;
  notes: string[];
}

export interface OperationalSignals {
  unresolvedAfterEvent: boolean;
  gradingDelayWarning: boolean;
  excessiveVoidHistory: boolean;
  lowLiquidity: boolean;
  notes: string[];
}

export interface IntegrityReport {
  id: string;
  wagerId: string;
  wagerTicketNumber?: string;
  generatedAt: string;
  generatedBy: string;
  wagerKind: string;
  marketStatus: string;
  participantCount: number;
  totalStake: number;
  concentrationMetrics: ConcentrationMetrics;
  pricingSignals: PricingSignals;
  participantSignals: ParticipantSignals;
  operationalSignals: OperationalSignals;
  warnings: string[];
  recommendations: string[];
  severity: IntegritySeverity;
  integrityScore: number;            // 0..100
  verdict: IntegrityVerdict;
  /** Brief snapshot of input data so the UI can render without re-fetching. */
  context: {
    title: string;
    metric: string;
    targetDate: string;
    locationSummary: string;
    hasSettlementPreview: boolean;
  };
}

export interface IntegritySummary {
  totalReports: number;
  byVerdict: Record<IntegrityVerdict, number>;
  bySeverity: Record<IntegritySeverity, number>;
  averageScore: number | null;
  warningCount: number;
  unresolvedAfterEventCount: number;
}

export class MarketIntegrityError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys (integrity namespace only) ──────────────────────────────────

const REPORT_PREFIX = 'integrity-report:';
const REPORTS_SET = 'integrity-reports:all';
const REPORT_BY_WAGER_PREFIX = 'integrity-report:wager:';
const MAX_REPORTS = 1000;

// ── Constants ────────────────────────────────────────────────────────────────

const CONCENTRATION_TOPUSER_PCT = 25;
const CONCENTRATION_TOP5_PCT = 60;
const LONGSHOT_THRESHOLD_ODDS = 500;        // American odds at which a bet counts as a long-shot
const LONGSHOT_EXPOSURE_PCT = 30;            // % of total stake on long-shots that triggers warning
const ONE_SIDED_PCT = 75;                    // % of stake on single outcome that triggers warning
const RAPID_SPIKE_BETS_PER_MIN = 5;          // ≥ this many bets in a 1-minute window
const LOW_LIQUIDITY_PARTICIPANTS = 3;
const LOW_LIQUIDITY_TOTAL_STAKE_CENTS = 5_000; // $50
const UNRESOLVED_DAYS_AFTER_TARGET = 1;
const GRADING_DELAY_HOURS_AFTER_LOCK = 48;
const VOID_HISTORY_LIMIT = 5;                // ≥ this many voids on same metric in last 30d
const STALE_PRICING_HOURS_BEFORE_LOCK = 24;

// ── ID helper ────────────────────────────────────────────────────────────────

function newReportId(): string {
  return `mi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function locationSummaryOf(w: Wager): string {
  if (w.kind === 'pointspread') return `${(w as PointspreadWager).locationA?.name ?? '?'} vs ${(w as PointspreadWager).locationB?.name ?? '?'}`;
  return (w as OddsWager | OverUnderWager).location?.name ?? '?';
}

// ── Concentration ────────────────────────────────────────────────────────────

function buildConcentration(bets: Bet[]): ConcentrationMetrics {
  const userTotals = new Map<string, number>();
  for (const b of bets) {
    if (b.status === 'void') continue;
    userTotals.set(b.userId, (userTotals.get(b.userId) ?? 0) + (b.amountCents || 0));
  }
  const totalStake = Array.from(userTotals.values()).reduce((s, v) => s + v, 0);
  if (userTotals.size === 0 || totalStake <= 0) {
    return { topUserPct: 0, top5Pct: 0, herfindahlIndex: null, uniqueUsers: 0 };
  }
  const sorted = Array.from(userTotals.values()).sort((a, b) => b - a);
  const topUserPct = (sorted[0] / totalStake) * 100;
  const top5Pct = (sorted.slice(0, 5).reduce((s, v) => s + v, 0) / totalStake) * 100;
  const herfindahlIndex = Array.from(userTotals.values()).reduce((s, v) => s + Math.pow(v / totalStake, 2), 0);
  return {
    topUserPct: Math.round(topUserPct * 10) / 10,
    top5Pct: Math.round(top5Pct * 10) / 10,
    herfindahlIndex: Math.round(herfindahlIndex * 10000) / 10000,
    uniqueUsers: userTotals.size,
  };
}

// ── Pricing signals ──────────────────────────────────────────────────────────

function buildPricingSignals(wager: Wager, settlementPreview: any | null): PricingSignals {
  const out: PricingSignals = {
    impliedHoldPct: null,
    unusualOddsMovement: false,
    stalePricingWarning: false,
    negativeHoldWarning: false,
    notes: [],
  };

  // implied hold from current odds on the wager
  const oddsList = collectOddsOnWager(wager);
  if (oddsList.length > 0) {
    const total = oddsList.reduce((s, o) => s + impliedProbability(o), 0);
    if (total > 0) {
      const holdPct = (total - 1) * 100;
      out.impliedHoldPct = Math.round(holdPct * 10) / 10;
      if (holdPct < 0) {
        out.negativeHoldWarning = true;
        out.notes.push(`Implied hold ${out.impliedHoldPct}% is negative — book pays out more than it takes in.`);
      }
    }
  }

  // unusual line movement detected via lineHistory length / opening vs closing snapshot
  const lineHistory = (wager as any).lineHistory ?? [];
  if (Array.isArray(lineHistory) && lineHistory.length >= 5) {
    out.unusualOddsMovement = true;
    out.notes.push(`Line moved ${lineHistory.length} times during the wager's life — review for steam-chasing or rapid repricing.`);
  }
  // Compare opening vs closing snapshot if available
  const opening = (wager as any).openingLineSnapshot;
  const closing = (wager as any).closingLineSnapshot;
  if (opening && closing && JSON.stringify(opening) !== JSON.stringify(closing)) {
    out.notes.push('Closing line differs from opening line — verify the change was intentional.');
  }

  // Stale pricing: pricingSnapshot.createdAt > STALE_PRICING_HOURS_BEFORE_LOCK before lockTime
  const ps = (wager as any).pricingSnapshot;
  if (ps && ps.createdAt && wager.lockTime) {
    const createdMs = new Date(ps.createdAt).getTime();
    const lockMs = new Date(wager.lockTime).getTime();
    if (Number.isFinite(createdMs) && Number.isFinite(lockMs)) {
      const hoursBeforeLock = (lockMs - createdMs) / 3_600_000;
      if (hoursBeforeLock > STALE_PRICING_HOURS_BEFORE_LOCK) {
        out.stalePricingWarning = true;
        out.notes.push(`Opening pricing snapshot was generated ${Math.round(hoursBeforeLock)}h before lock — odds may be stale.`);
      }
    }
  }

  // Cross-check with settlement preview hold if it exists (defensive consistency check)
  if (settlementPreview) {
    if (settlementPreview.estimatedNetHouseResult < 0) {
      out.notes.push(`Settlement preview projects net house loss of $${(Math.abs(settlementPreview.estimatedNetHouseResult) / 100).toFixed(2)}.`);
    }
  }

  return out;
}

function collectOddsOnWager(w: Wager): number[] {
  if (w.kind === 'odds') return ((w as OddsWager).outcomes ?? []).map(o => Number(o.odds)).filter(Number.isFinite);
  if (w.kind === 'over-under') {
    const ow = w as OverUnderWager;
    const a = Number(ow.over?.odds);
    const b = Number(ow.under?.odds);
    return [a, b].filter(Number.isFinite);
  }
  if (w.kind === 'pointspread') {
    const p = w as PointspreadWager;
    return [Number(p.locationAOdds), Number(p.locationBOdds)].filter(Number.isFinite);
  }
  return [];
}

// ── Participant signals ──────────────────────────────────────────────────────

function buildParticipantSignals(wager: Wager, bets: Bet[]): ParticipantSignals {
  const out: ParticipantSignals = {
    repeatedOneSidedAction: false,
    excessiveLongshotExposure: false,
    correlatedAccountsWarning: false,
    rapidBettingSpike: false,
    notes: [],
  };

  const live = bets.filter(b => b.status !== 'void');
  if (live.length === 0) return out;

  const totalStake = live.reduce((s, b) => s + (b.amountCents || 0), 0);

  // One-sided action: is > ONE_SIDED_PCT of stake on a single outcome?
  const byOutcome = new Map<string, number>();
  for (const b of live) byOutcome.set(b.outcomeLabel, (byOutcome.get(b.outcomeLabel) ?? 0) + (b.amountCents || 0));
  const topOutcome = Array.from(byOutcome.entries()).sort((a, b) => b[1] - a[1])[0];
  if (topOutcome && totalStake > 0) {
    const pct = (topOutcome[1] / totalStake) * 100;
    if (pct >= ONE_SIDED_PCT) {
      out.repeatedOneSidedAction = true;
      out.notes.push(`${pct.toFixed(1)}% of stake is on outcome "${topOutcome[0]}" — book is heavily one-sided.`);
    }
  }

  // Excessive long-shot exposure: bets at +500+ odds totaling > LONGSHOT_EXPOSURE_PCT of stake
  const longshotStake = live
    .filter(b => Number(b.odds) >= LONGSHOT_THRESHOLD_ODDS)
    .reduce((s, b) => s + (b.amountCents || 0), 0);
  if (totalStake > 0 && (longshotStake / totalStake) * 100 >= LONGSHOT_EXPOSURE_PCT) {
    out.excessiveLongshotExposure = true;
    out.notes.push(`${((longshotStake / totalStake) * 100).toFixed(1)}% of stake on long-shot outcomes (≥ +${LONGSHOT_THRESHOLD_ODDS}).`);
  }

  // Rapid betting spike: any 60-second window with >= RAPID_SPIKE_BETS_PER_MIN bets
  const sortedTimes = live
    .map(b => new Date(b.createdAt).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  let maxInWindow = 0;
  for (let i = 0; i < sortedTimes.length; i++) {
    let count = 0;
    for (let j = i; j < sortedTimes.length; j++) {
      if (sortedTimes[j] - sortedTimes[i] <= 60_000) count++;
      else break;
    }
    if (count > maxInWindow) maxInWindow = count;
  }
  if (maxInWindow >= RAPID_SPIKE_BETS_PER_MIN) {
    out.rapidBettingSpike = true;
    out.notes.push(`Rapid betting spike: ${maxInWindow} bets within a 60-second window.`);
  }

  // Correlated accounts: tight heuristic — multiple users betting same outcome within 60s of each other.
  // Only flag if at least 3 distinct users place bets on the same outcome within 60s.
  for (const [outcome] of byOutcome) {
    const sameOutcomeBets = live.filter(b => b.outcomeLabel === outcome).slice().sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    for (let i = 0; i < sameOutcomeBets.length; i++) {
      const window = new Set<string>();
      const start = new Date(sameOutcomeBets[i].createdAt).getTime();
      for (let j = i; j < sameOutcomeBets.length; j++) {
        const t = new Date(sameOutcomeBets[j].createdAt).getTime();
        if (t - start <= 60_000) window.add(sameOutcomeBets[j].userId);
        else break;
      }
      if (window.size >= 3) {
        out.correlatedAccountsWarning = true;
        out.notes.push(`${window.size} distinct users placed bets on "${outcome}" within a 60-second window — review for coordinated activity (informational).`);
        break;
      }
    }
    if (out.correlatedAccountsWarning) break;
  }

  return out;
}

// ── Operational signals ──────────────────────────────────────────────────────

async function buildOperationalSignals(wager: Wager, bets: Bet[]): Promise<OperationalSignals> {
  const out: OperationalSignals = {
    unresolvedAfterEvent: false,
    gradingDelayWarning: false,
    excessiveVoidHistory: false,
    lowLiquidity: false,
    notes: [],
  };

  const now = Date.now();
  const targetMs = new Date(wager.targetDate).getTime();
  const lockMs = new Date(wager.lockTime).getTime();

  // Unresolved after event
  if ((wager.status === 'open' || wager.status === 'locked')
      && Number.isFinite(targetMs)
      && (now - targetMs) > UNRESOLVED_DAYS_AFTER_TARGET * 24 * 3_600_000) {
    out.unresolvedAfterEvent = true;
    const days = Math.round((now - targetMs) / (24 * 3_600_000));
    out.notes.push(`Wager unresolved ${days} day(s) after targetDate (${wager.targetDate}). Grade or void via Wager Resolution.`);
  }

  // Grading delay: locked but more than N hours past lock
  if (wager.status === 'locked'
      && Number.isFinite(lockMs)
      && (now - lockMs) > GRADING_DELAY_HOURS_AFTER_LOCK * 3_600_000) {
    out.gradingDelayWarning = true;
    const hours = Math.round((now - lockMs) / 3_600_000);
    out.notes.push(`Wager has been locked for ${hours}h without grading. Threshold: ${GRADING_DELAY_HOURS_AFTER_LOCK}h.`);
  }

  // Excessive void history on the same metric in last 30 days, via audit log
  try {
    const events = await listAuditEvents(500);
    const cutoffMs = now - 30 * 24 * 3_600_000;
    const sameMetricVoids = events.filter(e =>
      e.eventType === 'wager_manually_voided'
      && new Date(e.createdAt).getTime() >= cutoffMs
      && (e.details as any)?.fromStatus !== undefined,
    );
    // Cross-reference each void target back to the wager metric is expensive; we use a softer
    // proxy: count any voids in the window. A high count is itself worth surfacing.
    if (sameMetricVoids.length >= VOID_HISTORY_LIMIT) {
      out.excessiveVoidHistory = true;
      out.notes.push(`${sameMetricVoids.length} wagers voided in the last 30 days — investigate void cause patterns.`);
    }
  } catch { /* audit log read failure shouldn't block the report */ }

  // Low liquidity
  const live = bets.filter(b => b.status !== 'void');
  const uniqueUsers = new Set(live.map(b => b.userId)).size;
  const totalStake = live.reduce((s, b) => s + (b.amountCents || 0), 0);
  if ((wager.status === 'locked' || wager.status === 'graded' || wager.status === 'void')
      && (uniqueUsers < LOW_LIQUIDITY_PARTICIPANTS || totalStake < LOW_LIQUIDITY_TOTAL_STAKE_CENTS)) {
    out.lowLiquidity = true;
    out.notes.push(`Low liquidity: ${uniqueUsers} unique user(s), $${(totalStake / 100).toFixed(2)} total stake.`);
  }

  return out;
}

// ── Severity / score / verdict ───────────────────────────────────────────────

interface RolledUp {
  warnings: string[];
  recommendations: string[];
  severity: IntegritySeverity;
  integrityScore: number;
  verdict: IntegrityVerdict;
}

function rollUp(input: {
  bets: Bet[];
  conc: ConcentrationMetrics;
  pricing: PricingSignals;
  participant: ParticipantSignals;
  operational: OperationalSignals;
}): RolledUp {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  let score = 100;
  let severity: IntegritySeverity = 'info';

  const bumpSeverity = (target: IntegritySeverity) => {
    const rank: Record<IntegritySeverity, number> = { info: 0, warning: 1, critical: 2 };
    if (rank[target] > rank[severity]) severity = target;
  };

  const { conc, pricing, participant, operational, bets } = input;

  // Soft warning when no participant data available
  if (bets.length === 0) {
    warnings.push('No participant stake data available — most signals can only be partially evaluated.');
    bumpSeverity('info');
    score -= 5;
    recommendations.push('Wait for at least a handful of participants before relying on integrity verdicts.');
  }

  // Concentration
  if (conc.uniqueUsers > 0 && conc.topUserPct >= CONCENTRATION_TOPUSER_PCT) {
    warnings.push(`Single user holds ${conc.topUserPct.toFixed(1)}% of stake (≥ ${CONCENTRATION_TOPUSER_PCT}% threshold).`);
    score -= 12;
    bumpSeverity('warning');
    recommendations.push('Confirm the dominant user is legitimate before relying on this market for calibration data.');
  }
  if (conc.uniqueUsers > 0 && conc.top5Pct >= CONCENTRATION_TOP5_PCT) {
    warnings.push(`Top 5 users hold ${conc.top5Pct.toFixed(1)}% of stake (≥ ${CONCENTRATION_TOP5_PCT}% threshold).`);
    score -= 8;
    bumpSeverity('warning');
  }

  // Pricing
  if (pricing.negativeHoldWarning) {
    warnings.push(`Negative implied hold (${pricing.impliedHoldPct}%). House pays out more than it takes in.`);
    score -= 15;
    bumpSeverity('warning');
    recommendations.push('Re-price using the Pricing & Margin Engine before reopening this market for similar wagers.');
  }
  if (pricing.unusualOddsMovement) {
    warnings.push('Unusual odds movement detected.');
    score -= 5;
    bumpSeverity('warning');
  }
  if (pricing.stalePricingWarning) {
    warnings.push('Opening pricing snapshot is stale relative to lock time.');
    score -= 4;
    bumpSeverity('warning');
  }

  // Participant
  if (participant.repeatedOneSidedAction) {
    warnings.push('Repeated one-sided action detected.');
    score -= 8;
    bumpSeverity('warning');
    recommendations.push('Investigate one-sided action — possible information leak or operator pricing miscalibration.');
  }
  if (participant.excessiveLongshotExposure) {
    warnings.push('Excessive long-shot exposure.');
    score -= 6;
    bumpSeverity('warning');
  }
  if (participant.rapidBettingSpike) {
    warnings.push('Rapid betting spike detected.');
    score -= 5;
    bumpSeverity('warning');
  }
  // correlatedAccountsWarning is informational only (per spec)
  if (participant.correlatedAccountsWarning) {
    warnings.push('Possible correlated account activity (informational only).');
    score -= 2;
  }

  // Operational
  if (operational.unresolvedAfterEvent) {
    warnings.push('Wager unresolved after event date.');
    score -= 12;
    bumpSeverity('critical');
    recommendations.push('Grade or void the wager via Wager Resolution.');
  }
  if (operational.gradingDelayWarning) {
    warnings.push('Grading delayed beyond threshold after lock.');
    score -= 8;
    bumpSeverity('warning');
  }
  if (operational.excessiveVoidHistory) {
    warnings.push('Excessive void history on similar markets.');
    score -= 6;
    bumpSeverity('warning');
  }
  if (operational.lowLiquidity) {
    warnings.push('Low liquidity / few participants relative to exposure.');
    score -= 8;
    bumpSeverity('warning');
  }

  score = Math.max(0, Math.min(100, score));

  let verdict: IntegrityVerdict = 'healthy';
  if (score < 50 || severity === 'critical') verdict = 'elevated_risk';
  else if (score < 75 || severity === 'warning') verdict = 'monitor';

  return { warnings, recommendations, severity, integrityScore: score, verdict };
}

// ── Main analyzer ────────────────────────────────────────────────────────────

export async function analyzeMarketIntegrity(wagerId: string, actor: string): Promise<IntegrityReport> {
  if (!actor) throw new MarketIntegrityError('actor is required', 'actor_required');
  if (!wagerId) throw new MarketIntegrityError('wagerId is required', 'wager_required');

  const wager = await getWager(wagerId);
  if (!wager) throw new MarketIntegrityError('Wager not found', 'wager_not_found');

  const [bets, settlementPreview] = await Promise.all([
    getWagerBets(wagerId).catch(() => [] as Bet[]),
    getLatestSettlementPreviewForWager(wagerId).catch(() => null),
  ]);

  const live = bets.filter(b => b.status !== 'void');
  const totalStake = live.reduce((s, b) => s + (b.amountCents || 0), 0);
  const conc = buildConcentration(bets);
  const pricing = buildPricingSignals(wager, settlementPreview);
  const participant = buildParticipantSignals(wager, bets);
  const operational = await buildOperationalSignals(wager, bets);

  const rolled = rollUp({ bets: live, conc, pricing, participant, operational });

  const id = newReportId();
  const now = new Date().toISOString();
  const report: IntegrityReport = {
    id,
    wagerId,
    wagerTicketNumber: wager.ticketNumber,
    generatedAt: now,
    generatedBy: actor,
    wagerKind: wager.kind,
    marketStatus: wager.status,
    participantCount: conc.uniqueUsers,
    totalStake,
    concentrationMetrics: conc,
    pricingSignals: pricing,
    participantSignals: participant,
    operationalSignals: operational,
    warnings: rolled.warnings,
    recommendations: rolled.recommendations,
    severity: rolled.severity,
    integrityScore: rolled.integrityScore,
    verdict: rolled.verdict,
    context: {
      title: wager.title,
      metric: wager.metric,
      targetDate: wager.targetDate,
      locationSummary: locationSummaryOf(wager),
      hasSettlementPreview: !!settlementPreview,
    },
  };

  // Persist
  const redis = getRedis();
  await redis.set(`${REPORT_PREFIX}${id}`, JSON.stringify(report));
  await redis.zadd(REPORTS_SET, { score: Date.now(), member: id });
  await redis.set(`${REPORT_BY_WAGER_PREFIX}${wagerId}`, id);
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'market_integrity_report_generated',
    targetType: 'wager',
    targetId: wagerId,
    summary: `Integrity report ${id} for wager ${wagerId} (${wager.kind}, status=${wager.status}, score=${rolled.integrityScore}, verdict=${rolled.verdict})`,
    details: {
      reportId: id, wagerId, kind: wager.kind, status: wager.status,
      score: rolled.integrityScore, verdict: rolled.verdict, severity: rolled.severity,
      warningCount: rolled.warnings.length,
      participantCount: conc.uniqueUsers, totalStakeCents: totalStake,
      topUserPct: conc.topUserPct, top5Pct: conc.top5Pct,
    },
  });

  return report;
}

// ── Listing / retrieval ──────────────────────────────────────────────────────

export async function getIntegrityReport(id: string): Promise<IntegrityReport | null> {
  const redis = getRedis();
  const raw = await redis.get(`${REPORT_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as IntegrityReport);
}

export async function getLatestIntegrityReportForWager(wagerId: string): Promise<IntegrityReport | null> {
  if (!wagerId) return null;
  const redis = getRedis();
  const raw = await redis.get(`${REPORT_BY_WAGER_PREFIX}${wagerId}`);
  if (!raw) return null;
  const id = typeof raw === 'string' ? raw : (raw as any);
  if (!id) return null;
  return getIntegrityReport(id);
}

export async function listIntegrityReports(limit = 100): Promise<IntegrityReport[]> {
  const redis = getRedis();
  const total = await redis.zcard(REPORTS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(REPORTS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: IntegrityReport[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${REPORT_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function getIntegritySummary(): Promise<IntegritySummary> {
  const reports = await listIntegrityReports(500);
  const byVerdict: Record<IntegrityVerdict, number> = { healthy: 0, monitor: 0, elevated_risk: 0 };
  const bySeverity: Record<IntegritySeverity, number> = { info: 0, warning: 0, critical: 0 };
  let scoreSum = 0;
  let scoreCount = 0;
  let warningCount = 0;
  let unresolvedAfterEventCount = 0;
  for (const r of reports) {
    byVerdict[r.verdict]++;
    bySeverity[r.severity]++;
    scoreSum += r.integrityScore;
    scoreCount++;
    warningCount += r.warnings.length;
    if (r.operationalSignals?.unresolvedAfterEvent) unresolvedAfterEventCount++;
  }
  return {
    totalReports: reports.length,
    byVerdict,
    bySeverity,
    averageScore: scoreCount === 0 ? null : Math.round(scoreSum / scoreCount),
    warningCount,
    unresolvedAfterEventCount,
  };
}

// ── Convenience: list wagers worth analyzing ─────────────────────────────────

export interface IntegrityTargetSummary {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  status: string;
  targetDate: string;
  locationSummary: string;
  hasReport: boolean;
}

export async function listIntegrityTargets(limit = 200): Promise<IntegrityTargetSummary[]> {
  const all = await listAllWagers(limit);
  const redis = getRedis();
  const out: IntegrityTargetSummary[] = [];
  for (const w of all) {
    let hasReport = false;
    try {
      const ptr = await redis.get(`${REPORT_BY_WAGER_PREFIX}${w.id}`);
      hasReport = !!ptr;
    } catch { /* ignore */ }
    out.push({
      id: w.id,
      ticketNumber: w.ticketNumber,
      title: w.title,
      kind: w.kind,
      status: w.status,
      targetDate: w.targetDate,
      locationSummary: locationSummaryOf(w),
      hasReport,
    });
  }
  return out;
}

// ── Trim ─────────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(REPORTS_SET);
  if (total <= MAX_REPORTS) return;
  const overflow = total - MAX_REPORTS;
  const oldest = await redis.zrange(REPORTS_SET, 0, overflow - 1);
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(REPORTS_SET, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${REPORT_PREFIX}${oldId}`);
  }
}
