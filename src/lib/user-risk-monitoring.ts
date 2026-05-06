// ── Step 108: User Risk & Responsible Play Monitoring ──────────────────────
//
// Advisory-only surveillance over user bet activity. Detects high-frequency
// activity, chasing patterns, oversized stakes, late-night sessions, repeated
// long-shot exposure, and unusual market concentration — all without
// restricting the user. Writes confined to user-risk-report:* + audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { listAllWagers } from './wager-store';
import { getUserBets, getWagerBets } from './bet-store';
import type { Bet } from './bet-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type RiskSeverity = 'info' | 'warning' | 'critical';
export type RiskVerdict = 'normal' | 'monitor' | 'elevated_risk';
export type ReportStatus = 'advisory_only';

export interface ResponsiblePlaySignals {
  highFrequencyActivity: boolean;
  chasingPatternWarning: boolean;
  oversizedStakeWarning: boolean;
  lateNightActivityWarning: boolean;
  repeatedLongshotWarning: boolean;
  notes: string[];
}

export interface IntegritySignals {
  correlatedMarketActivity: boolean;
  unusualOutcomeConcentration: boolean;
  possibleMultiAccountPattern: boolean;
  notes: string[];
}

export interface MarketConcentrationEntry {
  wagerId: string;
  wagerTitle?: string;
  stakeCents: number;
  pctOfTotal: number;
  betCount: number;
}

export interface RapidBettingSignal {
  windowMinutes: number;
  maxBetsInWindow: number;
  triggeredAt: string | null;
}

export interface RepeatedLossSignal {
  consecutiveLossStreak: number;
  averageStakePostLoss: number | null;   // cents
  averageStakePostWin: number | null;    // cents
  ratioPostLossToPostWin: number | null; // unitless
}

export interface UserRiskReport {
  id: string;
  userId: string;
  generatedAt: string;
  generatedBy: string;
  periodStart: string;        // ISO 8601
  periodEnd: string;          // ISO 8601
  totalStake: number;         // cents
  totalBets: number;
  netResultEstimate?: number; // cents (best-effort from settled bets)
  longshotStakePct: number;   // 0..100
  rapidBettingSignals: RapidBettingSignal;
  concentrationByMarket: MarketConcentrationEntry[];
  repeatedLossSignals: RepeatedLossSignal;
  responsiblePlaySignals: ResponsiblePlaySignals;
  integritySignals: IntegritySignals;
  warnings: string[];
  recommendations: string[];
  severity: RiskSeverity;
  riskScore: number;           // 0..100
  verdict: RiskVerdict;
  status: ReportStatus;
}

export interface RiskSummary {
  totalReports: number;
  byVerdict: Record<RiskVerdict, number>;
  bySeverity: Record<RiskSeverity, number>;
  warningCount: number;
  averageRiskScore: number | null;
  uniqueUsers: number;
}

export class UserRiskError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ──────────────────────────────────────────────────────

const REPORT_PREFIX = 'user-risk-report:';
const REPORTS_SET = 'user-risk-reports:all';
const REPORT_BY_USER_PREFIX = 'user-risk-report:user:';
const MAX_REPORTS = 2000;

// ── Constants ────────────────────────────────────────────────────────────────

const HIGH_FREQ_BETS_PER_HOUR = 20;
const LONGSHOT_THRESHOLD_ODDS = 500;
const LONGSHOT_PCT_THRESHOLD = 30;       // % of total stake
const OVERSIZED_STAKE_MULTIPLIER = 5;    // single bet > 5x median stake
const CHASING_RATIO_THRESHOLD = 1.3;     // post-loss avg stake / post-win avg stake
const LATE_NIGHT_PCT_THRESHOLD = 30;     // % of bets between 00:00-05:00 UTC
const ONE_SIDED_OUTCOME_PCT = 70;        // % of stake on a single outcome label
const CORRELATED_OUTCOME_BURST_BETS = 4; // ≥ this many bets on same outcome within 60s

