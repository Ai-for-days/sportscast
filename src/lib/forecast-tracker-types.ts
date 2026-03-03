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

export function calculateAccuracyScore(metric: ForecastMetric, error: number): number {
  const absError = Math.abs(error);

  if (metric === 'wind_speed' || metric === 'wind_gust') {
    // Wind: more forgiving. 0 mph error = 100, 30 mph error = 0
    return Math.max(0, Math.round(100 * (1 - absError / 30)));
  }

  // Temperature: 0° error = 100, 20° error = 0
  return Math.max(0, Math.round(100 * (1 - absError / 20)));
}

// ── Lead Time Display ───────────────────────────────────────────────────────

export function formatLeadTime(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.round(hours / 24 * 10) / 10;
  return `${days}d`;
}

// ── Calculate lead time in hours ────────────────────────────────────────────

export function calculateLeadTimeHours(
  inputAt: string,
  targetDate: string,
  targetTime?: string,
): number {
  const inputMs = new Date(inputAt).getTime();
  const targetStr = targetTime ? `${targetDate}T${targetTime}:00` : `${targetDate}T12:00:00`;
  const targetMs = new Date(targetStr).getTime();
  return Math.max(0, (targetMs - inputMs) / (1000 * 60 * 60));
}
