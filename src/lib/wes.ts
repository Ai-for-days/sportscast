// WES — Weather Experience Score. Spec: "WES one point oh.txt" (stats
// professor's design doc, not committed to the repo — ask the maintainer if
// you need the source again). Four public numbers per game, each 0-100:
// Environmental, Fan Feel, Player Feel, and overall WES.
//
// WES is NOT "how bad is the weather" — it's "what will this weather do to
// the experience of attending/playing this event." Environmental measures
// raw conditions; Fan Feel and Player Feel measure the HUMAN effect of those
// conditions, each built as a weighted blend of Environmental's own
// sub-scores (not re-derived from raw weather). The human side is
// deliberately 80% of the final number (Fan 35% + Player 45%).
//
// WES_VERSION 1.0 weights are an expert-designed initial model, explicitly
// NOT statistically proven (per spec requirement #12) — expect recalibration
// once historical event data exists. That's why every weight lives in
// WesConfig (Redis-backed, admin-editable at /admin/system/wes-control)
// rather than as a bare constant: the numbers are meant to move. Breakpoint
// lookup tables are NOT admin-editable in 1.0 (see BREAKPOINTS below) — only
// the weights are, which is a deliberate v1.0 scope line, not an oversight.
//
// Added 2026-08-21, still WES 1.0 (not a version bump — the spec's own
// framing): a severe-weather CAP on the final public number. wesRaw is the
// plain 0.20E+0.35F+0.45P blend, unchanged from launch. wesFinal is
// min(wesRaw, severeWeatherCap) when a cap applies — a hard ceiling so
// otherwise-favorable temperature/wind/humidity can't average a genuine
// safety/event-disruption threat away into a merely-mediocre-looking
// number. The cap is a ceiling, never a floor: an already-bad wesRaw below
// the cap passes through untouched. Environmental/FanFeel/PlayerFeel are
// never capped, only the overall score — Math.min, not a rewrite of those
// three formulas. Cap thresholds are fixed code for 1.0, same as the
// breakpoint curves — not admin-editable.

import { getRedis } from './redis';
import { getSunPosition } from './weather-utils';
import { getGameWindowForecast, type GameForecastSlot } from './mlb-game-forecast';
import type { WeatherAlert, ForecastPoint } from './types';

export const WES_VERSION = '1.0';

const DEG2RAD = Math.PI / 180;

// ── Piecewise-linear interpolation ──────────────────────────────────────
// Breakpoints are [x, y] pairs sorted ascending by x. Beyond the table's
// edges we extrapolate using the nearest segment's slope (clamped 0-100) —
// this is what makes "below 0 / above 115 -> approach 0" (and the analogous
// unstated edges on every other curve) fall out of one shared rule rather
// than needing bespoke edge-case code per table.

type Breakpoints = [number, number][];

