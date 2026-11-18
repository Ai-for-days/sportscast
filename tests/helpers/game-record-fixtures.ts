// Fixture games, stored lines and wagers for the game-record tests, shaped
// like the real board rows and Redis values they stand in for.
import { getVenueById } from '../../src/lib/venue-data';
import type { RecordGameInput, StoredFeedLine, BuildGameRecordInput } from '../../src/lib/game-record';
import type { GameLines } from '../../src/lib/sportsbook-odds';
import type { Wager } from '../../src/lib/wager-types';

export const KICK = Date.parse('2026-11-16T18:00:00Z'); // Monday 1:00 PM ET
export const MIN = 60_000;

export function venue(id: string) {
  const v = getVenueById(id);
  if (!v) throw new Error(`no venue ${id}`);
  return v;
}

export function lines(over: Partial<GameLines> = {}): GameLines {
  return {
    bookmaker: 'feed',
    lastUpdate: new Date(KICK - 20 * MIN).toISOString(),
    moneylineHome: -175,
    moneylineAway: 150,
    spreadHome: { point: -3.5, price: -110 },
    spreadAway: { point: 3.5, price: -110 },
    total: { point: 47.5, overPrice: -110, underPrice: -110 },
    homeRotation: null,
    awayRotation: null,
    live: false,
    feedGameId: 'f1',
    ...over,
  };
}

export function game(over: Partial<RecordGameInput> = {}): RecordGameInput {
  const home = venue('nfl-kc');
  return {
    id: '401772900',
    homeTeam: 'Kansas City Chiefs',
    awayTeam: 'Buffalo Bills',
    kickoffUTC: new Date(KICK).toISOString(),
    state: 'post',
    statusDetail: 'Final',
    homeScore: 27,
    awayScore: 20,
    venue: home,
    homeTeamVenue: home,
    awayVenue: venue('nfl-buf'),
    neutralSite: false,
    venueIsGameSite: true,
    gameSiteName: home.name,
    roofStatus: 'unknown',
    roofClosed: false,
    wes: { wesFinal: 71.6, wesVersion: '1.2' },
    wesIsFrozen: true,
    kickoffTimeTBD: false,
    ...over,
  };
}

export function feedLine(over: Partial<StoredFeedLine> = {}, l: Partial<GameLines> = {}): StoredFeedLine {
  const capturedAt = over.capturedAt ?? KICK - 18 * MIN;
  return {
    v: 1,
    feedId: 'f1',
    league: 'nfl',
    lines: lines(l),
    capturedAt,
    startTime: KICK,
    minutesBeforeStart: Math.floor((KICK - capturedAt) / MIN),
    home: 'Kansas City Chiefs',
    away: 'Buffalo Bills',
    homeShort: null,
    awayShort: null,
    ...over,
  };
}

const loc = (name: string, stationId: string) => ({ name, lat: 39.0489, lon: -94.4839, stationId, stationName: 'Kansas City Downtown Airport', timeZone: 'America/Chicago' });

export function ouWager(id: string, over: Partial<Wager> = {}): Wager {
  return {
    id,
    ticketNumber: 'WKT12345',
    title: 'GEHA Field at Arrowhead Stadium Temp at Kickoff Over/Under',
    status: 'graded',
    metric: 'actual_temp',
    targetDate: '2026-11-16',
    targetTime: '12:00',
    lockTime: new Date(KICK - 60 * MIN).toISOString(),
    createdAt: new Date(KICK - 3 * 86400_000).toISOString(),
    updatedAt: new Date(KICK + 86400_000).toISOString(),
    observedValue: 44,
    winningOutcome: 'under',
    kind: 'over-under',
    location: loc('GEHA Field at Arrowhead Stadium', 'KMKC'),
    line: 47.5,
    over: { odds: -115 },
    under: { odds: -105 },
    closingLineSnapshot: { capturedAt: new Date(KICK - 60 * MIN).toISOString(), marketType: 'over-under', overUnder: { line: 47.5, overOdds: -115, underOdds: -105 } },
    ...over,
  } as Wager;
}

export function psWager(id: string, over: Partial<Wager> = {}): Wager {
  return {
    id,
    ticketNumber: 'WKT54321',
    title: 'Kansas City High vs Orchard Park High',
    status: 'graded',
    metric: 'high_temp',
    targetDate: '2026-11-16',
    lockTime: new Date(KICK - 60 * MIN).toISOString(),
    createdAt: new Date(KICK - 3 * 86400_000).toISOString(),
    updatedAt: new Date(KICK + 86400_000).toISOString(),
    observedValue: 52,
    observedValueA: 52,
    observedValueB: 39,
    winningOutcome: 'locationA',
    kind: 'pointspread',
    locationA: loc('GEHA Field at Arrowhead Stadium', 'KMKC'),
    locationB: { ...loc('Highmark Stadium', 'KBUF'), lat: 42.7738, lon: -78.787, timeZone: 'America/New_York' },
    spread: -6.5,
    locationAOdds: -110,
    locationBOdds: -110,
    closingLineSnapshot: { capturedAt: new Date(KICK - 60 * MIN).toISOString(), marketType: 'pointspread', pointspread: { spread: -6.5, locationAOdds: -110, locationBOdds: -110 } },
    ...over,
  } as Wager;
}

export function input(over: Partial<BuildGameRecordInput> = {}): BuildGameRecordInput {
  return {
    league: 'nfl',
    game: game(),
    slug: 'buffalo-at-kansas-city',
    feedId: 'f1',
    feedClose: feedLine(),
    feedOpen: feedLine({ capturedAt: KICK - 6 * 86400_000 }, { spreadHome: { point: -2.5, price: -110 }, spreadAway: { point: 2.5, price: -110 }, total: { point: 49.5, overPrice: -110, underPrice: -110 } }),
    boardClose: null,
    forecast: { tempF: 46, windSpeedMph: 12, precipProbability: 10, description: 'Partly cloudy' },
    observed: { tempF: 44, windSpeedMph: 14, precipMmLastHour: 0, textDescription: 'Mostly Cloudy', stationId: 'KMKC' },
    wagers: [ouWager('w1'), psWager('w2')],
    previous: null,
    now: KICK + 20 * 3600_000,
    ...over,
  };
}
