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

  // Precipitation — check both probability and active precipitation
  if (forecast.precipMm > 0) {
    // Active precipitation happening right now
    if (forecast.precipMm >= 2.5) {
      score -= 50;
      notes.push(`Active heavy precipitation (${forecast.precipMm.toFixed(1)} mm/hr) — field conditions deteriorating`);
    } else if (forecast.precipMm >= 0.5) {
      score -= 35;
      notes.push(`Active precipitation (${forecast.precipMm.toFixed(1)} mm/hr) — wet playing conditions`);
    } else {
      score -= 20;
      notes.push(`Light precipitation (${forecast.precipMm.toFixed(1)} mm/hr) — monitor conditions`);
    }
  }
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
  if (forecast.precipMm >= 2.5) precipRisk = 'high';
  else if (forecast.precipMm > 0) precipRisk = forecast.precipMm >= 0.5 ? 'high' : 'moderate';
  else if (forecast.precipProbability < 10) precipRisk = 'none';
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

const W = '/icons/weather/';

// WMO code → [day icon, night icon] — Basmilius animated SVG weather icons (fill style)
const WMO_ICON_MAP: Record<number, [string, string]> = {
  // Clear / clouds
  0:  [`${W}clear-day.svg`,             `${W}clear-night.svg`],
  1:  [`${W}clear-day.svg`,             `${W}clear-night.svg`],
  2:  [`${W}partly-cloudy-day.svg`,     `${W}partly-cloudy-night.svg`],
  3:  [`${W}overcast-day.svg`,          `${W}overcast-night.svg`],

  // Fog
  45: [`${W}fog-day.svg`,               `${W}fog-night.svg`],
  48: [`${W}fog-day.svg`,               `${W}fog-night.svg`],

  // Drizzle
  51: [`${W}partly-cloudy-day-drizzle.svg`, `${W}partly-cloudy-night-drizzle.svg`],
  53: [`${W}drizzle.svg`,               `${W}drizzle.svg`],
  55: [`${W}drizzle.svg`,               `${W}drizzle.svg`],

  // Freezing drizzle
  56: [`${W}partly-cloudy-day-sleet.svg`, `${W}partly-cloudy-night-sleet.svg`],
  57: [`${W}sleet.svg`,                 `${W}sleet.svg`],

  // Rain
  61: [`${W}partly-cloudy-day-rain.svg`, `${W}partly-cloudy-night-rain.svg`],
  63: [`${W}rain.svg`,                  `${W}rain.svg`],
  65: [`${W}rain.svg`,                  `${W}rain.svg`],

  // Freezing rain
  66: [`${W}sleet.svg`,                 `${W}sleet.svg`],
  67: [`${W}sleet.svg`,                 `${W}sleet.svg`],

  // Snow
  71: [`${W}partly-cloudy-day-snow.svg`, `${W}partly-cloudy-night-snow.svg`],
  73: [`${W}snow.svg`,                  `${W}snow.svg`],
  75: [`${W}snow.svg`,                  `${W}snow.svg`],

  // Snow grains
  77: [`${W}partly-cloudy-day-snow.svg`, `${W}partly-cloudy-night-snow.svg`],

  // Rain showers
  80: [`${W}partly-cloudy-day-rain.svg`, `${W}partly-cloudy-night-rain.svg`],
  81: [`${W}rain.svg`,                  `${W}rain.svg`],
  82: [`${W}rain.svg`,                  `${W}rain.svg`],

  // Snow showers
  85: [`${W}partly-cloudy-day-snow.svg`, `${W}partly-cloudy-night-snow.svg`],
  86: [`${W}snow.svg`,                  `${W}snow.svg`],

  // Thunderstorms
  95: [`${W}thunderstorms-day-rain.svg`, `${W}thunderstorms-night-rain.svg`],
  96: [`${W}thunderstorms-day.svg`,     `${W}thunderstorms-night.svg`],
  99: [`${W}thunderstorms.svg`,         `${W}thunderstorms.svg`],
};

