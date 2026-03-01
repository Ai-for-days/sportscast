import type { WagerStatus } from '../../lib/wager-types';

interface Props {
  active: WagerStatus | 'all';
  onChange: (status: WagerStatus | 'all') => void;
}

const tabs: { label: string; value: WagerStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Locked', value: 'locked' },
  { label: 'Graded', value: 'graded' },
];

export default function WagerFilters({ active, onChange }: Props) {
  return (
    <div className="flex gap-1 rounded-lg bg-surface-dark p-1">
      {tabs.map(tab => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            active === tab.value
              ? 'bg-field text-white'
              : 'text-text-dark-muted hover:text-text-dark hover:bg-surface-dark-alt'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
