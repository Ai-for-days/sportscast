// ── Wallet Types ─────────────────────────────────────────────────────────────

export type TransactionType = 'deposit' | 'bet_placed' | 'bet_won' | 'bet_refund' | 'withdrawal';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amountCents: number;     // positive = credit, negative = debit
  balanceAfterCents: number;
  description: string;
  referenceId?: string;    // bet ID, Stripe checkout session ID, etc.
  createdAt: string;       // ISO 8601
}