// Description fallback → [day icon, night icon] — for overrides and non-WMO sources.
const DESC_ICON_MAP: [RegExp, string, string][] = [
  // Thunderstorms
  [/thunder.*hail/i,                    `${W}thunderstorms.svg`,              `${W}thunderstorms.svg`],
  [/thunder.*snow/i,                    `${W}thunderstorms-day-snow.svg`,     `${W}thunderstorms-night-snow.svg`],
  [/thunder.*rain/i,                    `${W}thunderstorms-day-rain.svg`,     `${W}thunderstorms-night-rain.svg`],
  [/thunder|storm/i,                    `${W}thunderstorms-day.svg`,          `${W}thunderstorms-night.svg`],

  // Blizzard / heavy snow
  [/blizzard|heavy snow/i,             `${W}snow.svg`,                       `${W}snow.svg`],

  // Freezing / sleet
  [/freezing|sleet/i,                   `${W}sleet.svg`,                      `${W}sleet.svg`],

  // Rain intensity
  [/heavy rain|downpour/i,             `${W}rain.svg`,                       `${W}rain.svg`],
  [/rain shower|light rain/i,          `${W}partly-cloudy-day-rain.svg`,     `${W}partly-cloudy-night-rain.svg`],
  [/rain/i,                             `${W}rain.svg`,                       `${W}rain.svg`],

  // Drizzle
  [/drizzle/i,                          `${W}partly-cloudy-day-drizzle.svg`, `${W}partly-cloudy-night-drizzle.svg`],

  // Snow
  [/snow shower|light snow|snow grain/i, `${W}partly-cloudy-day-snow.svg`,   `${W}partly-cloudy-night-snow.svg`],
  [/snow/i,                             `${W}snow.svg`,                       `${W}snow.svg`],

  // Hail
  [/hail/i,                             `${W}hail.svg`,                       `${W}hail.svg`],

  // Fog / mist / haze
  [/fog/i,                              `${W}fog-day.svg`,                    `${W}fog-night.svg`],
  [/mist/i,                             `${W}mist.svg`,                       `${W}mist.svg`],
  [/haze/i,                             `${W}haze-day.svg`,                   `${W}haze-night.svg`],
  [/dust/i,                             `${W}dust-day.svg`,                   `${W}dust-night.svg`],
  [/smoke/i,                            `${W}partly-cloudy-day-smoke.svg`,    `${W}partly-cloudy-night-smoke.svg`],

  // Cloud conditions
  [/overcast/i,                         `${W}overcast-day.svg`,               `${W}overcast-night.svg`],
  [/mostly cloudy|cloudy/i,             `${W}overcast-day.svg`,               `${W}overcast-night.svg`],
  [/partly|scattered|mostly clear/i,    `${W}partly-cloudy-day.svg`,          `${W}partly-cloudy-night.svg`],

  // Wind
  [/wind/i,                             `${W}wind.svg`,                       `${W}wind.svg`],
];

/** Descriptions that assert precipitation is falling. WMO codes >= 51 do the same. */
const PRECIP_DESC_RE = /rain|drizzle|snow|sleet|hail|thunder|storm|shower|freezing|blizzard/i;

export function getWeatherIcon(description: string, isNight: boolean = false, wmoCode?: number): string {
  // Prefer WMO code mapping when available
  if (wmoCode !== undefined && WMO_ICON_MAP[wmoCode]) {
    const d = description.toLowerCase();
    // Description overrides for enhanced conditions
    if (d.includes('blizzard')) return `${W}snow.svg`;
    if (d.includes('heavy rain') && wmoCode < 65) return `${W}rain.svg`;
    if (d.includes('heavy snow') && wmoCode < 75) return `${W}snow.svg`;

    // The description can come from a live station or radar observation while
    // the model's WMO code still reads clear — that mismatch put a sun icon
    // above the words "Light Rain". When the description reports precipitation
    // the code does not, the observation wins.
    if (PRECIP_DESC_RE.test(description) && wmoCode < 51) {
      for (const [pattern, day, night] of DESC_ICON_MAP) {
        if (pattern.test(description)) return isNight ? night : day;
      }
    }

    const [day, night] = WMO_ICON_MAP[wmoCode];
    return isNight ? night : day;
  }

  // Fallback: match by description
  for (const [pattern, day, night] of DESC_ICON_MAP) {
    if (pattern.test(description)) return isNight ? night : day;
  }

  // Default: clear
  return isNight ? `${W}clear-night.svg` : `${W}clear-day.svg`;
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
  const ampm = hour >= 12 ? 'pm' : 'am';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${day} ${h12}${ampm}`;
}

/** Returns day and time as separate strings for stacked chart labels. */
export function formatChartLabelParts(timeStr: string): { day: string; time: string } {
  const datePart = timeStr.slice(0, 10);
  const [y, mo, da] = datePart.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, da));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[d.getUTCDay()];
  const hour = parseLocalHour(timeStr);
  const ampm = hour >= 12 ? 'pm' : 'am';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return { day, time: `${h12}${ampm}` };
}

/**
 * Format a date string for display as MM-DD-YYYY (e.g. "07-22-2026").
 * Parses "YYYY-MM-DD" directly.
 */
export function formatDate(dateStr: string): string {
  const [y, mo, da] = dateStr.slice(0, 10).split('-').map(Number);
  return `${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}-${y}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Long-form date, e.g. "July 29, 2026".
 *
 * Parses the Y-M-D parts by hand rather than going through `new Date(str)`,
 * which would reinterpret a location-local timestamp in the server's zone and
 * can land on the wrong day. Same reason formatDate above does it this way.
 */
export function formatDateLong(dateStr: string): string {
  const [y, mo, da] = dateStr.slice(0, 10).split('-').map(Number);
  const month = MONTH_NAMES[(mo || 1) - 1] ?? '';
  return `${month} ${da}, ${y}`;
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

// Periodic terms from Meeus, Astronomical Algorithms (2nd ed.), Tables 47.A and
// 47.B: [D, M, M', F, coefficient]. Longitude in 1e-6 degrees, distance in metres
// (0.001 km), latitude in 1e-6 degrees. The previous version kept only the 8
// largest longitude terms and fixed mean elements, which put moonrise/moonset up
// to 3 minutes off the USNO (with the old sidereal-time constant). DBD 2026-11-20.
const MOON_LR: [number, number, number, number, number, number][] = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421], [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0], [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];
const MOON_B: [number, number, number, number, number][] = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
];

