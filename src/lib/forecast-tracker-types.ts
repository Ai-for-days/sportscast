// ── Forecast Tracker Types & Scoring ─────────────────────────────────────────

export type ForecastMetric = 'actual_temp' | 'high_temp' | 'low_temp' | 'wind_speed' | 'wind_gust';

export const METRIC_LABELS: Record<ForecastMetric, string> = {
  actual_temp: 'Temp at Time (°F)',
  high_temp: 'High Temp (°F)',
  low_temp: 'Low Temp (°F)',
  wind_speed: 'Wind Speed (mph)',
  wind_gust: 'Wind Gust (mph)',
};

export const METRIC_UNITS: Record<ForecastMetric, string> = {
  actual_temp: '°F',
  high_temp: '°F',
  low_temp: '°F',
  wind_speed: 'mph',
  wind_gust: 'mph',
};

/** Whether this metric needs a target time (vs just a date) */
export function metricNeedsTime(metric: ForecastMetric): boolean {
  return metric === 'actual_temp' || metric === 'wind_speed' || metric === 'wind_gust';
}

export interface ForecastEntry {
  id: string;
  // Location
  locationName: string;   // e.g. "Houston, TX"
  stationId: string;      // NWS station ID for verification
  lat: number;
  lon: number;
  timeZone: string;
  // Forecast
  metric: ForecastMetric;
  targetDate: string;     // YYYY-MM-DD
  targetTime?: string;    // HH:MM (for time-specific metrics)
  forecastValue: number;  // what we predicted
  source?: string[];      // e.g. ['wageronweather', 'accuweather', 'weather.com']
  // Tracking
  inputAt: string;        // ISO 8601 — when admin entered this
  leadTimeHours: number;  // target datetime - inputAt, in hours
  // Verification (filled after NWS data available)
  actualValue?: number;
  verifiedAt?: string;    // ISO 8601
  errorAbs?: number;      // |forecast - actual|
  accuracyScore?: number; // 0-100
  leadTimeMultiplier?: number;
  precisionMultiplier?: number; // 1.0 for day-level, 1.5 for hour-level
  weightedScore?: number; // accuracyScore × leadTimeMultiplier × precisionMultiplier
  // V2 verification fields (Phase 1)
  sourceNormalized?: string;
  signedError?: number;
  absError?: number;
  difficultyWeight?: number;
  adjustedError?: number;
  accuracyScoreV2?: number;
  leadBucket?: string;
  metricGroup?: string;
  settledAt?: string;
}

// ── Lead Time Multiplier ────────────────────────────────────────────────────
// Forecasts made farther in advance are worth more.

const LEAD_TIME_BRACKETS: { maxHours: number; multiplier: number; label: string }[] = [
  { maxHours: 1,    multiplier: 1.0,  label: 'Nowcast' },
  { maxHours: 6,    multiplier: 1.5,  label: 'Short-range' },
  { maxHours: 24,   multiplier: 2.0,  label: 'Day-ahead' },
  { maxHours: 72,   multiplier: 3.0,  label: '1-3 days' },
  { maxHours: 120,  multiplier: 5.0,  label: '3-5 days' },
  { maxHours: 168,  multiplier: 7.0,  label: '5-7 days' },
  { maxHours: 240,  multiplier: 10.0, label: '7-10 days' },
  { maxHours: 336,  multiplier: 13.0, label: '10-14 days' },
  { maxHours: Infinity, multiplier: 15.0, label: '14+ days' },
];

export function getLeadTimeMultiplier(leadTimeHours: number): { multiplier: number; label: string } {
  for (const bracket of LEAD_TIME_BRACKETS) {
    if (leadTimeHours <= bracket.maxHours) {
      return { multiplier: bracket.multiplier, label: bracket.label };
    }
  }
  return { multiplier: 15.0, label: '14+ days' };
}

// ── Precision Multiplier ────────────────────────────────────────────────────
// Forecasting by the hour is harder than by the day — reward specificity.

export function getPrecisionMultiplier(targetTime?: string): { multiplier: number; label: string } {
  if (targetTime) {
    return { multiplier: 1.5, label: 'Hourly' };
  }
  return { multiplier: 1.0, label: 'Daily' };
}

// ── Accuracy Scoring ────────────────────────────────────────────────────────
// Score 0-100 based on how close the forecast was to actual.
// Forecasts made further in advance get a wider "forgiveness window" —
// the max-error-for-zero-score grows with lead time so distant forecasts
// aren't punished as harshly for the same absolute error.

function getErrorCeiling(metric: ForecastMetric, leadTimeHours: number): number {
  // Base ceilings (same as before for nowcasts)
  const base = (metric === 'wind_speed' || metric === 'wind_gust') ? 30 : 20;

  // Scale up the ceiling so longer-range forecasts are graded more leniently.
  // At 0h  → 1.0x base  (20°F / 30 mph to hit zero)
  // At 24h → 1.25x       (25°F / 37.5 mph)
  // At 72h → 1.5x        (30°F / 45 mph)
  // At 168h → 2.0x       (40°F / 60 mph)
  // At 336h → 2.5x       (50°F / 75 mph)
  const scale = 1 + Math.min(leadTimeHours, 336) / 224;
  return base * scale;
}

export function calculateAccuracyScore(metric: ForecastMetric, error: number, leadTimeHours = 0): number {
  const absError = Math.abs(error);
  const ceiling = getErrorCeiling(metric, leadTimeHours);
  return Math.max(0, Math.round(100 * (1 - absError / ceiling)));
}

// ── Lead Time Display ───────────────────────────────────────────────────────

export function formatLeadTime(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.round(hours / 24 * 10) / 10;
  return `${days}d`;
}

// ── Calculate lead time in hours ────────────────────────────────────────────

/**
 * Calculate lead time using the event's local timezone, not the admin's.
 * targetTime is in the event location's timezone (e.g., "14:00" means 2pm
 * at the weather station, not 2pm where the admin lives).
 */
export function calculateLeadTimeHours(
  inputAt: string,
  targetDate: string,
  targetTime?: string,
  timeZone?: string,
): number {
  const inputMs = new Date(inputAt).getTime();

  if (timeZone) {
    // Build a Date that represents the target instant in the event's timezone.
    // We format "what time is it now" in the target timezone, then diff.
    const localTimeStr = targetTime || '12:00';
    const [h, m] = localTimeStr.split(':').map(Number);

    // Use a reference date at midnight UTC, then find the UTC offset for this timezone
    // by formatting a known instant and parsing back.
    const refStr = `${targetDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

    // Intl trick: format a known UTC date in the target timezone to find the offset
    const jan1 = new Date(`${targetDate}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(jan1);

    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';
    const tzNoon = new Date(`${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}Z`);
    // jan1 is noon UTC, tzNoon is what that looks like in the target tz interpreted as UTC
    // offset = tzNoon - jan1 (positive = east of UTC)
    const offsetMs = tzNoon.getTime() - jan1.getTime();

    // Target instant in UTC = local time string interpreted as UTC minus the offset
    const naiveMs = new Date(refStr + 'Z').getTime();
    const targetMs = naiveMs - offsetMs;

    return Math.max(0, (targetMs - inputMs) / (1000 * 60 * 60));
  }

  // Fallback (no timezone): interpret as local
  const targetStr = targetTime ? `${targetDate}T${targetTime}:00` : `${targetDate}T12:00:00`;
  const targetMs = new Date(targetStr).getTime();
  return Math.max(0, (targetMs - inputMs) / (1000 * 60 * 60));
}
