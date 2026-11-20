// Sunrise, sunset, first light and last light, computed here (DBD 2026-11-20).
//
// Why not just show Open-Meteo's sunrise/sunset: Open-Meteo returns HH:MM with the
// seconds cut off, so its times read up to a minute early next to the U.S. Naval
// Observatory, timeanddate.com and phone weather apps, which all round. Open-Meteo
// also has no twilight times, and "first light" / "last light" need them.
//
// "First light" and "last light" are civil dawn and civil dusk: the sun 6 degrees
// below the horizon, the definition the USNO, NOAA and Apple Weather use. Sunrise
// and sunset are the sun's upper edge on the horizon with standard refraction
// (altitude -0.833 degrees).
//
// Method: NOAA's solar calculator (Meeus, Astronomical Algorithms ch. 25 and the
// equation of time), solved for the hour angle and then iterated twice at the event
// time itself, so the sun's motion during the day is accounted for. Checked against
// the USNO for six US cities on three dates in tests/sun-times.test.ts: every time
// matches to the minute or within one minute.

const RAD = Math.PI / 180;

function solar(jd: number): { decl: number; eqTimeMin: number } {
  const T = (jd - 2451545.0) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
    + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD);
  return { decl, eqTimeMin: (4 * eqTime) / RAD };
}

/**
 * Minutes after local midnight (rounded to the nearest minute) when the sun's
 * centre crosses `altitudeDeg` on the given local date, rising or setting.
 * Returns -1 when it does not cross that altitude that day (polar day or night).
 */
function sunEvent(y: number, m: number, d: number, lat: number, lon: number, utcOffsetSec: number, altitudeDeg: number, rising: boolean): number {
  const jd0 = Date.UTC(y, m - 1, d) / 86400000 + 2440587.5; // 0h UTC of the date
  let utcMin = 720 - 4 * lon; // first guess: solar noon, in minutes of UTC
  for (let i = 0; i < 3; i++) {
    const { decl, eqTimeMin } = solar(jd0 + utcMin / 1440);
    const cosH = (Math.sin(altitudeDeg * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD))
      / (Math.cos(lat * RAD) * Math.cos(decl * RAD));
    if (cosH > 1 || cosH < -1) return -1;
    const H = Math.acos(cosH) / RAD;
    utcMin = 720 - 4 * (lon + (rising ? H : -H)) - eqTimeMin;
  }
  return Math.round(utcMin + utcOffsetSec / 60);
}

export interface SunTimes {
  firstLight: number;
  sunrise: number;
  sunset: number;
  lastLight: number;
}

/** All four times for one local date, as minutes after local midnight (-1 = none). */
export function getSunTimes(y: number, m: number, d: number, lat: number, lon: number, utcOffsetSec: number): SunTimes {
  return {
    firstLight: sunEvent(y, m, d, lat, lon, utcOffsetSec, -6, true),
    sunrise: sunEvent(y, m, d, lat, lon, utcOffsetSec, -0.833, true),
    sunset: sunEvent(y, m, d, lat, lon, utcOffsetSec, -0.833, false),
    lastLight: sunEvent(y, m, d, lat, lon, utcOffsetSec, -6, false),
  };
}
