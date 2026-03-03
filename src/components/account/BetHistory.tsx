import { useState, useEffect } from 'react';
import type { Bet, BetStatus } from '../../lib/bet-types';

const STATUS_STYLES: Record<BetStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Pending' },
  won: { bg: 'bg-green-100', text: 'text-green-700', label: 'Won' },
  lost: { bg: 'bg-red-100', text: 'text-red-700', label: 'Lost' },
  push: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Push' },
  void: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Void' },
};

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export default function BetHistory() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/bets?limit=50')
      .then(r => r.json())
      .then(data => setBets(data.bets || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-field/20 border-t-field" />
      </div>
    );
  }

  if (bets.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-8 text-center text-sm text-gray-500">
        No bets yet. Visit the <a href="/wagers" className="text-field hover:underline">wagers page</a> to place your first bet!
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm text-gray-900">
        <thead className="bg-gray-100 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">Outcome</th>
            <th className="px-4 py-3 text-center">Odds</th>
            <th className="px-4 py-3 text-right">Stake</th>
            <th className="px-4 py-3 text-right">Payout</th>
            <th className="px-4 py-3 text-center">Status</th>
            <th className="px-4 py-3 text-right">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {bets.map(bet => {
            const style = STATUS_STYLES[bet.status];
            return (
              <tr key={bet.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{bet.outcomeLabel}</td>
                <td className={`px-4 py-3 text-center font-mono ${bet.odds > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatOdds(bet.odds)}
                </td>
                <td className="px-4 py-3 text-right font-mono">${(bet.amountCents / 100).toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-mono">
                  {bet.status === 'won' ? `+$${((bet.potentialPayoutCents - bet.amountCents) / 100).toFixed(2)}` : '-'}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
                    {style.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs text-gray-500">
                  {new Date(bet.createdAt).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
