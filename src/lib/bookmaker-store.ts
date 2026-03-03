import { getRedis } from './redis';

// ── Bookmaker Bankroll ──────────────────────────────────────────────────────
// The house starts with $1,000,000. This tracks the bookmaker's available funds.
// When a player wins, profit comes from the bankroll.
// When a player loses, their escrowed stake goes to the bankroll.

const BANKROLL_KEY = 'bookmaker:bankroll';
const INITIAL_BANKROLL = 100_000_000; // $1,000,000 in cents

export async function getBankroll(): Promise<number> {
  const redis = getRedis();
  const raw = await redis.get(BANKROLL_KEY);
  if (raw === null || raw === undefined) {
    // Initialize on first read
    await redis.set(BANKROLL_KEY, INITIAL_BANKROLL);
    return INITIAL_BANKROLL;
  }
  return typeof raw === 'number' ? raw : parseInt(raw as string, 10) || 0;
}

/** Add funds to bankroll (e.g. when player loses) */
export async function creditBankroll(amountCents: number): Promise<number> {
  if (amountCents <= 0) throw new Error('Credit amount must be positive');
  const redis = getRedis();
  return await redis.incrby(BANKROLL_KEY, amountCents);
}

/** Remove funds from bankroll (e.g. when player wins profit) */
export async function debitBankroll(amountCents: number): Promise<number> {
  if (amountCents <= 0) throw new Error('Debit amount must be positive');
  const redis = getRedis();
  const script = `
    local current = tonumber(redis.call('GET', KEYS[1]) or '0')
    if current < tonumber(ARGV[1]) then
      return -1
    end
    return redis.call('DECRBY', KEYS[1], ARGV[1])
  `;
  const result = await redis.eval(script, [BANKROLL_KEY], [amountCents.toString()]) as number;
  if (result === -1) {
    throw new Error('Insufficient bookmaker bankroll');
  }
  return result;
}

/** Reset bankroll to initial $1,000,000 */
export async function resetBankroll(): Promise<number> {
  const redis = getRedis();
  await redis.set(BANKROLL_KEY, INITIAL_BANKROLL);
  return INITIAL_BANKROLL;
}
