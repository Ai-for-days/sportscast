import { useState, useEffect } from 'react';
import type { ForecastPoint, DailyForecast } from '../../lib/types';
import { formatTemp, formatTime, parseLocalHour, parseLocalMinute, formatDate, windDirectionLabel } from '../../lib/weather-utils';
import WeatherIcon from '../WeatherIcon';

interface VenueInfo {
  name: string;
  team: string;
  sport: string;
}

interface RecordData {
  recordHigh: number;
  recordHighYear: string;
  recordLow: number;
  recordLowYear: string;
  avgHigh: number;
  avgLow: number;
}

interface Props {
  current: ForecastPoint;
  today: DailyForecast;
  locationName?: string;
  venues?: VenueInfo[];
  utcOffsetSeconds?: number;
  lat?: number;
  lon?: number;
}

function generateSummary(current: ForecastPoint, today: DailyForecast): string {
  const parts: string[] = [];
  const desc = current.description.toLowerCase();

  if (desc.includes('blizzard')) {
    parts.push('Blizzard conditions with heavy snow and high winds. Travel is extremely dangerous.');
  } else if (desc.includes('clear')) {
    parts.push('Clear conditions expected this evening.');
  } else if (desc.includes('partly')) {
    parts.push('Partly cloudy skies are expected.');
  } else if (desc.includes('rain') || desc.includes('shower')) {
    parts.push(`Rain is expected with a ${today.precipProbability}% chance of precipitation.`);
  } else if (desc.includes('heavy snow')) {
    parts.push('Heavy snow is expected. Significant accumulations possible.');
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

  // Thunderstorm — dark dramatic sky with deep purples
  if (desc.includes('thunder') || desc.includes('storm')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #050510 0%, #1a0a2e 40%, #2d1b4e 100%)';
    return 'linear-gradient(180deg, #1a1a2e 0%, #374151 50%, #6b7280 100%)';
  }

  // Rain / drizzle / showers — muted steel tones
  if (desc.includes('rain') || desc.includes('drizzle') || desc.includes('shower')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #0a0f1a 0%, #1e293b 50%, #374151 100%)';
    if (timeOfDay === 'dawn') return 'linear-gradient(180deg, #78716c 0%, #a8a29e 50%, #d6d3d1 100%)';
    if (timeOfDay === 'dusk') return 'linear-gradient(180deg, #44403c 0%, #6b7280 50%, #9ca3af 100%)';
    return 'linear-gradient(180deg, #475569 0%, #78909c 50%, #b0bec5 100%)';
  }

  // Freezing rain / drizzle — icy blue-grey
  if (desc.includes('freezing')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #0f172a 0%, #1e3a5f 50%, #334155 100%)';
    return 'linear-gradient(180deg, #546e7a 0%, #90a4ae 50%, #cfd8dc 100%)';
  }

  // Blizzard — icy whiteout palette
  if (desc.includes('blizzard')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #0f172a 0%, #1e3a5f 30%, #64748b 70%, #94a3b8 100%)';
    return 'linear-gradient(180deg, #64748b 0%, #94a3b8 30%, #cbd5e1 60%, #e2e8f0 100%)';
  }

  // Snow — soft whites and pale blues
  if (desc.includes('snow')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #0f172a 0%, #1e3a5f 50%, #475569 100%)';
    if (timeOfDay === 'dawn') return 'linear-gradient(180deg, #b0bec5 0%, #cfd8dc 50%, #eceff1 100%)';
    return 'linear-gradient(180deg, #90a4ae 0%, #cfd8dc 50%, #eceff1 100%)';
  }

  // Fog / mist — hazy, washed out
  if (desc.includes('fog') || desc.includes('mist') || desc.includes('haze')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #263238 0%, #455a64 50%, #78909c 100%)';
    return 'linear-gradient(180deg, #90a4ae 0%, #b0bec5 50%, #e0e0e0 100%)';
  }

  // Overcast / cloudy — flat grey with subtle warmth at dawn/dusk
  if (desc.includes('overcast') || (desc.includes('cloudy') && !desc.includes('partly'))) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #111827 0%, #1f2937 50%, #374151 100%)';
    if (timeOfDay === 'dawn') return 'linear-gradient(180deg, #b45309 0%, #9ca3af 60%, #d1d5db 100%)';
    if (timeOfDay === 'dusk') return 'linear-gradient(180deg, #7c2d12 0%, #78716c 60%, #9ca3af 100%)';
    return 'linear-gradient(180deg, #546e7a 0%, #90a4ae 50%, #cfd8dc 100%)';
  }

  // Partly cloudy / scattered — blue sky peeking through
  if (desc.includes('partly') || desc.includes('scattered')) {
    if (timeOfDay === 'night') return 'linear-gradient(180deg, #020617 0%, #0f172a 40%, #1e3a5f 100%)';
    if (timeOfDay === 'dawn') return 'linear-gradient(180deg, #ea580c 0%, #fb923c 35%, #38bdf8 100%)';
    if (timeOfDay === 'dusk') return 'linear-gradient(180deg, #be123c 0%, #e11d48 30%, #7c3aed 70%, #312e81 100%)';
    if (cloudCover > 60) return 'linear-gradient(180deg, #1d4ed8 0%, #60a5fa 50%, #bfdbfe 100%)';
    return 'linear-gradient(180deg, #1e40af 0%, #3b82f6 45%, #93c5fd 100%)';
  }

  // Clear sky — vivid, dramatic time-of-day colors
  if (timeOfDay === 'night') return 'linear-gradient(180deg, #020617 0%, #0c1445 40%, #1e1b4b 100%)';
  if (timeOfDay === 'dawn') return 'linear-gradient(180deg, #c2410c 0%, #f59e0b 30%, #38bdf8 70%, #0ea5e9 100%)';
  if (timeOfDay === 'dusk') return 'linear-gradient(180deg, #991b1b 0%, #ea580c 25%, #f472b6 50%, #7c3aed 80%, #312e81 100%)';

  // Clear daytime — vivid deep blue to light blue
  return 'linear-gradient(180deg, #0c4a6e 0%, #0284c7 35%, #38bdf8 70%, #7dd3fc 100%)';
}

