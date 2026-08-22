// Football (NFL + NCAA) game-window forecast sampling — 4 quarters, one
// hour each, per Derek (2026-08-22): "think 4 hours long, 1 hour per
// quarter as a general rule... quarters 1, 2, 3, 4 like we do with innings
// for baseball, but each is an hour." Reuses the same interpolation
// machinery MLB's inning sampling already established (getGameWindowForecast
// in mlb-game-forecast.ts) rather than inventing a second sampler.

import { getGameWindowForecast, type GameForecastSlot } from './mlb-game-forecast';
import type { ForecastPoint } from './types';

export const QUARTER_STEP_MINUTES = 60;
export const QUARTERS_PER_GAME = 4;

export function quarterAtMinutes(minutes: number): number {
  return Math.min(QUARTERS_PER_GAME, Math.max(1, Math.round(minutes / QUARTER_STEP_MINUTES) + 1));
}

/** Kickoff through the start of the 4th quarter (kickoff + 3h), one sample per quarter — a 4-hour game modeled the same way innings model a 9-inning one. */
export function getQuarterForecast(
  hourly: ForecastPoint[],
  kickoffUTC: string,
  utcOffsetSeconds: number,
): GameForecastSlot[] {
  return getGameWindowForecast(
    hourly,
    kickoffUTC,
    utcOffsetSeconds,
    ((QUARTERS_PER_GAME - 1) * QUARTER_STEP_MINUTES) / 60,
    QUARTER_STEP_MINUTES,
  );
}
