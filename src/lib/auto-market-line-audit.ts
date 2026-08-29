// ── Does this forecast value deserve a real-money market? ─────────────────
//
// Derek, 2026-08-27, after finding two live NCAA markets published at a line
// of 0.5 degrees F at -110: "someone could bet that and wipe us out." The root
// cause is fixed (Open-Meteo null-padding becoming a confident 0), but that
// fixed one cause, not the class. Nothing would have told him if a different
// bad line got published; he found those two by eye.
//
// ⛔ The check that does NOT work here is an absolute range. A "temperature
// must be between 20 and 100" rule would have caught the 0.5 markets and then
// immediately suppressed this same week's genuine forecast of 110F in Lawrence
// KS and 107F in Columbia MO. Extreme weather is the product; a rule that
// silences it is worse than the bug.
//
// So the test is INTERNAL CONSISTENCY instead: a value is trustworthy when the
// rest of the same forecast agrees with it. A 0F game-start temperature
// surrounded by 85F hours is obviously broken. A 110F afternoon surrounded by
// 105F hours is obviously real. That distinction survives any weather.

import type { ForecastResponse } from './types';

/**
 * How far outside the day's own hourly range a value may sit before it is
 * treated as untrustworthy. Generous: a daily high or low legitimately sits a
 * little outside the sampled hourly extremes, and the failures this is aimed
 * at miss by 60 degrees or more, not by 12.
 */
export const PLAUSIBLE_MARGIN_F = 12;

export interface HourlyRange {
  min: number;
  max: number;
  count: number;
}

/** The observed spread of hourly temperatures for one local date. */
export function hourlyRangeForDate(forecast: ForecastResponse, dateStr: string): HourlyRange | null {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const h of forecast.hourly ?? []) {
    if (typeof h.time !== 'string' || !h.time.startsWith(dateStr)) continue;
    const t = h.tempF;
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    if (t < min) min = t;
    if (t > max) max = t;
    count++;
  }
  return count === 0 ? null : { min, max, count };
}

export interface LineAudit {
  ok: boolean;
  /** Operator-facing explanation, present only when ok is false. */
  reason?: string;
  range?: HourlyRange;
}

/**
 * Judge a temperature the engines are about to price a market on, against the
 * same venue's own hourly forecast for that date.
 *
 * Fails closed on missing data: if there are no usable hours for that date we
 * cannot corroborate anything, and pricing an unverifiable number is exactly
 * how the 0.5 markets shipped.
 */
export function auditForecastValue(
  value: number,
  forecast: ForecastResponse,
  dateStr: string,
): LineAudit {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: `value is not a usable number (${String(value)})` };
  }

  const range = hourlyRangeForDate(forecast, dateStr);
  if (!range) {
    return { ok: false, reason: `no hourly temperatures for ${dateStr} to corroborate it against` };
  }

  const low = range.min - PLAUSIBLE_MARGIN_F;
  const high = range.max + PLAUSIBLE_MARGIN_F;
  if (value < low || value > high) {
    return {
      ok: false,
      range,
      reason: `${value}F sits outside that day's own hourly range at this venue `
        + `(${range.min}F to ${range.max}F across ${range.count} hours, allowing ${PLAUSIBLE_MARGIN_F}F either side)`,
    };
  }

  return { ok: true, range };
}
