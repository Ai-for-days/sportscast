import { useBetting } from './BettingContext';

function formatOdds(odds: number) {
  if (odds === 0) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function BetSlip() {
  const { betLegs, removeLeg, stake, setStake, expectedPayout, loading, placeBet, error, success } = useBetting();

  if (betLegs.length === 0) {
    return null;
  }

  return (
    <>
      <div className="mb-4 rounded bg-surface-dark p-3">
        <p className="mb-2 text-xs font-semibold text-text-dark">Bet Slip ({betLegs.length})</p>
        <div className="mb-3 max-h-32 space-y-1 overflow-y-auto">
          {betLegs.map((leg, i) => (
            <div key={i} className="flex items-start justify-between gap-2 text-[10px]">
              <div className="flex-1">
                <p className="truncate text-text-dark-muted">{leg.gameDescription}</p>
                <p className="font-semibold text-text-dark">
                  {leg.oddsType === 'moneyline'
                    ? `ML ${leg.side?.toUpperCase()}`
                    : leg.oddsType === 'spread'
                    ? `Spread ${leg.line} ${leg.side?.toUpperCase()}`
                    : leg.oddsType === 'total'
                    ? `Total ${leg.line} ${leg.side?.toUpperCase()}`
                    : leg.outcomeDescription} {formatOdds(leg.odds)}
                </p>
              </div>
              <button onClick={() => removeLeg(i)} className="font-bold text-alert-light hover:text-alert">
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="mb-3 border-t border-border-dark pt-2">
          <label className="mb-1 block text-xs font-semibold text-text-dark">Stake</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="flex-1 rounded border border-border-dark bg-surface-dark px-2 py-1 text-sm text-text-dark"
              placeholder="10"
              min="0.01"
              step="0.01"
            />
            <div className="text-right text-[10px] text-text-dark-muted">
              <p>To Win</p>
              <p className="font-bold text-text-dark">${expectedPayout.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <button
          onClick={placeBet}
          disabled={loading}
          className="w-full rounded bg-field px-3 py-2 text-sm font-semibold text-white hover:bg-field-dark disabled:opacity-50"
        >
          {loading ? 'Placing...' : 'Place Bet'}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-3 rounded border border-alert/30 bg-alert/10 px-3 py-2 text-xs text-alert-light">
          {error}
        </div>
      )}

      {/* Success message */}
      {success && (
        <div className="mb-3 rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-400">
          {success}
        </div>
      )}
    </>
  );
}
