import { useState, useMemo } from 'react';
import type { Market } from '../betting/BettingContext';
import { sideMarketGroups, type SideMarket, type SideOutcome } from '../../lib/sidebar-markets';

interface MarketSelectorProps {
  allMarkets?: Record<string, Market[]>;
  onSelectMarket: (market: SideMarket, outcome: SideOutcome) => void;
  gameDescription: string;
}

export function MarketSelector({ allMarkets, onSelectMarket }: MarketSelectorProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string | null>(null);
  const [groupKey, setGroupKey] = useState<string | null>(null);

  const groups = useMemo(() => sideMarketGroups(allMarkets as any), [allMarkets]);
  if (groups.length === 0) return null;
  const active = groupKey ?? groups[0].key;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1">
        {groups.map((group) => (
          <button
            key={group.key}
            onClick={() => { setGroupKey(group.key); setOpenId(null); }}
            className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              active === group.key
                ? 'bg-field text-white dark:bg-field-light dark:text-field'
                : 'border border-border bg-surface text-text hover:bg-surface-alt dark:border-border-dark dark:bg-surface-dark-alt dark:text-text-dark dark:hover:bg-border-dark'
            }`}
          >
            {group.name} <span className="opacity-70">({group.markets.length})</span>
          </button>
        ))}
      </div>

      <div className="rounded border border-border bg-surface dark:border-border-dark dark:bg-surface-dark-alt">
        {groups.filter((g) => g.key === active).map((group) =>
          group.markets.map((market) => {
            const open = openId === market.id;
            return (
              <div key={market.id} className="border-b border-border last:border-b-0 dark:border-border-dark">
                <button
                  onClick={() => setOpenId(open ? null : market.id)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface-alt dark:hover:bg-border-dark"
                >
                  <span className="font-semibold text-text dark:text-text-dark">{market.title}</span>
                  <span className="shrink-0 text-[10px] text-text-muted dark:text-text-dark-muted">
                    {market.outcomes.length} {open ? '▲' : '▼'}
                  </span>
                </button>
                {open && (
                  <div className="grid grid-cols-1 gap-1 px-2 pb-2">
                    {market.outcomes.map((outcome) => (
                      <button
                        key={outcome.id}
                        onClick={() => { setSelectedOutcomeId(outcome.id); onSelectMarket(market, outcome); }}
                        className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-left text-xs transition-colors ${
                          selectedOutcomeId === outcome.id
                            ? 'border-field bg-field/15 text-field dark:border-field-light dark:bg-field-light/20 dark:text-field-light'
                            : 'border-border text-text hover:bg-surface-alt dark:border-border-dark dark:text-text-dark dark:hover:bg-border-dark'
                        }`}
                      >
                        <span className="font-medium">{outcome.label}</span>
                        <span className="shrink-0 font-mono font-semibold">{outcome.price}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
