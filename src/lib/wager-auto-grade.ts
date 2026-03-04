import { getWager, listAllWagers, gradeWager } from './wager-store';
import { settleWagerBets } from './bet-settlement';
import { fetchDayObservations, getObservedValue } from './nws-observations';
import type { Wager, OddsWager, OverUnderWager, PointspreadWager } from './wager-types';

/**
 * Determine when a wager "ends" in UTC milliseconds.
 * - If targetTime is set: end of that hour on targetDate in the location's timezone
 * - Otherwise: end of targetDate (23:59:59) in the location's timezone
 * Falls back to lockTime if no location timezone available.
 */
function getWagerEndTimeMs(wager: Wager): number {
  // Get the location timezone
  let tz: string | undefined;
  if (wager.kind === 'odds' || wager.kind === 'over-under') {
    tz = (wager as OddsWager | OverUnderWager).location?.timeZone;
  } else if (wager.kind === 'pointspread') {
    tz = (wager as PointspreadWager).locationA?.timeZone;
  }

  if (tz) {
    // Calculate timezone offset
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
    const parts = formatter.formatToParts(new Date(`${wager.targetDate}T12:00:00`));
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
    const offsetMatch = tzPart.match(/GMT([+-]?\d+)?(?::(\d+))?/);
    let offsetMinutes = 0;
    if (offsetMatch) {
      const hours = parseInt(offsetMatch[1] || '0', 10);
      const mins = parseInt(offsetMatch[2] || '0', 10);
      offsetMinutes = hours * 60 + (hours < 0 ? -mins : mins);
    }

    if (wager.targetTime) {
      // End = targetTime on targetDate in local tz → convert to UTC
      const localMs = new Date(`${wager.targetDate}T${wager.targetTime}:00`).getTime();
      return localMs - offsetMinutes * 60 * 1000;
    }
    // End of local day → UTC
    const localEndMs = new Date(`${wager.targetDate}T23:59:59`).getTime();
    return localEndMs - offsetMinutes * 60 * 1000;
  }

  // Fallback: use lockTime
  return new Date(wager.lockTime).getTime();
}

interface AutoGradeResult {
  wagerId: string;
  title: string;
  observedValue: number;
  winningOutcome: string;
  settlement: { won: number; lost: number; pushed: number };
}

/**
 * Determine the winning outcome from an observed value and wager definition.
 */
function determineOutcome(wager: Wager, observedValue: number): string {
  if (wager.kind === 'over-under') {
    const ou = wager as OverUnderWager;
    if (observedValue > ou.line) return 'over';
    if (observedValue < ou.line) return 'under';
    return 'push';
  }

  if (wager.kind === 'odds') {
    const ow = wager as OddsWager;
    for (const o of ow.outcomes) {
      if (observedValue >= o.minValue && observedValue <= o.maxValue) return o.label;
    }
    // Value didn't land in any defined range — all bets lose (not a push)
    return 'no_match';
  }

  // pointspread is handled separately (needs two values)
  return 'push';
}

/**
 * Auto-grade a single wager by fetching NWS observations.
 * Returns null if not enough data yet or wager can't be auto-graded.
 */
export async function autoGradeSingleWager(wagerId: string): Promise<AutoGradeResult | null> {
  const wager = await getWager(wagerId);
  if (!wager) return null;
  if (wager.status !== 'open' && wager.status !== 'locked') return null;

  // Must be past the wager's end time + 15 min buffer for NWS to publish
  const now = Date.now();
  const wagerEndMs = getWagerEndTimeMs(wager);
  if (now < wagerEndMs + 15 * 60 * 1000) return null;

  if (wager.kind === 'pointspread') {
    return autoGradePointspread(wager as PointspreadWager);
  }

  // Single-location wagers (odds, over-under)
  const location = (wager as OddsWager | OverUnderWager).location;
  if (!location?.stationId) return null;

  const observations = await fetchDayObservations(location.stationId, wager.targetDate, location.timeZone);
  if (observations.length < 4) return null; // Not enough data

  const observedValue = getObservedValue(observations, wager.metric, wager.targetTime, location.timeZone);
  if (observedValue === null) return null;

  const winningOutcome = determineOutcome(wager, observedValue);

  const graded = await gradeWager(wagerId, observedValue, winningOutcome);
  if (!graded) return null;

  const settlement = await settleWagerBets(wagerId);

  return {
    wagerId,
    title: wager.title,
    observedValue,
    winningOutcome,
    settlement: { won: settlement.won, lost: settlement.lost, pushed: settlement.pushed },
  };
}

