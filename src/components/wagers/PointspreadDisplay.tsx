import type { PointspreadWager } from '../../lib/wager-types';

interface Props {
  wager: PointspreadWager;
  bettable?: boolean;
  onOutcomeClick?: (outcomeLabel: string, odds: number) => void;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatSpread(spread: number): string {
  return spread > 0 ? `+${spread}` : `${spread}`;
}

function oddsColor(odds: number): string {
  return odds > 0 ? 'text-green-600' : 'text-red-600';
}

export default function PointspreadDisplay({ wager, bettable, onOutcomeClick }: Props) {
  const isAWinner = wager.status === 'graded' && wager.winningOutcome === 'locationA';
  const isBWinner = wager.status === 'graded' && wager.winningOutcome === 'locationB';
  const clickable = bettable && onOutcomeClick;

  const spreadA = wager.spread === 0 ? 'Even' : formatSpread(wager.spread);
  const spreadB = wager.spread === 0 ? 'Even' : formatSpread(-wager.spread);

  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        disabled={!clickable}
        onClick={() => clickable && onOutcomeClick('locationA', wager.locationAOdds)}
        className={`rounded-lg border px-4 py-3 text-center transition-colors ${
          isAWinner
            ? 'border-green-500 bg-green-50'
            : clickable
            ? 'border-gray-200 bg-gray-50 cursor-pointer hover:border-field hover:bg-field/5'
            : 'border-gray-200 bg-gray-50'
        }`}
      >
        <div className="text-xs text-gray-500 truncate" title={wager.locationA.name}>
          {wager.locationA.name}
        </div>
        <div className={`font-mono text-xl font-bold ${isAWinner ? 'text-green-600' : oddsColor(wager.locationAOdds)}`}>
          {formatOdds(wager.locationAOdds)}
        </div>
        <div className="text-xs text-gray-400 font-mono">({spreadA})</div>
        {wager.status === 'graded' && wager.observedValueA != null && (
          <div className="mt-1 text-xs text-gray-500">Actual: {Math.round(wager.observedValueA)}</div>
        )}
      </button>
      <button
        type="button"
        disabled={!clickable}
        onClick={() => clickable && onOutcomeClick('locationB', wager.locationBOdds)}
        className={`rounded-lg border px-4 py-3 text-center transition-colors ${
          isBWinner
            ? 'border-green-500 bg-green-50'
            : clickable
            ? 'border-gray-200 bg-gray-50 cursor-pointer hover:border-field hover:bg-field/5'
            : 'border-gray-200 bg-gray-50'
        }`}
      >
        <div className="text-xs text-gray-500 truncate" title={wager.locationB.name}>
          {wager.locationB.name}
        </div>
        <div className={`font-mono text-xl font-bold ${isBWinner ? 'text-green-600' : oddsColor(wager.locationBOdds)}`}>
          {formatOdds(wager.locationBOdds)}
        </div>
        <div className="text-xs text-gray-400 font-mono">({spreadB})</div>
        {wager.status === 'graded' && wager.observedValueB != null && (
          <div className="mt-1 text-xs text-gray-500">Actual: {Math.round(wager.observedValueB)}</div>
        )}
      </button>
    </div>
  );
}
