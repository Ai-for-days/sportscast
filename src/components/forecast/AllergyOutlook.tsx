import { useState } from 'react';
import type { AllergyData, AllergenSpecies, AllergyDayForecast, AllergyLevel } from '../../lib/types';

interface Props {
  allergyData?: AllergyData;
}

const levelColors: Record<AllergyLevel, string> = {
  'Very Low': 'bg-gray-400',
  'Low': 'bg-green-500',
  'Moderate': 'bg-yellow-500',
  'High': 'bg-orange-500',
  'Very High': 'bg-red-500',
};

const levelTextColors: Record<AllergyLevel, string> = {
  'Very Low': 'text-gray-600 dark:text-gray-400',
  'Low': 'text-green-700 dark:text-green-400',
  'Moderate': 'text-yellow-700 dark:text-yellow-400',
  'High': 'text-orange-700 dark:text-orange-400',
  'Very High': 'text-red-700 dark:text-red-400',
};

const levelBgLight: Record<AllergyLevel, string> = {
  'Very Low': 'bg-gray-100 dark:bg-gray-800',
  'Low': 'bg-green-50 dark:bg-green-950',
  'Moderate': 'bg-yellow-50 dark:bg-yellow-950',
  'High': 'bg-orange-50 dark:bg-orange-950',
  'Very High': 'bg-red-50 dark:bg-red-950',
};

const scoreBorderColor: Record<AllergyLevel, string> = {
  'Very Low': 'border-gray-300 dark:border-gray-600',
  'Low': 'border-green-400 dark:border-green-600',
  'Moderate': 'border-yellow-400 dark:border-yellow-600',
  'High': 'border-orange-400 dark:border-orange-600',
  'Very High': 'border-red-400 dark:border-red-600',
};

const scoreTextColor: Record<AllergyLevel, string> = {
  'Very Low': 'text-gray-600 dark:text-gray-300',
  'Low': 'text-green-700 dark:text-green-400',
  'Moderate': 'text-yellow-700 dark:text-yellow-300',
  'High': 'text-orange-700 dark:text-orange-300',
  'Very High': 'text-red-700 dark:text-red-300',
};

