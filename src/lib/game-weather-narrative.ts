// Prose weather write-up for a game window — first pitch/kickoff through 3.5
// hours later — built from the same 30-minute WagerOnWeather Consensus
// samples the stadium wind diagram already uses (getGameWindowForecast in
// mlb-game-forecast.ts; despite the filename it's sport-agnostic, just
// hourly-forecast interpolation, so it's reused as-is for every league on
// the Weatherboard rather than duplicated).
//
// Sun-glare uses a Meeus low-precision solar-altitude calculation
// (getSunAltitude, weather-utils.ts) against the venue's own lat/lon — not
// tied to a specific stadium's home-plate orientation, so it's phrased as a
// general "low sun" note rather than a batter's-eye claim.

import type { ForecastPoint, AirQualityData } from './types';
import { getGameWindowForecast, type GameForecastSlot } from './mlb-game-forecast';
import { windDirectionLabel, getSunAltitude } from './weather-utils';

export interface GameWeatherNarrativeInput {
  hourly: ForecastPoint[];
  kickoffUTC: string;
  utcOffsetSeconds: number;
  lat: number;
  lon: number;
  airQuality?: AirQualityData | null;
  /** "first pitch" for MLB, "kickoff" for everything else (default). */
  startLabel?: string;
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

/**
 * Null when the hourly forecast doesn't reach the game's window yet (too
 * far out) — never fabricated, matches getGameWindowForecast's own
 * contract. Callers should fall back to the plain high/low/wind summary.
 */
export function buildGameWeatherNarrative(input: GameWeatherNarrativeInput): string | null {
  const slots = getGameWindowForecast(input.hourly, input.kickoffUTC, input.utcOffsetSeconds, 3.5);
  if (slots.length === 0) return null;

  const first = slots[0];
  const last = slots[slots.length - 1];
  const startLabel = input.startLabel ?? 'kickoff';
  const parts: string[] = [];

  parts.push(
    `${first.description} and ${first.tempF}°F at ${startLabel} (${localClock(first.timeUTC, input.utcOffsetSeconds)}), ` +
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

  let peak: GameForecastSlot = slots[0];
  for (const s of slots) if (s.precipProbability > peak.precipProbability) peak = s;
  if (peak.precipProbability >= 20) {
    const isSnow = peak.tempF <= 32 || /snow/i.test(peak.description);
    parts.push(`${isSnow ? 'Snow' : 'Rain'} chance peaks at ${peak.precipProbability}% around ${localClock(peak.timeUTC, input.utcOffsetSeconds)}.`);
  }

  const latRad = input.lat * DEG2RAD;
  let glareSlot: GameForecastSlot | null = null;
  for (const s of slots) {
    const alt = getSunAltitude(Date.parse(s.timeUTC), latRad, input.lon);
    if (alt > 0 && alt < 15) { glareSlot = s; break; }
  }
  if (glareSlot) {
    parts.push(`Low sun near the horizon around ${localClock(glareSlot.timeUTC, input.utcOffsetSeconds)} may cause glare.`);
  }

  if (input.airQuality) {
    parts.push(`Air quality: ${input.airQuality.category} (AQI ${Math.round(input.airQuality.aqi)}).`);
  }

  return parts.join(' ');
}
