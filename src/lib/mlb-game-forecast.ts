// 30-minute-resolution weather for an MLB game window — from first pitch
// through N hours after (default 5, long enough to cover a regulation game
// plus extras). Built by interpolating the existing hourly forecast (already
// the WagerOnWeather Consensus blend — see forecast-consensus-live.ts,
// applied inside getForecast()) rather than fetching anything new.
//
// Open-Meteo's hourly `time` strings are LOCAL to the venue with NO
// timezone suffix (timezone=auto — see open-meteo.ts's own comment on this).
// A bare `new Date(pt.time)` is environment-dependent: verified directly in
// this Node runtime that `new Date('2026-02-18T09:00')` parses using the
// SERVER's local offset, not UTC and not the venue's. The only safe move is
// to force UTC onto the wall-clock digits (append 'Z') and then apply the
// venue's real utcOffsetSeconds ourselves — the same category of fix
// weather-utils.ts's parseLocalHour/parseLocalMinute exist for.
//
// Wind direction is a circular quantity — linearly blending 350deg and
// 10deg gives 180, exactly backwards. Interpolating via unit-vector
// components and recovering the angle with atan2 is the same fix
// wind-particles.ts documents for the spatial wind field, applied here to a
// temporal one.

import type { ForecastPoint } from './types';

export interface GameForecastSlot {
  /** Minutes since first pitch (0, 30, 60, ...). */
  minutesFromFirstPitch: number;
  /** ISO 8601 UTC instant this slot represents. */
  timeUTC: string;
  tempF: number;
  windSpeedMph: number;
  windGustMph: number;
  windDirectionDeg: number;
  precipProbability: number;
  description: string;
}

function hourlyPointEpochMs(pt: ForecastPoint, utcOffsetSeconds: number): number {
  // Treat the local wall-clock digits as if they were UTC (forcing 'Z'
  // sidesteps the server's own timezone entirely), then shift by the
  // venue's real offset to recover the true instant.
  const asUtc = Date.parse(`${pt.time}Z`);
  return Number.isFinite(asUtc) ? asUtc - utcOffsetSeconds * 1000 : NaN;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** Circular interpolation between two compass bearings (degrees), weighted toward b by f. */
function lerpDirection(a: number, b: number, f: number): number {
  const rad = Math.PI / 180;
  const x = lerp(Math.cos(a * rad), Math.cos(b * rad), f);
  const y = lerp(Math.sin(a * rad), Math.sin(b * rad), f);
  const deg = Math.atan2(y, x) / rad;
  return (deg + 360) % 360;
}

/**
 * Sample the hourly forecast at 30-minute intervals from `kickoffUTC`
 * through `hoursAfter` later. Slots outside the hourly array's coverage are
 * omitted (never fabricated) — callers should treat a short/empty result as
 * "forecast not available that far out yet."
 */
export function getGameWindowForecast(
  hourly: ForecastPoint[],
  kickoffUTC: string,
  utcOffsetSeconds: number,
  hoursAfter = 5,
): GameForecastSlot[] {
  const kickoffMs = Date.parse(kickoffUTC);
  if (!Number.isFinite(kickoffMs) || hourly.length === 0) return [];

  const points = hourly
    .map((pt) => ({ pt, ms: hourlyPointEpochMs(pt, utcOffsetSeconds) }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms);
  if (points.length === 0) return [];

  const slots: GameForecastSlot[] = [];
  let cursor = 0;
  for (let minutes = 0; minutes <= hoursAfter * 60; minutes += 30) {
    const targetMs = kickoffMs + minutes * 60000;
    if (targetMs < points[0].ms || targetMs > points[points.length - 1].ms) continue;

    while (cursor < points.length - 2 && points[cursor + 1].ms < targetMs) cursor++;
    const lo = points[cursor];
    const hi = points[Math.min(cursor + 1, points.length - 1)];
    const span = hi.ms - lo.ms;
    const f = span > 0 ? Math.min(1, Math.max(0, (targetMs - lo.ms) / span)) : 0;

    slots.push({
      minutesFromFirstPitch: minutes,
      timeUTC: new Date(targetMs).toISOString(),
      tempF: Math.round(lerp(lo.pt.tempF, hi.pt.tempF, f)),
      windSpeedMph: Math.round(lerp(lo.pt.windSpeedMph, hi.pt.windSpeedMph, f)),
      windGustMph: Math.round(lerp(lo.pt.windGustMph, hi.pt.windGustMph, f)),
      windDirectionDeg: Math.round(lerpDirection(lo.pt.windDirectionDeg, hi.pt.windDirectionDeg, f)),
      precipProbability: Math.round(lerp(lo.pt.precipProbability, hi.pt.precipProbability, f)),
      description: f < 0.5 ? lo.pt.description : hi.pt.description,
    });
  }
  return slots;
}
