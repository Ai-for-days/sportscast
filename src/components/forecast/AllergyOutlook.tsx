import type { AllergyData } from '../../lib/types';

interface Props {
  allergyData?: AllergyData;
}

const levelColors: Record<string, string> = {
  'Low': 'bg-green-500',
  'Moderate': 'bg-yellow-500',
  'High': 'bg-orange-500',
  'Very High': 'bg-red-500',
};

const levelTextColors: Record<string, string> = {
  'Low': 'text-green-700 dark:text-green-400',
  'Moderate': 'text-yellow-700 dark:text-yellow-400',
  'High': 'text-orange-700 dark:text-orange-400',
  'Very High': 'text-red-700 dark:text-red-400',
};

interface AllergenRowProps {
  icon: string;
  name: string;
  level: string;
}

function AllergenRow({ icon, name, level }: AllergenRowProps) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-3 last:border-0 dark:border-border-dark/50">
      <div className="flex items-center gap-3">
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-medium text-text dark:text-text-dark">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${levelTextColors[level] || 'text-text-muted'}`}>{level}</span>
        <div className={`h-5 w-1.5 rounded-full ${levelColors[level] || 'bg-gray-400'}`} />
      </div>
    </div>
  );
}

export default function AllergyOutlook({ allergyData }: Props) {
  if (!allergyData) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-2 text-lg font-semibold text-text dark:text-text-dark">Allergy Outlook</h3>
      <div>
        <AllergenRow icon="🌳" name="Tree Pollen" level={allergyData.treePollen} />
        <AllergenRow icon="🌾" name="Ragweed Pollen" level={allergyData.ragweedPollen} />
        <AllergenRow icon="🍄" name="Mold" level={allergyData.mold} />
        <AllergenRow icon="🌿" name="Grass Pollen" level={allergyData.grassPollen} />
        <AllergenRow icon="🏠" name="Dust & Dander" level={allergyData.dustAndDander} />
      </div>
    </div>
  );
}
