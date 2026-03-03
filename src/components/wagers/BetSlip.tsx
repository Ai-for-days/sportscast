import { useState, useEffect } from 'react';
import { calculatePayout, calculateStakeFromProfit } from '../../lib/odds-utils';

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

type InputMode = 'risk' | 'towin';

export default function BetSlip({ wagerId, wagerTitle, outcomeLabel, odds, onClose, onBetPlaced }: Props) {
  const [mode, setMode] = useState<InputMode>('risk');
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

  const inputCents = Math.round(parseFloat(amountStr || '0') * 100);

  // Calculate stake and payout based on mode
  let stakeCents: number;
  let payoutCents: number;
  let profitCents: number;

  if (mode === 'risk') {
    stakeCents = inputCents;
    payoutCents = stakeCents > 0 ? calculatePayout(stakeCents, odds) : 0;
    profitCents = payoutCents - stakeCents;
  } else {
    // "To Win" mode: user enters desired profit
    profitCents = inputCents;
    stakeCents = profitCents > 0 ? calculateStakeFromProfit(profitCents, odds) : 0;
    payoutCents = stakeCents + profitCents;
  }

  const handlePlaceBet = async () => {
    if (stakeCents < 100) {
      setError('Minimum risk is $1.00');
      return;
    }
    if (stakeCents > balanceCents) {
      setError(`Insufficient balance ($${(balanceCents / 100).toFixed(2)} available)`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wagerId, outcomeLabel, amountCents: stakeCents }),
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
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Place Bet</h3>
            <p className="mt-0.5 text-xs text-gray-500 truncate">{wagerTitle}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 text-lg">&times;</button>
        </div>

        {success ? (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-6 text-center">
            <div className="text-2xl mb-2">&#10003;</div>
            <div className="font-semibold text-green-600">Bet placed!</div>
          </div>
        ) : (
          <>
            {/* Selection */}
            <div className="mb-4 rounded-lg bg-gray-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">{outcomeLabel}</span>
                <span className={`font-mono font-bold ${odds > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatOdds(odds)}
                </span>
              </div>
            </div>

            {error && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </div>
            )}

            {/* Risk / To Win toggle */}
            <div className="mb-3 flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                onClick={() => { setMode('risk'); setAmountStr('10'); }}
                className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                  mode === 'risk'
                    ? 'bg-field text-white'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                Risk
              </button>
              <button
                onClick={() => { setMode('towin'); setAmountStr('10'); }}
                className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                  mode === 'towin'
                    ? 'bg-field text-white'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                To Win
              </button>
            </div>

            {/* Amount input */}
            <div className="mb-3">
              <label className="mb-1 block text-xs text-gray-500">
                {mode === 'risk' ? 'Risk Amount' : 'Desired Profit'}
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">$</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={amountStr}
                  onChange={e => setAmountStr(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-field"
                />
              </div>
              {/* Quick amounts */}
              <div className="mt-2 flex gap-1">
                {[10, 25, 50, 100].map(amt => (
                  <button
                    key={amt}
                    onClick={() => setAmountStr(amt.toString())}
                    className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Payout display */}
            <div className="mb-4 space-y-1 rounded-lg bg-gray-50 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Balance</span>
                <span className="font-mono text-gray-900">${(balanceCents / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">You risk</span>
                <span className="font-mono text-gray-900">${(stakeCents / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1">
                <span className="font-medium text-gray-900">Total payout</span>
                <span className="font-mono font-bold text-green-600">+${(profitCents / 100).toFixed(2)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePlaceBet}
                disabled={loading || stakeCents < 100}
                className="flex-1 rounded-lg bg-field px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-field-light disabled:opacity-50"
              >
                {loading ? 'Placing...' : `Bet $${(stakeCents / 100).toFixed(2)}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
