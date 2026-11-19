// Fixtures for the WOW-034 command-count and output-equality tests.
//
// A small but realistic world seeded into a CountingRedis: games at real
// venues in all four board leagues, a cached forecast for every venue, the
// Odds API blobs and the pushed feed's summaries for those games, open
// wagers, and a logged-in user with a wallet. Everything is deterministic for
// a fixed NOW so before/after outputs can be compared exactly.

import { venues } from '../../src/lib/venue-data';
import type { DailyForecast, ForecastPoint, ForecastResponse, Venue } from '../../src/lib/types';
import type { CountingRedis } from './counting-redis';

export const NOW = Date.parse('2026-11-22T15:00:00Z');
const DAY = 86400_000;

export const BOARD_LEAGUES = ['mlb', 'nfl', 'ncaa-football', 'mls'] as const;
export type BoardLeague = (typeof BOARD_LEAGUES)[number];

const SPORT_KEY: Record<BoardLeague, string> = {
  nfl: 'americanfootball_nfl',
  'ncaa-football': 'americanfootball_ncaaf',
  mlb: 'baseball_mlb',
  mls: 'soccer_usa_mls',
};

/** Open-air venues, a fixed handful per league. */
export function venuesFor(league: BoardLeague, n: number): Venue[] {
  return venues.filter((v) => v.league === league && v.type !== 'indoor').slice(0, n);
}

/** Per league: games today (ET) at its first few open-air venues. */
export const GAMES_PER_LEAGUE: Record<BoardLeague, number> = { mlb: 3, nfl: 6, 'ncaa-football': 8, mls: 3 };

export function kickoffFor(i: number): string {
  // 17:00Z .. staggered, all on 2026-11-22 ET.
  return new Date(Date.parse('2026-11-22T17:00:00Z') + i * 45 * 60_000).toISOString();
}

export function rawGamesFor(league: BoardLeague): any[] {
  return venuesFor(league, GAMES_PER_LEAGUE[league]).map((venue, i) => ({
    id: `${league}-g${i}`,
    homeTeam: venue.team ?? `Home ${i}`,
    awayTeam: `Visitors ${league} ${i}`,
    kickoffUTC: kickoffFor(i),
    state: 'pre',
    statusDetail: '',
    homeScore: null,
    awayScore: null,
    venue,
    roofStatus: 'unknown',
    venueIsGameSite: true,
    neutralSite: false,
    gameSiteName: venue.name,
    homeTeamVenue: venue,
    awayVenue: null,
    inning: null,
    inningState: null,
    homePitcher: null,
    awayPitcher: null,
    livePeriodClock: null,
  }));
}

function daily(date: string, i: number): DailyForecast {
  return {
    date, highF: 50 + i, lowF: 38 + i, feelsLikeHighF: 48 + i, feelsLikeLowF: 35 + i, precipMm: i % 3,
    precipProbability: (i * 13) % 100, windSpeedMph: 6 + (i % 9), windGustMph: 12 + (i % 9), humidity: 60, uvIndexMax: 2,
    sunrise: `${date}T07:00`, sunset: `${date}T17:00`, description: 'Partly cloudy', icon: 'pc',
    dayDescription: `Partly cloudy, high ${50 + i}.`, nightDescription: 'Clear.',
  };
}

function point(time: string, tempF: number, i: number): ForecastPoint {
  return {
    time, tempK: 0, tempF, tempC: 0, humidity: 60, dewPointF: 35, precipMm: 0,
    precipProbability: (i * 7) % 60, windSpeedMph: 5 + (i % 10), windDirectionDeg: (i * 30) % 360, windGustMph: 10 + (i % 10), cloudCover: 40,
    pressure: 1015, feelsLikeF: tempF - 2, uvIndex: 1, visibility: 16000, description: 'Partly cloudy', icon: 'pc',
  };
}

/** A 16-day real-looking forecast for a venue, generated 20 minutes before NOW. */
export function forecastAt(lat: number, lon: number, utcOffsetSeconds = -18000): ForecastResponse {
  const start = Date.parse('2026-11-22T00:00:00Z');
  const days: DailyForecast[] = [];
  const hourly: ForecastPoint[] = [];
  for (let d = 0; d < 16; d++) {
    const date = new Date(start + d * DAY).toISOString().slice(0, 10);
    days.push(daily(date, d));
    if (d < 3) for (let h = 0; h < 24; h++) hourly.push(point(`${date}T${String(h).padStart(2, '0')}:00`, 40 + h / 2 + d, h + d));
  }
  return {
    location: { lat, lon, name: 'Fixture', displayName: 'Fixture', state: '', country: 'US' },
    current: hourly[15],
    hourly,
    daily: days,
    alerts: [],
    utcOffsetSeconds,
    generatedAt: new Date(NOW - 20 * 60_000).toISOString(),
    baseProvider: 'open-meteo',
    source: { provider: 'open-meteo', label: 'WagerOnWeather Consensus', isResearchSample: false, notes: '' },
  } as unknown as ForecastResponse;
}

export function forecastKey(lat: number, lon: number): string {
  return `forecast:open-meteo:${lat.toFixed(3)},${lon.toFixed(3)}:16`;
}

