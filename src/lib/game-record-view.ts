// ── What the /games/... page shows for one record (WOW-031 2-4, WOW-032 B) ─
//
// Pure: record in, every string and table the page renders out, plus the two
// JSON-LD blocks. The Astro page only lays this out, so the tests can check
// the whole public surface: the labels, that the sportsbook is never named,
// and that every SportsEvent value is also on the page.
//
// GEO rules from WOW-031 3: an answer-first summary sentence, real tables with
// units, and a source and time on every number. Forecast and observed values
// are kept apart and labelled as such.

import {
  formatAmerican, formatEtTime, formatLongDate, formatPoint, etIsoWithOffset, gameRecordIndexable, gameRecordPath,
  orientLines, sportsbookLineLabel, whatStoodOut, GAME_LEAGUE_SEGMENT,
  type GameRecord, type LineSnapshotRecord, type WowMarketRecord,
} from './game-record';
import { getBreadcrumbSchema } from './schema-markup';
import { getWesBand } from './wes-scale';

const SITE = 'https://wageronweather.com';

export const FROZEN_GAME_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=86400';
export const OPEN_GAME_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=300';

export interface Row { cells: string[] }
export interface Table { caption: string; head: string[]; rows: string[][]; source: string }

export interface GamePageView {
  path: string;
  url: string;
  title: string;
  metaDescription: string;
  h1: string;
  neutralSite: boolean;
  summary: string;
  facts: { label: string; value: string }[];
  breadcrumbs: { label: string; href?: string }[];
  score: Table | null;
  lines: Table | null;
  noLinesNote: string | null;
  grades: Table | null;
  gradesNote: string | null;
  weather: Table | null;
  markets: Table | null;
  /** "n more markets not shown" when the record kept only the first 12. */
  marketsNote: string | null;
  stoodOut: string[];
  indexable: boolean;
  cacheControl: string;
  jsonLd: object[];
}

const LEAGUE_LABEL: Record<GameRecord['league'], string> = { nfl: 'NFL', 'ncaa-football': 'College Football', mlb: 'MLB', mls: 'MLS' };
const SPORT: Record<GameRecord['league'], string> = { nfl: 'American football', 'ncaa-football': 'American football', mlb: 'Baseball', mls: 'Soccer' };
const START_NOUN: Record<GameRecord['league'], string> = { nfl: 'Kickoff', 'ncaa-football': 'Kickoff', mlb: 'First pitch', mls: 'Kickoff' };
const UNIT: Record<GameRecord['league'], string> = { nfl: 'points', 'ncaa-football': 'points', mlb: 'runs', mls: 'goals' };

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

function captureText(iso: string | null): string {
  if (!iso) return 'capture time not recorded';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'capture time not recorded';
  const d = new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  return `captured ${d}, ${formatEtTime(ms)} ET`;
}

function kickoffText(rec: GameRecord): string {
  const day = formatLongDate(rec.date);
  if (rec.kickoffTimeTBD) return `${day}, time TBD`;
  const ms = Date.parse(rec.kickoff);
  return Number.isFinite(ms) ? `${day}, ${formatEtTime(ms)} ET` : day;
}

function siteText(rec: GameRecord): string {
  const name = rec.venue?.name ?? rec.siteName;
  return name || 'an unrecorded venue';
}

function addressText(rec: GameRecord): string | null {
  const v = rec.venue;
  if (!v) return null;
  return `${v.city}, ${v.state}${v.zip ? ` ${v.zip}` : ''}`;
}

function statusText(rec: GameRecord): string {
  switch (rec.result.status) {
    case 'final': return 'Final (played as scheduled)';
    case 'postponed': return 'Postponed';
    case 'cancelled': return 'Cancelled';
    case 'in_progress': return 'In progress';
    default: return 'Scheduled';
  }
}

function eventStatus(rec: GameRecord): string {
  if (rec.result.status === 'postponed') return 'https://schema.org/EventPostponed';
  if (rec.result.status === 'cancelled') return 'https://schema.org/EventCancelled';
  return 'https://schema.org/EventScheduled';
}

