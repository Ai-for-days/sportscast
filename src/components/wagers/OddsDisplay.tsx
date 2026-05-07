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

export default function OddsDisplay({ wager, bettable, onOutcomeClick }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {wager.outcomes.map((outcome, i) => {
        const odds = outcome.displayedOdds;
        const isWinner = !!outcome.isWinner;
        const hasOdds = typeof odds === 'number';
        const clickable = bettable && !!onOutcomeClick && hasOdds;

        return (
          <button
            key={i}
            type="button"
            disabled={!clickable}
            onClick={() => {
              if (clickable && hasOdds) onOutcomeClick!(outcome.label, odds!);
            }}
            className={`rounded-lg border px-3 py-2 text-center transition-colors ${
              isWinner
                ? 'border-green-500 bg-green-50'
                : clickable
                ? 'border-gray-200 bg-gray-50 cursor-pointer hover:border-field hover:bg-field/5'
                : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="text-xs text-gray-500">{outcome.label}</div>
            <div className={`font-mono text-lg font-bold ${isWinner ? 'text-green-600' : oddsColor(odds)}`}>
              {formatOdds(odds)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
