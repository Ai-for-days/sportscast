// ── Step 120 Part F: Pretend bet sandbox store (server-only) ────────────────
//
// Sandbox-only ledger. Records simulated bets against an active pretend-
// user session. Never writes to bet-store, wallet-store, or any other
// real-money path. Stake debits move only the session's virtual balance.
//
// Pretend bets are NOT auto-graded. Status is operator-controlled (the
// only mutating actions in this step are place / add-note / void).

import { getRedis } from './redis';
import { getWager } from './wager-store';
import type { Wager, OddsWager, OverUnderWager, PointspreadWager } from './wager-types';
import {
  applyTestBalanceDelta,
  getTestSession,
  type TestSession,
} from './pretend-user-testing';

if (typeof window !== 'undefined') {
  throw new Error(
    'pretend-bet-store is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export type PretendBetStatus = 'open' | 'won' | 'lost' | 'push' | 'void';

export interface PretendBetNote {
  at: string;
  actor: string;
  text: string;
}

export interface PretendBet {
  id: string;
  createdAt: string;
  createdBy: string;
  sessionId: string;
  pretendUserId: string;
  wagerId: string;
  wagerTitle: string;
  outcomeLabel: string;
  stakeCents: number;
  potentialPayoutCents: number;
  odds: number;
  status: PretendBetStatus;
  notes: PretendBetNote[];
}

export class PretendBetError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

// ── Redis keys ──────────────────────────────────────────────────────────────

const KEY = {
  bet: (id: string) => `pretend-bet:${id}`,
  all: 'pretend-bets:all',
  bySession: (sessionId: string) => `pretend-bets:session:${sessionId}`,
  byWager: (wagerId: string) => `pretend-bets:wager:${wagerId}`,
};
const MAX_BETS = 500;

// ── Odds helpers (American odds → payout) ───────────────────────────────────

function americanProfit(odds: number, stakeCents: number): number {
  if (!Number.isFinite(odds) || odds === 0 || stakeCents <= 0) return 0;
  if (odds > 0) return Math.round(stakeCents * (odds / 100));
  return Math.round(stakeCents * (100 / Math.abs(odds)));
}

function getOutcomeOdds(wager: Wager, outcomeLabel: string): number | null {
  if (wager.kind === 'odds') {
    const ow = wager as OddsWager;
    const found = ow.outcomes?.find((o) => o.label === outcomeLabel);
    return found ? found.odds : null;
  }
  if (wager.kind === 'over-under') {
    const ouw = wager as OverUnderWager;
    if (outcomeLabel.toLowerCase().startsWith('over')) return ouw.over?.odds ?? null;
    if (outcomeLabel.toLowerCase().startsWith('under')) return ouw.under?.odds ?? null;
    return null;
  }
  if (wager.kind === 'pointspread') {
    const psw = wager as PointspreadWager;
    if (outcomeLabel.startsWith(psw.locationA?.name ?? '__A__')) return psw.locationAOdds ?? null;
    if (outcomeLabel.startsWith(psw.locationB?.name ?? '__B__')) return psw.locationBOdds ?? null;
    return null;
  }
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function newBetId(): string {
  return `pbet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readBet(id: string): Promise<PretendBet | null> {
  const redis = getRedis();
  const raw = (await redis.get(KEY.bet(id))) as string | null;
  if (!raw) return null;
  return JSON.parse(raw) as PretendBet;
}

async function writeBet(bet: PretendBet): Promise<void> {
  const redis = getRedis();
  await redis.set(KEY.bet(bet.id), JSON.stringify(bet));
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export interface PlaceInput {
  sessionId: string;
  wagerId: string;
  outcomeLabel: string;
  stakeCents: number;
}

export interface PlaceResult {
  bet: PretendBet;
  session: TestSession;
}

export async function placePretendBet(
  input: PlaceInput,
  createdBy: string,
): Promise<PlaceResult> {
  if (!input.sessionId) throw new PretendBetError('sessionId is required.', 'session_required');
  if (!input.wagerId) throw new PretendBetError('wagerId is required.', 'wager_required');
  if (!input.outcomeLabel) {
    throw new PretendBetError('outcomeLabel is required.', 'outcome_required');
  }
  if (!Number.isFinite(input.stakeCents) || input.stakeCents <= 0) {
    throw new PretendBetError('Stake must be a positive integer (cents).', 'stake_invalid');
  }

  const session = await getTestSession(input.sessionId);
  if (!session) {
    throw new PretendBetError('Pretend-user session not found.', 'session_not_found');
  }
  if (session.status !== 'active') {
    throw new PretendBetError('Pretend-user session is closed.', 'session_closed');
  }

  const wager = await getWager(input.wagerId);
  if (!wager) throw new PretendBetError(`Wager ${input.wagerId} not found.`, 'wager_not_found');
  if (wager.status !== 'open') {
    throw new PretendBetError('Pretend bets are only allowed on open wagers.', 'wager_not_open');
  }

  const odds = getOutcomeOdds(wager, input.outcomeLabel);
  if (odds == null) {
    throw new PretendBetError(
      `Outcome "${input.outcomeLabel}" is not on this wager.`,
      'outcome_not_on_wager',
    );
  }

  const stake = Math.floor(input.stakeCents);
  if (session.currentTestBalanceCents < stake) {
    throw new PretendBetError(
      'Insufficient pretend-test balance for this stake.',
      'insufficient_balance',
    );
  }

  const profit = americanProfit(odds, stake);
  const potentialPayoutCents = stake + profit;

  const now = new Date().toISOString();
  const bet: PretendBet = {
    id: newBetId(),
    createdAt: now,
    createdBy,
    sessionId: session.id,
    pretendUserId: session.pretendUserId,
    wagerId: wager.id,
    wagerTitle: wager.title,
    outcomeLabel: input.outcomeLabel,
    stakeCents: stake,
    potentialPayoutCents,
    odds,
    status: 'open',
    notes: [],
  };

  // Debit virtual balance first; if that throws, no bet record is written.
  const updatedSession = await applyTestBalanceDelta(
    session.id,
    -stake,
    'pretend_bet_placed',
    createdBy,
    { betId: bet.id, wagerId: bet.wagerId, outcomeLabel: bet.outcomeLabel, stakeCents: stake },
  );

  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.set(KEY.bet(bet.id), JSON.stringify(bet));
  pipe.zadd(KEY.all, { score: Date.parse(now), member: bet.id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_BETS - 1);
  pipe.zadd(KEY.bySession(bet.sessionId), { score: Date.parse(now), member: bet.id });
  pipe.zadd(KEY.byWager(bet.wagerId), { score: Date.parse(now), member: bet.id });
  await pipe.exec();

  return { bet, session: updatedSession };
}

export async function addBetNote(
  id: string,
  text: string,
  actor: string,
): Promise<PretendBet> {
  if (!text.trim()) {
    throw new PretendBetError('Note text is required.', 'note_required');
  }
  const bet = await readBet(id);
  if (!bet) throw new PretendBetError(`Bet ${id} not found.`, 'not_found');
  bet.notes.push({ at: new Date().toISOString(), actor, text: text.trim() });
  await writeBet(bet);
  return bet;
}

export async function voidPretendBet(
  id: string,
  actor: string,
  reason?: string,
): Promise<PlaceResult> {
  const bet = await readBet(id);
  if (!bet) throw new PretendBetError(`Bet ${id} not found.`, 'not_found');
  if (bet.status !== 'open') {
    throw new PretendBetError(
      'Only open pretend bets can be voided in this step.',
      'invalid_status',
    );
  }
  bet.status = 'void';
  bet.notes.push({
    at: new Date().toISOString(),
    actor,
    text: reason?.trim() || 'Pretend bet voided by operator.',
  });

  const session = await applyTestBalanceDelta(
    bet.sessionId,
    bet.stakeCents,
    'pretend_bet_voided',
    actor,
    { betId: bet.id, restoredCents: bet.stakeCents, reason },
  );
  await writeBet(bet);
  return { bet, session };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listPretendBets(limit = 50): Promise<PretendBet[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_BETS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, safe - 1, { rev: true })) as string[];
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.bet(id));
  const rows = (await pipe.exec()) as Array<string | null>;
  return rows
    .filter((r): r is string => typeof r === 'string')
    .map((r) => JSON.parse(r) as PretendBet);
}

export async function getPretendBet(id: string): Promise<PretendBet | null> {
  return readBet(id);
}

export async function getPretendBetsBySession(
  sessionId: string,
  limit = 100,
): Promise<PretendBet[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_BETS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.bySession(sessionId), 0, safe - 1, { rev: true })) as string[];
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.bet(id));
  const rows = (await pipe.exec()) as Array<string | null>;
  return rows
    .filter((r): r is string => typeof r === 'string')
    .map((r) => JSON.parse(r) as PretendBet);
}

export async function getPretendBetsByWager(
  wagerId: string,
  limit = 100,
): Promise<PretendBet[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_BETS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.byWager(wagerId), 0, safe - 1, { rev: true })) as string[];
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.bet(id));
  const rows = (await pipe.exec()) as Array<string | null>;
  return rows
    .filter((r): r is string => typeof r === 'string')
    .map((r) => JSON.parse(r) as PretendBet);
}

export interface PretendBetSummary {
  total: number;
  open: number;
  voided: number;
  totalStakeCents: number;
  totalPotentialPayoutCents: number;
}

export async function getPretendBetSummary(): Promise<PretendBetSummary> {
  const recent = await listPretendBets(200);
  let open = 0;
  let voided = 0;
  let stake = 0;
  let payout = 0;
  for (const b of recent) {
    if (b.status === 'open') open += 1;
    if (b.status === 'void') voided += 1;
    if (b.status === 'open') {
      stake += b.stakeCents;
      payout += b.potentialPayoutCents;
    }
  }
  return {
    total: recent.length,
    open,
    voided,
    totalStakeCents: stake,
    totalPotentialPayoutCents: payout,
  };
}

/**
 * Helper for the UI: estimates payout for a given wager + outcome + stake
 * without writing anything. Used to drive the "Potential payout" preview
 * before the operator clicks Place.
 */
export async function previewPretendPayout(
  wagerId: string,
  outcomeLabel: string,
  stakeCents: number,
): Promise<{ ok: boolean; odds?: number; profitCents?: number; potentialPayoutCents?: number; reason?: string }> {
  if (!Number.isFinite(stakeCents) || stakeCents <= 0) {
    return { ok: false, reason: 'Stake must be a positive integer.' };
  }
  const wager = await getWager(wagerId);
  if (!wager) return { ok: false, reason: 'Wager not found.' };
  if (wager.status !== 'open') return { ok: false, reason: 'Wager is not open.' };
  const odds = getOutcomeOdds(wager, outcomeLabel);
  if (odds == null) return { ok: false, reason: 'Outcome not on this wager.' };
  const profit = americanProfit(odds, stakeCents);
  return {
    ok: true,
    odds,
    profitCents: profit,
    potentialPayoutCents: stakeCents + profit,
  };
}