/** The answer-first sentence(s): result, place and date, then the weather as stored. */
export function gameSummary(rec: GameRecord): string {
  const site = `${siteText(rec)}${rec.neutralSite ? ' (neutral site)' : ''}`;
  const day = formatLongDate(rec.date);
  const { homeScore: h, awayScore: a, status } = rec.result;
  let first: string;
  if (status === 'postponed' || status === 'cancelled') {
    first = `${rec.away.name} at ${rec.home.name}, scheduled for ${day} at ${site}, was ${status}.`;
  } else if (status === 'final' && h !== null && a !== null) {
    if (h === a) first = `${rec.away.name} and ${rec.home.name} tied ${a}-${h} at ${site} on ${day}.`;
    else {
      const [w, l, ws, ls] = h > a ? [rec.home.name, rec.away.name, h, a] : [rec.away.name, rec.home.name, a, h];
      first = `${w} beat ${l} ${ws}-${ls} at ${site} on ${day}.`;
    }
  } else {
    first = `${rec.away.name} at ${rec.home.name}, ${day} at ${site}: final score not yet recorded.`;
  }
  const parts: string[] = [first];
  if (status !== 'final') return first;
  if (rec.venue?.type === 'indoor') parts.push('Played indoors.');
  else if (rec.roof.closed) parts.push('Played with the roof closed.');
  if (rec.weather.wow) parts.push(`The WOW Score at ${START_NOUN[rec.league].toLowerCase()} was ${rec.weather.wow.score}.`);
  const o = rec.weather.observed;
  const f = rec.weather.forecast;
  if (o) parts.push(`Observed near ${START_NOUN[rec.league].toLowerCase()}: ${Math.round(o.tempF)}°F${o.windSpeedMph !== null ? `, wind ${Math.round(o.windSpeedMph)} mph` : ''} (NWS station ${o.stationId}).`);
  else if (f) parts.push(`Our ${START_NOUN[rec.league].toLowerCase()} forecast: ${Math.round(f.tempF)}°F, wind ${Math.round(f.windSpeedMph)} mph.`);
  return parts.join(' ');
}

function mlCell(n: number | null): string {
  return n === null ? '—' : formatAmerican(n);
}
function spreadCell(s: { point: number; price: number } | null): string {
  return s ? `${formatPoint(s.point)} (${formatAmerican(s.price)})` : '—';
}

function linesTable(rec: GameRecord): Table | null {
  const rows: string[][] = [];
  const add = (snap: LineSnapshotRecord | null, kind: 'open' | 'close') => {
    if (!snap) return;
    const l = orientLines(snap.lines, snap.bookSidesReversed);
    const label = sportsbookLineLabel(snap, kind, rec.date);
    const when = kind === 'open' && snap.capturedAt && rec.date >= '2026-10-13' ? ` (${captureText(snap.capturedAt)})` : '';
    rows.push([
      label + when,
      mlCell(l.moneylineAway),
      mlCell(l.moneylineHome),
      spreadCell(l.spreadAway),
      spreadCell(l.spreadHome),
      l.total ? `${l.total.point} (Over ${formatAmerican(l.total.overPrice)} / Under ${formatAmerican(l.total.underPrice)})` : '—',
    ]);
  };
  add(rec.sportsbook.open, 'open');
  add(rec.sportsbook.close, 'close');
  if (!rows.length) return null;
  return {
    caption: 'Sportsbook main lines',
    head: ['Line (source and capture time)', `${rec.away.name} moneyline (American odds)`, `${rec.home.name} moneyline (American odds)`, `${rec.away.name} spread (${UNIT[rec.league]}, price)`, `${rec.home.name} spread (${UNIT[rec.league]}, price)`, `Total (${UNIT[rec.league]}, prices)`],
    rows,
    source: 'One sportsbook. Prices are American odds. Each row names when the line was captured.',
  };
}

function gradesTable(rec: GameRecord): { table: Table | null; note: string | null } {
  const st = rec.result.status;
  if (st === 'postponed' || st === 'cancelled') return { table: null, note: `Not graded: the game was ${st}.` };
  if (st !== 'final') return { table: null, note: 'Result pending.' };
  const g = rec.sportsbook.grades;
  const close = rec.sportsbook.close;
  if (!g || !close) return { table: null, note: 'No stored sportsbook line to grade this game against.' };
  const u = UNIT[rec.league];
  const rows: string[][] = [];
  if (g.moneyline) {
    const who = g.moneyline.winner === 'home' ? `${rec.home.name} won` : g.moneyline.winner === 'away' ? `${rec.away.name} won` : 'Tie';
    rows.push(['Moneyline', who, g.moneyline.winnerPrice !== null ? `Winner's price ${formatAmerican(g.moneyline.winnerPrice)}` : 'Winner had no stored price']);
  }
  if (g.spread) {
    const res = g.spread.result === 'push' ? 'Push' : g.spread.result === 'home_cover' ? `${rec.home.name} covered` : `${rec.away.name} covered`;
    rows.push(['Against the spread', res, `${rec.home.name} ${formatPoint(g.spread.homePoint)}; margin against the spread ${g.spread.margin > 0 ? '+' : ''}${g.spread.margin} ${u} for ${rec.home.name}`]);
  }
  if (g.total) {
    const res = g.total.result === 'push' ? 'Push' : g.total.result === 'over' ? 'Over' : 'Under';
    rows.push(['Total', res, `Combined ${g.total.combined} ${u} against ${g.total.line}`]);
  }
  return {
    table: {
      caption: 'How the sportsbook lines graded',
      head: ['Bet type', 'Result', 'Detail'],
      rows,
      source: `Graded from the stored close (${sportsbookLineLabel(close, 'close', rec.date)}) against the final score from ESPN.`,
    },
    note: null,
  };
}