export function moonPosition(d: number) {
  // d = days since J2000.0 (TT ~ UT here; the ~69 s difference moves the moon
  // by 0.01 degrees, a few seconds of rise time).
  const T = d / 36525;
  const norm = (x: number) => ((x % 360) + 360) % 360;
  const Lp = norm(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T);
  const D = norm(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T);
  const M = norm(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const Mp = norm(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T);
  const F = norm(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const A1 = norm(119.75 + 131.849 * T), A2 = norm(53.09 + 479264.290 * T), A3 = norm(313.45 + 481266.484 * T);

  let sl = 0, sr = 0, sb = 0;
  for (const [cd, cm, cmp, cf, l, r] of MOON_LR) {
    const arg = (cd * D + cm * M + cmp * Mp + cf * F) * DEG2RAD;
    const e = Math.abs(cm) === 1 ? E : Math.abs(cm) === 2 ? E * E : 1;
    sl += l * e * Math.sin(arg);
    sr += r * e * Math.cos(arg);
  }
  for (const [cd, cm, cmp, cf, b] of MOON_B) {
    const arg = (cd * D + cm * M + cmp * Mp + cf * F) * DEG2RAD;
    const e = Math.abs(cm) === 1 ? E : Math.abs(cm) === 2 ? E * E : 1;
    sb += b * e * Math.sin(arg);
  }
  sl += 3958 * Math.sin(A1 * DEG2RAD) + 1962 * Math.sin((Lp - F) * DEG2RAD) + 318 * Math.sin(A2 * DEG2RAD);
  sb += -2235 * Math.sin(Lp * DEG2RAD) + 382 * Math.sin(A3 * DEG2RAD) + 175 * Math.sin((A1 - F) * DEG2RAD)
    + 175 * Math.sin((A1 + F) * DEG2RAD) + 127 * Math.sin((Lp - Mp) * DEG2RAD) - 115 * Math.sin((Lp + Mp) * DEG2RAD);

  // Nutation in longitude (largest term) and obliquity of date.
  const omega = norm(125.04452 - 1934.136261 * T) * DEG2RAD;
  const dPsi = (-17.2 / 3600) * Math.sin(omega);
  const lngDeg = norm(Lp + sl / 1e6 + dPsi);
  const latDeg = sb / 1e6;
  const distKm = 385000.56 + sr / 1000;

  const e = (23.4392911 - 0.0130042 * T + (9.2 / 3600) * Math.cos(omega)) * DEG2RAD;
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

  return { ra, dec, lng: lngDeg, distKm };
}

/** Sun's apparent ecliptic longitude (deg), Meeus low-precision. */
function sunEclipticLongitude(d: number): number {
  const M = ((357.5291 + 0.98560028 * d) % 360 + 360) % 360;
  const Mr = M * DEG2RAD;
  const C = 1.9148 * Math.sin(Mr) + 0.0200 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const L0 = ((280.4665 + 0.98564736 * d) % 360 + 360) % 360;
  return ((L0 + C) % 360 + 360) % 360;
}

/**
 * Illuminated fraction of the moon's disc (0–100%) and waxing flag, computed
 * from the REAL sun–moon geometry (elongation), not a mean-age cosine model.
 * The mean-age model drifts ~1 day after a couple of years because it ignores
 * the moon's elliptical orbit — enough to read 36% instead of 46.6% and
 * mislabel First Quarter as Waxing Crescent. This is accurate to <1%.
 */
export function getMoonIllumination(utcMs: number): { illumination: number; waxing: boolean } {
  const d = (utcMs / 86400000) + 2440587.5 - 2451545.0;
  const moonLon = moonPosition(d).lng;
  const sunLon = sunEclipticLongitude(d);
  const elong = ((moonLon - sunLon) % 360 + 360) % 360; // 0=new, 180=full
  const illumination = (1 - Math.cos(elong * DEG2RAD)) / 2 * 100;
  return { illumination, waxing: elong < 180 };
}

/**
 * Sun altitude (degrees above the horizon; negative = below) and azimuth
 * (compass bearing, 0 = N, clockwise), Meeus low-precision — same
 * GMST/local-sidereal-time approach as `getMoonAltitude` below, but for the
 * sun (ecliptic latitude 0, so the RA/dec transform drops the moon's
 * latitude-correction term). Azimuth via Meeus (13.5) — measured from South
 * westward in that formula, converted to a compass bearing by +180.
 * Accurate to a small fraction of a degree, plenty for a "is the sun low
 * enough to glare, and which side of the field" check.
 */
export function getSunPosition(utcMs: number, latRad: number, lonDeg: number): { altitude: number; azimuth: number } {
  const d = (utcMs / 86400000) + 2440587.5 - 2451545.0;
  const lngDeg = sunEclipticLongitude(d);
  const e = 23.4393 * DEG2RAD;
  const lngRad = lngDeg * DEG2RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(lngRad), Math.cos(lngRad));
  const dec = Math.asin(Math.sin(e) * Math.sin(lngRad));
  const gmst = ((280.16 + 360.9856235 * d) % 360 + 360) % 360;
  // KEPT on purpose (DBD 2026-11-20): the precise constant is 280.46061837 (Meeus 12.4), which
  // getMoonAltitude now uses. This sun position feeds the WOW Score's solar/glare sub-score, and
  // the 0.3-degree correction moves scores (one NFL board game: solar 94.5 -> 91). Changing the
  // score is a separate, versioned decision, so the sun-glare path keeps the old constant.
  const lst = (gmst + lonDeg) * DEG2RAD;
  const H = lst - ra;

  const altitude = Math.asin(
    Math.sin(latRad) * Math.sin(dec) +
    Math.cos(latRad) * Math.cos(dec) * Math.cos(H)
  ) * RAD2DEG;

  const azFromSouth = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(latRad) - Math.tan(dec) * Math.cos(latRad),
  ) * RAD2DEG;
  const azimuth = (azFromSouth + 180 + 360) % 360;

  return { altitude, azimuth };
}

