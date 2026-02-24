import type { SolunarData, SolunarPeriod } from './types';
import { getMoonAltitude, getMoonTimes } from './weather-utils';

const DEG2RAD = Math.PI / 180;

// --- Moon transit / underfoot ---

/**
 * Find the time when the moon is at its highest (transit) and lowest (underfoot)
 * points during a local day. Scans in 2-minute increments.
 * Returns minutes since local midnight.
 */
function getMoonTransit(
  year: number, month: number, day: number,
  lat: number, lon: number, utcOffsetSec: number
): { transit: number; underfoot: number } {
  const latRad = lat * DEG2RAD;
  const localMidnightUTC = Date.UTC(year, month - 1, day) - utcOffsetSec * 1000;

  let maxAlt = -Infinity;
  let minAlt = Infinity;
  let transitMin = 720; // default to noon
  let underfootMin = 0;

  for (let m = 0; m <= 1440; m += 2) {
    const alt = getMoonAltitude(localMidnightUTC + m * 60000, latRad, lon);
    if (alt > maxAlt) {
      maxAlt = alt;
      transitMin = m;
    }
    if (alt < minAlt) {
      minAlt = alt;
      underfootMin = m;
    }
  }

  return { transit: transitMin, underfoot: underfootMin };
}

// --- Moon phase ---

/** Known new moon reference: January 11, 2024 11:57 UTC */
const NEW_MOON_REF_MS = Date.UTC(2024, 0, 11, 11, 57, 0);
const SYNODIC_MONTH = 29.53059; // days
const SYNODIC_MS = SYNODIC_MONTH * 86400000;

/**
 * Get moon phase info for a given UTC timestamp.
 * Returns phase name and day within synodic cycle (0 = new moon).
 */
export function getMoonPhase(utcMs: number): { name: string; day: number } {
  const diff = utcMs - NEW_MOON_REF_MS;
  const day = ((diff % SYNODIC_MS) + SYNODIC_MS) % SYNODIC_MS / 86400000;

  let name: string;
  if (day < 1.85) name = 'New Moon';
  else if (day < 7.38) name = 'Waxing Crescent';
  else if (day < 9.23) name = 'First Quarter';
  else if (day < 14.77) name = 'Waxing Gibbous';
  else if (day < 16.61) name = 'Full Moon';
  else if (day < 22.15) name = 'Waning Gibbous';
  else if (day < 23.99) name = 'Last Quarter';
  else if (day < 27.68) name = 'Waning Crescent';
  else name = 'New Moon';

  return { name, day };
}

// --- Solunar rating ---

/**
 * 0-100 rating based on moon phase. Peaks near new moon (day ~0) and full moon (day ~14.76).
 */
export function getSolunarRating(phaseDay: number): number {
  // Distance from nearest new or full moon peak
  const distNew = Math.min(phaseDay, SYNODIC_MONTH - phaseDay);
  const distFull = Math.abs(phaseDay - SYNODIC_MONTH / 2);
  const minDist = Math.min(distNew, distFull);

  // Max distance is ~7.38 days (quarter moon)
  const maxDist = SYNODIC_MONTH / 4;
  const normalized = 1 - minDist / maxDist;
  return Math.round(Math.max(0, Math.min(100, normalized * 100)));
}

// --- Solunar periods ---

function minutesToHHMM(minutes: number): string {
  if (minutes < 0) return '--:--';
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function buildPeriods(
  transit: number, underfoot: number,
  moonrise: number, moonset: number
): SolunarPeriod[] {
  const periods: SolunarPeriod[] = [];

  // Major periods: moon overhead (transit) ±60 min, moon underfoot ±60 min
  if (transit >= 0) {
    periods.push({
      start: minutesToHHMM(Math.max(0, transit - 60)),
      end: minutesToHHMM(Math.min(1440, transit + 60)),
      type: 'major',
      label: 'Moon Overhead',
    });
  }
  if (underfoot >= 0) {
    periods.push({
      start: minutesToHHMM(Math.max(0, underfoot - 60)),
      end: minutesToHHMM(Math.min(1440, underfoot + 60)),
      type: 'major',
      label: 'Moon Underfoot',
    });
  }

  // Minor periods: moonrise ±30 min, moonset ±30 min
  if (moonrise >= 0) {
    periods.push({
      start: minutesToHHMM(Math.max(0, moonrise - 30)),
      end: minutesToHHMM(Math.min(1440, moonrise + 30)),
      type: 'minor',
      label: 'Moonrise',
    });
  }
  if (moonset >= 0) {
    periods.push({
      start: minutesToHHMM(Math.max(0, moonset - 30)),
      end: minutesToHHMM(Math.min(1440, moonset + 30)),
      type: 'minor',
      label: 'Moonset',
    });
  }

  // Sort by start time
  periods.sort((a, b) => a.start.localeCompare(b.start));
  return periods;
}

// --- Main orchestrator ---

/**
 * Calculate full solunar data for a given location and date.
 * @param lat Latitude in degrees
 * @param lon Longitude in degrees
 * @param utcOffsetSec UTC offset in seconds
 * @param dateStr ISO date string (YYYY-MM-DD or full ISO)
 */
export function calculateSolunar(
  lat: number, lon: number, utcOffsetSec: number, dateStr: string
): SolunarData {
  const datePart = dateStr.slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);

  // Moon rise/set
  const moonTimes = getMoonTimes(year, month, day, lat, lon, utcOffsetSec);

  // Moon transit/underfoot
  const { transit, underfoot } = getMoonTransit(year, month, day, lat, lon, utcOffsetSec);

  // Moon phase at noon local time
  const localNoonUTC = Date.UTC(year, month - 1, day, 12) - utcOffsetSec * 1000;
  const phase = getMoonPhase(localNoonUTC);
  const rating = getSolunarRating(phase.day);

  // Build solunar periods
  const periods = buildPeriods(transit, underfoot, moonTimes.rise, moonTimes.set);

  return {
    moonTransit: minutesToHHMM(transit),
    moonUnderfoot: minutesToHHMM(underfoot),
    moonrise: minutesToHHMM(moonTimes.rise),
    moonset: minutesToHHMM(moonTimes.set),
    moonPhase: phase.name,
    phaseDay: phase.day,
    rating,
    periods,
  };
}
