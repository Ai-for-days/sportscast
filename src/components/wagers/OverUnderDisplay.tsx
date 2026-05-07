import type { PublicWagerView } from '../../lib/public-wager-view';

interface Props {
  wager: PublicWagerView;
  bettable?: boolean;
  onOutcomeClick?: (outcomeLabel: string, odds: number) => void;
}

function formatOdds(odds: number | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function oddsColor(odds: number | undefined): string {
  if (odds == null) return 'text-gray-500';
  return odds > 0 ? 'text-green-600' : 'text-red-600';
}

export default function OverUnderDisplay({ wager, bettable, onOutcomeClick }: Props) {
  const overOdds = wager.outcomes.find(o => o.label.toLowerCase() === 'over')?.displayedOdds;
  const underOdds = wager.outcomes.find(o => o.label.toLowerCase() === 'under')?.displayedOdds;
  const isOverWinner = wager.status === 'graded' && wager.winningOutcome === 'over';
  const isUnderWinner = wager.status === 'graded' && wager.winningOutcome === 'under';
  const overClickable = bettable && !!onOutcomeClick && typeof overOdds === 'number';
  const underClickable = bettable && !!onOutcomeClick && typeof underOdds === 'number';

  return (
    <div className="space-y-3">
      {wager.line != null && (
        <div className="text-center">
          <span className="font-mono text-2xl font-bold text-gray-900">{wager.line}</span>
          <span className="ml-1 text-xs text-gray-500">line</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={!overClickable}
          onClick={() => {
            if (overClickable && typeof overOdds === 'number') onOutcomeClick!('over', overOdds);
          }}
          className={`rounded-lg border px-4 py-3 text-center transition-colors ${
            isOverWinner
              ? 'border-green-500 bg-green-50'
              : overClickable
              ? 'border-gray-200 bg-gray-50 cursor-pointer hover:border-field hover:bg-field/5'
              : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">Over</div>
          <div className={`font-mono text-xl font-bold ${isOverWinner ? 'text-green-600' : oddsColor(overOdds)}`}>
            {formatOdds(overOdds)}
          </div>
        </button>
        <button
          type="button"
          disabled={!underClickable}
          onClick={() => {
            if (underClickable && typeof underOdds === 'number') onOutcomeClick!('under', underOdds);
          }}
          className={`rounded-lg border px-4 py-3 text-center transition-colors ${
            isUnderWinner
              ? 'border-green-500 bg-green-50'
              : underClickable
              ? 'border-gray-200 bg-gray-50 cursor-pointer hover:border-field hover:bg-field/5'
              : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">Under</div>
          <div className={`font-mono text-xl font-bold ${isUnderWinner ? 'text-green-600' : oddsColor(underOdds)}`}>
            {formatOdds(underOdds)}
          </div>
        </button>
      </div>
    </div>
  );
}
