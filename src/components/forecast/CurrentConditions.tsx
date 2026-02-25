import { useState } from 'react';
import type { ForecastPoint } from '../../lib/types';
import { formatTemp, windDirectionLabel } from '../../lib/weather-utils';
import WeatherIcon from '../WeatherIcon';

interface Props {
  current: ForecastPoint;
  locationName?: string;
}

export default function CurrentConditions({ current, locationName }: Props) {
  const [unit, setUnit] = useState<'F' | 'C'>('F');

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-sky/5 to-field/5 p-6 shadow-sm dark:border-border-dark dark:from-sky/10 dark:to-field/10">
      <div className="flex items-start justify-between">
        <div>
          {locationName && (
            <h2 className="mb-1 text-lg font-semibold text-text dark:text-text-dark">{locationName}</h2>
          )}
          <p className="text-sm text-text-muted dark:text-text-dark-muted">
            {new Date(current.time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
        <button
          onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
          className="rounded-lg border border-border px-3 py-1 text-sm font-medium text-text-muted transition-colors hover:bg-surface-alt dark:border-border-dark dark:text-text-dark-muted dark:hover:bg-surface-dark"
        >
          {unit === 'F' ? 'Show °C' : 'Show °F'}
        </button>
      </div>

      <div className="mt-4 flex items-center gap-6">
        <div><WeatherIcon icon={current.icon} size={56} /></div>
        <div>
          <div className="text-5xl font-bold text-text dark:text-text-dark">
            {formatTemp(current.tempF, unit)}
          </div>
          <div className="mt-1 text-sm text-text-muted dark:text-text-dark-muted">
            {current.description}
          </div>
          <div className="mt-1 text-sm text-text-muted dark:text-text-dark-muted">
            Feels like {formatTemp(current.feelsLikeF, unit)}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Wind" value={`${current.windSpeedMph} mph ${windDirectionLabel(current.windDirectionDeg)}`} />
        <Stat label="Gusts" value={`${current.windGustMph} mph`} />
        <Stat label="Humidity" value={`${current.humidity}%`} />
        <Stat label="Precip" value={`${current.precipProbability}%`} />
        <Stat label="UV Index" value={`${current.uvIndex}`} />
        <Stat label="Pressure" value={`${current.pressure} hPa`} />
        <Stat label="Cloud Cover" value={`${current.cloudCover}%`} />
        <Stat label="Visibility" value={`${current.visibility} mi`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-text-muted dark:text-text-dark-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-text dark:text-text-dark">{value}</div>
    </div>
  );
}
