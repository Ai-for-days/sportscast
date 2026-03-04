import { useState, useEffect } from 'react';
import type { Wager, WagerStatus } from '../../lib/wager-types';
import type { Bet, BetStatus } from '../../lib/bet-types';
import type { Transaction } from '../../lib/wallet-types';
import WagerCard from '../wagers/WagerCard';
import WagerFilters from '../wagers/WagerFilters';
import BetSlip from '../wagers/BetSlip';
import DepositModal from '../account/DepositModal';

interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

interface BetSelection {
  wagerId: string;
  wagerTitle: string;
  outcomeLabel: string;
  odds: number;
}

const BET_STATUS_STYLES: Record<BetStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pending' },
  won: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Won' },
  lost: { bg: 'bg-red-100', text: 'text-red-700', label: 'Lost' },
  push: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Push' },
  void: { bg: 'bg-slate-100', text: 'text-slate-500', label: 'Void' },
};

type Tab = 'wagers' | 'mybets' | 'history';

export default function PlayerDashboard() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [balanceCents, setBalanceCents] = useState(0);
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<WagerStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('wagers');
  const [betSelection, setBetSelection] = useState<BetSelection | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [meRes, balRes, betRes, txRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/payments/balance'),
        fetch('/api/bets?limit=50'),
        fetch('/api/payments/transactions?limit=30'),
      ]);
      const meData = await meRes.json();
      if (!meData.user) { window.location.href = '/bettheforecast'; return; }
      setUser(meData.user);
      const balData = await balRes.json();
      setBalanceCents(balData.balanceCents || 0);
      const betData = await betRes.json();
      setBets(betData.bets || []);
      const txData = await txRes.json();
      setTransactions(txData.transactions || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    const fetchWagers = async () => {
      try {
        const params = new URLSearchParams();
        if (filter !== 'all') params.set('status', filter);
        params.set('limit', '50');
        const res = await fetch(`/api/wagers?${params}`);
        if (res.ok) {
          const data = await res.json();
          setWagers(data.wagers || []);
        }
      } catch { /* ignore */ }
    };
    fetchWagers();
  }, [filter]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  };

  const handleOutcomeClick = (wagerId: string, wagerTitle: string, outcomeLabel: string, odds: number) => {
    if (!user) { window.location.href = '/bettheforecast'; return; }
    setBetSelection({ wagerId, wagerTitle, outcomeLabel, odds });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-3 border-emerald-200 border-t-emerald-500" />
      </div>
    );
  }

  if (!user) return null;

  const pendingBets = bets.filter(b => b.status === 'pending');
  const settledBets = bets.filter(b => b.status !== 'pending');
  const totalWon = bets.filter(b => b.status === 'won').reduce((s, b) => s + (b.potentialPayoutCents - b.amountCents), 0);
  const totalLost = bets.filter(b => b.status === 'lost').reduce((s, b) => s + b.amountCents, 0);

  const TX_LABELS: Record<string, string> = {
    deposit: 'Deposit', bet_placed: 'Bet', bet_won: 'Win', bet_refund: 'Refund',
    withdrawal: 'Withdraw', correction: 'Correction',
  };

  return (
    <div className="space-y-0">
      {/* Top bar: dark header with user info + balance */}
      <div className="rounded-t-2xl bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-11 w-11 rounded-full ring-2 ring-emerald-400" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white ring-2 ring-emerald-300">
                {user.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
              </div>
            )}
            <div>
              <div className="text-base font-semibold text-white">{user.displayName}</div>
              <div className="text-xs text-slate-400">{user.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-slate-400">Balance</div>
              <div className="font-mono text-2xl font-bold text-emerald-400">
                ${(balanceCents / 100).toFixed(2)}
              </div>
            </div>
            <button
              onClick={() => setShowDeposit(true)}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 transition-colors"
            >
              Deposit
            </button>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-400 hover:text-white hover:border-slate-400 transition-colors"
            >
              Log out
            </button>
          </div>
        </div>

        {/* Quick stats row */}
        <div className="mt-4 flex gap-6 border-t border-slate-700 pt-4">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Active Bets</div>
            <div className="text-lg font-bold text-amber-400">{pendingBets.length}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Total Won</div>
            <div className="text-lg font-bold text-emerald-400">+${(totalWon / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Total Lost</div>
            <div className="text-lg font-bold text-red-400">-${(totalLost / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Record</div>
            <div className="text-lg font-bold text-white">
              {bets.filter(b => b.status === 'won').length}W - {bets.filter(b => b.status === 'lost').length}L
            </div>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex border-b border-slate-200 bg-slate-50 px-2">
        {([
          { key: 'wagers' as Tab, label: 'Sportsbook', count: wagers.length },
          { key: 'mybets' as Tab, label: 'My Bets', count: bets.length },
          { key: 'history' as Tab, label: 'Transactions', count: transactions.length },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-5 py-3 text-sm font-semibold transition-colors ${
              tab === t.key
                ? 'text-emerald-600'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-emerald-500' : 'text-slate-400'}`}>
              ({t.count})
            </span>
            {tab === t.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-b-2xl border border-t-0 border-slate-200 bg-white p-6">
        {/* SPORTSBOOK TAB */}
        {tab === 'wagers' && (
          <div className="space-y-5">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <WagerFilters active={filter} onChange={setFilter} />
              <div className="text-sm text-slate-500">
                {wagers.length} wager{wagers.length !== 1 ? 's' : ''}
              </div>
            </div>

            {wagers.length === 0 ? (
              <div className="rounded-xl bg-slate-50 px-6 py-14 text-center">
                <div className="text-4xl">&#x1F3B2;</div>
                <h3 className="mt-3 text-lg font-semibold text-slate-800">No wagers available</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {filter === 'all' ? 'Check back soon for weather wagers!' : `No ${filter} wagers right now.`}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {wagers.map(w => (
                  <WagerCard key={w.id} wager={w} user={user} onOutcomeClick={handleOutcomeClick} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* MY BETS TAB */}
        {tab === 'mybets' && (
          <div className="space-y-4">
            {bets.length === 0 ? (
              <div className="rounded-xl bg-slate-50 px-6 py-14 text-center">
                <p className="text-sm text-slate-500">No bets yet. Head to the Sportsbook tab to place your first bet!</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800 text-xs uppercase text-slate-300">
                    <tr>
                      <th className="px-4 py-3 text-left">Pick</th>
                      <th className="px-4 py-3 text-center">Odds</th>
                      <th className="px-4 py-3 text-right">Stake</th>
                      <th className="px-4 py-3 text-right">To Win</th>
                      <th className="px-4 py-3 text-center">Result</th>
                      <th className="px-4 py-3 text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bets.map(bet => {
                      const style = BET_STATUS_STYLES[bet.status];
                      const profit = bet.potentialPayoutCents - bet.amountCents;
                      return (
                        <tr key={bet.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-semibold text-slate-900">{bet.outcomeLabel}</td>
                          <td className={`px-4 py-3 text-center font-mono font-semibold ${bet.odds > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {bet.odds > 0 ? `+${bet.odds}` : bet.odds}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-700">${(bet.amountCents / 100).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right font-mono text-emerald-600">
                            {bet.status === 'won'
                              ? `+$${(profit / 100).toFixed(2)}`
                              : bet.status === 'pending'
                                ? `$${(profit / 100).toFixed(2)}`
                                : '-'
                            }
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${style.bg} ${style.text}`}>
                              {style.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-slate-500">
                            {new Date(bet.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TRANSACTIONS TAB */}
        {tab === 'history' && (
          <div className="space-y-4">
            {transactions.length === 0 ? (
              <div className="rounded-xl bg-slate-50 px-6 py-14 text-center">
                <p className="text-sm text-slate-500">No transactions yet. Deposit to get started!</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800 text-xs uppercase text-slate-300">
                    <tr>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Description</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-right">Balance</th>
                      <th className="px-4 py-3 text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.map(tx => (
                      <tr key={tx.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold ${
                            tx.amountCents > 0 ? 'text-emerald-600' : 'text-red-500'
                          }`}>
                            {TX_LABELS[tx.type] || tx.type}
                          </span>
                        </td>
                        <td className="max-w-[250px] truncate px-4 py-3 text-slate-600">{tx.description}</td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold ${tx.amountCents >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {tx.amountCents >= 0 ? '+' : ''}${(tx.amountCents / 100).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">${(tx.balanceAfterCents / 100).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-xs text-slate-500">
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bet slip modal */}
      {betSelection && (
        <BetSlip
          wagerId={betSelection.wagerId}
          wagerTitle={betSelection.wagerTitle}
          outcomeLabel={betSelection.outcomeLabel}
          odds={betSelection.odds}
          onClose={() => setBetSelection(null)}
          onBetPlaced={() => { setBetSelection(null); fetchAll(); }}
        />
      )}

      {/* Deposit modal */}
      {showDeposit && (
        <DepositModal
          onClose={() => setShowDeposit(false)}
          onDeposited={() => { setShowDeposit(false); fetchAll(); }}
        />
      )}
    </div>
  );
}
