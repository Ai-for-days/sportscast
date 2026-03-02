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
  hourly?: ForecastPoint[];
  locationName?: string;
  zip?: string;
  venues?: VenueInfo[];
  utcOffsetSeconds?: number;
  lat?: number;
  lon?: number;
}

function generateNext5HoursSummary(hourly: ForecastPoint[]): string {
  if (!hourly || hourly.length < 6) return '';

  const next5 = hourly.slice(1, 6); // next 5 hours (skip current)
  const parts: string[] = [];

  // Temperature trend
  const temps = next5.map(h => h.tempF);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const startTemp = hourly[0].tempF;
  const endTemp = next5[next5.length - 1].tempF;
  const tempDiff = endTemp - startTemp;

  if (Math.abs(tempDiff) >= 5) {
    if (tempDiff > 0) {
      parts.push(`temperatures rising to ${maxTemp}°F`);
    } else {
      parts.push(`temperatures dropping to ${minTemp}°F`);
    }
  } else {
    parts.push(`temperatures steady around ${Math.round((minTemp + maxTemp) / 2)}°F`);
  }

  // Precipitation
  const maxPrecipChance = Math.max(...next5.map(h => h.precipProbability));
  if (maxPrecipChance >= 70) {
    const precipDesc = next5.find(h => h.description.toLowerCase().includes('snow')) ? 'snow' : 'rain';
    parts.push(`${precipDesc} likely (${maxPrecipChance}% chance)`);
  } else if (maxPrecipChance >= 40) {
    parts.push(`possible showers (${maxPrecipChance}% chance)`);
  }

  // Wind
  const maxGust = Math.max(...next5.map(h => h.windGustMph));
  if (maxGust >= 30) {
    parts.push(`strong wind gusts up to ${maxGust} mph`);
  } else if (maxGust >= 15) {
    parts.push(`breezy with gusts to ${maxGust} mph`);
  }

  // Sky conditions — pick the most common description
  const descriptions = next5.map(h => h.description.toLowerCase());
  const hasThunder = descriptions.some(d => d.includes('thunder'));
  const hasRain = descriptions.some(d => d.includes('rain') || d.includes('shower'));
  const hasSnow = descriptions.some(d => d.includes('snow'));
  const hasCloudy = descriptions.some(d => d.includes('cloudy') || d.includes('overcast'));
  const hasFog = descriptions.some(d => d.includes('fog'));

  if (hasThunder) {
    parts.push('thunderstorms');
  } else if (hasSnow && !parts.some(p => p.includes('snow'))) {
    parts.push('snow');
  } else if (hasRain && !parts.some(p => p.includes('rain') || p.includes('shower'))) {
    parts.push('rain');
  } else if (hasFog) {
    parts.push('foggy conditions');
  } else if (hasCloudy) {
    parts.push('cloudy skies');
  } else {
    parts.push('clear skies');
  }

  return parts.join(', ') + '.';
}


/** Compute the current time at the forecast location using its UTC offset. */
function getLocationTime(utcOffsetSec: number): Date {
  const nowUTC = Date.now();
  return new Date(nowUTC + utcOffsetSec * 1000);
}

function formatLocationTime(d: Date): string {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export default function WeatherHero({ current, today, hourly, locationName, zip, venues, utcOffsetSeconds, lat, lon }: Props) {
  const [unit, setUnit] = useState<'F' | 'C'>('F');
  const offset = utcOffsetSeconds ?? -18000; // default EST
  const [now, setNow] = useState(() => getLocationTime(offset));
  const [records, setRecords] = useState<RecordData | null>(null);
  const next5Summary = hourly ? generateNext5HoursSummary(hourly) : '';

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
          <p className={`text-lg ${subtleColor}`}>
            {formatDate(current.time)}
          </p>
          <p className={`text-lg ${subtleColor}`}>
            {localTime} Local Time
          </p>
          {locationName && (
            <h1 className={`text-2xl font-semibold drop-shadow-sm ${textColor}`}>{locationName} Weather Forecast</h1>
          )}
          {zip && (
            <p className={`text-lg ${subtleColor}`}>{zip}</p>
          )}
          {venues && venues.length > 0 && venues.map((v, i) => (
            <div key={i} className={`mt-1.5 text-lg ${textColor}`}>
              <div className="font-semibold">&#127951; {v.name}</div>
              {v.team && (
                <div className={`text-base ${subtleColor}`}>
                  {v.team}{v.sport ? ` ${v.sport}` : ''}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col items-center">
          <div className={`mb-1 text-2xl font-medium ${textColor}`}>{current.description}</div>
          <div className="drop-shadow-md"><WeatherIcon icon={current.icon} size={96} /></div>
          <div className={`text-lg font-medium tracking-wide ${subtleColor}`}>
            Feels like it is {formatTemp(current.feelsLikeF, unit)}
          </div>
          <div className={`text-6xl font-thin tracking-tighter sm:text-7xl ${textColor}`}>
            {formatTemp(current.tempF, unit)}
          </div>
        </div>

        <div className={`mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-lg font-medium ${textColor}`}>
          <span>{formatTemp(today.highF, unit)}</span>
          <span>/</span>
          <span>{formatTemp(today.lowF, unit)}</span>
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

        {next5Summary && (
          <p className={`mt-4 border-t ${borderColor} pt-3 text-lg leading-relaxed ${summaryColor}`}>
            In the next 5 hours expect {next5Summary}
          </p>
        )}
      </div>
    </div>
  );
}
