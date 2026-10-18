import { useBetting } from './BettingContext';

const sports = [
  { label: 'NFL', value: 'football/nfl' },
  { label: 'College Football', value: 'football/college-football' },
  { label: 'MLB', value: 'baseball/mlb' },
  { label: 'MLS', value: 'soccer/north-america/united-states/mls' },
];

export function SportSelector() {
  const { selectedSport, setSelectedSport } = useBetting();

  return (
    <select
      value={selectedSport}
      onChange={(e) => setSelectedSport(e.target.value)}
      className="w-full rounded border border-border bg-surface px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark"
    >
      {sports.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
