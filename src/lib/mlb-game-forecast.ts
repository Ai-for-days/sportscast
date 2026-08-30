// 30-minute-resolution weather for an MLB game window — from first pitch
// through N hours after (default 5, long enough to cover a regulation game
// plus extras). Built by interpolating the existing hourly forecast (already
// the Wager on Weather blend — see forecast-consensus-live.ts,
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
  /** Minutes since first pitch (0, 30, 60, ... or 0, 20, 40, ... for inning-step sampling). */
  minutesFromFirstPitch: number;
  /** ISO 8601 UTC instant this slot represents. */
  timeUTC: string;
  tempF: number;
  windSpeedMph: number;
  windGustMph: number;
  windDirectionDeg: number;
  precipProbability: number;
  humidityPercent: number;
  description: string;
  /** Added for WES (see wes.ts) — apparent/"feels-like" temperature. */
  feelsLikeF: number;
  /** Added for WES — preferred over relative humidity for comfort scoring. */
  dewPointF: number;
  /** Added for WES — 0-100%. */
  cloudCoverPct: number;
  /** Added for WES — miles. */
  visibilityMiles: number;
  /** Added for WES. */
  uvIndex: number;
  /** Added for WES — precipitation rate in mm/hr (this slot's source hourly point already represents one hour of accumulation). */
  precipMmPerHr: number;
}

/** Each inning is modeled as a fixed 20 minutes (innings 1-3 in hour one,
 * 4-6 in hour two, 7-9 in hour three) — a simplification, not real per-game
 * pace, but enough to phrase weather timing as "around inning N" instead of
 * a clock time. Inning 1 = first pitch (minute 0). */
export const INNING_STEP_MINUTES = 20;
export const INNINGS_PER_GAME = 9;

export function inningAtMinutes(minutes: number): number {
  return Math.min(INNINGS_PER_GAME, Math.max(1, Math.round(minutes / INNING_STEP_MINUTES) + 1));
}

function hourlyPointEpochMs(pt: ForecastPoint, utcOffsetSeconds: number): number {
  // Treat the local wall-clock digits as if they were UTC (forcing 'Z'
  // sidesteps the server's own timezone entirely), then shift by the
  // venue's real offset to recover the true instant.
  const asUtc = Date.parse(`${pt.time}Z`);
  return Number.isFinite(asUtc) ? asUtc - utcOffsetSeconds * 1000 : NaN;
}

/**
 * Straight-line interpolation, refusing to invent a value out of a gap.
 *
 * `null + (null - null) * f` is 0, so before 2026-08-29 a missing reading came
 * out of here as a clean, finite zero: no wind, no humidity, bone dry. That is
 * what made the engines' own `Number.isFinite` guards decorative — nothing
 * non-finite ever reached them. The 2026-08-27 fix dropped whole points with a
 * null TEMPERATURE, which covers the field that priced the 0.5F markets but
 * not the seven others WES scores. Returning NaN instead hands those guards
 * something to catch, and lets computeWesFromSlots drop the slot rather than
 * score a gap as calm, dry weather.
 */
function lerp(a: number, b: number, f: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
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
  stepMinutes = 30,
): GameForecastSlot[] {
  const kickoffMs = Date.parse(kickoffUTC);
  if (!Number.isFinite(kickoffMs) || hourly.length === 0) return [];

  const points = hourly
    .map((pt) => ({ pt, ms: hourlyPointEpochMs(pt, utcOffsetSeconds) }))
    .filter((p) => Number.isFinite(p.ms))
    // 2026-08-27: a point with a null temperature is not a reading of zero
    // degrees. Open-Meteo pads its series past the model horizon with nulls,
    // and lerp(null, null) coerces straight to a clean, plausible-looking 0,
    // which is how two live markets got priced at 0.5 degrees. Dropping the
    // point means the series just ends where the real data ends, so the
    // callers' horizon checks fire the way they were always meant to.
    .filter((p) => Number.isFinite(p.pt.tempF))
    .sort((a, b) => a.ms - b.ms);
  if (points.length === 0) return [];

  const slots: GameForecastSlot[] = [];
  let cursor = 0;
  for (let minutes = 0; minutes <= hoursAfter * 60; minutes += stepMinutes) {
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
      humidityPercent: Math.round(lerp(lo.pt.humidity, hi.pt.humidity, f)),
      description: f < 0.5 ? lo.pt.description : hi.pt.description,
      feelsLikeF: lerp(lo.pt.feelsLikeF, hi.pt.feelsLikeF, f),
      dewPointF: lerp(lo.pt.dewPointF, hi.pt.dewPointF, f),
      cloudCoverPct: lerp(lo.pt.cloudCover, hi.pt.cloudCover, f),
      visibilityMiles: lerp(lo.pt.visibility, hi.pt.visibility, f),
      uvIndex: lerp(lo.pt.uvIndex, hi.pt.uvIndex, f),
      precipMmPerHr: lerp(lo.pt.precipMm, hi.pt.precipMm, f),
    });
  }
  return slots;
}

/** Same sampling, aligned to each of the 9 innings (see INNING_STEP_MINUTES). */
export function getInningForecast(
  hourly: ForecastPoint[],
  kickoffUTC: string,
  utcOffsetSeconds: number,
): GameForecastSlot[] {
  return getGameWindowForecast(
    hourly,
    kickoffUTC,
    utcOffsetSeconds,
    ((INNINGS_PER_GAME - 1) * INNING_STEP_MINUTES) / 60,
    INNING_STEP_MINUTES,
  );
}
