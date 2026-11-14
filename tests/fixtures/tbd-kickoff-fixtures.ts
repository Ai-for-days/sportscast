// Shared fixtures for tests/tbd-kickoff.test.ts (WOW-006 C). Not a test file.
//
// Two forecasts with DIFFERENT Friday (2026-11-20) and Saturday (2026-11-21)
// daily rows, so a test can tell which calendar day a game's `day` came from.
// Hourly points are venue-local wall-clock strings (Open-Meteo shape) covering
// Friday 12:00 through Saturday 23:00 local, so a game at 05:00Z has a full
// hourly window under either reading.

import { venues } from '../../src/lib/venue-data';
import { scheduleDeps } from '../../src/lib/league-schedule';
import { DEFAULT_WES_CONFIG } from '../../src/lib/wes';
import type { DailyForecast, ForecastPoint, ForecastResponse, Venue } from '../../src/lib/types';

export const NOW = Date.parse('2026-11-19T12:00:00Z');
export const KICKOFF_0500Z = '2026-11-21T05:00:00Z';
export const KICKOFF_SAT_2000Z = '2026-11-21T20:00:00Z';

export const husky = venues.find((v) => v.id === 'ncaa-wash') as Venue;      // Seattle, UTC-8 in November
export const autzen = venues.find((v) => v.id === 'ncaa-oregon') as Venue;   // Eugene, UTC-8
export const hawaii = venues.find((v) => v.id === 'ncaa-hawaii') as Venue;   // Honolulu, UTC-10

function daily(date: string, highF: number, lowF: number, precip: number, wind: number): DailyForecast {
  return {
    date, highF, lowF, feelsLikeHighF: highF, feelsLikeLowF: lowF, precipMm: 0,
    precipProbability: precip, windSpeedMph: wind, windGustMph: wind + 5, humidity: 60, uvIndexMax: 2,
    sunrise: `${date}T07:30`, sunset: `${date}T16:30`, description: `day-${date}`, icon: 'pc',
    dayDescription: `day-${date}`, nightDescription: 'night',
  };
}

function point(localTime: string, tempF: number): ForecastPoint {
  return {
    time: localTime, tempK: 0, tempF, tempC: 0, humidity: 60, dewPointF: 40, precipMm: 0,
    precipProbability: 10, windSpeedMph: 6, windDirectionDeg: 180, windGustMph: 11, cloudCover: 40,
    pressure: 1015, feelsLikeF: tempF, uvIndex: 1, visibility: 16000, description: 'Partly cloudy', icon: 'pc',
  };
}

/** Friday high/low differ from Saturday's in every field a test reads. */
export function forecastFor(v: Venue, utcOffsetSeconds: number, fri: [number, number], sat: [number, number]): ForecastResponse {
  const hourly: ForecastPoint[] = [];
  for (const [date, from] of [['2026-11-20', 12], ['2026-11-21', 0]] as const) {
    for (let h = from; h <= 23; h++) hourly.push(point(`${date}T${String(h).padStart(2, '0')}:00`, date === '2026-11-20' ? fri[0] - 4 : sat[0] - 4));
  }
  return {
    location: { lat: v.lat, lon: v.lon } as any,
    current: hourly[0],
    hourly,
    daily: [daily('2026-11-20', fri[0], fri[1], 20, 8), daily('2026-11-21', sat[0], sat[1], 60, 18)],
    utcOffsetSeconds,
    generatedAt: new Date(NOW - 20 * 60_000).toISOString(),
    source: { provider: 'open-meteo', label: 'WagerOnWeather Consensus', isResearchSample: false, notes: '' } as any,
    alerts: [],
  } as unknown as ForecastResponse;
}

export const FORECASTS: Record<string, ForecastResponse> = {
  'ncaa-wash': forecastFor(husky, -28800, [50, 41], [62, 47]),
  'ncaa-oregon': forecastFor(autzen, -28800, [52, 40], [64, 46]),
  'ncaa-hawaii': forecastFor(hawaii, -36000, [82, 72], [85, 74]),
};

export function rawGame(id: string, venue: Venue, kickoffUTC: string, tbd: boolean | undefined): any {
  const g: any = {
    id, homeTeam: venue.team ?? 'Home', awayTeam: 'Visitors', kickoffUTC, state: 'pre', statusDetail: '',
    homeScore: null, awayScore: null, venue, roofStatus: 'unknown', venueIsGameSite: true,
    neutralSite: false, gameSiteName: venue.name, homeTeamVenue: venue, awayVenue: null,
    inning: null, inningState: null, homePitcher: null, awayPitcher: null, livePeriodClock: null,
  };
  if (tbd !== undefined) g.kickoffTimeTBD = tbd;
  return g;
}

/** Stub every upstream of getScheduleGames; returns spies and a restore(). */
export function stubSchedule(raw: any[]) {
  const saved = { ...scheduleDeps };
  const wesSnapshotInputs: any[] = [];
  const kickoffSnapshots: string[] = [];
  const byLatLon = new Map(Object.entries(FORECASTS).map(([id, f]) => [`${f.location.lat},${f.location.lon}`, f]));
  Object.assign(scheduleDeps, {
    getRawGames: async () => raw.map((g) => ({ ...g })),
    getForecast: async (lat: number, lon: number) => byLatLon.get(`${lat},${lon}`) ?? null,
    getWesConfig: async () => DEFAULT_WES_CONFIG,
    getBoardLines: async (_l: unknown, games: unknown[]) => games.map(() => null),
    getRememberedRotations: async () => new Map(),
    rememberRotations: async () => {},
    getPublicRotationPairs: async (_l: unknown, games: unknown[]) => games.map(() => null),
    getClosingOdds: async () => new Map(),
    rememberClosingOdds: async () => {},
    getWesSnapshots: async () => new Map(),
    rememberWesSnapshots: async (entries: any[]) => { wesSnapshotInputs.push(...entries); },
    getRoofOverrides: async () => new Map(),
    saveKickoffSnapshot: async (id: string) => { kickoffSnapshots.push(id); },
    getForecastAccuracyWriteup: async () => null,
    getActualConditionsSummary: async () => null,
  });
  return { wesSnapshotInputs, kickoffSnapshots, restore: () => Object.assign(scheduleDeps, saved) };
}
