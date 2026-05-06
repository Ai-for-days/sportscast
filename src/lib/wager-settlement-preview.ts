// ── Step 99: Wager Settlement Preview & Liability Center ────────────────────
//
// Read-only liability projection for graded wagers. Pulls bet records via
// getWagerBets, projects what payouts WOULD look like if settlement were
// applied, and persists the projection as a preview record.
//
// SAFETY: never moves money, never updates user balances, never marks
// payouts as paid, never auto-settles, never connects to payment rails.
// Writes are confined to settlement-preview:* and the audit log; no
// wager:*, wallet:*, or bet:* mutation.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { getWager, listAllWagers } from './wager-store';
import { getWagerBets } from './bet-store';
import type { Wager } from './wager-types';
import type { Bet } from './bet-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type SettlementPreviewStatus = 'preview_only';

export interface SettlementPreview {
  id: string;
  wagerId: string;
  wagerTicketNumber?: string;
  generatedAt: string;
  generatedBy: string;
  wagerKind: string;
  metric: string;
  targetDate: string;
  winningOutcome: string | null;
  /** Total possible payout across all non-void bets (max house exposure). */
  estimatedGrossExposure: number;
  /** Sum of stakes on bets matching the winning outcome. */
  estimatedWinningStake: number;
  /** Sum of stakes on bets that did not match the winning outcome. */
  estimatedLosingStake: number;
  /** Net house result = totalStake − payoutEstimate − pushRefund. */
  estimatedNetHouseResult: number;
  /** Total payout to winners if settled. */
  payoutEstimate: number;
  /** Sum of stakes on bets that count as a push (refund). */
  pushRefund: number;
  /** Number of bets per category. */
  betCounts: { winners: number; losers: number; pushes: number; voided: number; total: number };
  /** Top stakeholders (userId → percent of gross stake). Capped at top 5. */
  topUsers: { userId: string; stakeCents: number; pctOfGross: number; potentialPayoutCents: number }[];
  liabilityWarnings: string[];
  notes: string[];
  status: SettlementPreviewStatus;
}

export interface GradedWagerSummary {
  id: string;
  ticketNumber: string;
  title: string;
  kind: string;
  metric: string;
  targetDate: string;
  winningOutcome?: string;
  voidReason?: string;
  status: string;
  /** True when at least one preview already exists for this wager. */
  hasPreview: boolean;
}

export class SettlementPreviewError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys (preview namespace only) ────────────────────────────────────

