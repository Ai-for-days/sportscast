import { useState, useMemo } from 'react';
import type { Market } from '../betting/BettingContext';

interface MarketGroup {
  key: string;
  name: string;
  markets: Market[];
}

interface MarketSelectorProps {
  allMarkets?: Record<string, Market[]>;
  onSelectMarket: (market: Market, outcome: any) => void;
  gameDescription: string;
}

const MARKET_DISPLAY_NAMES: Record<string, string> = {
  '2W-12': 'Moneyline',
  '1X2': 'Match Result',
  '2W-HCAP': 'Spread',
  '2W-OU': 'Over/Under',
  'PLAYER_PASS_YARDS': 'Passing Yards',
  'PLAYER_RUSH_YARDS': 'Rushing Yards',
  'PLAYER_RECEPTIONS': 'Receptions',
  'PLAYER_REC_YARDS': 'Receiving Yards',
  'PLAYER_TD': 'Player TD',
  'TEAM_TOTAL': 'Team Total',
  'ALT_SPREAD': 'Alternate Spread',
  'ALT_TOTAL': 'Alternate Total',
  'FIRST_DRIVE': 'First Drive',
  'QUARTER': 'Quarter Bet',
  'HALF': 'Half Bet',
  'HALFTIME': 'Halftime',
};

function getMarketCategory(key: string): string {
  if (['2W-12', '1X2', '2W-HCAP', '2W-OU'].includes(key)) return 'Main Lines';
  if (key.startsWith('PLAYER_') || key.includes('PASS_YARDS') || key.includes('RUSH_YARDS') || key.includes('REC')) return 'Player Props';
  if (key.includes('ALT_')) return 'Alternate Lines';
  if (key.includes('TEAM_') || key.includes('TOTAL')) return 'Team Props';
  if (['FIRST_DRIVE', 'QUARTER', 'HALF', 'HALFTIME'].includes(key)) return 'Game Props';
  return 'Other';
}

export function MarketSelector({ allMarkets, onSelectMarket, gameDescription }: MarketSelectorProps) {
  const [selectedMarketKey, setSelectedMarketKey] = useState<string | null>(null);
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string | null>(null);

  const groups = useMemo((): MarketGroup[] => {
    if (!allMarkets || Object.keys(allMarkets).length === 0) return [];

    const grouped = new Map<string, Market[]>();

    Object.entries(allMarkets).forEach(([key, markets]) => {
      const category = getMarketCategory(key);
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(...markets);
    });

    return Array.from(grouped.entries()).map(([name, markets]) => ({
      key: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      markets,
    }));
  }, [allMarkets]);

  if (!allMarkets || Object.keys(allMarkets).length === 0) {
    return null;
  }

  const selectedMarket = selectedMarketKey
    ? Object.values(allMarkets).flat().find(m => m.key === selectedMarketKey)
    : null;

  return (
    <div className="mt-4 space-y-3">
      <div className="text-xs font-semibold uppercase text-text dark:text-text-dark">
        Available Markets
      </div>

      {/* Market Type Tabs */}
      <div className="flex flex-wrap gap-2">
        {groups.map(group => (
          <button
            key={group.key}
            onClick={() => {
              setSelectedMarketKey(null);
              setSelectedOutcomeId(null);
            }}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              selectedMarketKey?.startsWith(group.key)
                ? 'bg-field text-white dark:bg-field-light dark:text-field'
                : 'bg-surface-dark text-text-muted hover:bg-border dark:bg-surface-dark-alt dark:text-text-dark-muted dark:hover:bg-border-dark'
            }`}
          >
            {group.name}
          </button>
        ))}
      </div>

      {/* Market List */}
      <div className="space-y-2 max-h-64 overflow-y-auto rounded border border-border bg-surface-dark p-3 dark:border-border-dark dark:bg-surface-dark-alt">
        {groups.map(group =>
          group.markets.slice(0, 5).map(market => (
            <div key={market.key} className="border-b border-border last:border-b-0 pb-2 last:pb-0 dark:border-border-dark">
              <button
                onClick={() => setSelectedMarketKey(market.key)}
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-border dark:hover:bg-border-dark transition-colors"
              >
                <div className="font-semibold text-text dark:text-text-dark">
                  {MARKET_DISPLAY_NAMES[market.key] || market.description}
                </div>
              </button>

              {/* Outcomes for Selected Market */}
              {selectedMarketKey === market.key && (
                <div className="ml-2 mt-2 space-y-1">
                  {market.outcomes.map(outcome => (
                    <button
                      key={outcome.id}
                      onClick={() => {
                        setSelectedOutcomeId(outcome.id);
                        onSelectMarket(market, outcome);
                      }}
                      className={`block w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                        selectedOutcomeId === outcome.id
                          ? 'bg-field/20 text-field dark:bg-field-light/20 dark:text-field-light'
                          : 'text-text-muted hover:bg-surface dark:text-text-dark-muted dark:hover:bg-surface'
                      }`}
                    >
                      <span className="font-medium">{outcome.description}</span>
                      {outcome.american && (
                        <span className="ml-2 text-xs text-text-muted dark:text-text-dark-muted">
                          {outcome.american}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