function weatherTable(rec: GameRecord): Table | null {
  const rows: string[][] = [];
  const noun = START_NOUN[rec.league].toLowerCase();
  if (rec.weather.wow) {
    const band = getWesBand(rec.weather.wow.score);
    rows.push(['WOW Score (0-100)', `${rec.weather.wow.score} (${band.label})`, `Wager on Weather, frozen at ${noun}`]);
  }
  const f = rec.weather.forecast;
  if (f) {
    rows.push(['Forecast temperature', `${Math.round(f.tempF)} °F`, `Wager on Weather forecast, saved before ${noun}`]);
    rows.push(['Forecast wind', `${Math.round(f.windSpeedMph)} mph`, `Wager on Weather forecast, saved before ${noun}`]);
    rows.push(['Forecast chance of precipitation', `${Math.round(f.precipProbability)}%`, `Wager on Weather forecast, saved before ${noun}`]);
  }
  const o = rec.weather.observed;
  if (o) {
    const src = `Observed, NWS station ${o.stationId}, nearest ${noun}`;
    rows.push(['Observed temperature', `${Math.round(o.tempF)} °F`, src]);
    if (o.windSpeedMph !== null) rows.push(['Observed wind', `${Math.round(o.windSpeedMph)} mph`, src]);
    if (o.precipMmLastHour !== null) rows.push(['Observed precipitation, prior hour', `${o.precipMmLastHour} mm`, src]);
    if (o.description) rows.push(['Observed conditions', o.description, src]);
  }
  if (rec.venue?.type === 'indoor') rows.push(['Roof', 'Indoor stadium', 'Wager on Weather venue data']);
  else if (rec.roof.closed) rows.push(['Roof', 'Closed for this game', 'Wager on Weather roof data']);
  if (!rows.length) return null;
  return { caption: 'Weather', head: ['Measure', 'Value', 'Source and time'], rows, source: 'Forecast values were saved before the game; observed values come from the nearest NWS station.' };
}

function lockText(m: WowMarketRecord): string {
  const l = m.lock;
  if (!l) return 'Not recorded';
  if (l.line !== undefined) return `Line ${l.line} ${m.unit}: Over ${formatAmerican(l.overOdds!)} / Under ${formatAmerican(l.underOdds!)}`;
  if (l.spread !== undefined) return `Spread ${formatPoint(l.spread)} ${m.unit}: ${m.aName ?? 'A'} ${formatAmerican(l.aOdds!)} / ${m.bName ?? 'B'} ${formatAmerican(l.bOdds!)}`;
  if (l.bands) return l.bands.map((b) => `${b.label} ${formatAmerican(b.odds)}`).join(', ');
  return 'Not recorded';
}

function resultText(m: WowMarketRecord): string {
  if (m.status === 'pending') return 'Result pending';
  if (m.status === 'void') return 'Void';
  switch (m.winner) {
    case 'over': return 'Over';
    case 'under': return 'Under';
    case 'push': return 'Push';
    case 'locationA': return m.aName ?? 'Side A';
    case 'locationB': return m.bName ?? 'Side B';
    case 'no_match': return 'No outcome matched';
    default: return m.winner ?? 'Graded';
  }
}

function observedText(m: WowMarketRecord): string {
  if (m.status !== 'graded' || m.observed === null) return m.status === 'pending' ? 'Result pending' : '—';
  const st = m.station ? ` (NWS ${m.station})` : '';
  if (m.kind === 'pointspread' && m.observedB != null) {
    return `${m.aName ?? 'A'} ${m.observed} ${m.unit}${st}; ${m.bName ?? 'B'} ${m.observedB} ${m.unit}${m.stationB ? ` (NWS ${m.stationB})` : ''}`;
  }
  return `${m.observed} ${m.unit}${st}`;
}

function marketsTable(rec: GameRecord): Table | null {
  if (!rec.markets.length) return null;
  return {
    caption: 'Wager on Weather markets on this game',
    head: ['Market', 'Price at lock (American odds)', 'Observed value', 'Result'],
    rows: rec.markets.map((m) => [m.title, lockText(m), observedText(m), resultText(m)]),
    source: 'Wager on Weather markets. Prices are as of each market\'s lock; observed values are from the NWS station each market is graded by.',
  };
}

