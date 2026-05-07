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

function formatSpread(spread: number): string {
  return spread > 0 ? `+${spread}` : `${spread}`;
}

function oddsColor(odds: number | undefined): string {
  if (odds == null) return 'text-gray-500';
  return odds > 0 ? 'text-green-600' : 'text-red-600';
}

export default function PointspreadDisplay({ wager, bettable, onOutcomeClick }: Props) {
  const isAWinner = wager.status === 'graded' && wager.winningOutcome === 'locationA';
  const isBWinner = wager.status === 'graded' && wager.winningOutcome === 'locationB';

  // Public outcomes[] for pointspread is built as [A, B] in toPublicWagerView.
  const aOutcome = wager.outcomes[0];
  const bOutcome = wager.outcomes[1];
  const aOdds = aOutcome?.displayedOdds;
  const bOdds = bOutcome?.displayedOdds;
  const aName = wager.locationAName ?? aOutcome?.label ?? 'A';
  const bName = wager.locationBName ?? bOutcome?.label ?? 'B';

  const spread = wager.spread;
  const spreadA = spread == null ? '—' : (spread === 0 ? 'Even' : formatSpread(spread));
  const spreadB = spread == null ? '—' : (spread === 0 ? 'Even' : formatSpread(-spread));

  const aClickable = bettable && !!onOutcomeClick && typeof aOdds === 'number';
  const bClickable = bettable && !!onOutcomeClick && typeof bOdds === 'number';

  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        disabled={!aClickable}
        onClick={() => {
          if (aClickable && typeof aOdds === 'number') onOutcomeClick!('locationA', aOdds);
        }}
        className={`rounded-lg border px-4 py-3 text-center transition-colors ${
          isAWinner
            ? 'border-green-500 bg-green-50'
            : aClickable
            ? 'border-gray-200 bg-gray-50 cursor-pointer hover:border-field hover:bg-field/5'
            : 'border-gray-200 bg-gray-50'
        }`}
      >
        <div className="text-xs text-gray-500 truncate" title={aName}>
          {aName}
        </div>
        <div className={`font-mono text-xl font-bold ${isAWinner ? 'text-green-600' : oddsColor(aOdds)}`}>
          {formatOdds(aOdds)}
        </div>
        <div className="text-xs text-gray-400 font-mono">({spreadA})</div>
        {wager.status === 'graded' && wager.observedValueA != null && (
          <div className="mt-1 text-xs text-gray-500">Actual: {Math.round(wager.observedValueA)}</div>
        )}
      </button>
      <button
        type="button"
        disabled={!bClickable}
        onClick={() => {
          if (bClickable && typeof bOdds === 'number') onOutcomeClick!('locationB', bOdds);
        }}
        className={`rounded-lg border px-4 py-3 text-center transition-colors ${
          isBWinner
            ? 'border-green-500 bg-green-50'
            : bClickable
            ? 'border-gray-200 bg-gray-50 cursor-pointer hover:border-field hover:bg-field/5'
            : 'border-gray-200 bg-gray-50'
        }`}
      >
        <div className="text-xs text-gray-500 truncate" title={bName}>
          {bName}
        </div>
        <div className={`font-mono text-xl font-bold ${isBWinner ? 'text-green-600' : oddsColor(bOdds)}`}>
          {formatOdds(bOdds)}
        </div>
        <div className="text-xs text-gray-400 font-mono">({spreadB})</div>
        {wager.status === 'graded' && wager.observedValueB != null && (
          <div className="mt-1 text-xs text-gray-500">Actual: {Math.round(wager.observedValueB)}</div>
        )}
      </button>
    </div>
  );
}
