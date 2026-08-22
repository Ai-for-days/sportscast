import { useState, useEffect, type CSSProperties } from 'react';
import type { ForecastPoint, DailyForecast } from '../../lib/types';
import type { WesResult } from '../../lib/wes';
import { getWesBand } from '../../lib/wes-scale';
import { formatTemp, formatTime, parseLocalHour, parseLocalMinute, formatDateLong, windDirectionLabel } from '../../lib/weather-utils';
import { getTimeOfDay, getSkyGradient, isLightBackground } from '../../lib/sky-theme';
import WeatherIcon from '../WeatherIcon';
import { sharedHourly } from '../../lib/client/shared-forecast';

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
  wes?: WesResult;
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

/** Moved here from the standalone TodaysWeather card (deleted) — per Derek,
 * the "next 12 hours" summary belongs directly under "next 5 hours" in this
 * same hero card, not in its own card further down the page. */
function buildNext12HoursSummary(hourly: ForecastPoint[]): string {
  if (!hourly || hourly.length < 13) return '';

  const next12 = hourly.slice(1, 13); // next 12 hours (skip current)
  const parts: string[] = [];

  // Temperature range and trend
  const temps = next12.map(h => h.tempF);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const startTemp = hourly[0].tempF;
  const midTemp = next12[5].tempF;
  const endTemp = next12[11].tempF;

  // Describe the temperature journey
  if (startTemp < midTemp && midTemp > endTemp) {
    parts.push(`Temperatures will rise to a high of ${maxTemp}°F then fall back to ${endTemp}°F.`);
  } else if (startTemp > midTemp && midTemp < endTemp) {
    parts.push(`Temperatures will drop to ${minTemp}°F before recovering to ${endTemp}°F.`);
  } else if (endTemp - startTemp >= 8) {
    parts.push(`Temperatures climbing from ${startTemp}°F to ${maxTemp}°F.`);
  } else if (startTemp - endTemp >= 8) {
    parts.push(`Temperatures falling from ${startTemp}°F to ${minTemp}°F.`);
  } else {
    parts.push(`Temperatures holding steady between ${minTemp}°F and ${maxTemp}°F.`);
  }

  // Precipitation analysis
  const precipHours = next12.filter(h => h.precipProbability >= 40);
  const maxPrecipChance = Math.max(...next12.map(h => h.precipProbability));
  if (precipHours.length > 0) {
    const descriptions = next12.map(h => h.description.toLowerCase());
    const hasSnow = descriptions.some(d => d.includes('snow'));
    const hasThunder = descriptions.some(d => d.includes('thunder'));
    const precipType = hasThunder ? 'thunderstorms' : hasSnow ? 'snow' : 'rain';

    if (precipHours.length >= 6) {
      parts.push(`Prolonged ${precipType} expected over the next 12 hours with up to a ${maxPrecipChance}% chance.`);
    } else if (precipHours.length >= 3) {
      parts.push(`${precipType.charAt(0).toUpperCase() + precipType.slice(1)} likely for several hours with a ${maxPrecipChance}% chance.`);
    } else {
      parts.push(`Brief ${precipType} possible with a ${maxPrecipChance}% chance.`);
    }
  }

  // Wind
  const maxGust = Math.max(...next12.map(h => h.windGustMph));
  const avgWind = Math.round(next12.reduce((sum, h) => sum + h.windSpeedMph, 0) / next12.length);
  if (maxGust >= 40) {
    parts.push(`Dangerous wind gusts up to ${maxGust} mph — secure loose objects.`);
  } else if (maxGust >= 25) {
    parts.push(`Gusty winds up to ${maxGust} mph.`);
  } else if (avgWind >= 12) {
    parts.push(`Breezy with sustained winds around ${avgWind} mph.`);
  }

  // Cloud cover trend
  const avgCloud = Math.round(next12.reduce((sum, h) => sum + h.cloudCover, 0) / next12.length);
  if (precipHours.length === 0) {
    if (avgCloud >= 80) {
      parts.push('Overcast skies throughout.');
    } else if (avgCloud >= 50) {
      parts.push('A mix of sun and clouds.');
    } else if (avgCloud >= 20) {
      parts.push('Mostly sunny with some passing clouds.');
    } else {
      parts.push('Clear skies.');
    }
  }

  // Feels like divergence
  const maxFeelsLikeDiff = Math.max(...next12.map(h => Math.abs(h.feelsLikeF - h.tempF)));
  if (maxFeelsLikeDiff >= 8) {
    const humidHour = next12.find(h => h.feelsLikeF - h.tempF >= 8);
    const coldHour = next12.find(h => h.tempF - h.feelsLikeF >= 8);
    if (humidHour) {
      parts.push(`Humidity will make it feel as warm as ${humidHour.feelsLikeF}°F.`);
    } else if (coldHour) {
      parts.push(`Wind chill will make it feel as cold as ${coldHour.feelsLikeF}°F.`);
    }
  }

  // UV warning (daytime hours)
  const maxUV = Math.max(...next12.map(h => h.uvIndex));
  if (maxUV >= 8) {
    parts.push(`Very high UV index of ${maxUV} — sun protection is essential.`);
  } else if (maxUV >= 6) {
    parts.push(`High UV index of ${maxUV} — sunscreen recommended.`);
  }

  return parts.join(' ');
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

export default function WeatherHero({ current, today, hourly: hourlyProp, locationName, zip, venues, utcOffsetSeconds, lat, lon, wes }: Props) {
  const hourly = sharedHourly<ForecastPoint>(hourlyProp);
  const [unit, setUnit] = useState<'F' | 'C'>('F');
  const offset = utcOffsetSeconds ?? -18000; // default EST
  const [now, setNow] = useState(() => getLocationTime(offset));
  const [records, setRecords] = useState<RecordData | null>(null);
  const next5Summary = hourly ? generateNext5HoursSummary(hourly) : '';
  const next12Summary = hourly ? buildNext12HoursSummary(hourly) : '';

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
  // On light gray backgrounds (overcast/cloudy/fog/snow daytime),
  // gray-700/800 subtle text washes out. Use near-black for both the
  // primary and "subtle" tiers so everything reads against the slate
  // gradient.
  const textColor = isLightBg ? 'text-black' : 'text-white';
  const subtleColor = isLightBg ? 'text-gray-900' : 'text-white/85';
  const borderColor = isLightBg ? 'border-gray-700/50' : 'border-white/30';
  const summaryColor = isLightBg ? 'text-black' : 'text-white/95';
  const btnBg = isLightBg ? 'bg-black/20 hover:bg-black/30' : 'bg-white/25 hover:bg-white/35';
  // Step 127: text-shadow keeps text legible across bright sky gradients
  // (e.g. partly cloudy daytime fades to near-white at the bottom).
  const textShadow = isLightBg
    ? '0 1px 2px rgba(255,255,255,0.55), 0 0 1px rgba(255,255,255,0.8)'
    : '0 1px 2px rgba(0,0,0,0.45)';

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-6 shadow-lg"
      style={{ background: skyGradient }}
    >
      {/* Atmospheric glow overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.1),transparent_60%)]" />
      {/* Step 127: contextual readability scrim — darkens bright bottoms when
          text is white, lightens dark tops when text is dark. Subtle enough
          to keep the sky feel intact. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isLightBg
            ? 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 45%)'
            : 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.28) 100%)',
        }}
      />

      <div className="relative text-center" style={{ textShadow }}>
        <div>
          <p className={`text-lg ${subtleColor}`}>
            {formatDateLong(current.time)}
          </p>
          <p className={`text-lg ${subtleColor}`}>
            {localTime} Local Time
          </p>
          {locationName && (() => {
            const parts = locationName.split(', ');
            const city = parts[0] || locationName;
            const state = parts.slice(1).join(', ');
            return (
              <h1 className="drop-shadow-sm">
                <span className={`block text-2xl font-semibold ${textColor}`}>{city}</span>
                {state && <span className={`block text-lg font-semibold ${textColor}`}>{state}</span>}
                <span className={`block text-2xl font-semibold ${textColor}`}>Weather Forecast</span>
              </h1>
            );
          })()}
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
          <div className={`text-lg font-medium tracking-wide ${subtleColor}`}>
            Feels like it is {formatTemp(current.feelsLikeF, unit)}
          </div>
          {wes && (() => {
            const band = getWesBand(wes.wesFinal);
            return (
              <div className="mt-1 flex flex-col items-center" style={{ '--wes-light': band.light, '--wes-dark': band.dark } as CSSProperties}>
                <div
                  className="wes-band-color inline-flex items-baseline gap-1 rounded-full border-2 px-2.5 py-1"
                  title={`Environmental ${Math.round(wes.environmental)}, Fan Feel ${Math.round(wes.fanFeel)}, Player Feel ${Math.round(wes.playerFeel)} (v${wes.wesVersion})`}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide wes-band-color">WES</span>
                  <span className="text-sm font-bold wes-band-color">{Math.round(wes.wesFinal)}</span>
                </div>
                <div className="mt-0.5 text-xs font-semibold wes-band-color">{band.label}</div>
                <a href="/what-is-wes" className={`mt-0.5 text-xs font-medium underline decoration-dotted ${subtleColor}`}>What's WES?</a>
              </div>
            );
          })()}
          <div className={`text-6xl font-thin tracking-tighter sm:text-7xl ${textColor}`}>
            {formatTemp(current.tempF, unit)}
          </div>
          <div className="drop-shadow-md"><WeatherIcon icon={current.icon} size={96} /></div>
          <div className={`mt-1 text-2xl font-medium ${textColor}`}>{current.description}</div>
        </div>

        <div className={`mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-lg ${subtleColor}`}>
          <span>Wind: {windDirectionLabel(current.windDirectionDeg)} {current.windSpeedMph} mph</span>
          <span>Gusts: {current.windGustMph} mph</span>
        </div>

        <div className={`mt-2 px-4 text-center text-xs ${subtleColor}`}>
          Conditions are hyperlocal and can differ from what you see outside.
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
        {next12Summary && (
          <p className={`mt-3 border-t ${borderColor} pt-3 text-base leading-relaxed ${summaryColor}`}>
            <span className="font-semibold">In the next 12 hours expect</span> {next12Summary}
          </p>
        )}
      </div>
    </div>
  );
}