/** Everything the page renders for one record. Pure. */
export function buildGamePageView(rec: GameRecord): GamePageView {
  const path = gameRecordPath(rec.league, rec.date, rec.slug);
  const url = `${SITE}${path}`;
  const name = `${rec.away.name} at ${rec.home.name}`;
  const summary = gameSummary(rec);
  const kickoff = kickoffText(rec);
  const address = addressText(rec);
  const v = rec.venue;
  const facts: { label: string; value: string }[] = [
    { label: START_NOUN[rec.league], value: kickoff },
    { label: 'Venue', value: `${siteText(rec)}${address ? `, ${address}` : ''}${rec.neutralSite ? ' (neutral site)' : ''}` },
  ];
  if (v) facts.push({ label: 'Coordinates', value: `${v.lat}, ${v.lon}` });
  facts.push({ label: 'Status', value: statusText(rec) });
  facts.push({ label: 'League and sport', value: `${LEAGUE_LABEL[rec.league]}, ${SPORT[rec.league]}` });
  facts.push({ label: 'Attendance', value: 'In-person event at the stadium' });

  const { homeScore: h, awayScore: a } = rec.result;
  const score: Table | null = rec.result.status === 'final' && h !== null && a !== null
    ? { caption: 'Final score', head: ['Team', `Final (${UNIT[rec.league]})`], rows: [[rec.away.name, String(a)], [rec.home.name, String(h)]], source: `ESPN, ${rec.result.detail || 'Final'}` }
    : null;

  const lines = linesTable(rec);
  const g = gradesTable(rec);

  const location: Record<string, unknown> = { '@type': 'StadiumOrArena', name: siteText(rec) };
  if (v) {
    location.address = { '@type': 'PostalAddress', addressLocality: v.city, addressRegion: v.state, ...(v.zip ? { postalCode: v.zip } : {}) };
    location.geo = { '@type': 'GeoCoordinates', latitude: v.lat, longitude: v.lon };
  }
  const kickoffMs = Date.parse(rec.kickoff);
  const sportsEvent = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name,
    startDate: rec.kickoffTimeTBD || !Number.isFinite(kickoffMs) ? rec.date : etIsoWithOffset(kickoffMs),
    eventStatus: eventStatus(rec),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location,
    homeTeam: { '@type': 'SportsTeam', name: rec.home.name },
    awayTeam: { '@type': 'SportsTeam', name: rec.away.name },
    sport: SPORT[rec.league],
    url,
    description: summary,
  };
  const longDate = formatLongDate(rec.date);
  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'The Weatherboard', href: '/weatherboard' },
    { label: longDate, href: `/weatherboard/${rec.date}` },
    { label: name },
  ];
  const indexable = gameRecordIndexable(rec);
  return {
    path,
    url,
    title: `${name}, ${shortDate(rec.date)}: Score, Lines and Weather`,
    metaDescription: summary.length > 300 ? `${summary.slice(0, 297)}...` : summary,
    h1: name,
    neutralSite: rec.neutralSite,
    summary,
    facts,
    breadcrumbs,
    score,
    lines,
    noLinesNote: lines ? null : 'No sportsbook line was stored for this game.',
    grades: g.table,
    gradesNote: g.note,
    weather: weatherTable(rec),
    markets: marketsTable(rec),
    marketsNote: (rec.marketsOmitted ?? 0) > 0 ? `${rec.marketsOmitted} more ${rec.marketsOmitted === 1 ? 'market' : 'markets'} not shown.` : null,
    stoodOut: whatStoodOut(rec),
    indexable,
    cacheControl: rec.frozenAt ? FROZEN_GAME_CACHE_CONTROL : OPEN_GAME_CACHE_CONTROL,
    jsonLd: [
      getBreadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: 'The Weatherboard', url: '/weatherboard' },
        { name: longDate, url: `/weatherboard/${rec.date}` },
        { name, url: path },
      ]),
      sportsEvent,
    ],
  };
}

/** Every string a reader can see, in page order (for tests of the public surface). */
export function visibleText(v: GamePageView): string {
  const t = (x: Table | null) => (x ? [x.caption, ...x.head, ...x.rows.flat(), x.source] : []);
  return [
    v.title, v.metaDescription, v.h1, v.neutralSite ? '(neutral site)' : '', v.summary,
    ...v.facts.flatMap((f) => [f.label, f.value]),
    ...v.breadcrumbs.map((b) => b.label),
    ...t(v.score), ...t(v.lines), v.noLinesNote ?? '', ...t(v.grades), v.gradesNote ?? '', ...t(v.weather), ...t(v.markets), v.marketsNote ?? '',
    ...(v.stoodOut.length ? ['What stood out', ...v.stoodOut] : []),
  ].join('\n');
}

export { GAME_LEAGUE_SEGMENT };