function clamp0to100(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function interpolate(table: Breakpoints, x: number): number {
  if (table.length === 0) return 100;
  if (table.length === 1) return clamp0to100(table[0][1]);
  if (x <= table[0][0]) {
    const [x0, y0] = table[0];
    const [x1, y1] = table[1];
    const slope = (y1 - y0) / (x1 - x0);
    return clamp0to100(y0 + slope * (x - x0));
  }
  const last = table.length - 1;
  if (x >= table[last][0]) {
    const [x0, y0] = table[last - 1];
    const [x1, y1] = table[last];
    const slope = (y1 - y0) / (x1 - x0);
    return clamp0to100(y1 + slope * (x - x1));
  }
  for (let i = 0; i < last; i++) {
    const [x0, y0] = table[i];
    const [x1, y1] = table[i + 1];
    if (x >= x0 && x <= x1) {
      const f = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return clamp0to100(y0 + (y1 - y0) * f);
    }
  }
  return clamp0to100(table[last][1]);
}

// ── Environmental breakpoint tables (fixed for WES 1.0 — see file header) ──

/** Feels-like °F -> score. */
const TEMPERATURE_TABLE: Breakpoints = [
  [0, 5], [10, 20], [20, 35], [30, 50], [40, 65], [50, 78], [55, 88], [60, 95],
  [65, 100], [75, 100], [80, 95], [85, 88], [90, 78], [95, 65], [100, 50],
  [105, 35], [110, 20], [115, 5],
];

/** Rain rate, inches/hr -> score. */
const PRECIPITATION_TABLE: Breakpoints = [
  [0, 100], [0.01, 95], [0.05, 85], [0.10, 70], [0.25, 50], [0.50, 30], [1.00, 10],
];

/** Sustained wind, mph -> score. */
const WIND_TABLE: Breakpoints = [
  [0, 100], [5, 100], [10, 95], [15, 85], [20, 70], [25, 55], [30, 40], [40, 20], [50, 5],
];

/** Wind gust, mph -> score. */
const GUST_TABLE: Breakpoints = [
  [0, 100], [10, 100], [20, 92], [30, 75], [40, 55], [50, 35], [60, 20], [70, 5],
];

/**
 * Dew point °F -> score. The spec's two range tables ("40-55:100 ... 85+:10"
 * for the hot/humid side, "30-40:95, 20-30:90, below 20:85" for the dry
 * side) are reconciled here into one monotonic set of points: each labeled
 * range's value becomes the score at that range's OUTER edge (the edge
 * further from the 40-55 comfort plateau), so the curve rises smoothly into
 * the plateau from both directions instead of jumping at 40.
 */
const HUMIDITY_TABLE: Breakpoints = [
  [0, 85], [20, 90], [30, 95], [40, 100], [55, 100], [60, 95], [65, 85],
  [70, 68], [75, 45], [80, 25], [85, 10],
];

/** Visibility, miles -> score. */
const VISIBILITY_TABLE: Breakpoints = [
  [0, 0], [0.25, 10], [0.5, 30], [1, 50], [3, 75], [5, 90], [7, 95], [10, 100],
];

// ── Solar/glare heuristic (categorical per spec, not a 1-D lookup table) ──
// Reuses the same 0-15° "glare band" convention already established in
// game-weather-narrative.ts, plus cloud cover and UV/heat to pick between
// the spec's five named categories.
function solarScore(cloudCoverPct: number, sunAltitudeDeg: number, uvIndex: number, feelsLikeF: number): number {
  if (sunAltitudeDeg <= 0) return 100; // sun down — no solar burden
  if (cloudCoverPct >= 70) return 100; // overcast — little solar burden regardless of angle
  if (sunAltitudeDeg < 15) return 70; // severe low-angle glare
  if (feelsLikeF >= 85 && uvIndex >= 7) return 82; // strong sun adding meaningful heat
  if (cloudCoverPct < 30) return 92; // strong direct sunshine
  return 98; // normal sunshine
}

// ── Severe weather (from alerts overlapping the event window) ──────────
//
// One classifier feeds two different outputs: the `severeWeatherScore`
// sub-score (a normal 0-100 Environmental input, unchanged from before) and
// the `severeWeatherCap` (added 2026-08-21, a hard ceiling on the FINAL
// public WES — see computeGameWes). Deriving both from the same bucket
// keeps them from ever disagreeing about how bad the weather is, while
// letting the two use different scales for different purposes.
type SevereBucket = 'none' | 'minor' | 'significant' | 'thunderstorm' | 'severe' | 'tornado';

const SEVERE_BUCKET_RANK: Record<SevereBucket, number> = {
  none: 0, minor: 1, significant: 2, thunderstorm: 3, severe: 4, tornado: 5,
};

/** Environmental sub-score per bucket — same values as WES 1.0 always used. */
const SEVERE_SCORE_BY_BUCKET: Record<SevereBucket, number> = {
  none: 100, minor: 85, significant: 65, thunderstorm: 35, severe: 15, tornado: 0,
};

/** Max possible wesFinal per bucket. null = no cap (bucket 'none' only). */
const SEVERE_CAP_BY_BUCKET: Record<SevereBucket, number | null> = {
  none: null, minor: 85, significant: 70, thunderstorm: 50, severe: 30, tornado: 10,
};

function classifySevereAlert(a: WeatherAlert): SevereBucket {
  const event = a.event.toLowerCase();
  if (a.severity === 'Extreme' || event.includes('tornado')) return 'tornado';
  if (event.includes('severe thunderstorm')) return 'severe';
  if (a.severity === 'Severe' || event.includes('thunderstorm') || event.includes('lightning')) return 'thunderstorm';
  if (a.severity === 'Moderate') return 'significant';
  return 'minor'; // Minor / Unknown — minor advisory
}

export interface SevereWeatherClassification {
  bucket: SevereBucket;
  /** The worst overlapping alert's own NWS event text (e.g. "Severe Thunderstorm Warning"); null when bucket is 'none'. */
  reason: string | null;
}

/** Worst-case classification across every alert overlapping the event window. Deterministic — no subjective interpretation beyond the fixed event-text/severity rules above. */
export function classifySevereWeather(alerts: WeatherAlert[], windowStartMs: number, windowEndMs: number): SevereWeatherClassification {
  const relevant = alerts.filter((a) => {
    const onset = Date.parse(a.onset);
    const expires = Date.parse(a.expires);
    if (!Number.isFinite(onset) || !Number.isFinite(expires)) return true; // unknown timing — assume relevant
    return onset <= windowEndMs && expires >= windowStartMs;
  });
  let worst: { bucket: SevereBucket; reason: string } | null = null;
  for (const a of relevant) {
    const bucket = classifySevereAlert(a);
    if (!worst || SEVERE_BUCKET_RANK[bucket] > SEVERE_BUCKET_RANK[worst.bucket]) {
      worst = { bucket, reason: a.event };
    }
  }
  return worst ?? { bucket: 'none', reason: null };
}

// ── Weight configuration (admin-editable — see wes-config.ts API route) ──

export interface WesEnvironmentalWeights {
  temperature: number;
  precipitation: number;
  wind: number;
  gust: number;
  humidity: number;
  solar: number;
  visibility: number;
  severeWeather: number;
}

export interface WesFanWeights {
  thermalComfort: number;
  attendance: number;
  energy: number;
  vocalization: number;
  visibility: number;
  wetnessComfort: number;
  clapping: number;
  concessions: number;
  mobility: number;
}

export interface WesPlayerWeights {
  thermal: number;
  grip: number;
  endurance: number;
  footing: number;
  vision: number;
  breathing: number;
  sweatEquipment: number;
  concentration: number;
  dexterity: number;
}

export interface WesTopWeights {
  environmental: number;
  fanFeel: number;
  playerFeel: number;
}

export interface WesConfig {
  top: WesTopWeights;
  environmental: WesEnvironmentalWeights;
  fan: WesFanWeights;
  player: WesPlayerWeights;
}

export const DEFAULT_WES_CONFIG: WesConfig = {
  top: { environmental: 0.20, fanFeel: 0.35, playerFeel: 0.45 },
  environmental: {
    temperature: 0.25, precipitation: 0.25, wind: 0.15, gust: 0.10,
    humidity: 0.10, solar: 0.05, visibility: 0.05, severeWeather: 0.05,
  },
  fan: {
    thermalComfort: 0.20, attendance: 0.20, energy: 0.15, vocalization: 0.10,
    visibility: 0.10, wetnessComfort: 0.10, clapping: 0.05, concessions: 0.05, mobility: 0.05,
  },
  player: {
    thermal: 0.20, grip: 0.15, endurance: 0.15, footing: 0.12, vision: 0.10,
    breathing: 0.08, sweatEquipment: 0.08, concentration: 0.07, dexterity: 0.05,
  },
};

const WES_CONFIG_KEY = 'wes:config';

function mergeConfig(partial: any): WesConfig {
  const d = DEFAULT_WES_CONFIG;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    top: {
      environmental: num(partial?.top?.environmental, d.top.environmental),
      fanFeel: num(partial?.top?.fanFeel, d.top.fanFeel),
      playerFeel: num(partial?.top?.playerFeel, d.top.playerFeel),
    },
    environmental: {
      temperature: num(partial?.environmental?.temperature, d.environmental.temperature),
      precipitation: num(partial?.environmental?.precipitation, d.environmental.precipitation),
      wind: num(partial?.environmental?.wind, d.environmental.wind),
      gust: num(partial?.environmental?.gust, d.environmental.gust),
      humidity: num(partial?.environmental?.humidity, d.environmental.humidity),
      solar: num(partial?.environmental?.solar, d.environmental.solar),
      visibility: num(partial?.environmental?.visibility, d.environmental.visibility),
      severeWeather: num(partial?.environmental?.severeWeather, d.environmental.severeWeather),
    },
    fan: {
      thermalComfort: num(partial?.fan?.thermalComfort, d.fan.thermalComfort),
      attendance: num(partial?.fan?.attendance, d.fan.attendance),
      energy: num(partial?.fan?.energy, d.fan.energy),
      vocalization: num(partial?.fan?.vocalization, d.fan.vocalization),
      visibility: num(partial?.fan?.visibility, d.fan.visibility),
      wetnessComfort: num(partial?.fan?.wetnessComfort, d.fan.wetnessComfort),
      clapping: num(partial?.fan?.clapping, d.fan.clapping),
      concessions: num(partial?.fan?.concessions, d.fan.concessions),
      mobility: num(partial?.fan?.mobility, d.fan.mobility),
    },
    player: {
      thermal: num(partial?.player?.thermal, d.player.thermal),
      grip: num(partial?.player?.grip, d.player.grip),
      endurance: num(partial?.player?.endurance, d.player.endurance),
      footing: num(partial?.player?.footing, d.player.footing),
      vision: num(partial?.player?.vision, d.player.vision),
      breathing: num(partial?.player?.breathing, d.player.breathing),
      sweatEquipment: num(partial?.player?.sweatEquipment, d.player.sweatEquipment),
      concentration: num(partial?.player?.concentration, d.player.concentration),
      dexterity: num(partial?.player?.dexterity, d.player.dexterity),
    },
  };
}

