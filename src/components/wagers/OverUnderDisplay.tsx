import type { OverUnderWager } from '../../lib/wager-types';

interface Props {
  wager: OverUnderWager;
  bettable?: boolean;
  onOutcomeClick?: (outcomeLabel: string, odds: number) => void;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function oddsColor(odds: number): string {
  return odds > 0 ? 'text-green-600' : 'text-red-600';
}

export default function OverUnderDisplay({ wager, bettable, onOutcomeClick }: Props) {
  const isOverWinner = wager.status === 'graded' && wager.winningOutcome === 'over';
  const isUnderWinner = wager.status === 'graded' && wager.winningOutcome === 'under';
  const clickable = bettable && onOutcomeClick;

  return (
    <div className="space-y-3">
      <div className="text-center">
        <span className="font-mono text-2xl font-bold text-gray-900">{wager.line}</span>
        <span className="ml-1 text-xs text-gray-500">line</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={!clickable}
          onClick={() => clickable && onOutcomeClick('over', wager.over.odds)}
          className={`rounded-lg border px-4 py-3 text-center transition-colors ${
            isOverWinner
              ? 'border-green-500 bg-green-50'
              : clickable
              ? 'border-gray-200 bg-gray-50 cursor-pointer hover:border-field hover:bg-field/5'
              : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">Over</div>
          <div className={`font-mono text-xl font-bold ${isOverWinner ? 'text-green-600' : oddsColor(wager.over.odds)}`}>
            {formatOdds(wager.over.odds)}
          </div>
        </button>
        <button
          type="button"
          disabled={!clickable}
          onClick={() => clickable && onOutcomeClick('under', wager.under.odds)}
          className={`rounded-lg border px-4 py-3 text-center transition-colors ${
            isUnderWinner
              ? 'border-green-500 bg-green-50'
              : clickable
              ? 'border-gray-200 bg-gray-50 cursor-pointer hover:border-field hover:bg-field/5'
              : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">Under</div>
          <div className={`font-mono text-xl font-bold ${isUnderWinner ? 'text-green-600' : oddsColor(wager.under.odds)}`}>
            {formatOdds(wager.under.odds)}
          </div>
        </button>
      </div>
    </div>
  );
}
