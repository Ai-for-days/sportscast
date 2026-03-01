import type { OverUnderWager } from '../../lib/wager-types';

interface Props {
  wager: OverUnderWager;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function oddsColor(odds: number): string {
  return odds > 0 ? 'text-green-400' : 'text-red-400';
}

export default function OverUnderDisplay({ wager }: Props) {
  const isOverWinner = wager.status === 'graded' && wager.winningOutcome === 'over';
  const isUnderWinner = wager.status === 'graded' && wager.winningOutcome === 'under';

  return (
    <div className="space-y-3">
      <div className="text-center">
        <span className="font-mono text-2xl font-bold text-text-dark">{wager.line}</span>
        <span className="ml-1 text-xs text-text-dark-muted">line</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className={`rounded-lg border px-4 py-3 text-center ${
          isOverWinner ? 'border-green-500 bg-green-500/10' : 'border-border-dark bg-surface-dark'
        }`}>
          <div className="text-xs font-medium uppercase tracking-wider text-text-dark-muted">Over</div>
          <div className={`font-mono text-xl font-bold ${isOverWinner ? 'text-green-400' : oddsColor(wager.over.odds)}`}>
            {formatOdds(wager.over.odds)}
          </div>
        </div>
        <div className={`rounded-lg border px-4 py-3 text-center ${
          isUnderWinner ? 'border-green-500 bg-green-500/10' : 'border-border-dark bg-surface-dark'
        }`}>
          <div className="text-xs font-medium uppercase tracking-wider text-text-dark-muted">Under</div>
          <div className={`font-mono text-xl font-bold ${isUnderWinner ? 'text-green-400' : oddsColor(wager.under.odds)}`}>
            {formatOdds(wager.under.odds)}
          </div>
        </div>
      </div>
    </div>
  );
}