export async function getWesConfig(): Promise<WesConfig> {
  try {
    const raw = await getRedis().get(WES_CONFIG_KEY);
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return mergeConfig(parsed);
    }
  } catch {
    /* redis unconfigured or miss — fall through to default */
  }
  return DEFAULT_WES_CONFIG;
}

export async function setWesConfig(patch: any): Promise<WesConfig> {
  const current = await getWesConfig();
  const next = mergeConfig({
    top: { ...current.top, ...patch?.top },
    environmental: { ...current.environmental, ...patch?.environmental },
    fan: { ...current.fan, ...patch?.fan },
    player: { ...current.player, ...patch?.player },
  });
  try {
    await getRedis().set(WES_CONFIG_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export async function resetWesConfig(): Promise<WesConfig> {
  try {
    await getRedis().set(WES_CONFIG_KEY, JSON.stringify(DEFAULT_WES_CONFIG));
  } catch {
    /* ignore */
  }
  return DEFAULT_WES_CONFIG;
}

// ── Result shape — every sub-score kept for debugging/admin per spec req #9 ──

export interface WesEnvironmentalSubScores {
  temperatureScore: number;
  precipitationScore: number;
  windScore: number;
  gustScore: number;
  humidityScore: number;
  solarScore: number;
  visibilityScore: number;
  severeWeatherScore: number;
}

export interface WesFanSubScores {
  fanThermalComfort: number;
  fanAttendance: number;
  fanEnergy: number;
  fanVocalization: number;
  fanVisibility: number;
  fanWetnessComfort: number;
  fanClapping: number;
  fanConcessions: number;
  fanMobility: number;
}

export interface WesPlayerSubScores {
  playerThermal: number;
  playerGrip: number;
  playerEndurance: number;
  playerFooting: number;
  playerVision: number;
  playerBreathing: number;
  playerSweatEquipment: number;
  playerConcentration: number;
  playerDexterity: number;
}

export interface WesResult {
  wesVersion: string;
  /** 0.20*Environmental + 0.35*FanFeel + 0.45*PlayerFeel — uncapped, full precision. Kept for internal/historical analysis; never the public number. */
  wesRaw: number;
  /** min(wesRaw, severeWeatherCap) when a cap applies, else wesRaw. THIS is the public-facing number — display it, not wesRaw. */
  wesFinal: number;
  /** Full precision — round only at display time. */
  environmental: number;
  fanFeel: number;
  playerFeel: number;
  /** Max possible wesFinal given the worst NWS alert overlapping the event window; null when there's no meaningful severe-weather risk (no cap applies). */
  severeWeatherCap: number | null;
  /** The NWS alert event text behind the cap (e.g. "Severe Thunderstorm Warning"); null when severeWeatherCap is null. */
  severeWeatherReason: string | null;
  environmentalSubScores: WesEnvironmentalSubScores;
  fanSubScores: WesFanSubScores;
  playerSubScores: WesPlayerSubScores;
}

// ── Core calculation ─────────────────────────────────────────────────────

/** Averages an environmental sub-score across sampled slots. Precipitation is aggregated separately (worst-moment, not average — see computeWesEnvironmental). */
function average(nums: number[]): number {
  if (nums.length === 0) return 100;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

interface WesGameInputs {
  slots: GameForecastSlot[];
  lat: number;
  lon: number;
  /** Environmental's severeWeatherScore sub-score — computed once in computeGameWes (classifySevereWeather) and shared with the wesFinal cap so the two can never disagree about how bad the weather is. */
  severeWeatherScoreValue: number;
}

function computeWesEnvironmental(inputs: WesGameInputs, weights: WesEnvironmentalWeights): { environmental: number; sub: WesEnvironmentalSubScores } {
  const { slots, lat, lon, severeWeatherScoreValue } = inputs;
  const latRad = lat * DEG2RAD;

  const temperatureScores: number[] = [];
  const windScores: number[] = [];
  const gustScores: number[] = [];
  const humidityScores: number[] = [];
  const solarScores: number[] = [];
  const visibilityScores: number[] = [];
  const precipitationScores: number[] = [];

  for (const s of slots) {
    temperatureScores.push(interpolate(TEMPERATURE_TABLE, s.feelsLikeF));
    windScores.push(interpolate(WIND_TABLE, s.windSpeedMph));
    gustScores.push(interpolate(GUST_TABLE, s.windGustMph));
    humidityScores.push(interpolate(HUMIDITY_TABLE, s.dewPointF));
    visibilityScores.push(interpolate(VISIBILITY_TABLE, s.visibilityMiles));
    const { altitude } = getSunPosition(Date.parse(s.timeUTC), latRad, lon);
    solarScores.push(solarScore(s.cloudCoverPct, altitude, s.uvIndex, s.feelsLikeF));
    // Precip rate: this hourly slot's mm value already represents mm/hr of accumulation.
    precipitationScores.push(interpolate(PRECIPITATION_TABLE, s.precipMmPerHr / 25.4));
  }

  const sub: WesEnvironmentalSubScores = {
    temperatureScore: average(temperatureScores),
    // Worst moment dominates (a 10-minute downpour shouldn't average away) — same
    // "peak" convention already used for precip in game-weather-narrative.ts.
    precipitationScore: precipitationScores.length ? Math.min(...precipitationScores) : 100,
    windScore: average(windScores),
    gustScore: average(gustScores),
    humidityScore: average(humidityScores),
    solarScore: average(solarScores),
    visibilityScore: average(visibilityScores),
    severeWeatherScore: severeWeatherScoreValue,
  };

  const environmental =
    weights.temperature * sub.temperatureScore +
    weights.precipitation * sub.precipitationScore +
    weights.wind * sub.windScore +
    weights.gust * sub.gustScore +
    weights.humidity * sub.humidityScore +
    weights.solar * sub.solarScore +
    weights.visibility * sub.visibilityScore +
    weights.severeWeather * sub.severeWeatherScore;

  return { environmental, sub };
}

function computeWesFan(e: WesEnvironmentalSubScores, weights: WesFanWeights): { fanFeel: number; sub: WesFanSubScores } {
  const fanThermalComfort = 0.65 * e.temperatureScore + 0.25 * e.humidityScore + 0.10 * e.solarScore;
  const fanAttendance = 0.40 * e.temperatureScore + 0.35 * e.precipitationScore + 0.15 * e.windScore + 0.10 * e.severeWeatherScore;
  const fanEnergy = 0.40 * fanThermalComfort + 0.25 * e.precipitationScore + 0.15 * e.windScore + 0.10 * e.solarScore + 0.10 * e.severeWeatherScore;
  const fanVocalization = 0.50 * e.temperatureScore + 0.25 * e.windScore + 0.15 * e.precipitationScore + 0.10 * e.humidityScore;
  const fanVisibility = 0.55 * e.visibilityScore + 0.35 * e.solarScore + 0.10 * e.precipitationScore;
  const fanWetnessComfort = 0.65 * e.precipitationScore + 0.20 * e.temperatureScore + 0.15 * e.windScore;
  const fanClapping = 0.55 * e.temperatureScore + 0.20 * e.precipitationScore + 0.25 * e.windScore;
  const fanConcessions = 0.50 * e.temperatureScore + 0.30 * e.humidityScore + 0.20 * e.precipitationScore;
  const fanMobility = 0.40 * e.precipitationScore + 0.30 * e.temperatureScore + 0.20 * e.windScore + 0.10 * e.severeWeatherScore;

  const sub: WesFanSubScores = {
    fanThermalComfort, fanAttendance, fanEnergy, fanVocalization, fanVisibility,
    fanWetnessComfort, fanClapping, fanConcessions, fanMobility,
  };

  const fanFeel =
    weights.thermalComfort * fanThermalComfort +
    weights.attendance * fanAttendance +
    weights.energy * fanEnergy +
    weights.vocalization * fanVocalization +
    weights.visibility * fanVisibility +
    weights.wetnessComfort * fanWetnessComfort +
    weights.clapping * fanClapping +
    weights.concessions * fanConcessions +
    weights.mobility * fanMobility;

  return { fanFeel, sub };
}

function computeWesPlayer(e: WesEnvironmentalSubScores, weights: WesPlayerWeights): { playerFeel: number; sub: WesPlayerSubScores } {
  const playerThermal = 0.70 * e.temperatureScore + 0.20 * e.humidityScore + 0.10 * e.solarScore;
  const playerGrip = 0.45 * e.precipitationScore + 0.25 * e.temperatureScore + 0.20 * e.humidityScore + 0.10 * e.windScore;
  const playerEndurance = 0.55 * e.temperatureScore + 0.30 * e.humidityScore + 0.10 * e.solarScore + 0.05 * e.windScore;
  const playerFooting = 0.65 * e.precipitationScore + 0.20 * e.windScore + 0.10 * e.temperatureScore + 0.05 * e.severeWeatherScore;
  const playerVision = 0.45 * e.visibilityScore + 0.35 * e.solarScore + 0.15 * e.precipitationScore + 0.05 * e.windScore;
  // No AQI input wired in yet — left isolated per spec ("if AQI is already
  // available, leave the code structured so we can add air quality here
  // later") so a future change only touches this one line.
  const playerBreathing = 0.60 * e.temperatureScore + 0.30 * e.humidityScore + 0.10 * e.severeWeatherScore;
  const playerSweatEquipment = 0.50 * e.temperatureScore + 0.35 * e.humidityScore + 0.15 * e.solarScore;
  // Kept isolated per spec — WES 1.0 defines this as a plain average, but the
  // doc explicitly flags it for a future nonlinear "frustration" replacement.
  const baseConcentration = (playerThermal + playerGrip + playerFooting + playerVision) / 4;
  const playerConcentration = baseConcentration;
  const playerDexterity = 0.65 * e.temperatureScore + 0.20 * e.precipitationScore + 0.15 * e.windScore;

  const sub: WesPlayerSubScores = {
    playerThermal, playerGrip, playerEndurance, playerFooting, playerVision,
    playerBreathing, playerSweatEquipment, playerConcentration, playerDexterity,
  };

  const playerFeel =
    weights.thermal * playerThermal +
    weights.grip * playerGrip +
    weights.endurance * playerEndurance +
    weights.footing * playerFooting +
    weights.vision * playerVision +
    weights.breathing * playerBreathing +
    weights.sweatEquipment * playerSweatEquipment +
    weights.concentration * playerConcentration +
    weights.dexterity * playerDexterity;

  return { playerFeel, sub };
}

/** WES's event-window duration — 3.5 hours, matching the fixed duration
 * already used for every non-MLB narrative in game-weather-narrative.ts
 * (buildGameWeatherNarrative). MLB uses its own 9-inning window elsewhere for
 * narrative phrasing, but for WES's numeric aggregation a single shared
 * duration keeps all four leagues directly comparable. */
const WES_WINDOW_HOURS = 3.5;
const WES_STEP_MINUTES = 30;

export function computeGameWes(
  hourly: ForecastPoint[],
  kickoffUTC: string,
  utcOffsetSeconds: number,
  lat: number,
  lon: number,
  alerts: WeatherAlert[],
  config: WesConfig,
): WesResult | null {
  const slots = getGameWindowForecast(hourly, kickoffUTC, utcOffsetSeconds, WES_WINDOW_HOURS, WES_STEP_MINUTES);
  if (slots.length === 0) return null;

  const kickoffMs = Date.parse(kickoffUTC);
  const windowStartMs = kickoffMs;
  const windowEndMs = kickoffMs + WES_WINDOW_HOURS * 3600000;

  const classification = classifySevereWeather(alerts, windowStartMs, windowEndMs);
  const severeWeatherScoreValue = SEVERE_SCORE_BY_BUCKET[classification.bucket];

  const { environmental, sub: environmentalSubScores } = computeWesEnvironmental(
    { slots, lat, lon, severeWeatherScoreValue },
    config.environmental,
  );
  const { fanFeel, sub: fanSubScores } = computeWesFan(environmentalSubScores, config.fan);
  const { playerFeel, sub: playerSubScores } = computeWesPlayer(environmentalSubScores, config.player);

  const wesRaw = config.top.environmental * environmental + config.top.fanFeel * fanFeel + config.top.playerFeel * playerFeel;

  // Severe weather can place a hard ceiling on the FINAL public WES so that
  // otherwise-favorable temperature/wind/humidity can't average away a
  // genuine safety/event-disruption threat (added 2026-08-21). This caps
  // wesFinal only — it never touches Environmental/FanFeel/PlayerFeel, which
  // stay exactly what the uncapped formulas produce.
  const severeWeatherCap = SEVERE_CAP_BY_BUCKET[classification.bucket];
  const severeWeatherReason = severeWeatherCap !== null ? classification.reason : null;
  const wesFinal = severeWeatherCap !== null ? Math.min(wesRaw, severeWeatherCap) : wesRaw;

  return {
    wesVersion: WES_VERSION,
    wesRaw,
    wesFinal,
    environmental,
    fanFeel,
    playerFeel,
    severeWeatherCap,
    severeWeatherReason,
    environmentalSubScores,
    fanSubScores,
    playerSubScores,
  };
}
