import { useState, useEffect } from 'react';
import type { Bet, BetStatus } from '../../lib/bet-types';

const STATUS_STYLES: Record<BetStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-field/20', text: 'text-field-light', label: 'Pending' },
  won: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Won' },
  lost: { bg: 'bg-alert/20', text: 'text-alert-light', label: 'Lost' },
  push: { bg: 'bg-storm/20', text: 'text-storm-light', label: 'Push' },
  void: { bg: 'bg-storm/20', text: 'text-storm-light', label: 'Void' },
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
      <div className="rounded-xl border border-border-dark bg-surface-dark-alt px-6 py-8 text-center text-sm text-text-dark-muted">
        No bets yet. Visit the <a href="/wagers" className="text-field-light hover:underline">wagers page</a> to place your first bet!
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border-dark">
      <table className="w-full text-sm text-text-dark">
        <thead className="bg-surface-dark text-xs uppercase text-text-dark-muted">
          <tr>
            <th className="px-4 py-3 text-left">Outcome</th>
            <th className="px-4 py-3 text-center">Odds</th>
            <th className="px-4 py-3 text-right">Stake</th>
            <th className="px-4 py-3 text-right">Payout</th>
            <th className="px-4 py-3 text-center">Status</th>
            <th className="px-4 py-3 text-right">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-dark">
          {bets.map(bet => {
            const style = STATUS_STYLES[bet.status];
            return (
              <tr key={bet.id} className="bg-surface-dark-alt hover:bg-surface-dark">
                <td className="px-4 py-3 font-medium">{bet.outcomeLabel}</td>
                <td className={`px-4 py-3 text-center font-mono ${bet.odds > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatOdds(bet.odds)}
                </td>
                <td className="px-4 py-3 text-right font-mono">${(bet.amountCents / 100).toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-mono">
                  {bet.status === 'won' ? `$${(bet.potentialPayoutCents / 100).toFixed(2)}` : '-'}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
                    {style.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs text-text-dark-muted">
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
