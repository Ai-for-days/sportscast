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
    minTempF: 25,
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
  if (wc !== null && wc < 10) {
    score -= 30;
    notes.push(`Wind chill of ${wc}F creates dangerous cold exposure`);
  } else if (wc !== null && wc < 25) {
    score -= 15;
    notes.push(`Wind chill of ${wc}F — dress warmly`);
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
  if (d.includes('thunder') || d.includes('storm')) return '⛈️';
  if (d.includes('heavy rain') || d.includes('downpour')) return '🌧️';
  if (d.includes('rain') || d.includes('drizzle') || d.includes('shower')) return '🌦️';
  if (d.includes('snow') || d.includes('blizzard')) return '🌨️';
  if (d.includes('fog') || d.includes('mist') || d.includes('haze')) return '🌫️';
  if (d.includes('overcast') || d.includes('cloudy')) return '☁️';
  if (d.includes('partly') || d.includes('scattered')) return isNight ? '⛅' : '⛅';
  return isNight ? '🌙' : '☀️';
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
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; displayName: string; state: string; country: string; zip: string }> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`,
      { headers: { 'User-Agent': 'SportsCast/1.0 (sports weather dashboard)' } }
    );
    if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
    const data = await response.json();
    const addr = data.address || {};
    // Prefer city/town/village — only fall back to county as last resort
    const city = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || '';
    const state = addr.state || '';
    const country = addr.country || '';
    const zip = addr.postcode || '';

    // If we only got a county, try a second lookup at higher zoom for city-level detail
    if (!city && addr.county) {
      try {
        const res2 = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`,
          { headers: { 'User-Agent': 'SportsCast/1.0 (sports weather dashboard)' } }
        );
        if (res2.ok) {
          const data2 = await res2.json();
          const addr2 = data2.address || {};
          const city2 = addr2.city || addr2.town || addr2.village || addr2.hamlet || addr2.suburb || '';
          const zip2 = addr2.postcode || zip;
          if (city2) {
            const displayName = [city2, state, zip2].filter(Boolean).join(', ');
            return { name: city2, displayName, state, country, zip: zip2 };
          }
        }
      } catch {}
      // Still no city — use county as fallback
      const displayName = [addr.county, state, zip].filter(Boolean).join(', ');
      return { name: addr.county, displayName, state, country, zip };
    }

    const displayName = [city, state, zip].filter(Boolean).join(', ');
    return { name: city || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, displayName: displayName || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, state, country, zip };
  } catch {
    return { name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, displayName: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, state: '', country: '', zip: '' };
  }
}
