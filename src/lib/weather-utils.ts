import type { ForecastPoint, PlayabilityRating, SportType, SportsMetrics } from './types';

export function kToF(k: number): number {
  return Math.round((k - 273.15) * 9 / 5 + 32);
}

export function kToC(k: number): number {
  return Math.round(k - 273.15);
}

export function fToC(f: number): number {
  return Math.round((f - 32) * 5 / 9);
}

export function windSpeed(u: number, v: number): number {
  return Math.round(Math.sqrt(u * u + v * v) * 2.237); // m/s to mph
}

export function windDirection(u: number, v: number): number {
  return Math.round((270 - Math.atan2(v, u) * 180 / Math.PI) % 360);
}

export function windDirectionLabel(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

export function heatIndex(tempF: number, rh: number): number | null {
  if (tempF < 80 || rh < 40) return null;
  const t = tempF;
  const r = rh;
  let hi = -42.379 + 2.04901523 * t + 10.14333127 * r
    - 0.22475541 * t * r - 0.00683783 * t * t
    - 0.05481717 * r * r + 0.00122874 * t * t * r
    + 0.00085282 * t * r * r - 0.00000199 * t * t * r * r;
  return Math.round(hi);
}

export function windChill(tempF: number, windMph: number): number | null {
  if (tempF >= 50 || windMph <= 3) return null;
  const wc = 35.74 + 0.6215 * tempF - 35.75 * Math.pow(windMph, 0.16)
    + 0.4275 * tempF * Math.pow(windMph, 0.16);
  return Math.round(wc);
}

export function feelsLike(tempF: number, rh: number, windMph: number): number {
  const hi = heatIndex(tempF, rh);
  if (hi !== null) return hi;
  const wc = windChill(tempF, windMph);
  if (wc !== null) return wc;
  return tempF;
}

const sportThresholds: Record<SportType, {
  maxWindMph: number;
  maxPrecipProbability: number;
  minTempF: number;
  maxTempF: number;
  maxHeatIndex: number;
  notes: string[];
}> = {
  baseball: {
    maxWindMph: 35,
    maxPrecipProbability: 60,
    minTempF: 35,
    maxTempF: 105,
    maxHeatIndex: 110,
    notes: ['Wind over 25 mph affects fly balls significantly', 'Rain delay likely above 50% precip probability'],
  },
  football: {
    maxWindMph: 45,
    maxPrecipProbability: 80,
    minTempF: 0,
    maxTempF: 110,
    maxHeatIndex: 115,
    notes: ['Wind over 30 mph affects passing game', 'Cold weather favors running game'],
  },
  soccer: {
    maxWindMph: 40,
    maxPrecipProbability: 70,
    minTempF: 35,
    maxTempF: 105,
    maxHeatIndex: 110,
    notes: ['Lightning requires play stoppage', 'Wet fields increase injury risk'],
  },
  tennis: {
    maxWindMph: 20,
    maxPrecipProbability: 30,
    minTempF: 40,
    maxTempF: 100,
    maxHeatIndex: 105,
    notes: ['Any rain typically stops play on hard courts', 'Wind significantly affects serve accuracy'],
  },
  golf: {
    maxWindMph: 30,
    maxPrecipProbability: 50,
    minTempF: 35,
    maxTempF: 105,
    maxHeatIndex: 110,
    notes: ['Lightning protocol: immediate evacuation', 'Wind over 20 mph makes scoring very difficult'],
  },
  youth: {
    maxWindMph: 25,
    maxPrecipProbability: 40,
    minTempF: 40,
    maxTempF: 95,
    maxHeatIndex: 100,
    notes: ['Youth athletes more susceptible to heat illness', 'Wind chill below 20F: limit outdoor exposure'],
  },
};

export function assessPlayability(
  forecast: ForecastPoint,
  sport: SportType = 'youth'
): SportsMetrics {
  const thresholds = sportThresholds[sport];
  const hi = heatIndex(forecast.tempF, forecast.humidity);
  const wc = windChill(forecast.tempF, forecast.windSpeedMph);
  const notes: string[] = [];
  let score = 100;

  // Temperature checks
  if (forecast.tempF < thresholds.minTempF) {
    score -= 50;
    notes.push(`Temperature ${forecast.tempF}F is below the ${thresholds.minTempF}F minimum for ${sport}`);
  } else if (forecast.tempF > thresholds.maxTempF) {
    score -= 50;
    notes.push(`Temperature ${forecast.tempF}F exceeds the ${thresholds.maxTempF}F maximum for ${sport}`);
  }

  // Heat index
  if (hi !== null && hi > thresholds.maxHeatIndex) {
    score -= 40;
    notes.push(`Heat index of ${hi}F exceeds safety threshold of ${thresholds.maxHeatIndex}F`);
  } else if (hi !== null && hi > thresholds.maxHeatIndex - 10) {
    score -= 20;
    notes.push(`Heat index of ${hi}F approaching safety limit`);
  }

  // Wind chill
  if (wc !== null && wc < 0) {
    score -= 65;
    notes.push(`Wind chill of ${wc}F — extreme cold, unsafe for outdoor play`);
  } else if (wc !== null && wc < 10) {
    score -= 50;
    notes.push(`Wind chill of ${wc}F — dangerous cold, high frostbite risk`);
  } else if (wc !== null && wc < 20) {
    score -= 35;
    notes.push(`Wind chill of ${wc}F — frostbite risk on exposed skin`);
  } else if (wc !== null && wc < 32) {
    score -= 20;
    notes.push(`Wind chill of ${wc}F — dress warmly, monitor for cold stress`);
  }

  // Wind
  if (forecast.windSpeedMph > thresholds.maxWindMph) {
    score -= 40;
    notes.push(`Wind speed ${forecast.windSpeedMph} mph exceeds ${sport} safety threshold of ${thresholds.maxWindMph} mph`);
  } else if (forecast.windSpeedMph > thresholds.maxWindMph * 0.7) {
    score -= 15;
    notes.push(`Wind speed ${forecast.windSpeedMph} mph is elevated for ${sport}`);
  }

  // Precipitation
  if (forecast.precipProbability > thresholds.maxPrecipProbability) {
    score -= 35;
    notes.push(`${forecast.precipProbability}% chance of precipitation exceeds ${sport} threshold`);
  } else if (forecast.precipProbability > thresholds.maxPrecipProbability * 0.6) {
    score -= 15;
    notes.push(`${forecast.precipProbability}% chance of precipitation — monitor conditions`);
  }

  // Add sport-specific notes
  thresholds.notes.forEach(note => {
    if (forecast.windSpeedMph > thresholds.maxWindMph * 0.6 && note.toLowerCase().includes('wind')) {
      notes.push(note);
    }
  });

  score = Math.max(0, score);

  let playability: PlayabilityRating;
  let recommendation: SportsMetrics['recommendation'];

  if (score >= 80) {
    playability = 'excellent';
    recommendation = 'play';
  } else if (score >= 60) {
    playability = 'good';
    recommendation = 'play';
  } else if (score >= 40) {
    playability = 'fair';
    recommendation = 'monitor';
  } else if (score >= 20) {
    playability = 'poor';
    recommendation = 'delay';
  } else {
    playability = 'dangerous';
    recommendation = 'cancel';
  }

  let precipRisk: SportsMetrics['precipRisk'];
  if (forecast.precipProbability < 10) precipRisk = 'none';
  else if (forecast.precipProbability < 30) precipRisk = 'low';
  else if (forecast.precipProbability < 60) precipRisk = 'moderate';
  else precipRisk = 'high';

  return {
    playability,
    heatIndex: hi,
    windChill: wc,
    precipRisk,
    sportNotes: notes,
    recommendation,
  };
}

export function getWeatherIcon(description: string, isNight: boolean = false): string {
  const d = description.toLowerCase();
  if (d.includes('thunder') || d.includes('storm'))
    return '/icons/weather/weather_icon_set3_01.png';
  if (d.includes('freezing') || d.includes('sleet'))
    return '/icons/weather/weather_icon_set2_04.png';
  if (d.includes('heavy rain') || d.includes('downpour'))
    return isNight ? '/icons/weather/weather_icon_02.png' : '/icons/weather/weather_icon_05.png';
  if (d.includes('rain') || d.includes('drizzle') || d.includes('shower'))
    return isNight ? '/icons/weather/weather_icon_set4_06.png' : '/icons/weather/weather_icon_set4_09.png';
  if (d.includes('heavy snow') || d.includes('blizzard'))
    return isNight ? '/icons/weather/weather_icon_set2_10.png' : '/icons/weather/weather_icon_set2_09.png';
  if (d.includes('snow'))
    return isNight ? '/icons/weather/weather_icon_set2_10.png' : '/icons/weather/weather_icon_set2_06.png';
  if (d.includes('fog') || d.includes('mist') || d.includes('haze'))
    return '/icons/weather/weather_icon_set4_11.png';
  if (d.includes('overcast'))
    return '/icons/weather/weather_icon_set4_16.png';
  if (d.includes('mostly cloudy') || d.includes('cloudy'))
    return '/icons/weather/weather_icon_set4_16.png';
  if (d.includes('partly') || d.includes('scattered'))
    return isNight ? '/icons/weather/weather_icon_set4_04.png' : '/icons/weather/weather_icon_set4_12.png';
  return isNight ? '/icons/weather/weather_icon_set4_14.png' : '/icons/weather/weather_icon_set4_13.png';
}

export function describeWeather(tempF: number, humidity: number, precipProb: number, windMph: number, cloudCover: number): string {
  if (precipProb > 70 && tempF < 32) return 'Snow likely';
  if (precipProb > 70) return 'Rain likely';
  if (precipProb > 40 && tempF < 32) return 'Chance of snow';
  if (precipProb > 40) return 'Chance of rain';
  if (cloudCover > 80) return 'Overcast';
  if (cloudCover > 50) return 'Mostly cloudy';
  if (cloudCover > 20) return 'Partly cloudy';
  return 'Clear';
}

export function formatTemp(tempF: number, unit: 'F' | 'C' = 'F'): string {
  if (unit === 'C') return `${fToC(tempF)}°C`;
  return `${Math.round(tempF)}°F`;
}

/**
 * Parse the hour (0-23) from an Open-Meteo local time string like "2026-02-18T09:00" or "2026-02-18T09:15".
 * This avoids JavaScript Date timezone corruption.
 */
export function parseLocalHour(timeStr: string): number {
  const match = timeStr.match(/T(\d{2})/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Parse the minute from an Open-Meteo local time string.
 */
export function parseLocalMinute(timeStr: string): number {
  const match = timeStr.match(/T\d{2}:(\d{2})/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Format time string for display. Parses directly from "YYYY-MM-DDTHH:MM" format
 * to avoid timezone issues.
 */
export function formatTime(timeStr: string): string {
  const h = parseLocalHour(timeStr);
  const m = parseLocalMinute(timeStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Format a chart axis label. Parses directly from string to avoid timezone issues.
 */
export function formatChartLabel(timeStr: string): string {
  // Parse date parts directly: "2026-02-18T09:00"
  const datePart = timeStr.slice(0, 10); // "2026-02-18"
  const [y, mo, da] = datePart.split('-').map(Number);
  // Use UTC methods to get day-of-week from the date (this is just for the day name)
  const d = new Date(Date.UTC(y, mo - 1, da));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[d.getUTCDay()];
  const hour = parseLocalHour(timeStr);
  const ampm = hour >= 12 ? 'p' : 'a';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${day} ${h12}${ampm}`;
}

/**
 * Format a date string for display. Parses "YYYY-MM-DD" directly.
 */
export function formatDate(dateStr: string): string {
  const [y, mo, da] = dateStr.slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, da));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Format a short day label from a time string, e.g., "Mon", "Tue".
 */
export function formatDayLabel(timeStr: string): string {
  const datePart = timeStr.slice(0, 10);
  const [y, mo, da] = datePart.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, da));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[d.getUTCDay()];
}

// --- Moon position and rise/set calculation (Meeus simplified) ---

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function moonPosition(d: number) {
  // d = days since J2000.0
  // Meeus, Astronomical Algorithms — Chapter 47 (simplified)
  const L = ((218.3165 + 13.176396 * d) % 360 + 360) % 360;   // mean longitude
  const M = ((134.9634 + 13.064993 * d) % 360 + 360) % 360;   // mean anomaly
  const F = ((93.2721 + 13.229350 * d) % 360 + 360) % 360;    // argument of latitude
  const D = ((297.8502 + 12.190749 * d) % 360 + 360) % 360;   // mean elongation
  const Ms = ((357.5291 + 0.985600 * d) % 360 + 360) % 360;   // sun mean anomaly

  const Mr = M * DEG2RAD;
  const Dr = D * DEG2RAD;
  const Fr = F * DEG2RAD;
  const Msr = Ms * DEG2RAD;

  // Longitude corrections (Meeus Table 47.A, largest terms)
  const lngDeg = L
    + 6.289 * Math.sin(Mr)              // equation of center
    + 1.274 * Math.sin(2 * Dr - Mr)     // evection
    + 0.658 * Math.sin(2 * Dr)          // variation
    + 0.214 * Math.sin(2 * Mr)          // annual equation
    - 0.186 * Math.sin(Msr)             // parallactic inequality
    - 0.114 * Math.sin(2 * Fr)
    + 0.059 * Math.sin(2 * Dr - 2 * Mr)
    + 0.057 * Math.sin(2 * Dr - Mr - Msr);

  // Latitude corrections (Meeus Table 47.B, largest terms)
  const latDeg = 5.128 * Math.sin(Fr)
    + 0.281 * Math.sin(Mr + Fr)
    + 0.278 * Math.sin(Mr - Fr)
    + 0.173 * Math.sin(2 * Dr - Fr)
    + 0.055 * Math.sin(2 * Dr - Mr + Fr)
    + 0.046 * Math.sin(2 * Dr - Mr - Fr);

  const e = 23.4393 * DEG2RAD; // obliquity
  const lngRad = lngDeg * DEG2RAD;
  const latRad = latDeg * DEG2RAD;

  const ra = Math.atan2(
    Math.sin(lngRad) * Math.cos(e) - Math.tan(latRad) * Math.sin(e),
    Math.cos(lngRad)
  );
  const dec = Math.asin(
    Math.sin(latRad) * Math.cos(e) +
    Math.cos(latRad) * Math.sin(e) * Math.sin(lngRad)
  );

  return { ra, dec };
}

export function getMoonAltitude(utcMs: number, latRad: number, lonDeg: number): number {
  const d = (utcMs / 86400000) + 2440587.5 - 2451545.0;
  const moon = moonPosition(d);
  const gmst = ((280.16 + 360.9856235 * d) % 360 + 360) % 360;
  const lst = (gmst + lonDeg) * DEG2RAD;
  const H = lst - moon.ra;

  return Math.asin(
    Math.sin(latRad) * Math.sin(moon.dec) +
    Math.cos(latRad) * Math.cos(moon.dec) * Math.cos(H)
  ) * RAD2DEG;
}

/** Refine a moon rise/set crossing to ~15-second precision within a window. */
function refineEvent(
  midnightUTC: number, latRad: number, lon: number,
  startMin: number, endMin: number, threshold: number, isRise: boolean
): number {
  const fineStep = 0.25; // 15-second steps
  let prev = getMoonAltitude(midnightUTC + startMin * 60000, latRad, lon);
  for (let m = startMin + fineStep; m <= endMin; m += fineStep) {
    const alt = getMoonAltitude(midnightUTC + m * 60000, latRad, lon);
    if (isRise && prev < threshold && alt >= threshold) {
      const frac = (threshold - prev) / (alt - prev);
      return Math.round((m - fineStep) + frac * fineStep);
    }
    if (!isRise && prev >= threshold && alt < threshold) {
      const frac = (prev - threshold) / (prev - alt);
      return Math.round((m - fineStep) + frac * fineStep);
    }
    prev = alt;
  }
  // Fallback: midpoint
  return Math.round((startMin + endMin) / 2);
}

/**
 * Calculate moonrise and moonset times for a given date and location.
 * Returns minutes since local midnight, or -1 if the event doesn't occur that day.
 */
export function getMoonTimes(
  year: number, month: number, day: number,
  lat: number, lon: number, utcOffsetSec: number
): { rise: number; set: number } {
  const latRad = lat * DEG2RAD;
  // Local midnight in UTC milliseconds
  const localMidnightUTC = Date.UTC(year, month - 1, day) - utcOffsetSec * 1000;
  // Moon horizon threshold differs from the sun due to large horizontal parallax.
  // h0 = 0.7275 * HP - 0.5667° where HP (mean horizontal parallax) ≈ 0.9507°
  // h0 = 0.6916 - 0.5667 = +0.125° (positive, unlike the sun's -0.833°)
  const threshold = 0.125;

  let rise = -1;
  let set = -1;

  // Coarse scan at 2-minute intervals to find crossings
  const coarseStep = 2;
  let prevAlt = getMoonAltitude(localMidnightUTC, latRad, lon);

  for (let m = coarseStep; m <= 1440; m += coarseStep) {
    const utcMs = localMidnightUTC + m * 60000;
    const alt = getMoonAltitude(utcMs, latRad, lon);

    if (prevAlt < threshold && alt >= threshold && rise < 0) {
      // Refine with 0.25-minute (15-second) steps in this 2-min window
      rise = refineEvent(localMidnightUTC, latRad, lon, m - coarseStep, m, threshold, true);
    }
    if (prevAlt >= threshold && alt < threshold && set < 0) {
      rise >= 0; // already found rise
      set = refineEvent(localMidnightUTC, latRad, lon, m - coarseStep, m, threshold, false);
    }

    prevAlt = alt;
  }

  return { rise, set };
}

// --- Natural-language weather descriptions (AccuWeather-style) ---

import type { DailyForecast } from './types';

function tempQualifier(highF: number): string {
  if (highF >= 100) return 'hot';
  if (highF >= 90) return 'very warm';
  if (highF >= 80) return 'warm';
  if (highF >= 68) return 'pleasant';
  if (highF >= 55) return 'cool';
  if (highF >= 40) return 'chilly';
  if (highF >= 25) return 'cold';
  return 'very cold';
}

function skyPhrase(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('blizzard')) return 'blizzard';
  if (d.includes('thunder') || d.includes('storm')) return 'thunderstorms';
  if (d.includes('heavy snow')) return 'heavy snow';
  if (d.includes('snow')) return 'snow';
  if (d.includes('freezing')) return 'freezing rain';
  if (d.includes('rain') || d.includes('shower') || d.includes('drizzle')) return 'rain';
  if (d.includes('fog') || d.includes('mist')) return 'fog';
  if (d.includes('overcast')) return 'cloudy';
  if (d.includes('partly') || d.includes('scattered')) return 'partly sunny';
  if (d.includes('cloudy')) return 'mostly cloudy';
  return 'sunny';
}

export function generateDayDescription(day: DailyForecast, prevDay: DailyForecast | null): string {
  const sky = skyPhrase(day.description);
  const tq = tempQualifier(day.highF);
  const windy = day.windGustMph >= 35 ? 'Windy' : day.windGustMph >= 20 ? 'Breezy' : '';
  const humid = day.humidity >= 70 && day.highF >= 80;

  // Temperature trend
  let trend = '';
  if (prevDay) {
    const diff = day.highF - prevDay.highF;
    if (diff <= -12) trend = 'Much colder';
    else if (diff <= -6) trend = 'Cooler';
    else if (diff >= 12) trend = 'Much warmer';
    else if (diff >= 6) trend = 'Warmer';
  }

  // Precipitation-based descriptions
  if (sky === 'blizzard') {
    return 'Blizzard conditions with heavy snow and high winds';
  }
  if (sky === 'thunderstorms') {
    if (trend) return `${trend} with thunderstorms`;
    if (windy) return `${windy} with thunderstorms`;
    return 'Thunderstorms expected';
  }
  if (sky === 'heavy snow') {
    if (trend) return `${trend} with heavy snow`;
    if (windy) return `${windy} with heavy snow`;
    return 'Heavy snow expected';
  }
  if (sky === 'snow') {
    if (trend) return `${trend} with snow`;
    if (windy) return `${windy} with snow`;
    return 'Snow expected';
  }
  if (sky === 'freezing rain') {
    return trend ? `${trend} with freezing rain` : 'Freezing rain possible';
  }
  if (sky === 'rain') {
    if (trend && windy) return `${trend} and ${windy.toLowerCase()} with rain`;
    if (trend) return `${trend} with periods of rain`;
    if (windy) return `${windy} with showers`;
    if (day.precipProbability >= 70) return 'Rain likely';
    return 'Showers possible';
  }
  if (sky === 'fog') {
    return trend ? `${trend} with fog` : `Foggy and ${tq}`;
  }

  // Clear/cloudy descriptions
  if (trend && windy) {
    const skyBit = sky === 'sunny' ? 'sunshine' : sky === 'partly sunny' ? 'clouds and sun' : 'clouds';
    return `${trend} and ${windy.toLowerCase()} with ${skyBit}`;
  }
  if (trend) {
    const skyBit = sky === 'sunny' ? 'plenty of sunshine' : sky === 'partly sunny' ? 'clouds and sun' : 'clouds';
    return `${trend} with ${skyBit}`;
  }
  if (windy) {
    const skyBit = sky === 'sunny' ? 'sun' : sky === 'partly sunny' ? 'clouds and sun' : 'clouds';
    return `${windy} with ${skyBit}`;
  }

  // Simple descriptions
  if (sky === 'sunny') {
    if (humid) return 'Sunny and humid';
    return `Sunny and ${tq}`;
  }
  if (sky === 'partly sunny') {
    if (humid) return 'Partly sunny and humid';
    return `Partly sunny and ${tq}`;
  }
  if (sky === 'mostly cloudy' || sky === 'cloudy') {
    return `Mostly cloudy and ${tq}`;
  }
  return `${sky.charAt(0).toUpperCase() + sky.slice(1)} and ${tq}`;
}

export function generateNightDescription(day: DailyForecast): string {
  const sky = skyPhrase(day.description);
  const lowTq = day.lowF <= 20 ? 'very cold' : day.lowF <= 32 ? 'cold' : day.lowF <= 45 ? 'chilly' : '';

  if (sky === 'blizzard') return 'Blizzard conditions continuing overnight';
  if (sky === 'thunderstorms') return 'Thunderstorms possible';
  if (sky === 'heavy snow') return 'Heavy snow continuing overnight';
  if (sky === 'snow') return 'Snow showers possible';
  if (sky === 'rain') {
    return day.precipProbability >= 60 ? 'Periods of rain' : 'A shower possible';
  }
  if (sky === 'fog') return 'Foggy';
  if (sky === 'cloudy' || sky === 'mostly cloudy') {
    return lowTq ? `Mostly cloudy and ${lowTq}` : 'Mostly cloudy';
  }
  if (sky === 'partly sunny') {
    return lowTq ? `Partly cloudy and ${lowTq}` : 'Partly cloudy';
  }
  // Clear
  return lowTq ? `Clear and ${lowTq}` : 'Clear';
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; displayName: string; state: string; country: string; zip: string }> {
  const ua = { 'User-Agent': 'WagerOnWeather/1.0 (sports weather dashboard)' };
  let bestCity = '';
  let bestState = '';
  let bestCountry = '';
  let bestZip = '';

  // Try multiple zoom levels — higher zooms are more likely to return a postcode
  for (const zoom of [18, 16, 14, 10]) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${zoom}&addressdetails=1`,
        { headers: ua }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const addr = data.address || {};
      const city = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || '';
      const state = addr.state || '';
      const country = addr.country || '';
      const zip = addr.postcode || '';

      if (!bestCity && city) bestCity = city;
      if (!bestState && state) bestState = state;
      if (!bestCountry && country) bestCountry = country;
      if (!bestZip && zip) bestZip = zip;

      // We have everything we need
      if (bestCity && bestZip) break;
    } catch {}
  }

  const name = bestCity || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  const displayName = [bestCity, bestState, bestZip].filter(Boolean).join(', ') || name;
  return { name, displayName, state: bestState, country: bestCountry, zip: bestZip };
}
