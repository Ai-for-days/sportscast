import { getWager, listAllWagers, gradeWager } from './wager-store';
import { settleWagerBets } from './bet-settlement';
import { fetchDayObservations, getObservedValue } from './nws-observations';
import type { Wager, OddsWager, OverUnderWager, PointspreadWager } from './wager-types';

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
    // Value didn't land in any defined range — push
    return 'push';
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

  // Must be past the target date + brief buffer for NWS to publish
  // Use 06:00 UTC next day (~midnight+ for US timezones) + 15min buffer
  const nextDay = new Date(`${wager.targetDate}T06:00:00Z`);
  nextDay.setDate(nextDay.getDate() + 1);
  const now = Date.now();
  if (now < nextDay.getTime() + 15 * 60 * 1000) return null;

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