// ── Helpers ──────────────────────────────────────────────────────────────────

function newReportId(): string {
  return `urr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso(): string { return new Date().toISOString(); }
function daysAgoIso(days: number): string { return new Date(Date.now() - days * 24 * 3_600_000).toISOString(); }

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function withinPeriod(b: Bet, periodStart: string, periodEnd: string): boolean {
  const t = b.createdAt;
  return t >= periodStart && t <= periodEnd;
}

function isLongshot(odds: number): boolean {
  return Number.isFinite(odds) && odds >= LONGSHOT_THRESHOLD_ODDS;
}

function netPnlFromBet(b: Bet): number | null {
  if (b.status === 'won') return (b.potentialPayoutCents || 0) - (b.amountCents || 0);
  if (b.status === 'lost') return -(b.amountCents || 0);
  if (b.status === 'push') return 0;
  return null; // pending / void → no realized result
}

// ── Compute helpers ─────────────────────────────────────────────────────────

function computeRapidBetting(bets: Bet[]): RapidBettingSignal {
  const out: RapidBettingSignal = { windowMinutes: 60, maxBetsInWindow: 0, triggeredAt: null };
  const times = bets.map(b => new Date(b.createdAt).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 0; i < times.length; i++) {
    let count = 0;
    for (let j = i; j < times.length; j++) {
      if (times[j] - times[i] <= 60 * 60_000) count++;
      else break;
    }
    if (count > out.maxBetsInWindow) {
      out.maxBetsInWindow = count;
      out.triggeredAt = new Date(times[i]).toISOString();
    }
  }
  return out;
}

function computeRepeatedLoss(bets: Bet[]): RepeatedLossSignal {
  const settled = bets
    .filter(b => b.status === 'won' || b.status === 'lost')
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let maxStreak = 0;
  let curStreak = 0;
  const stakesPostLoss: number[] = [];
  const stakesPostWin: number[] = [];
  let prev: Bet | null = null;
  for (const b of settled) {
    if (prev) {
      if (prev.status === 'lost') stakesPostLoss.push(b.amountCents || 0);
      if (prev.status === 'won') stakesPostWin.push(b.amountCents || 0);
    }
    if (b.status === 'lost') { curStreak++; if (curStreak > maxStreak) maxStreak = curStreak; }
    else { curStreak = 0; }
    prev = b;
  }

  const avg = (arr: number[]) => arr.length === 0 ? null : Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);
  const postLoss = avg(stakesPostLoss);
  const postWin = avg(stakesPostWin);
  const ratio = postLoss != null && postWin != null && postWin > 0 ? Math.round((postLoss / postWin) * 100) / 100 : null;

  return {
    consecutiveLossStreak: maxStreak,
    averageStakePostLoss: postLoss,
    averageStakePostWin: postWin,
    ratioPostLossToPostWin: ratio,
  };
}

async function computeMarketConcentration(bets: Bet[]): Promise<MarketConcentrationEntry[]> {
  const totalStake = bets.reduce((s, b) => s + (b.amountCents || 0), 0);
  if (totalStake <= 0) return [];

  const byWager = new Map<string, { stake: number; count: number }>();
  for (const b of bets) {
    const cur = byWager.get(b.wagerId) ?? { stake: 0, count: 0 };
    cur.stake += b.amountCents || 0;
    cur.count++;
    byWager.set(b.wagerId, cur);
  }

  const out: MarketConcentrationEntry[] = [];
  for (const [wagerId, agg] of byWager.entries()) {
    out.push({
      wagerId,
      stakeCents: agg.stake,
      pctOfTotal: Math.round((agg.stake / totalStake) * 1000) / 10,
      betCount: agg.count,
    });
  }
  out.sort((a, b) => b.stakeCents - a.stakeCents);
  return out.slice(0, 10);
}

function computeOutcomeConcentration(bets: Bet[]): { dominantLabel: string | null; pctOfTotal: number } {
  const totalStake = bets.reduce((s, b) => s + (b.amountCents || 0), 0);
  if (totalStake <= 0) return { dominantLabel: null, pctOfTotal: 0 };
  const byLabel = new Map<string, number>();
  for (const b of bets) byLabel.set(b.outcomeLabel, (byLabel.get(b.outcomeLabel) ?? 0) + (b.amountCents || 0));
  const top = Array.from(byLabel.entries()).sort((a, b) => b[1] - a[1])[0];
  if (!top) return { dominantLabel: null, pctOfTotal: 0 };
  return { dominantLabel: top[0], pctOfTotal: Math.round((top[1] / totalStake) * 1000) / 10 };
}

function computeCorrelatedOutcomeBurst(bets: Bet[]): boolean {
  // ≥ CORRELATED_OUTCOME_BURST_BETS bets on the same outcomeLabel within 60 seconds
  const byLabel = new Map<string, Bet[]>();
  for (const b of bets) {
    if (!byLabel.has(b.outcomeLabel)) byLabel.set(b.outcomeLabel, []);
    byLabel.get(b.outcomeLabel)!.push(b);
  }
  for (const [, list] of byLabel) {
    if (list.length < CORRELATED_OUTCOME_BURST_BETS) continue;
    const times = list.map(b => new Date(b.createdAt).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
    for (let i = 0; i < times.length; i++) {
      let count = 0;
      for (let j = i; j < times.length; j++) {
        if (times[j] - times[i] <= 60_000) count++;
        else break;
      }
      if (count >= CORRELATED_OUTCOME_BURST_BETS) return true;
    }
  }
  return false;
}

function computeLateNightPct(bets: Bet[]): number {
  if (bets.length === 0) return 0;
  let lateCount = 0;
  for (const b of bets) {
    const d = new Date(b.createdAt);
    const hour = d.getUTCHours();
    if (hour >= 0 && hour < 5) lateCount++;
  }
  return Math.round((lateCount / bets.length) * 1000) / 10;
}

function computeOversizedStake(bets: Bet[]): { medianStake: number | null; maxStake: number | null; ratio: number | null } {
  const stakes = bets.map(b => b.amountCents || 0).filter(s => s > 0);
  if (stakes.length === 0) return { medianStake: null, maxStake: null, ratio: null };
  const med = median(stakes);
  const max = Math.max(...stakes);
  const ratio = med != null && med > 0 ? Math.round((max / med) * 100) / 100 : null;
  return { medianStake: med, maxStake: max, ratio };
}

// ── Risk score / verdict ─────────────────────────────────────────────────────

interface ScoreInput {
  responsible: ResponsiblePlaySignals;
  integrity: IntegritySignals;
  totalBets: number;
  longshotStakePct: number;
  rapidBets: number;
}

function scoreAndVerdict(input: ScoreInput): { riskScore: number; severity: RiskSeverity; verdict: RiskVerdict } {
  let score = 100;
  const r = input.responsible;
  const i = input.integrity;

  if (r.highFrequencyActivity) score -= 15;
  if (r.chasingPatternWarning) score -= 18;
  if (r.oversizedStakeWarning) score -= 12;
  if (r.lateNightActivityWarning) score -= 6;
  if (r.repeatedLongshotWarning) score -= 10;
  if (i.correlatedMarketActivity) score -= 8;
  if (i.unusualOutcomeConcentration) score -= 8;
  if (i.possibleMultiAccountPattern) score -= 4;

  // No data → modest pull-down
  if (input.totalBets === 0) score = Math.min(score, 70);

  score = Math.max(0, Math.min(100, score));

  let severity: RiskSeverity = 'info';
  if (r.chasingPatternWarning || r.oversizedStakeWarning) severity = 'warning';
  if (i.correlatedMarketActivity || (r.chasingPatternWarning && r.repeatedLongshotWarning)) severity = 'critical';

  let verdict: RiskVerdict = 'normal';
  if (score < 50 || severity === 'critical') verdict = 'elevated_risk';
  else if (score < 75 || severity === 'warning') verdict = 'monitor';

  return { riskScore: score, severity, verdict };
}

// ── Main: generate ──────────────────────────────────────────────────────────

export interface GenerateInput {
  userId: string;
  periodStart?: string;
  periodEnd?: string;
}

export async function generateUserRiskReport(input: GenerateInput, actor: string): Promise<UserRiskReport> {
  if (!actor) throw new UserRiskError('actor is required', 'actor_required');
  if (!input.userId?.trim()) throw new UserRiskError('userId is required', 'user_required');

  const periodEnd = input.periodEnd ?? nowIso();
  const periodStart = input.periodStart ?? daysAgoIso(30);

  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Pull bet data — read-only
  let allUserBets: Bet[] = [];
  try {
    const result = await getUserBets(input.userId.trim(), 500, 0);
    allUserBets = result?.bets ?? [];
  } catch {
    warnings.push('User bet store unavailable — most signals can only be partially evaluated.');
  }

  // Filter to period
  const bets = allUserBets.filter(b => withinPeriod(b, periodStart, periodEnd) && b.status !== 'void');

  // Aggregates
  const totalStake = bets.reduce((s, b) => s + (b.amountCents || 0), 0);
  const totalBets = bets.length;

  const netParts = bets.map(netPnlFromBet).filter((x): x is number => x != null);
  const netResultEstimate = netParts.length === 0 ? undefined : netParts.reduce((s, x) => s + x, 0);

  const longshotStake = bets.filter(b => isLongshot(b.odds)).reduce((s, b) => s + (b.amountCents || 0), 0);
  const longshotStakePct = totalStake > 0 ? Math.round((longshotStake / totalStake) * 1000) / 10 : 0;

  const rapidBettingSignals = computeRapidBetting(bets);
  const repeatedLossSignals = computeRepeatedLoss(bets);
  const concentrationByMarket = await computeMarketConcentration(bets);
  const oversized = computeOversizedStake(bets);
  const outcomeConc = computeOutcomeConcentration(bets);
  const lateNightPct = computeLateNightPct(bets);

  // Responsible-play signals
  const respNotes: string[] = [];
  const responsiblePlaySignals: ResponsiblePlaySignals = {
    highFrequencyActivity: rapidBettingSignals.maxBetsInWindow > HIGH_FREQ_BETS_PER_HOUR,
    chasingPatternWarning: !!repeatedLossSignals.ratioPostLossToPostWin
      && repeatedLossSignals.ratioPostLossToPostWin >= CHASING_RATIO_THRESHOLD,
    oversizedStakeWarning: !!oversized.ratio && oversized.ratio >= OVERSIZED_STAKE_MULTIPLIER,
    lateNightActivityWarning: lateNightPct >= LATE_NIGHT_PCT_THRESHOLD,
    repeatedLongshotWarning: longshotStakePct >= LONGSHOT_PCT_THRESHOLD,
    notes: respNotes,
  };

  if (responsiblePlaySignals.highFrequencyActivity) {
    respNotes.push(`Up to ${rapidBettingSignals.maxBetsInWindow} bets within a 60-minute window.`);
  }
  if (responsiblePlaySignals.chasingPatternWarning) {
    respNotes.push(`Average stake after a loss is ${repeatedLossSignals.ratioPostLossToPostWin}× the average after a win — possible chasing.`);
  }
  if (responsiblePlaySignals.oversizedStakeWarning) {
    respNotes.push(`Single bet of ${oversized.maxStake} cents is ${oversized.ratio}× the user's median stake.`);
  }
  if (responsiblePlaySignals.lateNightActivityWarning) {
    respNotes.push(`${lateNightPct}% of bets fall between 00:00 and 05:00 UTC.`);
  }
  if (responsiblePlaySignals.repeatedLongshotWarning) {
    respNotes.push(`${longshotStakePct}% of stake on long-shot odds (≥ +${LONGSHOT_THRESHOLD_ODDS}).`);
  }

  // Integrity signals
  const intNotes: string[] = [];
  const integritySignals: IntegritySignals = {
    correlatedMarketActivity: computeCorrelatedOutcomeBurst(bets),
    unusualOutcomeConcentration: outcomeConc.dominantLabel != null && outcomeConc.pctOfTotal >= ONE_SIDED_OUTCOME_PCT,
    possibleMultiAccountPattern: false, // intentionally informational; we don't have cross-user data here
    notes: intNotes,
  };

  if (integritySignals.correlatedMarketActivity) {
    intNotes.push(`≥ ${CORRELATED_OUTCOME_BURST_BETS} bets on the same outcomeLabel within a 60-second window.`);
  }
  if (integritySignals.unusualOutcomeConcentration && outcomeConc.dominantLabel) {
    intNotes.push(`${outcomeConc.pctOfTotal}% of stake on outcome "${outcomeConc.dominantLabel}".`);
  }
  intNotes.push('Multi-account pattern detection is informational only — we do not have cross-user correlation data here.');

  // Roll up warnings + recommendations
  const flagWarnings: string[] = [];
  if (responsiblePlaySignals.highFrequencyActivity) {
    flagWarnings.push('High-frequency activity detected.');
    recommendations.push('Consider a soft check-in via the existing operator workflow before user takes additional sessions.');
  }
  if (responsiblePlaySignals.chasingPatternWarning) {
    flagWarnings.push('Chasing pattern: stakes increase after losses.');
    recommendations.push('Flag to responsible-play reviewer for outreach decision (no automatic action).');
  }
  if (responsiblePlaySignals.oversizedStakeWarning) {
    flagWarnings.push('Oversized stake relative to user history.');
  }
  if (responsiblePlaySignals.lateNightActivityWarning) {
    flagWarnings.push('Late-night activity concentration.');
  }
  if (responsiblePlaySignals.repeatedLongshotWarning) {
    flagWarnings.push('Repeated long-shot exposure.');
  }
  if (integritySignals.correlatedMarketActivity) {
    flagWarnings.push('Correlated bet bursts on the same outcome.');
    recommendations.push('Open Market Integrity to compare against cross-user activity on the same wagers.');
  }
  if (integritySignals.unusualOutcomeConcentration) {
    flagWarnings.push('Heavy concentration on a single outcome label across markets.');
  }
  if (totalBets === 0) {
    warnings.push('No bets in this period — most signals could not be evaluated.');
  }

  const rolled = scoreAndVerdict({
    responsible: responsiblePlaySignals,
    integrity: integritySignals,
    totalBets,
    longshotStakePct,
    rapidBets: rapidBettingSignals.maxBetsInWindow,
  });

  const id = newReportId();
  const now = nowIso();
  const report: UserRiskReport = {
    id,
    userId: input.userId.trim(),
    generatedAt: now,
    generatedBy: actor,
    periodStart,
    periodEnd,
    totalStake,
    totalBets,
    netResultEstimate,
    longshotStakePct,
    rapidBettingSignals,
    concentrationByMarket,
    repeatedLossSignals,
    responsiblePlaySignals,
    integritySignals,
    warnings: [...warnings, ...flagWarnings],
    recommendations,
    severity: rolled.severity,
    riskScore: rolled.riskScore,
    verdict: rolled.verdict,
    status: 'advisory_only',
  };

  // Persist
  const redis = getRedis();
  await redis.set(`${REPORT_PREFIX}${id}`, JSON.stringify(report));
  await redis.zadd(REPORTS_SET, { score: Date.now(), member: id });
  await redis.zadd(`${REPORT_BY_USER_PREFIX}${report.userId}`, { score: Date.now(), member: id });
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'user_risk_report_generated',
    targetType: 'user',
    targetId: report.userId,
    summary: `User risk report ${id} for ${report.userId} (verdict=${rolled.verdict}, score=${rolled.riskScore}, ${totalBets} bets)`,
    details: {
      reportId: id, userId: report.userId, verdict: rolled.verdict, severity: rolled.severity,
      riskScore: rolled.riskScore, totalBets, totalStakeCents: totalStake,
      warningCount: report.warnings.length,
    },
  });

  return report;
}

