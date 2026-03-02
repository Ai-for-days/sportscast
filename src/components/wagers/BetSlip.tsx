import { useState, useEffect } from 'react';
import { calculatePayout } from '../../lib/odds-utils';

interface Props {
  wagerId: string;
  wagerTitle: string;
  outcomeLabel: string;
  odds: number;
  onClose: () => void;
  onBetPlaced: () => void;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export default function BetSlip({ wagerId, wagerTitle, outcomeLabel, odds, onClose, onBetPlaced }: Props) {
  const [amountStr, setAmountStr] = useState('10');
  const [balanceCents, setBalanceCents] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/payments/balance')
      .then(r => r.json())
      .then(data => setBalanceCents(data.balanceCents || 0))
      .catch(() => {});
  }, []);

  const amountCents = Math.round(parseFloat(amountStr || '0') * 100);
  const maxBetCents = Math.floor(balanceCents * 0.5);
  const payoutCents = amountCents > 0 ? calculatePayout(amountCents, odds) : 0;
  const profitCents = payoutCents - amountCents;

  const handlePlaceBet = async () => {
    if (amountCents < 1000) {
      setError('Minimum bet is $10.00');
      return;
    }
    if (amountCents > maxBetCents) {
      setError(`Maximum bet is 50% of your balance ($${(maxBetCents / 100).toFixed(2)})`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wagerId, outcomeLabel, amountCents }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to place bet');
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        onBetPlaced();
        onClose();
      }, 1500);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-xl border border-border-dark bg-surface-dark p-5 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-dark">Place Bet</h3>
            <p className="mt-0.5 text-xs text-text-dark-muted truncate">{wagerTitle}</p>
          </div>
          <button onClick={onClose} className="text-text-dark-muted hover:text-text-dark text-lg">&times;</button>
        </div>

        {success ? (
          <div className="rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-6 text-center">
            <div className="text-2xl mb-2">&#10003;</div>
            <div className="font-semibold text-green-400">Bet placed!</div>
          </div>
        ) : (
          <>
            {/* Selection */}
            <div className="mb-4 rounded-lg bg-surface-dark-alt px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-dark">{outcomeLabel}</span>
                <span className={`font-mono font-bold ${odds > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatOdds(odds)}
                </span>
              </div>
            </div>

            {error && (
              <div className="mb-3 rounded-lg border border-alert/30 bg-alert/5 px-3 py-2 text-xs text-alert-light">
                {error}
              </div>
            )}

            {/* Stake input */}
            <div className="mb-3">
              <label className="mb-1 block text-xs text-text-dark-muted">Stake</label>
              <div className="flex items-center gap-2">
                <span className="text-text-dark-muted">$</span>
                <input
                  type="number"
                  min="10"
                  max={maxBetCents / 100}
                  step="1"
                  value={amountStr}
                  onChange={e => setAmountStr(e.target.value)}
                  className="w-full rounded-lg border border-border-dark bg-surface-dark-alt px-3 py-2 font-mono text-sm text-text-dark outline-none focus:border-field"
                />
              </div>
              {/* Quick amounts */}
              <div className="mt-2 flex gap-1">
                {[10, 25, 50, 100].map(amt => (
                  <button
                    key={amt}
                    onClick={() => setAmountStr(amt.toString())}
                    className="rounded border border-border-dark px-2 py-1 text-xs text-text-dark-muted hover:bg-surface-dark-alt"
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Payout display */}
            <div className="mb-4 space-y-1 rounded-lg bg-surface-dark-alt px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-text-dark-muted">Balance</span>
                <span className="font-mono text-text-dark">${(balanceCents / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-dark-muted">Max bet (50%)</span>
                <span className="font-mono text-text-dark">${(maxBetCents / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-dark-muted">Potential profit</span>
                <span className="font-mono text-green-400">+${(profitCents / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-border-dark pt-1">
                <span className="font-medium text-text-dark">Total payout</span>
                <span className="font-mono font-bold text-text-dark">${(payoutCents / 100).toFixed(2)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-border-dark px-4 py-2.5 text-sm text-text-dark-muted hover:bg-surface-dark-alt"
              >
                Cancel
              </button>
              <button
                onClick={handlePlaceBet}
                disabled={loading || amountCents < 1000}
                className="flex-1 rounded-lg bg-field px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-field-light disabled:opacity-50"
              >
                {loading ? 'Placing...' : 'Place Bet'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
