import { useEffect, useState } from 'react';
import { useBetting } from './BettingContext';

interface Sport {
  name: string;
  path: string;
  icon?: string;
}

export function SportSelector() {
  const { selectedSport, setSelectedSport } = useBetting();
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSports = async () => {
      try {
        const res = await fetch('/api/sportsbook/sports');
        if (res.ok) {
          const data = await res.json();
          setSports(data);
          // Set first sport as default if not already selected
          if (data.length > 0 && selectedSport === 'football/nfl') {
            setSelectedSport(data[0].path);
          }
        }
      } catch (err) {
        console.error('Failed to fetch sports:', err);
        // Fallback to basic sports
        setSports([
          { name: 'NFL', path: 'football/nfl' },
          { name: 'College Football', path: 'football/college-football' },
          { name: 'MLB', path: 'baseball/mlb' },
          { name: 'MLS', path: 'soccer/north-america/united-states/mls' },
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchSports();
  }, []);

  if (loading) {
    return <div className="text-xs text-text-muted dark:text-text-dark-muted">Loading sports...</div>;
  }

  return (
    <select
      value={selectedSport}
      onChange={(e) => setSelectedSport(e.target.value)}
      className="w-full rounded border border-border bg-surface px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark"
    >
      {sports.map((s) => (
        <option key={s.path} value={s.path}>
          {s.icon ? `${s.icon} ` : ''}{s.name}
        </option>
      ))}
    </select>
  );
}
