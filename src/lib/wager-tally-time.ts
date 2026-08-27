// ── When a wager is tallied ────────────────────────────────────────────────
//
// Per Derek (2026-08-27), defining what "the time on a wager" means:
//
//   "if the wager is day temp, then the time would be 11:59pm local time at
//    the venue in the time zone with the earliest time. Other wagers would
//    have the same eastern time as the start of the game."
//
//   "lock time isn't the same as the time we put on the wagers because the
//    time we put on the wagers is when that wager is tallied."
//
// So this is NOT the lock time. A market locks 3 hours before kickoff and is
// tallied later, when the weather it is measuring is finally known. Those are
// two different moments and the customer needs both.
//
// ⛔ Display only. Nothing here feeds grading. Verified before writing it:
// nws-grading.ts's getObservedValue() consults `targetTime` only when the
// metric is `actual_temp`; a high_temp or low_temp wager grades against the
// day's aggregate no matter what time is attached to it. That is exactly why
// a day-temp wager can carry a tally time safely.

import type { Wager, WagerMetric } from './wager-types';
import { localTimeToUTC } from './wager-store';

/** Day-temp metrics resolve on a whole calendar day, not a moment in it. */
function isDayMetric(m: WagerMetric): boolean {
  return m === 'high_temp' || m === 'low_temp';
}

/** Every metric this wager actually resolves on, including both sides. */
function metricsOf(w: Wager): WagerMetric[] {
  const psw = w as { metricA?: WagerMetric; metricB?: WagerMetric };
  return [w.metric, psw.metricA, psw.metricB].filter(Boolean) as WagerMetric[];
}

/** Every location this wager grades against. */
function locationsOf(w: Wager): { name: string; timeZone: string }[] {
  const any = w as {
    location?: { name: string; timeZone: string };
    locationA?: { name: string; timeZone: string };
    locationB?: { name: string; timeZone: string };
  };
  return [any.location, any.locationA, any.locationB]
    .filter((l): l is { name: string; timeZone: string } => !!l?.timeZone);
}

/** A zone's UTC offset in minutes at a given instant. West is more negative. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  // Intl gives us the local wall clock in that zone; the gap between that and
  // the same fields read as UTC is the offset. Handles DST because it asks
  // about a specific instant rather than assuming a fixed rule.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0');
  const hour = get('hour') === 24 ? 0 : get('hour');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The venue whose clock reads earliest, which is the westernmost one.
 *
 * This is the tie-break Derek specified for a wager that spans two venues in
 * different zones, and it is also the only one that can be right: a daily high
 * is not final until that venue's calendar day is over, so tallying has to wait
 * for the venue whose midnight comes last in real time. That is the same venue
 * whose clock currently reads earliest.
 */
export function westernmostLocation<T extends { timeZone: string }>(locations: T[], at: Date): T | null {
  if (locations.length === 0) return null;
  return locations.reduce((west, cur) =>
    zoneOffsetMinutes(cur.timeZone, at) < zoneOffsetMinutes(west.timeZone, at) ? cur : west);
}

export interface WagerTallyTime {
  /** 24-hour "HH:MM" in `timeZone`. */
  time: string;
  /** IANA zone the time is expressed in. */
  timeZone: string;
  /** Display label, e.g. "11:59 PM CDT". */
  label: string;
  /** Which rule produced it, for callers that want to explain themselves. */
  basis: 'end-of-day' | 'game-time';
}

/** "11:59 PM CDT" for a wall clock on a given date in a given zone. */
export function formatTallyLabel(dateStr: string, time: string, timeZone: string): string {
  const instant = localTimeToUTC(dateStr, time, timeZone);
  if (Number.isNaN(instant.getTime())) return time;
  return new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  }).format(instant);
}

/**
 * When this wager gets tallied, or null when there is nothing meaningful to
 * show (a metric with no time basis and no target time on the record).
 */
export function wagerTallyTime(w: Wager): WagerTallyTime | null {
  const reference = localTimeToUTC(w.targetDate, '12:00', 'UTC');
  const at = Number.isNaN(reference.getTime()) ? new Date() : reference;

  // Day temp: the whole calendar day counts, so it is tallied at the end of it,
  // at whichever venue's day ends last.
  if (metricsOf(w).some(isDayMetric)) {
    const west = westernmostLocation(locationsOf(w), at);
    if (!west) return null;
    return {
      time: '23:59',
      timeZone: west.timeZone,
      label: formatTallyLabel(w.targetDate, '23:59', west.timeZone),
      basis: 'end-of-day',
    };
  }

  // Everything else is a by-time wager, tallied at the moment on the record.
  // For the auto-created "at game start" markets that is kickoff, and their
  // location timeZone is deliberately ET (see auto-market-shared.ts), so this
  // renders as Eastern exactly as Derek specified. A hand-built wager carries
  // its venue's real zone and is labeled honestly with that instead.
  if (w.targetTime) {
    const loc = locationsOf(w)[0];
    if (!loc) return null;
    return {
      time: w.targetTime,
      timeZone: loc.timeZone,
      label: formatTallyLabel(w.targetDate, w.targetTime, loc.timeZone),
      basis: 'game-time',
    };
  }

  return null;
}
