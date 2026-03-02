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
  return odds > 0 ? 'text-green-400' : 'text-red-400';
}

export default function PointspreadDisplay({ wager, bettable, onOutcomeClick }: Props) {
  const isAWinner = wager.status === 'graded' && wager.winningOutcome === 'locationA';
  const isBWinner = wager.status === 'graded' && wager.winningOutcome === 'locationB';
  const clickable = bettable && onOutcomeClick;

  return (
    <div className="space-y-3">
      <div className="text-center">
        <span className="text-xs text-text-dark-muted">Spread</span>
        <span className="ml-2 font-mono text-2xl font-bold text-text-dark">{formatSpread(wager.spread)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={!clickable}
          onClick={() => clickable && onOutcomeClick('locationA', wager.locationAOdds)}
          className={`rounded-lg border px-4 py-3 text-center transition-colors ${
            isAWinner
              ? 'border-green-500 bg-green-500/10'
              : clickable
              ? 'border-border-dark bg-surface-dark cursor-pointer hover:border-field hover:bg-field/5'
              : 'border-border-dark bg-surface-dark'
          }`}
        >
          <div className="text-xs text-text-dark-muted truncate" title={wager.locationA.name}>
            {wager.locationA.name}
          </div>
          <div className={`font-mono text-xl font-bold ${isAWinner ? 'text-green-400' : oddsColor(wager.locationAOdds)}`}>
            {formatOdds(wager.locationAOdds)}
          </div>
          {wager.status === 'graded' && wager.observedValueA != null && (
            <div className="mt-1 text-xs text-text-dark-muted">Actual: {wager.observedValueA}</div>
          )}
        </button>
        <button
          type="button"
          disabled={!clickable}
          onClick={() => clickable && onOutcomeClick('locationB', wager.locationBOdds)}
          className={`rounded-lg border px-4 py-3 text-center transition-colors ${
            isBWinner
              ? 'border-green-500 bg-green-500/10'
              : clickable
              ? 'border-border-dark bg-surface-dark cursor-pointer hover:border-field hover:bg-field/5'
              : 'border-border-dark bg-surface-dark'
          }`}
        >
          <div className="text-xs text-text-dark-muted truncate" title={wager.locationB.name}>
            {wager.locationB.name}
          </div>
          <div className={`font-mono text-xl font-bold ${isBWinner ? 'text-green-400' : oddsColor(wager.locationBOdds)}`}>
            {formatOdds(wager.locationBOdds)}
          </div>
          {wager.status === 'graded' && wager.observedValueB != null && (
            <div className="mt-1 text-xs text-text-dark-muted">Actual: {wager.observedValueB}</div>
          )}
        </button>
      </div>
    </div>
  );
}
