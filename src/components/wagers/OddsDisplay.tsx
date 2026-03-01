import type { OddsWager } from '../../lib/wager-types';

interface Props {
  wager: OddsWager;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function oddsColor(odds: number): string {
  return odds > 0 ? 'text-green-400' : 'text-red-400';
}

export default function OddsDisplay({ wager }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {wager.outcomes.map((outcome, i) => {
        const isWinner = wager.status === 'graded' && wager.winningOutcome === outcome.label;
        return (
          <div
            key={i}
            className={`rounded-lg border px-3 py-2 text-center transition-colors ${
              isWinner
                ? 'border-green-500 bg-green-500/10'
                : 'border-border-dark bg-surface-dark'
            }`}
          >
            <div className="text-xs text-text-dark-muted">{outcome.label}</div>
            <div className={`font-mono text-lg font-bold ${isWinner ? 'text-green-400' : oddsColor(outcome.odds)}`}>
              {formatOdds(outcome.odds)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
