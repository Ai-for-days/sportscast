// Prose weather write-ups for a game window, built from the same
// WagerOnWeather Consensus samples the stadium wind diagram already uses
// (getGameWindowForecast in mlb-game-forecast.ts).
//
// Two versions:
//  - buildGameWeatherNarrative — generic, all leagues. Kickoff + 3.5h,
//    30-minute samples, clock-time references, compass wind directions.
//  - buildMlbGameWeatherNarrative — MLB only. Innings 1-9 (20-minute
//    samples, matching the site's inning-timing convention — see
//    INNING_STEP_MINUTES), field-relative wind ("blowing out to left
//    field") via the stadium's real compass orientation, a sun-glare zone
//    ("over the third-base side") from a Meeus low-precision solar-position
//    calculation, and a humidity trend. Falls back to the generic compass
//    wind phrasing (and skips the sun zone) when a park has no orientation
//    data yet (stadium-orientations.json doesn't cover all 30).

import type { ForecastPoint, AirQualityData } from './types';
import { getGameWindowForecast, getInningForecast, inningAtMinutes, type GameForecastSlot } from './mlb-game-forecast';
import { windDirectionLabel, getSunPosition } from './weather-utils';
import { fieldWindLabel, sunFieldZoneLabel } from './stadium-wind';

export interface GameWeatherNarrativeInput {
  hourly: ForecastPoint[];
  kickoffUTC: string;
  utcOffsetSeconds: number;
  lat: number;
  lon: number;
  airQuality?: AirQualityData | null;
}

export interface MlbGameWeatherNarrativeInput extends GameWeatherNarrativeInput {
  /** Home-plate-through-the-mound-to-center-field compass bearing. Undefined for the few parks stadium-orientations.json doesn't cover yet. */
  stadiumBearingDeg?: number;
}

const DEG2RAD = Math.PI / 180;

