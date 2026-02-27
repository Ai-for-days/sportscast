import { useState, useEffect } from 'react';
import type { ForecastPoint, DailyForecast } from '../../lib/types';
import { formatTemp, formatTime, parseLocalHour, parseLocalMinute, formatDate, windDirectionLabel } from '../../lib/weather-utils';
import { getTimeOfDay, getSkyGradient, isLightBackground } from '../../lib/sky-theme';
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
  zip?: string;
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

export default function WeatherHero({ current, today, locationName, zip, venues, utcOffsetSeconds, lat, lon }: Props) {
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
        <div>
          {zip && (
            <p className={`text-lg ${subtleColor}`}>{zip}</p>
          )}
          {locationName && (
            <h1 className={`text-2xl font-semibold drop-shadow-sm ${textColor}`}>{locationName} Weather Forecast</h1>
          )}
          <p className={`mt-1 text-lg ${subtleColor}`}>
            {formatDate(current.time)}
          </p>
          <p className={`text-lg ${subtleColor}`}>
            {localTime} Local Time
          </p>
          {venues && venues.length > 0 && venues.map((v, i) => (
            <div key={i} className={`mt-1.5 text-lg ${textColor}`}>
              <div className="font-semibold">🏟️ {v.name}</div>
              {v.team && (
                <div className={`text-base ${subtleColor}`}>
                  {v.team}{v.sport ? ` ${v.sport}` : ''}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col items-center">
          <div className="drop-shadow-md"><WeatherIcon icon={current.icon} size={96} /></div>
          <div className={`mt-1 text-2xl font-medium ${textColor}`}>{current.description}</div>
          <div className={`text-lg font-medium tracking-wide ${subtleColor}`}>
            Feels {formatTemp(current.feelsLikeF, unit)}
          </div>
          <div className={`text-6xl font-thin tracking-tighter sm:text-7xl ${textColor}`}>
            {formatTemp(current.tempF, unit)}
          </div>
        </div>

        <div className={`mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-lg font-medium ${textColor}`}>
          <span>H: {formatTemp(today.highF, unit)}</span>
          <span>L: {formatTemp(today.lowF, unit)}</span>
        </div>

        <div className={`mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-lg ${subtleColor}`}>
          <span>Wind: {windDirectionLabel(current.windDirectionDeg)} {current.windSpeedMph} mph</span>
          <span>Gusts: {current.windGustMph} mph</span>
        </div>

        {records && (() => {
          const highDiff = unit === 'C' ? Math.round((today.highF - 32) * 5/9) - Math.round((records.avgHigh - 32) * 5/9) : today.highF - records.avgHigh;
          const lowDiff = unit === 'C' ? Math.round((today.lowF - 32) * 5/9) - Math.round((records.avgLow - 32) * 5/9) : today.lowF - records.avgLow;
          const unitLabel = unit === 'C' ? '°C' : '°F';
          const fmtDiff = (d: number) => d > 0 ? `+${d}°` : d < 0 ? `${d}°` : '0°';
          return (
            <>
              <div className={`mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm ${subtleColor}`} style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em' }}>
                <span>Record High: {formatTemp(records.recordHigh, unit)} ({records.recordHighYear})</span>
                <span>Record Low: {formatTemp(records.recordLow, unit)} ({records.recordLowYear})</span>
              </div>
              <div className={`mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm ${subtleColor}`} style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em' }}>
                <span>Avg High: {formatTemp(records.avgHigh, unit)} <span style={{ fontWeight: 700 }}>({fmtDiff(highDiff)})</span></span>
                <span>Avg Low: {formatTemp(records.avgLow, unit)} <span style={{ fontWeight: 700 }}>({fmtDiff(lowDiff)})</span></span>
              </div>
            </>
          );
        })()}

        <div className="mt-3 flex justify-center">
          <button
            onClick={() => setUnit(u => u === 'F' ? 'C' : 'F')}
            className={`rounded-full px-4 py-1.5 text-sm font-medium backdrop-blur-sm transition-colors ${btnBg} ${textColor}`}
          >
            {unit === 'F' ? '°C' : '°F'}
          </button>
        </div>

        <p className={`mt-4 border-t ${borderColor} pt-3 text-lg leading-relaxed ${summaryColor}`}>
          {summary}
        </p>
      </div>
    </div>
  );
}
