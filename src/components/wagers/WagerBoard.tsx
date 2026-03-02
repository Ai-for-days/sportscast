import { useState, useEffect } from 'react';
import type { Wager, WagerStatus } from '../../lib/wager-types';
import WagerCard from './WagerCard';
import WagerFilters from './WagerFilters';
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

export default function WagerBoard() {
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [filter, setFilter] = useState<WagerStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [betSelection, setBetSelection] = useState<BetSelection | null>(null);

  // Fetch user auth state
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(data => setUser(data.user || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const fetchWagers = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (filter !== 'all') params.set('status', filter);
        params.set('limit', '50');

        const res = await fetch(`/api/wagers?${params}`);
        if (!res.ok) throw new Error('Failed to load wagers');
        const data = await res.json();
        setWagers(data.wagers || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchWagers();
  }, [filter]);

  const handleOutcomeClick = (wagerId: string, wagerTitle: string, outcomeLabel: string, odds: number) => {
    if (!user) {
      window.location.href = '/login';
      return;
    }
    setBetSelection({ wagerId, wagerTitle, outcomeLabel, odds });
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <WagerFilters active={filter} onChange={setFilter} />
        <div className="text-sm text-text-dark-muted">
          {!loading && `${wagers.length} wager${wagers.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-field/20 border-t-field" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-alert/30 bg-alert/5 px-6 py-4 text-center">
          <p className="text-sm text-alert-light">{error}</p>
          <button
            onClick={() => setFilter(filter)}
            className="mt-2 text-sm font-medium text-field-light hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && wagers.length === 0 && (
        <div className="rounded-xl border border-border-dark bg-surface-dark-alt px-6 py-16 text-center">
          <div className="text-4xl">&#x1F3B2;</div>
          <h3 className="mt-3 text-lg font-semibold text-text-dark">No wagers yet</h3>
          <p className="mt-1 text-sm text-text-dark-muted">
            {filter === 'all'
              ? 'Check back soon for weather wagers!'
              : `No ${filter} wagers right now.`}
          </p>
        </div>
      )}

      {/* Wager cards */}
      {!loading && !error && wagers.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {wagers.map(wager => (
            <WagerCard
              key={wager.id}
              wager={wager}
              user={user}
              onOutcomeClick={handleOutcomeClick}
            />
          ))}
        </div>
      )}

      {/* Bet slip modal */}
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