const PREVIEW_PREFIX = 'settlement-preview:';
const PREVIEWS_SET = 'settlement-previews:all';
const PREVIEW_BY_WAGER_PREFIX = 'settlement-preview:wager:';
const MAX_PREVIEWS = 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function newPreviewId(): string {
  return `wsp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fmtUsd(cents: number): string {
  return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// ── Listing graded wagers ────────────────────────────────────────────────────

export async function listGradedWagersForSettlementPreview(limit = 200): Promise<GradedWagerSummary[]> {
  const redis = getRedis();
  const all = await listAllWagers(limit);
  const out: GradedWagerSummary[] = [];

  for (const w of all) {
    if (w.status !== 'graded' && w.status !== 'void') continue;
    // Detect existing preview pointer (cheap)
    let hasPreview = false;
    try {
      const ptr = await redis.get(`${PREVIEW_BY_WAGER_PREFIX}${w.id}`);
      hasPreview = !!ptr;
    } catch { /* ignore */ }

    out.push({
      id: w.id,
      ticketNumber: w.ticketNumber,
      title: w.title,
      kind: w.kind,
      metric: w.metric,
      targetDate: w.targetDate,
      winningOutcome: w.winningOutcome,
      voidReason: w.voidReason,
      status: w.status,
      hasPreview,
    });
  }

  // Sort: voided first (need a refund picture), then most-recent target date
  out.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'void' ? -1 : 1;
    return b.targetDate.localeCompare(a.targetDate);
  });
  return out;
}

// ── Bet matching ─────────────────────────────────────────────────────────────

interface BetCategory {
  winners: Bet[];
  losers: Bet[];
  pushes: Bet[];
  voided: Bet[];
}

function categorizeBets(wager: Wager, bets: Bet[]): BetCategory {
  const out: BetCategory = { winners: [], losers: [], pushes: [], voided: [] };
  for (const b of bets) {
    if (b.status === 'void') {
      out.voided.push(b);
      continue;
    }
    // Wager voided ⇒ every non-void bet is a push (refund stake)
    if (wager.status === 'void') {
      out.pushes.push(b);
      continue;
    }
    // Wager graded with a winningOutcome
    if (!wager.winningOutcome) {
      // Defensive: graded wager without winningOutcome is malformed; treat as void/refund
      out.pushes.push(b);
      continue;
    }
    if (b.outcomeLabel === wager.winningOutcome) out.winners.push(b);
    else out.losers.push(b);
  }
  return out;
}

// ── Liability warnings ───────────────────────────────────────────────────────

function buildLiabilityWarnings(input: {
  wager: Wager;
  bets: Bet[];
  cat: BetCategory;
  payoutEstimate: number;
  netHouseResult: number;
  grossExposure: number;
  topUsers: SettlementPreview['topUsers'];
}): string[] {
  const w: string[] = [];
  const { wager, bets, cat, payoutEstimate, netHouseResult, grossExposure, topUsers } = input;

  if (bets.length === 0) {
    w.push('No participant stake data available for this wager — bet records are empty.');
    return w;
  }

  if (wager.status === 'graded' && !wager.winningOutcome) {
    w.push('Wager is graded but has no winningOutcome stored — every bet is treated as a push for this preview.');
  }

  if (wager.status === 'void') {
    w.push(`Wager is voided${wager.voidReason ? ` (${wager.voidReason})` : ''} — all non-void bets are projected as refunds.`);
  }

  if (cat.pushes.length > 0 && wager.status !== 'void') {
    w.push(`${cat.pushes.length} bet(s) projected as push (refund stake without profit).`);
  }

  // High gross exposure
  if (grossExposure >= 500_000) {
    w.push(`High gross exposure ${fmtUsd(grossExposure)} — verify before any manual settlement.`);
  }

  // Net loss (house pays out more than collected)
  if (netHouseResult < 0) {
    w.push(`Net house loss projected: ${fmtUsd(netHouseResult)}. Confirm winningOutcome and bet alignment before settling.`);
  }

  // Single-user concentration
  if (topUsers.length > 0 && topUsers[0].pctOfGross >= 25) {
    w.push(`Single user concentration: ${topUsers[0].userId} holds ${topUsers[0].pctOfGross.toFixed(1)}% of gross stake.`);
  }

  // Bets already in non-pending status — they were settled outside this preview
  const alreadyResolved = bets.filter(b => b.status === 'won' || b.status === 'lost' || b.status === 'push').length;
  if (alreadyResolved > 0) {
    w.push(`${alreadyResolved} bet(s) already carry a resolved status (won/lost/push) — they may have been settled outside this preview. This is preview-only and changes nothing.`);
  }

  // Outcome label / wager kind sanity
  if (wager.winningOutcome) {
    if (wager.kind === 'over-under' && !['over', 'under'].includes(wager.winningOutcome)) {
      w.push(`winningOutcome "${wager.winningOutcome}" is unexpected for an over-under wager.`);
    }
    if (wager.kind === 'pointspread' && !['locationA', 'locationB'].includes(wager.winningOutcome)) {
      w.push(`winningOutcome "${wager.winningOutcome}" is unexpected for a pointspread wager.`);
    }
    if (wager.kind === 'odds') {
      const labels = (wager.outcomes ?? []).map(o => o.label);
      if (labels.length > 0 && !labels.includes(wager.winningOutcome)) {
        w.push(`winningOutcome "${wager.winningOutcome}" does not match any defined outcome label on this odds wager.`);
      }
    }
  }

  // Bet outcomeLabel mismatch with available wager labels
  if (wager.kind === 'odds') {
    const labels = new Set((wager.outcomes ?? []).map(o => o.label));
    if (labels.size > 0) {
      const mismatched = bets.filter(b => b.status !== 'void' && !labels.has(b.outcomeLabel)).length;
      if (mismatched > 0) {
        w.push(`${mismatched} bet(s) have outcomeLabel that doesn't match any current outcome on this wager — they're treated as losers in this preview.`);
      }
    }
  }

  return w;
}

// ── Build a preview ──────────────────────────────────────────────────────────

export async function generateSettlementPreview(wagerId: string, actor: string): Promise<SettlementPreview> {
  if (!actor) throw new SettlementPreviewError('actor is required', 'actor_required');
  if (!wagerId) throw new SettlementPreviewError('wagerId is required', 'wager_required');

  const wager = await getWager(wagerId);
  if (!wager) throw new SettlementPreviewError('Wager not found', 'wager_not_found');
  if (wager.status !== 'graded' && wager.status !== 'void') {
    throw new SettlementPreviewError(
      `Wager status is "${wager.status}" — preview is only available for graded or voided wagers.`,
      'wager_not_graded',
    );
  }

  const bets = await getWagerBets(wagerId);
  const cat = categorizeBets(wager, bets);

  // Aggregate
  const sumStakes = (xs: Bet[]) => xs.reduce((s, b) => s + (b.amountCents || 0), 0);
  const sumPayouts = (xs: Bet[]) => xs.reduce((s, b) => s + (b.potentialPayoutCents || 0), 0);

  const winnerStake = sumStakes(cat.winners);
  const loserStake = sumStakes(cat.losers);
  const pushStake = sumStakes(cat.pushes);
  const totalStake = winnerStake + loserStake + pushStake; // voided bets excluded

  const payoutEstimate = sumPayouts(cat.winners);          // full payout (stake + profit) on winners
  const grossExposure = payoutEstimate + pushStake;        // potential outflow under this resolution
  const netHouseResult = totalStake - payoutEstimate - pushStake;

  // Per-user concentration
  const userTotals = new Map<string, { stake: number; potential: number }>();
  for (const b of bets) {
    if (b.status === 'void') continue;
    const cur = userTotals.get(b.userId) ?? { stake: 0, potential: 0 };
    cur.stake += b.amountCents || 0;
    cur.potential += b.potentialPayoutCents || 0;
    userTotals.set(b.userId, cur);
  }
  const topUsers = Array.from(userTotals.entries())
    .map(([userId, v]) => ({
      userId,
      stakeCents: v.stake,
      pctOfGross: totalStake > 0 ? (v.stake / totalStake) * 100 : 0,
      potentialPayoutCents: v.potential,
    }))
    .sort((a, b) => b.stakeCents - a.stakeCents)
    .slice(0, 5);

  const liabilityWarnings = buildLiabilityWarnings({
    wager, bets, cat, payoutEstimate, netHouseResult, grossExposure, topUsers,
  });

  const notes: string[] = [];
  notes.push(`Wager status: ${wager.status}${wager.winningOutcome ? `; winningOutcome="${wager.winningOutcome}"` : ''}.`);
  notes.push(`${bets.length} total bet record(s); ${cat.winners.length} winner(s), ${cat.losers.length} loser(s), ${cat.pushes.length} push(es), ${cat.voided.length} voided.`);
  notes.push(`Total non-void stake: ${fmtUsd(totalStake)}; projected payouts: ${fmtUsd(payoutEstimate)}; projected refunds: ${fmtUsd(pushStake)}; net house: ${fmtUsd(netHouseResult)}.`);
  notes.push('Preview is non-binding. No bets, balances, or wager records were modified.');

  const id = newPreviewId();
  const now = new Date().toISOString();
  const preview: SettlementPreview = {
    id,
    wagerId: wager.id,
    wagerTicketNumber: wager.ticketNumber,
    generatedAt: now,
    generatedBy: actor,
    wagerKind: wager.kind,
    metric: wager.metric,
    targetDate: wager.targetDate,
    winningOutcome: wager.winningOutcome ?? null,
    estimatedGrossExposure: grossExposure,
    estimatedWinningStake: winnerStake,
    estimatedLosingStake: loserStake,
    estimatedNetHouseResult: netHouseResult,
    payoutEstimate,
    pushRefund: pushStake,
    betCounts: {
      winners: cat.winners.length, losers: cat.losers.length,
      pushes: cat.pushes.length, voided: cat.voided.length,
      total: bets.length,
    },
    topUsers,
    liabilityWarnings,
    notes,
    status: 'preview_only',
  };

  // Persist (preview namespace only)
  const redis = getRedis();
  await redis.set(`${PREVIEW_PREFIX}${id}`, JSON.stringify(preview));
  await redis.zadd(PREVIEWS_SET, { score: Date.now(), member: id });
  await redis.set(`${PREVIEW_BY_WAGER_PREFIX}${wagerId}`, id);
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'wager_settlement_preview_generated',
    targetType: 'wager',
    targetId: wagerId,
    summary: `Settlement preview ${id} for wager ${wagerId} (${wager.kind}, status=${wager.status}, bets=${bets.length}, net=${fmtUsd(netHouseResult)})`,
    details: {
      previewId: id, wagerId, kind: wager.kind, status: wager.status,
      winningOutcome: wager.winningOutcome ?? null,
      grossExposureCents: grossExposure, payoutEstimateCents: payoutEstimate,
      netHouseResultCents: netHouseResult, totalStakeCents: totalStake,
      betCounts: preview.betCounts, warningCount: liabilityWarnings.length,
    },
  });

  return preview;
}

// ── Retrieval ────────────────────────────────────────────────────────────────

export async function getSettlementPreview(id: string): Promise<SettlementPreview | null> {
  const redis = getRedis();
  const raw = await redis.get(`${PREVIEW_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as SettlementPreview);
}

export async function getLatestSettlementPreviewForWager(wagerId: string): Promise<SettlementPreview | null> {
  if (!wagerId) return null;
  const redis = getRedis();
  const raw = await redis.get(`${PREVIEW_BY_WAGER_PREFIX}${wagerId}`);
  if (!raw) return null;
  const id = typeof raw === 'string' ? raw : (raw as any);
  if (!id) return null;
  return getSettlementPreview(id);
}

export async function listSettlementPreviews(limit = 100): Promise<SettlementPreview[]> {
  const redis = getRedis();
  const total = await redis.zcard(PREVIEWS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(PREVIEWS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: SettlementPreview[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${PREVIEW_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

// ── Trimming ─────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(PREVIEWS_SET);
  if (total <= MAX_PREVIEWS) return;
  const overflow = total - MAX_PREVIEWS;
  const oldest = await redis.zrange(PREVIEWS_SET, 0, overflow - 1);
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(PREVIEWS_SET, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${PREVIEW_PREFIX}${oldId}`);
    // Note: we intentionally don't delete the by-wager pointer here; it just
    // ends up dangling, and the next generation overwrites it.
  }
}
