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

function fmtUSD(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    deposit: { color: 'text-green-600', label: 'Deposit' },
    bet_placed: { color: 'text-orange-500', label: 'Bet Placed' },
    bet_won: { color: 'text-green-600', label: 'Bet Won' },
    bet_lost: { color: 'text-red-500', label: 'Loss' },
    bet_refund: { color: 'text-blue-500', label: 'Refund' },
    withdrawal: { color: 'text-red-500', label: 'Withdrawal' },
    correction: { color: 'text-blue-500', label: 'Credit' },
  };

  return (
    <div className="space-y-6">
      {/* Profile header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-12 w-12 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-field/20 text-lg font-bold text-field">
              {user.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold text-gray-900">{user.displayName}</h2>
            <p className="text-sm text-gray-500">{user.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50"
        >
          Log out
        </button>
      </div>

      {/* Balance card */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">Balance</div>
            <div className="font-mono text-3xl font-bold text-gray-900">
              ${fmtUSD(balanceCents)}
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
              href="/bettheforecast"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100"
            >
              Place Bets
            </a>
          </div>
        </div>
      </div>

      {/* Bet history */}
      <div>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">My Bets</h3>
        <BetHistory />
      </div>

      {/* Transaction history */}
      <div>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">Transaction History</h3>
        {transactions.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-8 text-center text-sm text-gray-500">
            No transactions yet. Make your first deposit to get started!
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm text-gray-900">
              <thead className="bg-gray-100 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {transactions.map(tx => {
                  const style = TX_TYPE_STYLES[tx.type] || { color: 'text-gray-900', label: tx.type };
                  return (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${style.color}`}>{style.label}</span>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3">{tx.description}</td>
                      <td className={`px-4 py-3 text-right font-mono ${tx.amountCents >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {tx.amountCents >= 0 ? '+' : '-'}${fmtUSD(tx.amountCents)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">${fmtUSD(tx.balanceAfterCents)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500">
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
