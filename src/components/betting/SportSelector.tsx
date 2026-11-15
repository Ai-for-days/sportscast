import { useEffect } from 'react';
import { useBetting } from './BettingContext';
import { SIDEBAR_SPORTS } from '../../lib/sportsbook-sports';

// Every sport, straight from the shared list (fed sports first). This used to
// fetch /api/sportsbook/sports (which serves the same list) and, if that call
// failed, fell back to a hard-coded four, so the dropdown could show only
// NFL, College Football, MLB and MLS. Reading the list directly means it is
// always complete and never waits on the network.
export function SportSelector() {
  const { selectedSport, setSelectedSport } = useBetting();

  // If the current pick is not offered, switch to the first sport so the
  // dropdown label and the games below always match.
  useEffect(() => {
    if (!SIDEBAR_SPORTS.some((s) => s.path === selectedSport)) setSelectedSport(SIDEBAR_SPORTS[0].path);
  }, [selectedSport, setSelectedSport]);

  return (
    <select
      value={selectedSport}
      onChange={(e) => setSelectedSport(e.target.value)}
      aria-label="Sport"
      className="w-full rounded border border-border bg-surface px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark"
    >
      {SIDEBAR_SPORTS.map((s) => (
        <option key={s.path} value={s.path}>
          {s.icon ? `${s.icon} ` : ''}{s.name}{s.league === null ? ' (no odds yet)' : ''}
        </option>
      ))}
    </select>
  );
}
