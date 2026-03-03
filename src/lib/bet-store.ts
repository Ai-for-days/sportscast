import { getRedis } from './redis';
import { getWager } from './wager-store';
import { debitBalance, getBalance, recordTransaction } from './wallet-store';
import { calculatePayout } from './odds-utils';
import { getUserById } from './user-store';
import type { Bet, BetStatus } from './bet-types';
import type { Wager, OddsWager, OverUnderWager, PointspreadWager } from './wager-types';

// ── Redis key helpers ────────────────────────────────────────────────────────

const KEY = {
  bet: (id: string) => `bet:${id}`,
  byUser: (userId: string) => `bets:by-user:${userId}`,
  byWager: (wagerId: string) => `bets:by-wager:${wagerId}`,
} as const;

const MIN_BET = 100;          // $1.00

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `bet_${ts}_${rand}`;
}

// ── Validation helpers ──────────────────────────────────────────────────────

function getOddsForOutcome(wager: Wager, outcomeLabel: string): number | null {
  if (wager.kind === 'odds') {
    const outcome = (wager as OddsWager).outcomes.find(o => o.label === outcomeLabel);
    return outcome ? outcome.odds : null;
  }
  if (wager.kind === 'over-under') {
    const ou = wager as OverUnderWager;
    if (outcomeLabel === 'over') return ou.over.odds;
    if (outcomeLabel === 'under') return ou.under.odds;
    return null;
  }
  if (wager.kind === 'pointspread') {
    const ps = wager as PointspreadWager;
    if (outcomeLabel === 'locationA') return ps.locationAOdds;
    if (outcomeLabel === 'locationB') return ps.locationBOdds;
    return null;
  }
  return null;
}

// ── Place bet ───────────────────────────────────────────────────────────────

export async function placeBet(userId: string, wagerId: string, outcomeLabel: string, amountCents: number): Promise<Bet> {
  // Block frozen users
  const user = await getUserById(userId);
  if (user?.frozen) {
    throw new Error('Your account has been frozen. Contact support.');
  }

  // Validate minimum
  if (amountCents < MIN_BET) {
    throw new Error(`Minimum bet is $${(MIN_BET / 100).toFixed(2)}`);
  }

  // Validate player has enough balance
  const currentBalance = await getBalance(userId);
  if (amountCents > currentBalance) {
    throw new Error(`Insufficient balance ($${(currentBalance / 100).toFixed(2)} available)`);
  }

  // Validate wager exists and is open
  const wager = await getWager(wagerId);
  if (!wager) throw new Error('Wager not found');
  if (wager.status !== 'open') throw new Error('Wager is not open for betting');

  // lockTime is set to 15 minutes before the event — no bets after that
  const lockMs = new Date(wager.lockTime).getTime();
  if (Date.now() >= lockMs) {
    throw new Error('Bets must be placed at least 15 minutes before the event');
  }

  // Validate outcome exists
  const odds = getOddsForOutcome(wager, outcomeLabel);
  if (odds === null) throw new Error('Invalid outcome');

  // Calculate payout
  const potentialPayoutCents = calculatePayout(amountCents, odds);

  // Debit balance (atomic)
  const newBalance = await debitBalance(userId, amountCents);

  // Create bet
  const redis = getRedis();
  const id = generateId();
  const now = new Date().toISOString();

  const bet: Bet = {
    id,
    userId,
    wagerId,
    outcomeLabel,
    odds,
    amountCents,
    potentialPayoutCents,
    status: 'pending',
    createdAt: now,
  };

  const pipeline = redis.pipeline();
  pipeline.set(KEY.bet(id), JSON.stringify(bet));
  pipeline.zadd(KEY.byUser(userId), { score: Date.now(), member: id });
  pipeline.sadd(KEY.byWager(wagerId), id);
  await pipeline.exec();

  // Record transaction
  await recordTransaction({
    userId,
    type: 'bet_placed',
    amountCents: -amountCents,
    balanceAfterCents: newBalance,
    description: `Bet $${(amountCents / 100).toFixed(2)} on "${wager.title}" — ${outcomeLabel}`,
    referenceId: id,
  });

  return bet;
}

// ── Read operations ─────────────────────────────────────────────────────────

export async function getBet(id: string): Promise<Bet | null> {
  const redis = getRedis();
  const raw = await redis.get(KEY.bet(id));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Bet;
}

export async function getUserBets(userId: string, limit = 20, offset = 0): Promise<{ bets: Bet[]; total: number }> {
  const redis = getRedis();
  const key = KEY.byUser(userId);
  const total = await redis.zcard(key);
  const ids = await redis.zrange(key, offset, offset + limit - 1, { rev: true }) as string[];

  if (ids.length === 0) return { bets: [], total };

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(KEY.bet(id));
  }
  const results = await pipeline.exec();

  const bets: Bet[] = [];
  for (const raw of results) {
    if (raw) {
      bets.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Bet);
    }
  }

  return { bets, total };
}

export async function getWagerBets(wagerId: string): Promise<Bet[]> {
  const redis = getRedis();
  const ids = await redis.smembers(KEY.byWager(wagerId)) as string[];
  if (ids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(KEY.bet(id));
  }
  const results = await pipeline.exec();

  return results
    .filter(Boolean)
    .map(raw => typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Bet);
}

// ── Update bet status ───────────────────────────────────────────────────────

export async function updateBetStatus(betId: string, status: BetStatus): Promise<Bet | null> {
  const bet = await getBet(betId);
  if (!bet) return null;

  const updated: Bet = {
    ...bet,
    status,
    settledAt: new Date().toISOString(),
  };

  const redis = getRedis();
  await redis.set(KEY.bet(betId), JSON.stringify(updated));
  return updated;
}