/** Compute the current time at the forecast location using its UTC offset. */
function getLocationTime(utcOffsetSec: number): Date {
  const nowUTC = Date.now();
  // Create a Date shifted to the location's local time
  return new Date(nowUTC + utcOffsetSec * 1000);
}

function formatLocationTime(d: Date): string {
  // d is already shifted to location time, so extract UTC hours/minutes
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export default function WeatherHero({ current, today, locationName, venues, utcOffsetSeconds, lat, lon }: Props) {
  const [unit, setUnit] = useState<'F' | 'C'>('F');
  const offset = utcOffsetSeconds ?? -18000; // default EST
  const [now, setNow] = useState(() => getLocationTime(offset));
  const [records, setRecords] = useState<RecordData | null>(null);
  const summary = generateSummary(current, today);

  // Fetch record data
  useEffect(() => {
    if (!lat || !lon || !today.date) return;
    const [, m, d] = today.date.split('-').map(Number);
    fetch(`/api/records?lat=${lat}&lon=${lon}&month=${m}&day=${d}`)
      .then(res => res.ok ? res.json() : null)
      .then(result => { if (result && !result.error) setRecords(result); })
      .catch(() => {});
  }, [lat, lon, today.date]);
  const timeOfDay = getTimeOfDay(current.time, today.sunrise, today.sunset);
  const skyGradient = getSkyGradient(current.description, current.cloudCover, timeOfDay);

  // Live clock — updates every minute, using location's UTC offset
  useEffect(() => {
    const timer = setInterval(() => setNow(getLocationTime(offset)), 60000);
    return () => clearInterval(timer);
  }, [offset]);

  const localTime = formatLocationTime(now);

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

      <div className="relative text-center">
        <div className="flex items-start justify-between">
          <div className="flex-1" />
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
          <div className="flex flex-1 justify-end">
            <button
              onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
              className={`rounded-full px-3 py-1 text-xs font-medium backdrop-blur-sm transition-colors ${btnBg} ${textColor}`}
            >
              {unit === 'F' ? '°C' : '°F'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-4">
          <div className="drop-shadow-md"><WeatherIcon icon={current.icon} size={96} /></div>
          <div>
            <div className={`text-sm font-medium tracking-wide ${subtleColor}`}>
              Feels {formatTemp(current.feelsLikeF, unit)}
            </div>
            <div className={`text-6xl font-thin tracking-tighter sm:text-7xl ${textColor}`}>
              {formatTemp(current.tempF, unit)}
            </div>
            <div className={`mt-1 text-lg font-medium ${textColor}`}>{current.description}</div>
          </div>
        </div>

        <div className={`mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm ${textColor}`}>
          <span>H:{formatTemp(today.highF, unit)}</span>
          <span>L:{formatTemp(today.lowF, unit)}</span>
        </div>

        {records && (() => {
          const highDiff = today.highF - records.avgHigh;
          const lowDiff = today.lowF - records.avgLow;
          const fmtDiff = (d: number) => d > 0 ? `+${d}°` : d < 0 ? `${d}°` : '0°';
          return (
            <div className={`mt-1.5 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs ${subtleColor}`}>
              <span>Avg High: {records.avgHigh}° <span style={{ fontWeight: 700 }}>({fmtDiff(highDiff)})</span></span>
              <span>Avg Low: {records.avgLow}° <span style={{ fontWeight: 700 }}>({fmtDiff(lowDiff)})</span></span>
            </div>
          );
        })()}

        <div className={`mt-1.5 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm ${subtleColor}`}>
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