/** MLB linescore inningState ("Top"/"Middle"/"Bottom"/"End") -> broadcast-style short label. */
export function inningStateLabel(inningState: string): string {
  return inningState === 'Top' ? 'Top' : inningState === 'Bottom' ? 'Bot' : inningState === 'Middle' ? 'Mid' : 'End';
}

/** "1st", "2nd", "3rd", "4th", ... */
export function ordinal(n: number): string {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}

export function getMoonAltitude(utcMs: number, latRad: number, lonDeg: number): number {
  const d = (utcMs / 86400000) + 2440587.5 - 2451545.0;
  const moon = moonPosition(d);
  const gmst = ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360; // Meeus 12.4 (was 280.16, 0.3 deg = 1.2 min of time off)
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
  const noonD = (localMidnightUTC + 720 * 60000) / 86400000 + 2440587.5 - 2451545.0;
  const hp = Math.asin(6378.14 / moonPosition(noonD).distKm) * RAD2DEG;
  const threshold = 0.7275 * hp - 0.5667; // ~ +0.125 at mean distance

  let rise = -1;
  let set = -1;

  // Coarse scan at 2-minute intervals to find crossings. We scan up to 36h (not
  // just the 24h calendar day) so a moonrise/moonset that falls shortly after
  // local midnight is still reported. Without this, every location shows "--:--"
  // roughly one day a month — the night the moon sets just after midnight — even
  // though the moon really does set. Minutes >1440 render as the next-day AM time.
  const coarseStep = 2;
  const scanEnd = 2160; // 36 hours
  let prevAlt = getMoonAltitude(localMidnightUTC, latRad, lon);

  for (let m = coarseStep; m <= scanEnd; m += coarseStep) {
    const utcMs = localMidnightUTC + m * 60000;
    const alt = getMoonAltitude(utcMs, latRad, lon);

    if (prevAlt < threshold && alt >= threshold && rise < 0) {
      // Refine with 0.25-minute (15-second) steps in this 2-min window
      rise = refineEvent(localMidnightUTC, latRad, lon, m - coarseStep, m, threshold, true);
    }
    if (prevAlt >= threshold && alt < threshold && set < 0) {
      set = refineEvent(localMidnightUTC, latRad, lon, m - coarseStep, m, threshold, false);
    }
    if (rise >= 0 && set >= 0) break;

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
