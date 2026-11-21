import { SPORTSBOOK_BETTING_OPEN } from '../../lib/practice-only';
import { GRADING_NOTE } from '../../lib/public-odds';
import { useState } from 'react';
import { useBetting, type GameWithOdds } from './BettingContext';
import { MarketSelector } from './MarketSelector';
import { sortByStart } from '../../lib/sidebar-order';
import { splitTeams, signed, type SideMarket, type SideOutcome } from '../../lib/sidebar-markets';

function formatTime(ms: number) {
  const date = new Date(ms);
  return date.toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatOdds(odds: number) {
  if (odds === 0) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function OddsButton({ show, onClick, top, price }: { show: boolean; onClick: () => void; top: string; price: number | null }) {
  if (!show) return <span className="text-center text-text-muted dark:text-text-dark-muted">—</span>;
  return (
    <button
      onClick={onClick}
      className="rounded border border-border bg-surface px-1 py-1 text-center leading-tight text-text hover:border-field hover:bg-field/10 dark:border-border-dark dark:bg-surface-dark-alt dark:text-text-dark dark:hover:border-field-light"
    >
      <span className="block font-semibold">{top}</span>
      {price !== null && <span className="block text-[10px] text-text-muted dark:text-text-dark-muted">{formatOdds(price)}</span>}
    </button>
  );
}

function GameCard({ game }: { game: GameWithOdds }) {
  const { betLegs, addLeg, setError } = useBetting();
  const [expanded, setExpanded] = useState(false);

  const handleAddLeg = (type: 'moneyline' | 'spread' | 'total', side: 'away' | 'home' | 'over' | 'under') => {
    // Paused until results grading is live (WOW-039 A): show the note, add nothing.
    if (!SPORTSBOOK_BETTING_OPEN) {
      setError(GRADING_NOTE);
      return;
    }
    // Get odds and line based on type
    let odds = 0;
    let line: number | undefined;

    if (type === 'moneyline' && game.moneyline) {
      const ml = game.moneyline[side as 'away' | 'home'];
      odds = ml;
    } else if (type === 'spread' && game.spread) {
      const sp = game.spread[side as 'away' | 'home'];
      odds = sp.price;
      line = sp.point;
    } else if (type === 'total' && game.total) {
      const tot = game.total[side as 'over' | 'under'];
      odds = tot;
      line = game.total.point;
    }

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

  const handlePropMarketSelect = (market: SideMarket, outcome: SideOutcome) => {
    if (!SPORTSBOOK_BETTING_OPEN) {
      setError(GRADING_NOTE);
      return;
    }
    const price = outcome.price.toUpperCase() === 'EVEN' ? '100' : outcome.price;
    const odds = parseInt(price, 10) || 0;
    if (odds === 0 || !odds) {
      setError('This odds option is not available');
      return;
    }

    const leg = {
      gameId: game.id,
      gameDescription: game.description,
      oddsType: 'prop' as const,
      marketKey: market.key,
      marketDescription: market.title,
      outcomeId: outcome.id,
      outcomeDescription: outcome.label,
      odds,
      ...(outcome.raw.handicap && { line: parseFloat(outcome.raw.handicap) }),
    };

    addLeg(leg);
  };

  const teams = splitTeams(game.description);
  const teamName = (side: 'away' | 'home') => (teams ? teams[side] : side === 'away' ? 'Away' : 'Home');

  return (
    <div className="rounded border border-border bg-surface-alt p-2 dark:border-border-dark dark:bg-surface-dark">
      <p className="truncate text-xs font-semibold text-text dark:text-text-dark" title={game.description}>
        {teams ? `${teams.away} at ${teams.home}` : game.description}
      </p>
      <p className="text-[10px] text-text-muted dark:text-text-dark-muted">
        {game.score
          ? <span className={game.score.state === 'in' ? 'font-semibold text-red-600 dark:text-red-400' : 'font-semibold'}>{game.score.detail}</span>
          : formatTime(game.startTime)}
        {game.score?.state === 'post' && <span> · closing line</span>}
      </p>

      {(game.moneyline || game.spread || game.total) && (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_repeat(3,4rem)] items-center gap-1 text-[11px]">
          <span />
          <span className="text-center text-[10px] font-semibold uppercase text-text-muted dark:text-text-dark-muted">Spread</span>
          <span className="text-center text-[10px] font-semibold uppercase text-text-muted dark:text-text-dark-muted">Total</span>
          <span className="text-center text-[10px] font-semibold uppercase text-text-muted dark:text-text-dark-muted">Money</span>
          {(['away', 'home'] as const).map((side) => {
            const rot = side === 'away' ? game.awayRotation : game.homeRotation;
            const ou = side === 'away' ? 'over' : 'under';
            return [
              <span key={`${side}-n`} className="flex min-w-0 items-center gap-1 font-semibold text-text dark:text-text-dark" title={teamName(side)}>
                <span className="truncate">
                  {rot ? <span className="mr-1 font-mono font-normal text-text-muted dark:text-text-dark-muted">{rot}</span> : null}
                  {teamName(side)}
                </span>
                {game.score && game.score[side] !== null && (
                  <span className="ml-auto shrink-0 font-mono font-bold">{game.score[side]}</span>
                )}
              </span>,
              <OddsButton key={`${side}-s`} show={!!game.spread} onClick={() => handleAddLeg('spread', side)}
                top={game.spread ? signed(game.spread[side].point) : ''} price={game.spread ? game.spread[side].price : 0} />,
              <OddsButton key={`${side}-t`} show={!!game.total} onClick={() => handleAddLeg('total', ou)}
                top={game.total ? `${ou === 'over' ? 'O' : 'U'} ${game.total.point}` : ''} price={game.total ? game.total[ou] : 0} />,
              <OddsButton key={`${side}-m`} show={!!game.moneyline} onClick={() => handleAddLeg('moneyline', side)}
                top={game.moneyline ? formatOdds(game.moneyline[side]) : ''} price={null} />,
            ];
          })}
        </div>
      )}

      {!(game.moneyline || game.spread || game.total) && game.score && (
        <p className="mt-1 text-[11px] font-semibold text-text dark:text-text-dark">
          {teamName('away')} {game.score.away ?? '-'}, {teamName('home')} {game.score.home ?? '-'}
        </p>
      )}

      {/* More Markets Button */}
      {game.allMarkets && Object.keys(game.allMarkets).length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 w-full rounded border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-text hover:bg-surface-alt transition-colors dark:border-border-dark dark:bg-surface-dark-alt dark:text-text-dark dark:hover:bg-border-dark"
        >
          {expanded ? '▼ Hide More Markets' : '► Show More Markets'}
        </button>
      )}

      {/* Market Selector for Props & Alternates */}
      {expanded && (
        <MarketSelector
          allMarkets={game.allMarkets}
          onSelectMarket={handlePropMarketSelect}
          gameDescription={game.description}
        />
      )}
    </div>
  );
}

export function GamesList() {
  const { games, gamesLoading, gamesError, sportUnsupported } = useBetting();

  return (
    <div className="mb-4">
      {gamesLoading ? (
        <p className="text-xs text-text-muted dark:text-text-dark-muted">Loading games...</p>
      ) : gamesError && games.length === 0 ? (
        <p className="text-xs text-alert-light">{gamesError}</p>
      ) : sportUnsupported ? (
        <p className="text-xs text-text-muted dark:text-text-dark-muted">No odds posted for this sport yet.</p>
      ) : games.length === 0 ? (
        <p className="text-xs text-text-muted dark:text-text-dark-muted">No games available</p>
      ) : (
        <div className="space-y-3">
          {sortByStart(games).map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  );
}
