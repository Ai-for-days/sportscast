// ── Tests: /api/feeds/game-weather and the board synthetic guard (WOW-002) ──
//
// Written from the Professor's WOW-002 spec (tests t1-t10), with expected
// values worked out by hand from the spec, not snapshotted from output.
// Run with `npm test`. No network: every upstream is stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGameWeatherFeed,
  handleGameWeatherFeedRequest,
  impactFor,
  oneSentence,
  unavailableReason,
  FORECAST_MAX_AGE_HOURS,
  WRITEUP_MAX_CHARS,
  type FeedDeps,
  type GameWeatherFeed,
} from '../src/lib/game-weather-feed';
import { getScheduleGames, scheduleDeps, type EnrichedScheduleGame, type ScheduleResult } from '../src/lib/league-schedule';
import { venues } from '../src/lib/venue-data';
import { DEFAULT_WES_CONFIG, type WesResult } from '../src/lib/wes';
import type { DailyForecast, ForecastPoint, ForecastResponse, Venue } from '../src/lib/types';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const KICKOFF = '2026-11-15T18:00:00Z'; // 12:00 local at UTC-6
const OFFSET = -21600;

const outdoorVenue = venues.find((v) => v.league === 'ncaa-football' && v.type === 'outdoor') as Venue;
const indoorVenue = venues.find((v) => v.type === 'indoor') as Venue;
const retractableVenue = venues.find((v) => v.type === 'retractable') as Venue;

function daily(o: Partial<DailyForecast> = {}): DailyForecast {
  return {
    date: '2026-11-15', highF: 60, lowF: 45, feelsLikeHighF: 60, feelsLikeLowF: 45, precipMm: 0,
    precipProbability: 10, windSpeedMph: 5, windGustMph: 8, humidity: 50, uvIndexMax: 3,
    sunrise: '2026-11-15T07:00', sunset: '2026-11-15T17:20', description: 'Partly cloudy', icon: 'pc',
    dayDescription: 'Partly cloudy', nightDescription: 'Clear',
    ...o,
  };
}

function wes(final: number): WesResult {
  return {
    wesVersion: '1.0', wesRaw: final, wesFinal: final, environmental: final, fanFeel: final, playerFeel: final,
    severeWeatherCap: null, severeWeatherReason: null,
    environmentalSubScores: {} as any, fanSubScores: {} as any, playerSubScores: {} as any,
  };
}

function mkGame(o: Partial<EnrichedScheduleGame> = {}): EnrichedScheduleGame {
  return {
    id: 'g1', homeTeam: 'Home U', awayTeam: 'Away State', kickoffUTC: KICKOFF, state: 'pre', statusDetail: '',
    homeScore: null, awayScore: null, venue: outdoorVenue, roofStatus: 'unknown', roofUncertain: false,
    venueIsGameSite: true, neutralSite: false, gameSiteName: outdoorVenue.name, homeTeamVenue: outdoorVenue,
    awayVenue: null, weatherMatters: true, roofClosed: false, day: daily(),
    weatherNarrative: 'Partly cloudy and 58°F at kickoff with a light 5 mph breeze. Conditions stay steady through the fourth quarter.',
    firstPitchWeather: null, wes: wes(84.4), wesIsFrozen: false, lines: null, linesAreClosing: false,
    inning: null, inningState: null, homePitcher: null, awayPitcher: null, livePeriodClock: null,
    forecastAccuracyWriteup: null, actualConditionsSummary: null,
    forecastGeneratedAt: new Date(NOW - 30 * 60_000).toISOString(),
    forecastSource: 'WagerOnWeather Consensus', forecastSynthetic: false, kickoffTimeTBD: false,
    kickoffWeather: { tempF: 58.4, windSpeedMph: 5.2, windGustMph: 9.6, precipProbability: 10 },
    ...o,
  };
}

const result = (games: EnrichedScheduleGame[]): ScheduleResult => ({ games, windowDays: 7, truncated: false });

// A game with no usable forecast, the way getScheduleGames builds it.
const noWeather = { day: null, weatherNarrative: null, wes: null, kickoffWeather: null, forecastGeneratedAt: null, forecastSource: null };

