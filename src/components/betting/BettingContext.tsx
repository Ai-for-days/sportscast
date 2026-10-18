import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface GameWithOdds {
  id: string;
  description: string;
  startTime: number;
  startTimeISO: string;
  live: boolean;
  moneyline?: { away: number; home: number };
  spread?: { away: { point: number; price: number }; home: { point: number; price: number } };
  total?: { point: number; over: number; under: number };
}

export interface BetLeg {
  gameId: string;
  gameDescription: string;
  oddsType: 'moneyline' | 'spread' | 'total';
  side: 'away' | 'home' | 'over' | 'under';
  odds: number;
  line?: number;
}

export interface BettingContextType {
  // Games & Sport
  selectedSport: string;
  setSelectedSport: (sport: string) => void;
  games: GameWithOdds[];
  gamesLoading: boolean;
  gamesError: string | null;

  // Bet Slip
  betLegs: BetLeg[];
  addLeg: (leg: BetLeg) => void;
  removeLeg: (index: number) => void;
  clearSlip: () => void;

  // Stake & Calculation
  stake: string;
  setStake: (stake: string) => void;
  expectedPayout: number;

  // Balance
  balance: number | null;
  balanceLoading: boolean;

  // Betting
  placeBet: () => Promise<void>;
  loading: boolean;
  error: string | null;
  success: string | null;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
}

const BettingContext = createContext<BettingContextType | null>(null);

export function BettingSidebarProvider({ children }: { children: ReactNode }) {
  const [selectedSport, setSelectedSport] = useState('football/nfl');
  const [games, setGames] = useState<GameWithOdds[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState<string | null>(null);

  const [betLegs, setBetLegs] = useState<BetLeg[]>([]);
  const [stake, setStake] = useState('10');

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch balance on mount and poll every 5 seconds
  useEffect(() => {
    const fetchBalance = async () => {
      setBalanceLoading(true);
      try {
        const res = await fetch('/api/account/balance');
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balanceDollars);
        } else if (res.status === 401) {
          setError('Please log in to place bets');
        }
      } catch (err: any) {
        console.error('Balance fetch error:', err);
      } finally {
        setBalanceLoading(false);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch games when sport changes
  useEffect(() => {
    const fetchGames = async () => {
      setGamesLoading(true);
      setGamesError(null);
      try {
        const res = await fetch(`/api/sportsbook/games?sport=${encodeURIComponent(selectedSport)}`);
        if (res.ok) {
          const data = await res.json();
          setGames(data.games || []);
        } else {
          const data = await res.json();
          setGamesError(data.error || 'Failed to load games');
          setGames([]);
        }
      } catch (err: any) {
        console.error('Games fetch error:', err);
        setGamesError('Unable to connect to sportsbook');
        setGames([]);
      } finally {
        setGamesLoading(false);
      }
    };

    fetchGames();
  }, [selectedSport]);

  const addLeg = (leg: BetLeg) => {
    setBetLegs([...betLegs, leg]);
    setError(null);
  };

  const removeLeg = (index: number) => {
    setBetLegs(betLegs.filter((_, i) => i !== index));
  };

  const clearSlip = () => {
    setBetLegs([]);
    setStake('10');
    setError(null);
    setSuccess(null);
  };

  const calculateExpectedPayout = (): number => {
    if (betLegs.length === 0 || !stake) return 0;
    let decimal = 1.0;
    for (const leg of betLegs) {
      decimal *= leg.odds > 0 ? 1 + leg.odds / 100 : 1 + 100 / Math.abs(leg.odds);
    }
    return parseFloat(parseFloat(stake) * (decimal - 1).toFixed(2));
  };

  const placeBet = async () => {
    if (betLegs.length === 0) {
      setError('Add at least one bet leg');
      return;
    }

    const stakeNum = parseFloat(stake);
    if (!stakeNum || stakeNum <= 0) {
      setError('Enter a valid stake');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/bets/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legs: betLegs, stake: stakeNum }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to place bet');
        return;
      }

      const data = await res.json();
      setSuccess(`Bet placed! #${data.bet.id}`);
      setBalance(data.newBalance);
      clearSlip();

      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) {
      setError(err?.message || 'Error placing bet');
    } finally {
      setLoading(false);
    }
  };

  const value: BettingContextType = {
    selectedSport,
    setSelectedSport,
    games,
    gamesLoading,
    gamesError,
    betLegs,
    addLeg,
    removeLeg,
    clearSlip,
    stake,
    setStake,
    expectedPayout: calculateExpectedPayout(),
    balance,
    balanceLoading,
    placeBet,
    loading,
    error,
    success,
    setError,
    setSuccess,
  };

  return <BettingContext.Provider value={value}>{children}</BettingContext.Provider>;
}

export function useBetting(): BettingContextType {
  const context = useContext(BettingContext);
  if (!context) {
    throw new Error('useBetting must be used inside BettingSidebarProvider');
  }
  return context;
}