function localClock(timeUTCISO: string, utcOffsetSeconds: number): string {
  const ms = Date.parse(timeUTCISO) + utcOffsetSeconds * 1000;
  const d = new Date(ms);
  const h24 = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Circular difference between two compass bearings, in [0, 180]. */
function circularDiff(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function peakPrecipSlot(slots: GameForecastSlot[]): GameForecastSlot {
  let peak = slots[0];
  for (const s of slots) if (s.precipProbability > peak.precipProbability) peak = s;
  return peak;
}

function isSnow(s: GameForecastSlot): boolean {
  return s.tempF <= 32 || /snow/i.test(s.description);
}

/**
 * Generic write-up (NFL/NCAA football/MLS): kickoff through +3.5h, clock
 * times, compass wind. Null when the hourly forecast doesn't reach the
 * game's window yet — never fabricated; callers fall back to the plain
 * high/low/wind summary.
 */
export function buildGameWeatherNarrative(input: GameWeatherNarrativeInput): string | null {
  const slots = getGameWindowForecast(input.hourly, input.kickoffUTC, input.utcOffsetSeconds, 3.5);
  if (slots.length === 0) return null;

  const first = slots[0];
  const last = slots[slots.length - 1];
  const parts: string[] = [];

  parts.push(
    `${first.description} and ${first.tempF}°F at kickoff (${localClock(first.timeUTC, input.utcOffsetSeconds)}), ` +
    `wind ${first.windSpeedMph} mph ${windDirectionLabel(first.windDirectionDeg)}.`,
  );

  const tempDelta = last.tempF - first.tempF;
  if (Math.abs(tempDelta) >= 4) {
    parts.push(`${tempDelta > 0 ? 'Warming' : 'Cooling'} to ${last.tempF}°F by ${localClock(last.timeUTC, input.utcOffsetSeconds)}.`);
  }

  const maxWind = Math.max(...slots.map((s) => s.windSpeedMph));
  const maxGust = Math.max(...slots.map((s) => s.windGustMph));
  if (maxGust >= 20 || maxGust - maxWind >= 6) {
    parts.push(`Gusts up to ${maxGust} mph.`);
  }
  if (circularDiff(first.windDirectionDeg, last.windDirectionDeg) >= 45) {
    parts.push(`Wind shifting from ${windDirectionLabel(first.windDirectionDeg)} to ${windDirectionLabel(last.windDirectionDeg)}.`);
  }

  const peak = peakPrecipSlot(slots);
  if (peak.precipProbability >= 20) {
    parts.push(`${isSnow(peak) ? 'Snow' : 'Rain'} chance peaks at ${peak.precipProbability}% around ${localClock(peak.timeUTC, input.utcOffsetSeconds)}.`);
  }

  const latRad = input.lat * DEG2RAD;
  let glareSlot: GameForecastSlot | null = null;
  for (const s of slots) {
    const { altitude } = getSunPosition(Date.parse(s.timeUTC), latRad, input.lon);
    if (altitude > 0 && altitude < 15) { glareSlot = s; break; }
  }
  if (glareSlot) {
    parts.push(`Low sun near the horizon around ${localClock(glareSlot.timeUTC, input.utcOffsetSeconds)} may cause glare.`);
  }

  if (input.airQuality) {
    parts.push(`Air quality: ${input.airQuality.category} (AQI ${Math.round(input.airQuality.aqi)}).`);
  }

  return parts.join(' ');
}

/**
 * MLB write-up: innings 1-9 instead of clock time, field-relative wind and
 * sun position when the park's orientation is known. Null when the hourly
 * forecast doesn't reach the game yet.
 */
export function buildMlbGameWeatherNarrative(input: MlbGameWeatherNarrativeInput): string | null {
  const slots = getInningForecast(input.hourly, input.kickoffUTC, input.utcOffsetSeconds);
  if (slots.length === 0) return null;

  const bearing = input.stadiumBearingDeg;
  const windPhrase = (s: GameForecastSlot) =>
    bearing !== undefined ? fieldWindLabel(s.windDirectionDeg, bearing).toLowerCase() : windDirectionLabel(s.windDirectionDeg);

  const first = slots[0];
  const last = slots[slots.length - 1];
  const lastInning = inningAtMinutes(last.minutesFromFirstPitch);
  const parts: string[] = [];

  parts.push(`${first.description} and ${first.tempF}°F at first pitch, wind ${first.windSpeedMph} mph — ${windPhrase(first)}.`);

  const tempDelta = last.tempF - first.tempF;
  if (Math.abs(tempDelta) >= 4) {
    parts.push(`${tempDelta > 0 ? 'Warming' : 'Cooling'} to ${last.tempF}°F by around inning ${lastInning}.`);
  }

  const maxWind = Math.max(...slots.map((s) => s.windSpeedMph));
  const maxGust = Math.max(...slots.map((s) => s.windGustMph));
  if (maxGust >= 20 || maxGust - maxWind >= 6) {
    parts.push(`Gusts up to ${maxGust} mph.`);
  }

  const firstPhrase = windPhrase(first);
  const lastPhrase = windPhrase(last);
  if (firstPhrase !== lastPhrase) {
    parts.push(`Wind shifts from ${firstPhrase} to ${lastPhrase} by inning ${lastInning}.`);
  }

  const peak = peakPrecipSlot(slots);
  if (peak.precipProbability >= 20) {
    parts.push(`${isSnow(peak) ? 'Snow' : 'Rain'} chance peaks at ${peak.precipProbability}% around inning ${inningAtMinutes(peak.minutesFromFirstPitch)}.`);
  }

  const humidityDelta = last.humidityPercent - first.humidityPercent;
  if (Math.abs(humidityDelta) >= 15) {
    parts.push(`Humidity ${humidityDelta > 0 ? 'rising' : 'easing'} from ${first.humidityPercent}% to ${last.humidityPercent}% as the game progresses.`);
  }

  const latRad = input.lat * DEG2RAD;
  let glareSlot: GameForecastSlot | null = null;
  let glareAzimuth = 0;
  for (const s of slots) {
    const { altitude, azimuth } = getSunPosition(Date.parse(s.timeUTC), latRad, input.lon);
    if (altitude > 0 && altitude < 15) { glareSlot = s; glareAzimuth = azimuth; break; }
  }
  if (glareSlot) {
    const inning = inningAtMinutes(glareSlot.minutesFromFirstPitch);
    if (bearing !== undefined) {
      parts.push(`Sun glare possible ${sunFieldZoneLabel(glareAzimuth, bearing)} around inning ${inning}.`);
    } else {
      parts.push(`Low sun near the horizon around inning ${inning} may cause glare.`);
    }
  }

  if (input.airQuality) {
    parts.push(`Air quality: ${input.airQuality.category} (AQI ${Math.round(input.airQuality.aqi)}).`);
  }

  return parts.join(' ');
}