// ── t1 ─────────────────────────────────────────────────────────────────────
test('t1: a synthetic forecast puts the game in unavailable with reason synthetic', () => {
  const feed = buildGameWeatherFeed('ncaa-football', result([mkGame({ ...noWeather, forecastSynthetic: true })]), NOW);
  assert.equal(feed.games.length, 0);
  assert.deepEqual(feed.unavailable, [{ id: 'g1', awayTeam: 'Away State', homeTeam: 'Home U', kickoffUTC: KICKOFF, reason: 'synthetic' }]);
});

// ── t2 ─────────────────────────────────────────────────────────────────────
test('t2: a forecast 3 h 1 min old is stale; 2 h 59 min old is served', () => {
  assert.equal(FORECAST_MAX_AGE_HOURS, 3);
  const old = mkGame({ forecastGeneratedAt: new Date(NOW - (3 * 60 + 1) * 60_000).toISOString() });
  const fresh = mkGame({ id: 'g2', forecastGeneratedAt: new Date(NOW - (2 * 60 + 59) * 60_000).toISOString() });
  assert.equal(unavailableReason(old, NOW), 'stale');
  assert.equal(unavailableReason(fresh, NOW), null);
  const feed = buildGameWeatherFeed('ncaa-football', result([old, fresh]), NOW);
  assert.deepEqual(feed.unavailable.map((u) => [u.id, u.reason]), [['g1', 'stale']]);
  assert.deepEqual(feed.games.map((g) => g.id), ['g2']);
});

// ── t3 ─────────────────────────────────────────────────────────────────────
test('t3: no forecast is no-forecast; a kickoff past the daily range is out-of-horizon', () => {
  const none = mkGame({ ...noWeather });
  const beyond = mkGame({ id: 'g2', day: null, weatherNarrative: null, wes: null, kickoffWeather: null });
  const feed = buildGameWeatherFeed('ncaa-football', result([none, beyond]), NOW);
  assert.deepEqual(feed.unavailable.map((u) => [u.id, u.reason]), [['g1', 'no-forecast'], ['g2', 'out-of-horizon']]);
  assert.equal(feed.games.length, 0);
});

// ── t4 ─────────────────────────────────────────────────────────────────────
test('t4: indoor and roofClosed both give indoor:true with null weather', () => {
  const indoor = mkGame({ venue: indoorVenue, weatherMatters: false, ...noWeather });
  const closed = mkGame({ id: 'g2', venue: retractableVenue, roofClosed: true, weatherMatters: false, ...noWeather });
  const feed = buildGameWeatherFeed('ncaa-football', result([indoor, closed]), NOW);
  assert.equal(feed.unavailable.length, 0);
  assert.equal(feed.games.length, 2);
  for (const g of feed.games) {
    assert.equal(g.indoor, true);
    assert.equal(g.day, null);
    assert.equal(g.kickoff, null);
    assert.equal(g.wes, null);
    assert.equal(g.forecastGeneratedAt, null);
    assert.equal(g.impact?.label, 'none');
    assert.match(g.impact!.note, /^Indoor stadium/);
  }
});

// ── t5 ─────────────────────────────────────────────────────────────────────
const ALLOWED_PATHS = new Set([
  'version', 'league', 'generatedAt', 'truncated', 'forecastMaxAgeHours', 'games', 'unavailable',
  'games[].id', 'games[].awayTeam', 'games[].homeTeam', 'games[].kickoffUTC', 'games[].kickoffTimeTBD', 'games[].neutralSite',
  'games[].venue', 'games[].venue.name', 'games[].venue.city', 'games[].venue.state', 'games[].venue.slug', 'games[].venue.url',
  'games[].indoor', 'games[].roofUncertain', 'games[].forecastGeneratedAt', 'games[].forecastSource',
  'games[].day', 'games[].day.highF', 'games[].day.lowF', 'games[].day.sky',
  'games[].kickoff', 'games[].kickoff.tempF', 'games[].kickoff.windMph', 'games[].kickoff.gustMph', 'games[].kickoff.rainChancePct',
  'games[].wes', 'games[].wes.score', 'games[].wes.band', 'games[].wes.basis',
  'games[].impact', 'games[].impact.label', 'games[].impact.note', 'games[].impact.basis',
  'games[].writeup',
  'unavailable[].id', 'unavailable[].awayTeam', 'unavailable[].homeTeam', 'unavailable[].kickoffUTC', 'unavailable[].reason',
]);
// `wes.score` is the WES number the spec itself names; it is the one key the
// forbidden pattern would otherwise catch, so it is exempted by exact path.
const FORBIDDEN = /odds|line|rotation|score|quarter|slot|hourly|inning/i;