function oddsApiGame(g: any, i: number) {
  return {
    id: `oa-${g.id}`,
    commence_time: g.kickoffUTC,
    home_team: g.homeTeam,
    away_team: g.awayTeam,
    home_rotation: 300 + i * 2,
    away_rotation: 299 + i * 2,
    bookmakers: [{
      key: 'draftkings', title: 'DraftKings', last_update: new Date(NOW - 5 * 60_000).toISOString(),
      markets: [
        { key: 'h2h', outcomes: [{ name: g.homeTeam, price: -150 }, { name: g.awayTeam, price: 130 }] },
        { key: 'spreads', outcomes: [{ name: g.homeTeam, price: -110, point: -3.5 }, { name: g.awayTeam, price: -110, point: 3.5 }] },
        { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 44.5 + i }, { name: 'Under', price: -110, point: 44.5 + i }] },
      ],
    }],
  };
}

function feedSummary(league: string, g: any, i: number) {
  const lines = {
    bookmaker: 'Bovada', lastUpdate: new Date(NOW - 4 * 60_000).toISOString(),
    moneylineHome: -140 - i, moneylineAway: 120 + i,
    spreadHome: { point: -3, price: -110 }, spreadAway: { point: 3, price: -110 },
    total: { point: 43.5 + i, overPrice: -110, underPrice: -110 },
    homeRotation: null, awayRotation: null, live: false,
  };
  return {
    id: `feed-${g.id}`, league, startTime: Date.parse(g.kickoffUTC), description: `${g.awayTeam} @ ${g.homeTeam}`,
    home: g.homeTeam, away: g.awayTeam, homeShort: null, awayShort: null,
    lines, liveLines: null, marketCount: 3, groups: ['main'],
    fullAt: NOW - 4 * 60_000, seenAt: NOW - 60_000, liveAt: null, liveSeenAt: null,
  };
}

function feedGame(s: any) {
  return {
    id: s.id, description: s.description, startTime: s.startTime, live: false,
    competitors: [{ name: s.home, home: true }, { name: s.away, home: false }],
    groups: [{ description: 'Game Lines', markets: [
      { id: `${s.id}-ml`, key: '2W-12', description: 'Moneyline', outcomes: [
        { id: `${s.id}-ml-a`, type: 'A', description: s.away, price: { american: '+120' } },
        { id: `${s.id}-ml-h`, type: 'H', description: s.home, price: { american: '-140' } },
      ] },
    ] }],
    receivedAt: NOW - 4 * 60_000,
  };
}

/** Seed every key the board, sportsbook and page paths read. */
export function seedWorld(r: CountingRedis): void {
  for (const league of BOARD_LEAGUES) {
    const games = rawGamesFor(league);
    for (const g of games) r.kv.set(forecastKey(g.venue.lat, g.venue.lon), JSON.stringify(forecastAt(g.venue.lat, g.venue.lon)));
    r.kv.set(`odds:sport:${SPORT_KEY[league]}`, JSON.stringify(games.map(oddsApiGame)));
    const h = new Map<string, unknown>();
    games.forEach((g, i) => {
      const s = feedSummary(league, g, i);
      h.set(s.id, JSON.stringify(s));
      r.kv.set(`oddsfeed:game:${s.id}`, JSON.stringify(feedGame(s)));
    });
    r.hashes.set(`oddsfeed:summary:${league}`, h);
  }
  // The NFL maps to a second (preseason) Odds API key; in November its cached list is empty.
  r.kv.set('odds:sport:americanfootball_nfl_preseason', '[]');
  r.kv.set('oddsfeed:last-ingest', JSON.stringify({ at: NOW - 60_000, source: 'scraper', games: 20, stored: 20, rejected: 0 }));
}

// ── Wagers ────────────────────────────────────────────────────────────────

export function wagerFixture(i: number, over: Record<string, unknown> = {}): any {
  const target = new Date(NOW + (1 + (i % 6)) * DAY).toISOString().slice(0, 10);
  return {
    id: `wg-${String(i).padStart(4, '0')}`,
    ticketNumber: 1000 + i,
    title: `Fixture market ${i}`,
    description: 'High temperature over/under.',
    kind: 'over_under',
    status: 'open',
    metric: 'daily_high',
    targetDate: target,
    lockTime: new Date(NOW + (i % 6) * DAY + 6 * 3600_000).toISOString(),
    location: { label: 'Columbia, SC', lat: 33.97, lon: -80.94 },
    outcomes: [{ label: 'Over 60', odds: -110 }, { label: 'Under 60', odds: -110 }],
    createdAt: new Date(NOW - 3 * DAY).toISOString(),
    updatedAt: new Date(NOW - 3 * DAY).toISOString(),
    ...over,
  };
}

/** `open` wagers: n in the future and `expired` already past their lock time. */
export function seedWagers(r: CountingRedis, n: number, expired: number): void {
  const open = r.zsets.get('wagers:by-status:open') ?? new Map<string, number>();
  const all = r.zsets.get('wagers:all') ?? new Map<string, number>();
  for (let i = 0; i < n + expired; i++) {
    const w = i < expired
      ? wagerFixture(i, { lockTime: new Date(NOW - 3600_000).toISOString(), targetDate: '2026-11-22' })
      : wagerFixture(i);
    r.kv.set(`wager:${w.id}`, JSON.stringify(w));
    open.set(w.id, Date.parse(`${w.targetDate}T00:00:00Z`) + i);
    all.set(w.id, Date.parse(w.createdAt) + i);
    const byDate = r.sets.get(`wagers:by-date:${w.targetDate}`) ?? new Set<string>();
    byDate.add(w.id);
    r.sets.set(`wagers:by-date:${w.targetDate}`, byDate);
  }
  r.zsets.set('wagers:by-status:open', open);
  r.zsets.set('wagers:all', all);
}
