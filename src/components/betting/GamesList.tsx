import { useBetting, type GameWithOdds } from './BettingContext';

function formatTime(ms: number) {
  const date = new Date(ms);
  return date.toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatOdds(odds: number) {
  if (odds === 0) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function GameCard({ game }: { game: GameWithOdds }) {
  const { betLegs, addLeg, setError } = useBetting();

  const handleAddLeg = (type: 'moneyline' | 'spread' | 'total', side: 'away' | 'home' | 'over' | 'under') => {
    const odds = game[type]?.[side]?.price || game[type]?.[side] || 0;
    const line = game[type]?.[side]?.point;

    if (odds === 0 || !odds) {
      setError('This odds option is not available');
      return;
    }

    const leg = {
      gameId: game.id,
      gameDescription: game.description,
      oddsType: type,
      side,
      odds,
      ...(line !== undefined && { line }),
    };

    addLeg(leg);
  };

  return (
    <div className="rounded border border-border-dark/30 bg-surface-dark p-2 dark:bg-surface-dark-alt">
      <p className="truncate text-xs font-semibold text-text-dark">{game.description}</p>
      <p className="text-[10px] text-text-dark-muted">{formatTime(game.startTime)}</p>

      <div className="mt-2 space-y-1">
        {/* Moneyline */}
        {game.moneyline && (
          <div className="flex gap-1">
            <button
              onClick={() => handleAddLeg('moneyline', 'away')}
              className="flex-1 rounded bg-slate-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-600"
            >
              ML {formatOdds(game.moneyline.away)}
            </button>
            <button
              onClick={() => handleAddLeg('moneyline', 'home')}
              className="flex-1 rounded bg-slate-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-600"
            >
              ML {formatOdds(game.moneyline.home)}
            </button>
          </div>
        )}

        {/* Spread */}
        {game.spread && (
          <div className="flex gap-1">
            <button
              onClick={() => handleAddLeg('spread', 'away')}
              className="flex-1 rounded bg-blue-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-blue-600"
            >
              {game.spread.away.point > 0 ? '+' : ''}{game.spread.away.point} ({formatOdds(game.spread.away.price)})
            </button>
            <button
              onClick={() => handleAddLeg('spread', 'home')}
              className="flex-1 rounded bg-blue-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-blue-600"
            >
              {game.spread.home.point > 0 ? '+' : ''}{game.spread.home.point} ({formatOdds(game.spread.home.price)})
            </button>
          </div>
        )}

        {/* Total */}
        {game.total && (
          <div className="flex gap-1">
            <button
              onClick={() => handleAddLeg('total', 'over')}
              className="flex-1 rounded bg-green-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-green-600"
            >
              O {game.total.point} ({formatOdds(game.total.over)})
            </button>
            <button
              onClick={() => handleAddLeg('total', 'under')}
              className="flex-1 rounded bg-green-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-green-600"
            >
              U {game.total.point} ({formatOdds(game.total.under)})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function GamesList() {
  const { games, gamesLoading, gamesError } = useBetting();

  return (
    <div className="mb-4 max-h-96 overflow-y-auto">
      {gamesLoading ? (
        <p className="text-xs text-text-muted dark:text-text-dark-muted">Loading games...</p>
      ) : gamesError && games.length === 0 ? (
        <p className="text-xs text-alert-light">{gamesError}</p>
      ) : games.length === 0 ? (
        <p className="text-xs text-text-muted dark:text-text-dark-muted">No games available</p>
      ) : (
        <div className="space-y-3">
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  );
}