function SeverityBar({ level }: { level: number }) {
  const pct = Math.round((level / 4) * 100);
  let color = 'bg-gray-400';
  if (level >= 3.5) color = 'bg-red-500';
  else if (level >= 2.5) color = 'bg-orange-500';
  else if (level >= 1.5) color = 'bg-yellow-500';
  else if (level >= 0.5) color = 'bg-green-500';

  return (
    <div className="h-1.5 w-16 rounded-full bg-gray-200 dark:bg-gray-700">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SpeciesRow({ species }: { species: AllergenSpecies }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-base shrink-0">{species.icon}</span>
        <span className="text-sm font-medium text-text dark:text-text-dark truncate">{species.name}</span>
        {species.isPeak && (
          <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 dark:bg-red-900/40 dark:text-red-400">
            Peak
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <SeverityBar level={species.adjustedLevel} />
        <span className={`text-xs font-semibold w-16 text-right ${levelTextColors[species.levelLabel]}`}>
          {species.levelLabel}
        </span>
      </div>
    </div>
  );
}

function CategoryGroup({ label, species }: { label: string; species: AllergenSpecies[] }) {
  if (species.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-dark-muted mb-1 mt-2">
        {label}
      </div>
      {species.map(s => <SpeciesRow key={s.name} species={s} />)}
    </div>
  );
}

function FiveDayStrip({ forecast }: { forecast: AllergyDayForecast[] }) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="flex gap-2 overflow-x-auto py-1">
      {forecast.map((day, i) => {
        const d = new Date(day.date + 'T12:00:00');
        const dayLabel = i === 0 ? 'Today' : dayNames[d.getDay()];
        return (
          <div key={day.date} className="flex flex-col items-center gap-1 min-w-[52px]" title={day.dominantFactor}>
            <span className="text-xs text-text-muted dark:text-text-dark-muted">{dayLabel}</span>
            <div className={`flex h-9 w-9 items-center justify-center rounded-full border-2 ${scoreBorderColor[day.level]}`}>
              <span className={`text-sm font-bold ${scoreTextColor[day.level]}`}>{day.score}</span>
            </div>
            <span className={`text-[10px] font-medium ${levelTextColors[day.level]}`}>{day.level}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function AllergyOutlook({ allergyData }: Props) {
  const [showInactive, setShowInactive] = useState(false);

  if (!allergyData) return null;

  const {
    regionLabel,
    overallScore,
    overallLevel,
    activeSpecies,
    inactiveSpecies,
    fiveDayForecast,
    tips,
    weatherAdjustments,
  } = allergyData;

  const trees = activeSpecies.filter(s => s.category === 'tree');
  const grasses = activeSpecies.filter(s => s.category === 'grass');
  const weeds = activeSpecies.filter(s => s.category === 'weed');
  const molds = activeSpecies.filter(s => s.category === 'mold');
  const indoor = activeSpecies.filter(s => s.category === 'indoor');

  const progressPct = Math.min(100, overallScore);

  let progressBarColor = 'bg-gray-400';
  if (overallScore >= 75) progressBarColor = 'bg-red-500';
  else if (overallScore >= 55) progressBarColor = 'bg-orange-500';
  else if (overallScore >= 35) progressBarColor = 'bg-yellow-500';
  else if (overallScore >= 15) progressBarColor = 'bg-green-500';

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">Allergy Outlook</h3>
        <span className="text-xs text-text-muted dark:text-text-dark-muted">{regionLabel} Region</span>
      </div>

      {/* Overall Risk Banner */}
      <div className={`mb-4 rounded-lg p-4 ${levelBgLight[overallLevel]}`}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className={`text-3xl font-bold ${scoreTextColor[overallLevel]}`}>{overallScore}</span>
            <span className="text-sm text-text-muted dark:text-text-dark-muted"> / 100</span>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${levelColors[overallLevel]} text-white`}>
            {overallLevel.toUpperCase()}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className={`h-full rounded-full ${progressBarColor} transition-all duration-500`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Active Species by Category */}
      <div className="mb-4">
        <CategoryGroup label="Trees" species={trees} />
        <CategoryGroup label="Grasses" species={grasses} />
        <CategoryGroup label="Weeds" species={weeds} />
        <CategoryGroup label="Mold" species={molds} />
        <CategoryGroup label="Indoor" species={indoor} />
        {activeSpecies.length === 0 && (
          <p className="py-4 text-center text-sm text-text-muted dark:text-text-dark-muted">
            No allergens are currently in season for your region.
          </p>
        )}
      </div>

      {/* Weather Impact */}
      {weatherAdjustments.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-dark-muted mb-2">
            Weather Impact
          </h4>
          <div className="flex flex-wrap gap-2">
            {weatherAdjustments.map((adj) => (
              <span
                key={adj.label}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                  adj.impact === 'increases'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : adj.impact === 'decreases'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {adj.impact === 'increases' ? '↑' : '↓'} {adj.label}: {adj.value}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 5-Day Forecast Strip */}
      {fiveDayForecast.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-dark-muted mb-2">
            5-Day Allergy Forecast
          </h4>
          <FiveDayStrip forecast={fiveDayForecast} />
        </div>
      )}

      {/* Health Tips */}
      {tips.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-dark-muted mb-2">
            Health Tips
          </h4>
          <ul className="space-y-1.5">
            {tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text dark:text-text-dark">
                <span className="mt-0.5 shrink-0 text-xs text-text-muted dark:text-text-dark-muted">•</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Off-Season Section */}
      {inactiveSpecies.length > 0 && (
        <div>
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="flex w-full items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-sm text-text-muted hover:bg-surface-alt dark:border-border-dark/50 dark:text-text-dark-muted dark:hover:bg-surface-dark"
          >
            <span>{inactiveSpecies.length} species off-season</span>
            <span className="text-xs">{showInactive ? '▲' : '▼'}</span>
          </button>
          {showInactive && (
            <div className="mt-2 rounded-lg bg-surface-alt/50 p-3 dark:bg-surface-dark/50">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {inactiveSpecies.map(s => (
                  <div key={s.name} className="flex items-center gap-1.5 text-xs text-text-muted dark:text-text-dark-muted">
                    <span>{s.icon}</span>
                    <span>{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
