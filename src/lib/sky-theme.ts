import { parseLocalHour, parseLocalMinute } from './weather-utils';

export type TimeOfDay = 'night' | 'dawn' | 'day' | 'dusk';

export function getTimeOfDay(currentTime: string, sunrise: string, sunset: string): TimeOfDay {
  const h = parseLocalHour(currentTime);
  const m = parseLocalMinute(currentTime);
  const nowMin = h * 60 + m;

  let sunriseMin = 6 * 60;
  let sunsetMin = 18 * 60;

  if (sunrise) {
    sunriseMin = parseLocalHour(sunrise) * 60 + parseLocalMinute(sunrise);
  }
  if (sunset) {
    sunsetMin = parseLocalHour(sunset) * 60 + parseLocalMinute(sunset);
  }

  if (nowMin >= sunriseMin - 45 && nowMin <= sunriseMin + 45) return 'dawn';
  if (nowMin >= sunsetMin - 45 && nowMin <= sunsetMin + 45) return 'dusk';
  if (nowMin > sunriseMin + 45 && nowMin < sunsetMin - 45) return 'day';
  return 'night';
}

export function getSkyGradient(description: string, cloudCover: number, timeOfDay: TimeOfDay): string {
  const desc = description.toLowerCase();

  if (desc.includes('thunder') || desc.includes('storm')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #050510 0%, #1a0a2e 40%, #2d1b4e 100%)';
    return 'linear-gradient(180deg, #1a1a2e 0%, #374151 50%, #6b7280 100%)';
  }
  if (desc.includes('rain') || desc.includes('drizzle') || desc.includes('shower')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #0a0f1a 0%, #1e293b 50%, #374151 100%)';
    if (timeOfDay === 'dawn') return 'linear-gradient(180deg, #78716c 0%, #a8a29e 50%, #d6d3d1 100%)';
    if (timeOfDay === 'dusk') return 'linear-gradient(180deg, #44403c 0%, #6b7280 50%, #9ca3af 100%)';
    return 'linear-gradient(180deg, #475569 0%, #78909c 50%, #b0bec5 100%)';
  }
  if (desc.includes('freezing')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #0f172a 0%, #1e3a5f 50%, #334155 100%)';
    return 'linear-gradient(180deg, #546e7a 0%, #90a4ae 50%, #cfd8dc 100%)';
  }
  if (desc.includes('blizzard')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #0f172a 0%, #1e3a5f 30%, #64748b 70%, #94a3b8 100%)';
    return 'linear-gradient(180deg, #64748b 0%, #94a3b8 30%, #cbd5e1 60%, #e2e8f0 100%)';
  }
  if (desc.includes('snow')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #0f172a 0%, #1e3a5f 50%, #475569 100%)';
    if (timeOfDay === 'dawn') return 'linear-gradient(180deg, #b0bec5 0%, #cfd8dc 50%, #eceff1 100%)';
    return 'linear-gradient(180deg, #90a4ae 0%, #cfd8dc 50%, #eceff1 100%)';
  }
  if (desc.includes('fog') || desc.includes('mist') || desc.includes('haze')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #263238 0%, #455a64 50%, #78909c 100%)';
    return 'linear-gradient(180deg, #90a4ae 0%, #b0bec5 50%, #e0e0e0 100%)';
  }
  if (desc.includes('overcast') || (desc.includes('cloudy') && !desc.includes('partly'))) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #111827 0%, #1f2937 50%, #374151 100%)';
    if (timeOfDay === 'dawn') return 'linear-gradient(180deg, #b45309 0%, #9ca3af 60%, #d1d5db 100%)';
    if (timeOfDay === 'dusk') return 'linear-gradient(180deg, #7c2d12 0%, #78716c 60%, #9ca3af 100%)';
    return 'linear-gradient(180deg, #546e7a 0%, #90a4ae 50%, #cfd8dc 100%)';
  }
  if (desc.includes('partly') || desc.includes('scattered')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #020617 0%, #0f172a 40%, #1e3a5f 100%)';
    if (timeOfDay === 'dawn') return 'linear-gradient(180deg, #ea580c 0%, #fb923c 35%, #38bdf8 100%)';
    if (timeOfDay === 'dusk') return 'linear-gradient(180deg, #be123c 0%, #e11d48 30%, #7c3aed 70%, #312e81 100%)';
    if (cloudCover > 60) return 'linear-gradient(180deg, #1d4ed8 0%, #60a5fa 50%, #bfdbfe 100%)';
    return 'linear-gradient(180deg, #1e40af 0%, #3b82f6 45%, #93c5fd 100%)';
  }
  if (timeOfDay === 'night') return 'linear-gradient(180deg, #020617 0%, #0c1445 40%, #1e1b4b 100%)';
  if (timeOfDay === 'dawn') return 'linear-gradient(180deg, #c2410c 0%, #f59e0b 30%, #38bdf8 70%, #0ea5e9 100%)';
  if (timeOfDay === 'dusk') return 'linear-gradient(180deg, #991b1b 0%, #ea580c 25%, #f472b6 50%, #7c3aed 80%, #312e81 100%)';
  return 'linear-gradient(180deg, #0c4a6e 0%, #0284c7 35%, #38bdf8 70%, #7dd3fc 100%)';
}

export function isLightBackground(description: string, timeOfDay: TimeOfDay): boolean {
  const desc = description.toLowerCase();
  return (
    (desc.includes('fog') || desc.includes('snow') || desc.includes('overcast') ||
     (desc.includes('cloudy') && !desc.includes('partly')))
    && timeOfDay !== 'night'
  );
}
