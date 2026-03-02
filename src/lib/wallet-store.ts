import { getRedis } from './redis';
import type { Transaction, TransactionType } from './wallet-types';

// ── Redis key helpers ────────────────────────────────────────────────────────

const KEY = {
  balance: (userId: string) => `balance:${userId}`,
  transaction: (id: string) => `transaction:${id}`,
  userTransactions: (userId: string) => `transactions:${userId}`,
} as const;

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `tx_${ts}_${rand}`;
}

// ── Balance operations ──────────────────────────────────────────────────────

export async function getBalance(userId: string): Promise<number> {
  const redis = getRedis();
  const raw = await redis.get(KEY.balance(userId));
  return typeof raw === 'number' ? raw : parseInt(raw as string || '0', 10) || 0;
}

export async function creditBalance(userId: string, amountCents: number): Promise<number> {
  if (amountCents <= 0) throw new Error('Credit amount must be positive');
  const redis = getRedis();
  const newBalance = await redis.incrby(KEY.balance(userId), amountCents);
  return newBalance;
}

/**
 * Atomic check-and-debit using Lua script.
 * Returns new balance on success, or throws if insufficient funds.
 */
export async function debitBalance(userId: string, amountCents: number): Promise<number> {
  if (amountCents <= 0) throw new Error('Debit amount must be positive');
  const redis = getRedis();
  const key = KEY.balance(userId);

  // Lua script: check balance >= amount, then decrby. Returns new balance or -1 if insufficient.
  const script = `
    local current = tonumber(redis.call('GET', KEYS[1]) or '0')
    if current < tonumber(ARGV[1]) then
      return -1
    end
    return redis.call('DECRBY', KEYS[1], ARGV[1])
  `;

  const result = await redis.eval(script, [key], [amountCents.toString()]) as number;
  if (result === -1) {
    throw new Error('Insufficient balance');
  }
  return result;
}

// ── Transaction recording ───────────────────────────────────────────────────

export async function recordTransaction(data: {
  userId: string;
  type: TransactionType;
  amountCents: number;
  balanceAfterCents: number;
  description: string;
  referenceId?: string;
}): Promise<Transaction> {
  const redis = getRedis();
  const id = generateId();
  const now = new Date().toISOString();

  const tx: Transaction = {
    id,
    userId: data.userId,
    type: data.type,
    amountCents: data.amountCents,
    balanceAfterCents: data.balanceAfterCents,
    description: data.description,
    referenceId: data.referenceId,
    createdAt: now,
  };

  const pipeline = redis.pipeline();
  pipeline.set(KEY.transaction(id), JSON.stringify(tx));
  pipeline.zadd(KEY.userTransactions(data.userId), { score: Date.now(), member: id });
  await pipeline.exec();

  return tx;
}

export async function getTransactions(userId: string, limit = 20, offset = 0): Promise<{ transactions: Transaction[]; total: number }> {
  const redis = getRedis();
  const key = KEY.userTransactions(userId);
  const total = await redis.zcard(key);
  const ids = await redis.zrange(key, offset, offset + limit - 1, { rev: true }) as string[];

  if (ids.length === 0) return { transactions: [], total };

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(KEY.transaction(id));
  }
  const results = await pipeline.exec();

  const transactions: Transaction[] = [];
  for (const raw of results) {
    if (raw) {
      const tx = typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Transaction;
      transactions.push(tx);
    }
  }

  return { transactions, total };
}