export function keyPaths(value: unknown, prefix = ''): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) out.push(...keyPaths(item, `${prefix}[]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.push(p, ...keyPaths(v, p));
    }
  }
  return [...new Set(out)];
}

export function assertFeedShape(feed: unknown): string[] {
  const paths = keyPaths(feed).map((p) => p.replace(/^(games|unavailable)\[\]\./, '$1[].'));
  for (const p of paths) {
    assert.ok(ALLOWED_PATHS.has(p), `key path not in allowlist: ${p}`);
    if (p !== 'games[].wes.score') assert.ok(!FORBIDDEN.test(p.split('.').pop()!), `forbidden key: ${p}`);
  }
  for (const g of (feed as GameWeatherFeed).games) {
    for (const [k, v] of Object.entries(g)) assert.ok(!Array.isArray(v), `game field ${k} holds an array`);
    for (const v of Object.values(g)) {
      if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) assert.ok(!Array.isArray(v2), `nested ${k2} holds an array`);
    }
  }
  return paths;
}

test('t5: every key path of a full response is in the frozen allowlist; no odds/score/hourly keys; no arrays in a game', () => {
  const games = [
    mkGame(),
    mkGame({ id: 'g2', venue: indoorVenue, weatherMatters: false, ...noWeather }),
    mkGame({ id: 'g3', ...noWeather, forecastSynthetic: true }),
    // Fields the feed must never copy out, even when the game carries them.
    mkGame({ id: 'g4', homeScore: 21, awayScore: 14, lines: { awayRotation: 101, homeRotation: 102 } as any }),
  ];
  const feed = buildGameWeatherFeed('ncaa-football', result(games), NOW);
  const paths = assertFeedShape(JSON.parse(JSON.stringify(feed)));
  assert.ok(paths.includes('games[].kickoff.windMph'));
  assert.ok(paths.includes('unavailable[].reason'));
});

// ── t6 ─────────────────────────────────────────────────────────────────────
test('t6: impact labels match the hand-computed cases', () => {
  const cases: [number, number, number, string][] = [
    [20, 60, 10, 'high'],
    [13, 60, 10, 'moderate'],
    [5, 60, 10, 'none'],
    [5, 30, 0, 'high'],
  ];
  for (const [wind, high, rain, label] of cases) {
    const got = impactFor({ venue: outdoorVenue, roofClosed: false, day: daily({ windSpeedMph: wind, highF: high, precipProbability: rain }) });
    assert.equal(got?.label, label, `wind ${wind}, high ${high}, rain ${rain}`);
    assert.equal(got?.basis, 'game-day daily forecast');
  }
});

// ── t7 ─────────────────────────────────────────────────────────────────────
test('t7: the writeup is one sentence, at most 240 characters, with no betting language', () => {
  const long = `${'Gusty northwest winds of 25 to 30 mph sweep across the open end of the stadium, '.repeat(4)}easing late. Rain arrives after halftime.`;
  const feed = buildGameWeatherFeed('ncaa-football', result([mkGame(), mkGame({ id: 'g2', weatherNarrative: long })]), NOW);
  assert.equal(feed.games[0].writeup, 'Partly cloudy and 58°F at kickoff with a light 5 mph breeze.');
  for (const g of feed.games) {
    assert.ok(g.writeup.length > 0 && g.writeup.length <= WRITEUP_MAX_CHARS, `length ${g.writeup.length}`);
    assert.ok(!/[.!?]\s+[A-Z]/.test(g.writeup), `more than one sentence: ${g.writeup}`);
    assert.ok(!/\b(edge|value|lock|easy money|best bet)\b/i.test(g.writeup), `betting language: ${g.writeup}`);
  }
  assert.equal(oneSentence('Wind 2.5 mph. Dry.'), 'Wind 2.5 mph.');
});

// ── t8 ─────────────────────────────────────────────────────────────────────
function deps(over: Partial<FeedDeps> = {}): FeedDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getScheduleGames: async () => result([mkGame()]),
    recordSourceSuccess: async () => { calls.push('success'); },
    recordSourceFailure: async () => { calls.push('failure'); },
    now: () => NOW,
    ...over,
  };
}

test('t8: 400 for an unknown league or any extra parameter; cache header on 200, no-store on 500', async () => {
  for (const q of ['?league=x', '?league=nfl&days=3', '?league=nfl&team=Oregon', '', '?league=nfl&league=mlb']) {
    const res = await handleGameWeatherFeedRequest(new URL(`https://wageronweather.com/api/feeds/game-weather${q}`), deps());
    assert.equal(res.status, 400, q);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', q);
  }
  const d = deps();
  const ok = await handleGameWeatherFeedRequest(new URL('https://wageronweather.com/api/feeds/game-weather?league=ncaa-football'), d);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), 'public, s-maxage=600, stale-while-revalidate=300');
  assertFeedShape(await ok.json());
  assert.deepEqual(d.calls, ['success']);

  const bad = deps({ getScheduleGames: async () => { throw new Error('boom'); } });
  const err = await handleGameWeatherFeedRequest(new URL('https://wageronweather.com/api/feeds/game-weather?league=nfl'), bad);
  assert.equal(err.status, 500);
  assert.equal(err.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(bad.calls, ['failure']);

  // Every outdoor game unavailable -> failure recorded; zero games -> nothing recorded.
  const allGone = deps({ getScheduleGames: async () => result([mkGame({ ...noWeather, forecastSynthetic: true })]) });
  await handleGameWeatherFeedRequest(new URL('https://wageronweather.com/api/feeds/game-weather?league=nfl'), allGone);
  assert.deepEqual(allGone.calls, ['failure']);
  const empty = deps({ getScheduleGames: async () => result([]) });
  await handleGameWeatherFeedRequest(new URL('https://wageronweather.com/api/feeds/game-weather?league=nfl'), empty);
  assert.deepEqual(empty.calls, []);
});

