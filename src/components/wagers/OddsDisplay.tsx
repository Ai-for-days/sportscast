import type { OddsWager } from '../../lib/wager-types';

interface Props {
  wager: OddsWager;
  bettable?: boolean;
  onOutcomeClick?: (outcomeLabel: string, odds: number) => void;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function oddsColor(odds: number): string {
  return odds > 0 ? 'text-green-600' : 'text-red-600';
}

export default function OddsDisplay({ wager, bettable, onOutcomeClick }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {wager.outcomes.map((outcome, i) => {
        const isWinner = wager.status === 'graded' && wager.winningOutcome === outcome.label;
        const clickable = bettable && onOutcomeClick;

        return (
          <button
            key={i}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onOutcomeClick(outcome.label, outcome.odds)}
            className={`rounded-lg border px-3 py-2 text-center transition-colors ${
              isWinner
                ? 'border-green-500 bg-green-50'
                : clickable
                ? 'border-gray-200 bg-gray-50 cursor-pointer hover:border-field hover:bg-field/5'
                : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="text-xs text-gray-500">{outcome.label}</div>
            <div className={`font-mono text-lg font-bold ${isWinner ? 'text-green-600' : oddsColor(outcome.odds)}`}>
              {formatOdds(outcome.odds)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
