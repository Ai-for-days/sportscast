import { useState, useEffect } from 'react';
import type { ForecastPoint, DailyForecast } from '../../lib/types';
import { formatTemp, formatTime, parseLocalHour, parseLocalMinute, formatDate, windDirectionLabel } from '../../lib/weather-utils';

interface VenueInfo {
  name: string;
  team: string;
  sport: string;
}

interface Props {
  current: ForecastPoint;
  today: DailyForecast;
  locationName?: string;
  venues?: VenueInfo[];
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

type TimeOfDay = 'night' | 'dawn' | 'day' | 'dusk';

function getTimeOfDay(currentTime: string, sunrise: string, sunset: string): TimeOfDay {
  // Parse directly from time strings to avoid timezone corruption
  const h = parseLocalHour(currentTime);
  const m = parseLocalMinute(currentTime);
  const nowMin = h * 60 + m;

  let sunriseMin = 6 * 60; // default 6am
  let sunsetMin = 18 * 60; // default 6pm

  if (sunrise) {
    sunriseMin = parseLocalHour(sunrise) * 60 + parseLocalMinute(sunrise);
  }
  if (sunset) {
    sunsetMin = parseLocalHour(sunset) * 60 + parseLocalMinute(sunset);
  }

  // Dawn: 45 min before to 45 min after sunrise
  if (nowMin >= sunriseMin - 45 && nowMin <= sunriseMin + 45) return 'dawn';
  // Dusk: 45 min before to 45 min after sunset
  if (nowMin >= sunsetMin - 45 && nowMin <= sunsetMin + 45) return 'dusk';
  // Day: between dawn and dusk
  if (nowMin > sunriseMin + 45 && nowMin < sunsetMin - 45) return 'day';
  // Night
  return 'night';
}

function getSkyGradient(description: string, cloudCover: number, timeOfDay: TimeOfDay): string {
  const desc = description.toLowerCase();

  // Thunderstorm — dark dramatic sky
  if (desc.includes('thunder') || desc.includes('storm')) {
    if (timeOfDay === 'night') return 'linear-gradient(to bottom, #0f0f1a, #1a1a2e, #2d2d44)';
    return 'linear-gradient(to bottom, #2c3e50, #4a5568, #718096)';
  }

  // Rain / drizzle / showers
  if (desc.includes('rain') || desc.includes('drizzle') || desc.includes('shower')) {
    if (timeOfDay === 'night') return 'linear-gradient(to bottom, #1a202c, #2d3748, #4a5568)';
    if (timeOfDay === 'dawn') return 'linear-gradient(to bottom, #6b7280, #9ca3af, #d1d5db)';
    if (timeOfDay === 'dusk') return 'linear-gradient(to bottom, #4b5563, #6b7280, #9ca3af)';
    return 'linear-gradient(to bottom, #64748b, #94a3b8, #cbd5e1)';
  }

  // Freezing rain / drizzle
  if (desc.includes('freezing')) {
    if (timeOfDay === 'night') return 'linear-gradient(to bottom, #1e293b, #334155, #475569)';
    return 'linear-gradient(to bottom, #64748b, #94a3b8, #e2e8f0)';
  }

  // Snow
  if (desc.includes('snow')) {
    if (timeOfDay === 'night') return 'linear-gradient(to bottom, #1e293b, #334155, #64748b)';
    if (timeOfDay === 'dawn') return 'linear-gradient(to bottom, #94a3b8, #cbd5e1, #e2e8f0)';
    return 'linear-gradient(to bottom, #94a3b8, #cbd5e1, #f1f5f9)';
  }

  // Fog / mist
  if (desc.includes('fog') || desc.includes('mist') || desc.includes('haze')) {
    if (timeOfDay === 'night') return 'linear-gradient(to bottom, #374151, #4b5563, #6b7280)';
    return 'linear-gradient(to bottom, #9ca3af, #d1d5db, #e5e7eb)';
  }

  // Overcast / cloudy
  if (desc.includes('overcast') || (desc.includes('cloudy') && !desc.includes('partly'))) {
    if (timeOfDay === 'night') return 'linear-gradient(to bottom, #1f2937, #374151, #4b5563)';
    if (timeOfDay === 'dawn') return 'linear-gradient(to bottom, #d97706, #9ca3af, #d1d5db)';
    if (timeOfDay === 'dusk') return 'linear-gradient(to bottom, #9a3412, #78716c, #9ca3af)';
    return 'linear-gradient(to bottom, #6b7280, #9ca3af, #d1d5db)';
  }

  // Partly cloudy / scattered
  if (desc.includes('partly') || desc.includes('scattered')) {
    if (timeOfDay === 'night') return 'linear-gradient(to bottom, #0f172a, #1e3a5f, #334155)';
    if (timeOfDay === 'dawn') return 'linear-gradient(to bottom, #f59e0b, #fb923c, #7dd3fc)';
    if (timeOfDay === 'dusk') return 'linear-gradient(to bottom, #ea580c, #f472b6, #7c3aed)';
    // Daytime partly cloudy — the classic blue with some muting
    if (cloudCover > 60) return 'linear-gradient(to bottom, #3b82f6, #60a5fa, #bfdbfe)';
    return 'linear-gradient(to bottom, #2563eb, #38bdf8, #7dd3fc)';
  }

  // Clear sky — varies dramatically by time of day
  if (timeOfDay === 'night') return 'linear-gradient(to bottom, #0c1445, #1e1b4b, #312e81)';
  if (timeOfDay === 'dawn') return 'linear-gradient(to bottom, #f97316, #fbbf24, #38bdf8)';
  if (timeOfDay === 'dusk') return 'linear-gradient(to bottom, #dc2626, #f97316, #7c3aed)';

  // Clear daytime — bright blue sky
  return 'linear-gradient(to bottom, #0284c7, #38bdf8, #7dd3fc)';
}

export default function WeatherHero({ current, today, locationName, venues }: Props) {
  const [unit, setUnit] = useState<'F' | 'C'>('F');
  const [now, setNow] = useState(new Date());
  const summary = generateSummary(current, today);
  const timeOfDay = getTimeOfDay(current.time, today.sunrise, today.sunset);
  const skyGradient = getSkyGradient(current.description, current.cloudCover, timeOfDay);

  // Live clock — updates every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const localTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  // Use dark text for light backgrounds (fog, snow daytime, overcast daytime)
  const desc = current.description.toLowerCase();
  const isLightBg = (
    (desc.includes('fog') || desc.includes('snow') || desc.includes('overcast') ||
     (desc.includes('cloudy') && !desc.includes('partly')))
    && timeOfDay !== 'night'
  );
  const textColor = isLightBg ? 'text-gray-800' : 'text-white';
  const subtleColor = isLightBg ? 'text-gray-600' : 'text-white/70';
  const borderColor = isLightBg ? 'border-gray-400/30' : 'border-white/20';
  const summaryColor = isLightBg ? 'text-gray-700' : 'text-white/90';
  const btnBg = isLightBg ? 'bg-black/10 hover:bg-black/20' : 'bg-white/20 hover:bg-white/30';

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-6 shadow-lg"
      style={{ background: skyGradient }}
    >
      {/* Atmospheric glow overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.1),transparent_60%)]" />

      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            {locationName && (
              <h1 className={`text-xl font-semibold drop-shadow-sm ${textColor}`}>{locationName}</h1>
            )}
            <p className={`mt-0.5 text-sm ${subtleColor}`}>
              {formatDate(current.time)}
            </p>
            <p className={`text-sm ${subtleColor}`}>
              {localTime} Local Time
            </p>
            {venues && venues.length > 0 && venues.map((v, i) => (
              <div key={i} className={`mt-1 text-sm ${textColor}`}>
                <div className="font-semibold">🏟️ {v.name}</div>
                {v.team && (
                  <div className={`text-xs ${subtleColor}`}>
                    {v.team}{v.sport ? ` ${v.sport}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
            className={`rounded-full px-3 py-1 text-xs font-medium backdrop-blur-sm transition-colors ${btnBg} ${textColor}`}
          >
            {unit === 'F' ? '°C' : '°F'}
          </button>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <div className="text-7xl drop-shadow-md sm:text-8xl">{current.icon}</div>
          <div>
            <div className={`text-6xl font-thin tracking-tighter sm:text-7xl ${textColor}`}>
              {formatTemp(current.tempF, unit)}
            </div>
            <div className={`mt-1 text-lg font-medium ${textColor}`}>{current.description}</div>
          </div>
        </div>

        <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm ${textColor}`}>
          <span>H:{formatTemp(today.highF, unit)}</span>
          <span>L:{formatTemp(today.lowF, unit)}</span>
          <span>Feels {formatTemp(current.feelsLikeF, unit)}</span>
        </div>

        <div className={`mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm ${subtleColor}`}>
          <span>Wind: {windDirectionLabel(current.windDirectionDeg)} {current.windSpeedMph} mph</span>
          <span>Gusts: {current.windGustMph} mph</span>
        </div>

        <p className={`mt-4 border-t ${borderColor} pt-3 text-sm leading-relaxed ${summaryColor}`}>
          {summary}
        </p>
      </div>
    </div>
  );
}