/**
 * Auto-grade a pointspread wager (needs observations from two stations).
 */
async function autoGradePointspread(wager: PointspreadWager): Promise<AutoGradeResult | null> {
  if (!wager.locationA?.stationId || !wager.locationB?.stationId) return null;

  const [obsA, obsB] = await Promise.all([
    fetchDayObservations(wager.locationA.stationId, wager.targetDate, wager.locationA.timeZone),
    fetchDayObservations(wager.locationB.stationId, wager.targetDate, wager.locationB.timeZone),
  ]);

  if (obsA.length < 4 || obsB.length < 4) return null;

  const valueA = getObservedValue(obsA, wager.metric, wager.targetTime, wager.locationA.timeZone);
  const valueB = getObservedValue(obsB, wager.metric, wager.targetTime, wager.locationB.timeZone);

  if (valueA === null || valueB === null) return null;

  const actualDiff = valueA - valueB;
  // locationA "covers" if the actual diff exceeds the spread
  let winningOutcome: string;
  if (actualDiff > wager.spread) {
    winningOutcome = 'locationA';
  } else if (actualDiff < wager.spread) {
    winningOutcome = 'locationB';
  } else {
    winningOutcome = 'push';
  }

  // Store both observed values — use valueA as primary observed
  const graded = await gradeWager(wager.id, valueA, winningOutcome);
  if (!graded) return null;

  const settlement = await settleWagerBets(wager.id);

  return {
    wagerId: wager.id,
    title: wager.title,
    observedValue: valueA,
    winningOutcome,
    settlement: { won: settlement.won, lost: settlement.lost, pushed: settlement.pushed },
  };
}

/**
 * Auto-grade ALL eligible wagers (expired, ungraded, target date passed).
 */
export async function autoGradeAllWagers(): Promise<{
  graded: AutoGradeResult[];
  skipped: number;
  locked: number;
  errors: string[];
}> {
  const result = { graded: [] as AutoGradeResult[], skipped: 0, locked: 0, errors: [] as string[] };

  const allWagers = await listAllWagers(200);
  const now = Date.now();
  const todayStr = new Date().toISOString().split('T')[0];

  // Step 1: Auto-lock any open wagers whose lockTime OR targetDate has passed
  for (const w of allWagers) {
    if (w.status === 'open') {
      const lockTimePassed = new Date(w.lockTime).getTime() <= now;
      const targetDatePassed = w.targetDate < todayStr;
      if (lockTimePassed || targetDatePassed) {
        try {
          const { lockExpiredSingle } = await import('./wager-store');
          const locked = await lockExpiredSingle(w.id);
          if (locked) result.locked++;
        } catch { /* ignore lock errors */ }
      }
    }
  }

  // Step 2: Re-fetch to get updated statuses, then find eligible wagers
  const refreshed = await listAllWagers(200);
  const eligible = refreshed.filter(w =>
    (w.status === 'open' || w.status === 'locked') &&
    (new Date(w.lockTime).getTime() <= now || w.targetDate < todayStr)
  );

  for (const wager of eligible) {
    try {
      const gradeResult = await autoGradeSingleWager(wager.id);
      if (gradeResult) {
        result.graded.push(gradeResult);
      } else {
        result.skipped++;
      }
    } catch (err: any) {
      result.errors.push(`${wager.id} (${wager.title}): ${err.message}`);
    }
  }

  return result;
}
