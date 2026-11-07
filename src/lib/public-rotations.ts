// Backup source for rotation numbers: a public schedule file (2026-11-06).
//
// The board's `#` column and the sidebar get rotation numbers from The Odds
// API. Its key has answered 401 on every request since 2026-10-25, which
// blanked every rotation number on the site. Derek: "we need for all of them
// to have rotation numbers" and "rotation numbers are public". Bovada's own
// feeds carry none (checked 2026-11-06), so this reads the public schedule
// file behind OddsLogic's free odds board (the one WagerTalk embeds):
// rotation numbers, team names and kickoff times. We take ONLY those
// identifiers, never prices, fetch it at most every few hours, and cache it.
// The Odds API still wins whenever it has a number; this only fills gaps.
//
// Registered in data-source-health.ts as 'rotation-feed'. Pure parsing and
// matching are exported for tests; network and Redis are in getPublicRotationPairs.

import { getRedis } from './redis';
import { recordSourceSuccess, recordSourceFailure } from './data-source-health';
import type { RotationPair } from './rotation-numbers';

const SCHEDULE_URL = 'https://freeodds.oddslogic.com/ol-lite-stage/next/data.php?data=all.txt';
const CACHE_KEY = 'pubrot:index:v1';
const CACHE_TTL_SECONDS = 3 * 3600;
const FAILURE_TTL_SECONDS = 10 * 60;
/** How far a listed kickoff may sit from ours and still be the same game. */
const KICKOFF_TOLERANCE_MS = 3 * 3600 * 1000;

export type RotationLeague = 'nfl' | 'ncaa-football' | 'mlb' | 'mls';

export interface PublicRotationRow {
  league: RotationLeague;
  /** Away team's rotation number; home is away + 1 (the published convention). */
  rotation: number;
  away: string;
  home: string;
  startMs: number;
}

// ── Parsing ────────────────────────────────────────────────────────────────

type Node = string | Node[];

/** Parse the file's brace format: {a,b,{c,d},"quoted, text"} into nested arrays. */
export function parseBraces(text: string): Node[] {
  let i = 0;
  const parseList = (): Node[] => {
    const out: Node[] = [];
    i++; // skip '{'
    let cur = '';
    let pendingList: Node[] | null = null;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        const end = text.indexOf('"', i + 1);
        cur += text.slice(i + 1, end === -1 ? text.length : end);
        i = end === -1 ? text.length : end + 1;
      } else if (c === '{') {
        // Sibling lists sit back to back with no comma ("}{"), so a list
        // already waiting is its own item.
        if (pendingList) out.push(pendingList);
        pendingList = parseList();
      } else if (c === ',' || c === '}') {
        out.push(pendingList ?? cur);
        pendingList = null;
        cur = '';
        i++;
        if (c === '}') return out;
      } else {
        cur += c;
        i++;
      }
    }
    return out;
  };
  const top: Node[] = [];
  while (i < text.length) {
    if (text[i] === '{') top.push(parseList());
    else i++;
  }
  return top;
}