// ── t9 / t10: getScheduleGames with every upstream stubbed ──────────────────
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
    // And the feed serves it, in the allowed shape.
    const feed = buildGameWeatherFeed('ncaa-football', { games, windowDays: 7, truncated: false }, NOW);
    assert.equal(feed.games.length, 1);
    assertFeedShape(JSON.parse(JSON.stringify(feed)));
  } finally { s2.restore(); }
});

// ── t11 (WOW-004): the feed reads forecasts in background mode ──────────────
test('t11: weatherOnly passes maxAgeSeconds = 3 h to every getForecast call; the default path passes none', async () => {
  const seen: (number | undefined)[] = [];
  const s1 = stubSchedule(forecast(false));
  const spy = async (_lat: number, _lon: number, _days: number, o?: { maxAgeSeconds?: number }) => { seen.push(o?.maxAgeSeconds); return forecast(false); };
  Object.assign(scheduleDeps, { getForecast: spy });
  try {
    await getScheduleGames('ncaa-football', 7, undefined, { weatherOnly: true });
    assert.ok(seen.length >= 1, 'getForecast should be called for the outdoor venue');
    assert.ok(seen.every((v) => v === 3 * 3600), `weatherOnly maxAgeSeconds: ${JSON.stringify(seen)}`);
  } finally { s1.restore(); }
  seen.length = 0;
  const s2 = stubSchedule(forecast(false));
  Object.assign(scheduleDeps, { getForecast: spy });
  try {
    await getScheduleGames('ncaa-football', 7);
    assert.ok(seen.length >= 1);
    assert.ok(seen.every((v) => v === undefined), `default maxAgeSeconds: ${JSON.stringify(seen)}`);
  } finally { s2.restore(); }
});
