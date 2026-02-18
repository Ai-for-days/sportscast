import { useState } from 'react';
import type { ForecastPoint, DailyForecast } from '../../lib/types';
import { formatTemp } from '../../lib/weather-utils';

interface Props {
  current: ForecastPoint;
  today: DailyForecast;
  locationName?: string;
}

function generateSummary(current: ForecastPoint, today: DailyForecast): string {
  const parts: string[] = [];
  const desc = current.description.toLowerCase();

  if (desc.includes('clear')) {
    parts.push('Clear conditions expected this evening.');
  } else if (desc.includes('partly')) {
    parts.push('Partly cloudy skies are expected.');
  } else if (desc.includes('rain') || desc.includes('shower')) {
    parts.push(`Rain is expected with a ${today.precipProbability}% chance of precipitation.`);
  } else if (desc.includes('snow')) {
    parts.push('Snow is expected today.');
  } else if (desc.includes('thunder')) {
    parts.push('Thunderstorms are in the forecast.');
  } else if (desc.includes('cloudy') || desc.includes('overcast')) {
    parts.push('Overcast skies throughout the day.');
  } else if (desc.includes('fog')) {
    parts.push('Foggy conditions are present.');
  } else {
    parts.push(`${current.description} conditions are expected.`);
  }

  if (current.windGustMph >= 15) {
    parts.push(`Wind gusts are up to ${current.windGustMph} mph.`);
  }

  if (today.highF >= 90) {
    parts.push(`High near ${today.highF}°. Stay hydrated.`);
  } else if (today.lowF <= 32) {
    parts.push(`Low near ${today.lowF}°. Bundle up.`);
  }

  return parts.join(' ');
}

export default function WeatherHero({ current, today, locationName }: Props) {
  const [unit, setUnit] = useState<'F' | 'C'>('F');
  const summary = generateSummary(current, today);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-sky-500 via-sky-400 to-blue-300 p-6 text-white shadow-lg dark:from-slate-700 dark:via-slate-600 dark:to-slate-500">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.15),transparent_60%)]" />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            {locationName && (
              <h1 className="text-xl font-semibold drop-shadow-sm">{locationName}</h1>
            )}
            <p className="mt-0.5 text-sm text-white/70">
              {new Date(current.time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <button
            onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
            className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur-sm transition-colors hover:bg-white/30"
          >
            {unit === 'F' ? '°C' : '°F'}
          </button>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <div className="text-7xl drop-shadow-md sm:text-8xl">{current.icon}</div>
          <div>
            <div className="text-6xl font-thin tracking-tighter sm:text-7xl">
              {formatTemp(current.tempF, unit)}
            </div>
            <div className="mt-1 text-lg font-medium">{current.description}</div>
          </div>
        </div>

        <div className="mt-2 flex gap-4 text-sm">
          <span>H:{formatTemp(today.highF, unit)}</span>
          <span>L:{formatTemp(today.lowF, unit)}</span>
        </div>

        <p className="mt-4 border-t border-white/20 pt-3 text-sm leading-relaxed text-white/90">
          {summary}
        </p>
      </div>
    </div>
  );
}
