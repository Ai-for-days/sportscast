import { useState, useEffect } from 'react';
import type { Transaction } from '../../lib/wallet-types';
import DepositModal from './DepositModal';
import BetHistory from './BetHistory';

interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

export default function AccountDashboard() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [balanceCents, setBalanceCents] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeposit, setShowDeposit] = useState(false);

  const fetchData = async () => {
    try {
      const [meRes, balRes, txRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/payments/balance'),
        fetch('/api/payments/transactions?limit=20'),
      ]);

      const meData = await meRes.json();
      if (!meData.user) {
        window.location.href = '/login';
        return;
      }
      setUser(meData.user);

      const balData = await balRes.json();
      setBalanceCents(balData.balanceCents || 0);

      const txData = await txRes.json();
      setTransactions(txData.transactions || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-field/20 border-t-field" />
      </div>
    );
  }

  if (!user) return null;

  const TX_TYPE_STYLES: Record<string, { color: string; label: string }> = {
    deposit: { color: 'text-green-400', label: 'Deposit' },
    bet_placed: { color: 'text-heat-light', label: 'Bet Placed' },
    bet_won: { color: 'text-green-400', label: 'Bet Won' },
    bet_refund: { color: 'text-sky-light', label: 'Refund' },
    withdrawal: { color: 'text-alert-light', label: 'Withdrawal' },
  };

  return (
    <div className="space-y-6">
      {/* Profile header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-12 w-12 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-field/20 text-lg font-bold text-field-light">
              {user.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold text-text-dark">{user.displayName}</h2>
            <p className="text-sm text-text-dark-muted">{user.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-border-dark px-4 py-2 text-sm text-text-dark-muted hover:bg-surface-dark"
        >
          Log out
        </button>
      </div>

      {/* Balance card */}
      <div className="rounded-xl border border-border-dark bg-surface-dark-alt p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-text-dark-muted">Balance</div>
            <div className="font-mono text-3xl font-bold text-text-dark">
              ${(balanceCents / 100).toFixed(2)}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowDeposit(true)}
              className="rounded-lg bg-field px-4 py-2 text-sm font-semibold text-white hover:bg-field-light"
            >
              Deposit
            </button>
            <a
              href="/wagers"
              className="rounded-lg border border-border-dark px-4 py-2 text-sm font-medium text-text-dark hover:bg-surface-dark"
            >
              Place Bets
            </a>
          </div>
        </div>
      </div>

      {/* Bet history */}
      <div>
        <h3 className="mb-3 text-lg font-semibold text-text-dark">My Bets</h3>
        <BetHistory />
      </div>

      {/* Transaction history */}
      <div>
        <h3 className="mb-3 text-lg font-semibold text-text-dark">Transaction History</h3>
        {transactions.length === 0 ? (
          <div className="rounded-xl border border-border-dark bg-surface-dark-alt px-6 py-8 text-center text-sm text-text-dark-muted">
            No transactions yet. Make your first deposit to get started!
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border-dark">
            <table className="w-full text-sm text-text-dark">
              <thead className="bg-surface-dark text-xs uppercase text-text-dark-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dark">
                {transactions.map(tx => {
                  const style = TX_TYPE_STYLES[tx.type] || { color: 'text-text-dark', label: tx.type };
                  return (
                    <tr key={tx.id} className="bg-surface-dark-alt hover:bg-surface-dark">
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${style.color}`}>{style.label}</span>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3">{tx.description}</td>
                      <td className={`px-4 py-3 text-right font-mono ${tx.amountCents >= 0 ? 'text-green-400' : 'text-alert-light'}`}>
                        {tx.amountCents >= 0 ? '+' : ''}{(tx.amountCents / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">${(tx.balanceAfterCents / 100).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-xs text-text-dark-muted">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showDeposit && (
        <DepositModal
          onClose={() => setShowDeposit(false)}
          onDeposited={() => { setShowDeposit(false); fetchData(); }}
        />
      )}
    </div>
  );
}
