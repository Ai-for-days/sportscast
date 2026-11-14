// ── Tests: the board synthetic-forecast guard (WOW-002 W1-guard, re-shipped WOW-004) ──
//
// getScheduleGames' full (board) path must treat a synthetic forecast as no
// forecast: no narrative, no WES, no day, no kickoff sample. A real forecast
// is still narrated and scored. Every upstream is stubbed through
// scheduleDeps. Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getScheduleGames, scheduleDeps, usableForecast } from '../src/lib/league-schedule';
import { venues } from '../src/lib/venue-data';
import { DEFAULT_WES_CONFIG } from '../src/lib/wes';
import type { DailyForecast, ForecastPoint, ForecastResponse, Venue } from '../src/lib/types';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const KICKOFF = '2026-11-15T18:00:00Z'; // 12:00 local at UTC-6
const OFFSET = -21600;
const outdoorVenue = venues.find((v) => v.league === 'ncaa-football' && v.type === 'outdoor') as Venue;

function daily(): DailyForecast {
  return {
    date: '2026-11-15', highF: 60, lowF: 45, feelsLikeHighF: 60, feelsLikeLowF: 45, precipMm: 0,
    precipProbability: 10, windSpeedMph: 5, windGustMph: 8, humidity: 50, uvIndexMax: 3,
    sunrise: '2026-11-15T07:00', sunset: '2026-11-15T17:20', description: 'Partly cloudy', icon: 'pc',
    dayDescription: 'Partly cloudy', nightDescription: 'Clear',
  };
}

function hourlyPoint(localTime: string): ForecastPoint {
  return {
    time: localTime, tempK: 0, tempF: 58, tempC: 0, humidity: 55, dewPointF: 42, precipMm: 0,
    precipProbability: 10, windSpeedMph: 5, windDirectionDeg: 180, windGustMph: 9, cloudCover: 40,
    pressure: 1015, feelsLikeF: 58, uvIndex: 2, visibility: 16000, description: 'Partly cloudy', icon: 'pc',
  };
}

function forecast(synthetic: boolean): ForecastResponse {
  const hourly: ForecastPoint[] = [];
  for (let h = 6; h <= 23; h++) hourly.push(hourlyPoint(`2026-11-15T${String(h).padStart(2, '0')}:00`));
  return {
    location: { lat: outdoorVenue.lat, lon: outdoorVenue.lon } as any,
    current: hourly[0],
    hourly,
    daily: [daily()],
    utcOffsetSeconds: OFFSET,
    generatedAt: new Date(NOW).toISOString(),
    source: { provider: 'open-meteo', label: 'WagerOnWeather Consensus', isResearchSample: false, notes: '' } as any,
    alerts: [],
    ...(synthetic ? { synthetic: true } : {}),
  } as unknown as ForecastResponse;
}

function stubSchedule(f: ForecastResponse) {
  const saved = { ...scheduleDeps };
  const calls: Record<string, number> = {};
  const count = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
  Object.assign(scheduleDeps, {
    getRawGames: async () => [{
      id: 'g1', homeTeam: 'Home U', awayTeam: 'Away State', kickoffUTC: KICKOFF, state: 'pre', statusDetail: '',
      homeScore: null, awayScore: null, venue: outdoorVenue, roofStatus: 'unknown', venueIsGameSite: true,
      neutralSite: false, gameSiteName: outdoorVenue.name, homeTeamVenue: outdoorVenue, awayVenue: null,
      inning: null, inningState: null, homePitcher: null, awayPitcher: null, livePeriodClock: null,
    }],
    getForecast: async () => f,
    getWesConfig: async () => DEFAULT_WES_CONFIG,
    getBoardLines: async (_l: unknown, games: unknown[]) => { count('getBoardLines'); return games.map(() => null); },
    getRememberedRotations: async () => { count('getRememberedRotations'); return new Map(); },
    rememberRotations: async () => { count('rememberRotations'); },
    getPublicRotationPairs: async (_l: unknown, games: unknown[]) => { count('getPublicRotationPairs'); return games.map(() => null); },
    getClosingOdds: async () => { count('getClosingOdds'); return new Map(); },
    rememberClosingOdds: async () => { count('rememberClosingOdds'); },
    getWesSnapshots: async () => new Map(),
    rememberWesSnapshots: async () => {},
    getRoofOverrides: async () => new Map(),
    saveKickoffSnapshot: async () => {},
    getForecastAccuracyWriteup: async () => null,
    getActualConditionsSummary: async () => null,
  });
  return { calls, restore: () => Object.assign(scheduleDeps, saved) };
}

test('usableForecast refuses a synthetic forecast and passes a real one through', () => {
  assert.equal(usableForecast(null), null);
  assert.equal(usableForecast(forecast(true)), null);
  const real = forecast(false);
  assert.equal(usableForecast(real), real);
});

test('t10: on the full board path a synthetic forecast gives null narrative, WES and day; a real one does not', async () => {
  const s1 = stubSchedule(forecast(true));
  try {
    const { games } = await getScheduleGames('ncaa-football', 7);
    assert.equal(games.length, 1);
    assert.equal(games[0].weatherNarrative, null);
    assert.equal(games[0].wes, null);
    assert.equal(games[0].day, null);
    assert.equal(games[0].kickoffWeather, null);
    assert.equal(games[0].forecastGeneratedAt, null);
    assert.equal(games[0].forecastSynthetic, true);
  } finally { s1.restore(); }
  const s2 = stubSchedule(forecast(false));
  try {
    const { games } = await getScheduleGames('ncaa-football', 7);
    assert.ok(games[0].weatherNarrative, 'a real forecast should be narrated');
    assert.ok(games[0].wes, 'a real forecast should be scored');
    assert.equal(games[0].day?.highF, 60);
    assert.equal(games[0].forecastSynthetic, false);
    assert.equal(games[0].forecastSource, 'WagerOnWeather Consensus');
  } finally { s2.restore(); }
});

test('t9: weatherOnly never calls getBoardLines or the rotation/closing-odds stores; the default path still does', async () => {
  const s1 = stubSchedule(forecast(false));
  try {
    await getScheduleGames('ncaa-football', 7, undefined, { weatherOnly: true });
    assert.deepEqual(s1.calls, {});
  } finally { s1.restore(); }
  const s2 = stubSchedule(forecast(false));
  try {
    await getScheduleGames('ncaa-football', 7);
    assert.equal(s2.calls.getBoardLines, 1);
    assert.equal(s2.calls.getRememberedRotations, 1);
    assert.equal(s2.calls.getClosingOdds, 1);
  } finally { s2.restore(); }
});