/** Which of our leagues a section header belongs to, or null for everything else. */
export function leagueFromHeader(header: string): RotationLeague | null {
  const h = header.toUpperCase().trim();
  if (/^NFL\b/.test(h)) return 'nfl';
  if (/^COLLEGE FOOTBALL\b/.test(h)) return 'ncaa-football';
  if (/^(MLB|MAJOR LEAGUE BASEBALL)\b/.test(h)) return 'mlb';
  // Soccer rotations here are 6-digit (away, home, draw, total in steps of 4).
  if (/^(MLS|NWSL|MAJOR LEAGUE SOCCER|NATIONAL WOMEN'?S SOCCER)\b/.test(h)) return 'mls';
  return null;
}

/** Rows for our four leagues from the raw schedule file. Pure. */
export function parsePublicSchedule(text: string): PublicRotationRow[] {
  const rows: PublicRotationRow[] = [];
  const top = parseBraces(text);
  // Layout: {meta}{ {header..}{game..}{game..}{header..}... }
  for (const block of top) {
    if (!Array.isArray(block)) continue;
    let league: RotationLeague | null = null;
    for (const item of block) {
      if (!Array.isArray(item)) continue;
      const first = String(item[0] ?? '');
      if (first.startsWith('header')) {
        league = leagueFromHeader(String(item[5] ?? ''));
        continue;
      }
      if (!league || !/^\d+$/.test(first)) continue;
      const teams = item[16];
      if (!Array.isArray(teams)) continue;
      const startMs = Date.parse(String(item[9] ?? '').replace(' ', 'T') + 'Z');
      const away = String(teams[0] ?? '').trim();
      const home = String(teams[5] ?? '').trim();
      if (!Number.isFinite(startMs) || !away || !home) continue;
      rows.push({ league, rotation: Number(first), away, home, startMs });
    }
  }
  return rows;
}

// ── Matching ───────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

/** The file's own abbreviations, spelled the way our team names are. */
export function expandListedName(listed: string): string {
  return listed
    .replace(/&nbsp;/g, ' ')
    .replace(/^N\.\s?Y\.\s/i, 'New York ')
    .replace(/^L\.\s?A\.\s/i, 'Los Angeles ')
    .replace(/\bSt\.$/i, 'State')
    .replace(/^Miami Florida$/i, 'Miami')
    .replace(/^Miami Ohio$/i, 'Miami (OH)')
    .replace(/^Southern Miss$/i, 'Southern Mississippi')
    .trim();
}

/** Does our full team name ("Atlanta Falcons") start with the listed one ("Atlanta")? */
function nameMatches(ours: string, listed: string): boolean {
  const o = norm(ours);
  const expanded = expandListedName(listed);
  // "Middle Tennessee St." is "Middle Tennessee" at ESPN but "Michigan St." is
  // "Michigan State": try the expanded form, then the form without "State".
  const forms = [expanded, /St\.$/i.test(listed.trim()) ? expanded.replace(/\s*State$/, '') : ''];
  return forms.some((f) => {
    const l = norm(f);
    return l.length > 0 && (o === l || o.startsWith(l));
  });
}

/**
 * The rotation pair for one of our games, or null when no listed game
 * matches unambiguously. Both teams must match (either orientation, for
 * neutral-site games listed the other way round) and the kickoff must be
 * close. A wrong number is worse than a blank one, so ties return null.
 */
export function matchPublicRotation(
  rows: readonly PublicRotationRow[],
  league: string,
  homeTeam: string,
  awayTeam: string,
  kickoffUTC: string,
): RotationPair | null {
  const ms = Date.parse(kickoffUTC);
  if (!Number.isFinite(ms)) return null;
  const hits: { pair: RotationPair; gap: number; strength: number }[] = [];
  for (const r of rows) {
    if (r.league !== league) continue;
    const gap = Math.abs(r.startMs - ms);
    if (gap > KICKOFF_TOLERANCE_MS) continue;
    if (nameMatches(awayTeam, r.away) && nameMatches(homeTeam, r.home)) {
      hits.push({ pair: { away: r.rotation, home: r.rotation + 1 }, gap, strength: norm(r.away).length + norm(r.home).length });
    } else if (nameMatches(awayTeam, r.home) && nameMatches(homeTeam, r.away)) {
      hits.push({ pair: { away: r.rotation + 1, home: r.rotation }, gap, strength: norm(r.away).length + norm(r.home).length });
    }
  }
  if (hits.length === 0) return null;
  // Longest names first ("Miami (OH)" beats "Miami"), then closest kickoff.
  hits.sort((a, b) => b.strength - a.strength || a.gap - b.gap);
  if (hits.length > 1 && hits[0].strength === hits[1].strength && hits[0].gap === hits[1].gap
      && (hits[0].pair.away !== hits[1].pair.away)) return null;
  return hits[0].pair;
}

// ── Fetch + cache ──────────────────────────────────────────────────────────

let memo: { at: number; rows: PublicRotationRow[] } | null = null;
let inFlight: Promise<PublicRotationRow[]> | null = null;

async function loadRows(): Promise<PublicRotationRow[]> {
  if (memo && Date.now() - memo.at < 5 * 60 * 1000) return memo.rows;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      try {
        const raw = await getRedis().get(CACHE_KEY);
        if (raw) {
          const rows = (typeof raw === 'string' ? JSON.parse(raw) : raw) as PublicRotationRow[];
          memo = { at: Date.now(), rows };
          return rows;
        }
      } catch {
        /* cache miss or redis down: fetch */
      }
      let rows: PublicRotationRow[] = [];
      let ok = false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(SCHEDULE_URL, { signal: controller.signal, headers: { 'User-Agent': 'WagerOnWeather/1.0' } });
        clearTimeout(timer);
        if (res.ok) {
          const text = await res.text();
          rows = parsePublicSchedule(text);
          ok = rows.length > 0;
          if (ok) await recordSourceSuccess('rotation-feed');
          else await recordSourceFailure('rotation-feed', 'schedule file parsed to zero games (format change?)');
        } else {
          await recordSourceFailure('rotation-feed', `schedule ${res.status} ${res.statusText}`);
        }
      } catch {
        await recordSourceFailure('rotation-feed', 'schedule request failed or timed out');
      }
      try {
        await getRedis().set(CACHE_KEY, JSON.stringify(rows), { ex: ok ? CACHE_TTL_SECONDS : FAILURE_TTL_SECONDS });
      } catch {
        /* ignore */
      }
      memo = { at: Date.now(), rows };
      return rows;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Rotation pairs for a list of our games (same order), null where unmatched. Never throws. */
export async function getPublicRotationPairs(
  league: string,
  games: readonly { homeTeam: string; awayTeam: string; kickoffUTC: string }[],
): Promise<(RotationPair | null)[]> {
  if (games.length === 0) return [];
  try {
    const rows = await loadRows();
    return games.map((g) => matchPublicRotation(rows, league, g.homeTeam, g.awayTeam, g.kickoffUTC));
  } catch {
    return games.map(() => null);
  }
}