// ── Retrieval ────────────────────────────────────────────────────────────────

export async function getReport(id: string): Promise<UserRiskReport | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = await redis.get(`${REPORT_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as UserRiskReport);
}

export async function listReports(limit = 200): Promise<UserRiskReport[]> {
  const redis = getRedis();
  const total = await redis.zcard(REPORTS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(REPORTS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: UserRiskReport[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${REPORT_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function listReportsForUser(userId: string, limit = 100): Promise<UserRiskReport[]> {
  if (!userId) return [];
  const redis = getRedis();
  const total = await redis.zcard(`${REPORT_BY_USER_PREFIX}${userId}`);
  if (total === 0) return [];
  const ids = await redis.zrange(`${REPORT_BY_USER_PREFIX}${userId}`, 0, Math.min(total, limit) - 1, { rev: true });
  const out: UserRiskReport[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${REPORT_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

// ── Known users ─────────────────────────────────────────────────────────────

export interface KnownUser {
  userId: string;
  betCount: number;
  totalStakeCents: number;
  hasReport: boolean;
}

export async function listKnownUsers(limit = 200): Promise<KnownUser[]> {
  // Sample recent wagers and aggregate user IDs
  const wagers = await listAllWagers(100).catch(() => []);
  const tally = new Map<string, { count: number; stake: number }>();
  for (const w of wagers) {
    let bets: Bet[] = [];
    try { bets = await getWagerBets(w.id); } catch { /* skip */ }
    for (const b of bets) {
      if (!b.userId) continue;
      const cur = tally.get(b.userId) ?? { count: 0, stake: 0 };
      cur.count++;
      if (b.status !== 'void') cur.stake += b.amountCents || 0;
      tally.set(b.userId, cur);
    }
  }

  const redis = getRedis();
  const out: KnownUser[] = [];
  for (const [userId, agg] of tally.entries()) {
    let hasReport = false;
    try {
      const total = await redis.zcard(`${REPORT_BY_USER_PREFIX}${userId}`);
      hasReport = total > 0;
    } catch { /* ignore */ }
    out.push({ userId, betCount: agg.count, totalStakeCents: agg.stake, hasReport });
  }
  out.sort((a, b) => b.betCount - a.betCount);
  return out.slice(0, limit);
}

// ── Summary ──────────────────────────────────────────────────────────────────

export async function getRiskSummary(): Promise<RiskSummary> {
  const reports = await listReports(500);
  const byVerdict: Record<RiskVerdict, number> = { normal: 0, monitor: 0, elevated_risk: 0 };
  const bySeverity: Record<RiskSeverity, number> = { info: 0, warning: 0, critical: 0 };
  let warningCount = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  const usersSeen = new Set<string>();
  for (const r of reports) {
    byVerdict[r.verdict]++;
    bySeverity[r.severity]++;
    warningCount += (r.warnings ?? []).length;
    if (Number.isFinite(r.riskScore)) { scoreSum += r.riskScore; scoreCount++; }
    if (r.userId) usersSeen.add(r.userId);
  }
  return {
    totalReports: reports.length,
    byVerdict,
    bySeverity,
    warningCount,
    averageRiskScore: scoreCount === 0 ? null : Math.round(scoreSum / scoreCount),
    uniqueUsers: usersSeen.size,
  };
}

// ── Trim ─────────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(REPORTS_SET);
  if (total <= MAX_REPORTS) return;
  const overflow = total - MAX_REPORTS;
  const oldest = await redis.zrange(REPORTS_SET, 0, overflow - 1) as string[];
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(REPORTS_SET, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${REPORT_PREFIX}${oldId}`);
  }
}
