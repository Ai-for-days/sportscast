import { useState, useEffect } from 'react';
import type { Wager } from '../../lib/wager-types';
import WagerCard from './WagerCard';
import BetSlip from './BetSlip';

interface UserInfo {
  id: string;
  email: string;
  displayName: string;
}

interface BetSelection {
  wagerId: string;
  wagerTitle: string;
  outcomeLabel: string;
  odds: number;
}

interface Props {
  cityName: string; // e.g. "Seattle, WA" or "Columbia, SC"
}

function getLocationCity(wager: Wager): string {
  if (wager.kind === 'pointspread') {
    return `${wager.locationA.name}|${wager.locationB.name}`;
  }
  return wager.location.name;
}

function matchesCity(wager: Wager, cityName: string): boolean {
  const target = cityName.toLowerCase();
  const wagerLoc = getLocationCity(wager).toLowerCase();
  // Match if the wager location contains the city name or vice versa
  return wagerLoc.includes(target) || target.includes(wagerLoc.split(',')[0]);
}

export default function ForecastWagers({ cityName }: Props) {
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [betSelection, setBetSelection] = useState<BetSelection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/wagers?status=open&limit=50').then(r => r.json()),
      fetch('/api/auth/me').then(r => r.json()),
    ]).then(([wagerData, meData]) => {
      const allOpen: Wager[] = wagerData.wagers || [];
      // Filter to wagers matching this city
      const matching = allOpen.filter(w => matchesCity(w, cityName));
      setWagers(matching);
      setUser(meData.user || null);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [cityName]);

  if (loading || wagers.length === 0) return null;

  const handleOutcomeClick = (wagerId: string, wagerTitle: string, outcomeLabel: string, odds: number) => {
    if (!user) {
      window.location.href = '/login';
      return;
    }
    setBetSelection({ wagerId, wagerTitle, outcomeLabel, odds });
  };

  return (
    <div className="rounded-xl border border-field/30 bg-field/5 p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">&#127922;</span>
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">
          Bet on {cityName.split(',')[0]} Weather
        </h3>
      </div>
      <p className="mb-4 text-sm text-text-muted dark:text-text-dark-muted">
        {wagers.length} open wager{wagers.length !== 1 ? 's' : ''} for this location. Click an outcome to place a bet.
      </p>
      <div className="grid gap-3">
        {wagers.map(wager => (
          <WagerCard
            key={wager.id}
            wager={wager}
            user={user}
            onOutcomeClick={handleOutcomeClick}
          />
        ))}
      </div>

      {!user && (
        <div className="mt-3 text-center">
          <a href="/signup" className="text-sm font-medium text-field-light hover:underline">
            Sign up to place bets
          </a>
        </div>
      )}

      {betSelection && (
        <BetSlip
          wagerId={betSelection.wagerId}
          wagerTitle={betSelection.wagerTitle}
          outcomeLabel={betSelection.outcomeLabel}
          odds={betSelection.odds}
          onClose={() => setBetSelection(null)}
          onBetPlaced={() => setBetSelection(null)}
        />
      )}
    </div>
  );
}
