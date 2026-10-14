// Pushed sportsbook odds: payload shape, validation, and the derived views (2026-10-13).
//
// Derek's scraper on his own machine (Documents\Scrapers\bovada) reads
// Bovada and POSTs every game, with every market Bovada offers, to
// /api/odds/ingest. This file is the pure half: what a valid payload looks
// like, the main game lines the Weatherboard shows, and which markets moved
// since the last push (the line-movement history). No Redis here, so it is
// all unit-testable; storage is bovada-store.ts.
//
// The structure is Bovada's own, kept generic on purpose: groups (Bovada's
// displayGroups, e.g. "Game Lines", "Alternate Lines", "TD Scorer Props") hold
// markets, markets hold outcomes. Nothing here lists market names, so a market
// family Bovada adds next week shows up on the game page without a code change.
//
// Customer-facing copy never names the source (Derek, 2026-10-13: "we don't
// need to say that our numbers are from Bovada").

import type { GameLines } from './sportsbook-odds';

export interface FeedPrice {
  handicap?: string | null;
  american?: string | null;
  decimal?: string | null;
}

export interface FeedOutcome {
  id: string;
  description: string;
  /** A away, H home, O over, U under, D draw, X prop, plus others Bovada uses. */
  type?: string | null;
  /** O open, S suspended. */
  status?: string | null;
  competitorId?: string | null;
  price: FeedPrice;
}

export interface FeedPeriod {
  id?: string | null;
  description?: string | null;
  abbreviation?: string | null;
  live?: boolean | null;
  main?: boolean | null;
}

export interface FeedMarket {
  id: string;
  key?: string | null;
  description: string;
  descriptionKey?: string | null;
  marketTypeId?: string | null;
  status?: string | null;
  period: FeedPeriod;
  outcomes: FeedOutcome[];
}

export interface FeedGroup {
  id?: string | null;
  description: string;
  order?: number | null;
  markets: FeedMarket[];
}

export interface FeedCompetitor {
  id?: string | null;
  name: string;
  shortName?: string | null;
  home: boolean;
}

export interface FeedGame {
  id: string;
  /** The site's league key: nfl, ncaa-football, mlb, mls (MLS and NWSL). */
  league: string;
  leagueName?: string | null;
  sportPath?: string | null;
  description: string;
  link?: string | null;
  /** Kickoff, epoch ms UTC. */
  startTime: number;
  /** Bovada's flag: live BETTING is offered. Not "the game has started". */
  live: boolean;
  status?: string | null;
  numMarkets?: number | null;
  competitors: FeedCompetitor[];
  /** full = every market for the game; main = only the list's main lines (live updates). */
  scope: 'full' | 'main';
  groups: FeedGroup[];
}

export interface FeedSeen {
  id: string;
  league: string;
}

export interface FeedPayload {
  v: 1;
  source: 'scraper' | 'live';
  sentAt: number;
  games: FeedGame[];
  /** Games pushed earlier whose lines have not moved: still on offer, so still fresh. */
  seen: FeedSeen[];
}

export const FEED_LEAGUES = ['nfl', 'ncaa-football', 'mlb', 'mls'] as const;

const LIMITS = {
  games: 400,
  seen: 2000,
  groups: 100,
  markets: 2000,
  outcomes: 300,
  text: 300,
};

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
// Market and outcome ids are NOT that tidy: Bovada uses ids like
// "G-2W-HCAP.Handicap - Asian.119" (spaces, dashes, dots). The strict game-id
// rule above silently dropped 87 of 175 markets on the first live push
// (2026-10-14). These only ever become Redis hash fields and query values, so
// anything printable is fine.
export const MARKET_ID = /^[^\u0000-\u001f\u007f]{1,128}$/;

// ── Validation ──────────────────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function str(v: unknown, max = LIMITS.text): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v);
  return s.length <= max ? s : s.slice(0, max);
}

function keyOf(v: unknown): string | null {
  const s = v === null || v === undefined ? '' : String(v);
  return MARKET_ID.test(s) ? s : null;
}

function idOf(v: unknown): string | null {
  const s = v === null || v === undefined ? '' : String(v);
  return ID.test(s) ? s : null;
}

function parseMarket(m: any): FeedMarket | null {
  const id = keyOf(m?.id);
  if (!id || !Array.isArray(m?.outcomes) || m.outcomes.length > LIMITS.outcomes) return null;
  const per = m.period ?? {};
  const outcomes: FeedOutcome[] = [];
  for (const o of m.outcomes) {
    const oid = keyOf(o?.id);
    if (!oid) continue;
    outcomes.push({
      id: oid,
      description: str(o.description) ?? '',
      type: str(o.type, 8),
      status: str(o.status, 4),
      competitorId: str(o.competitorId, 64),
      price: {
        handicap: str(o.price?.handicap, 16),
        american: str(o.price?.american, 16),
        decimal: str(o.price?.decimal, 16),
      },
    });
  }
  return {
    id,
    key: str(m.key, 64),
    description: str(m.description) ?? '',
    descriptionKey: str(m.descriptionKey),
    marketTypeId: str(m.marketTypeId, 64),
    status: str(m.status, 4),
    period: {
      id: str(per.id, 32),
      description: str(per.description, 80),
      abbreviation: str(per.abbreviation, 16),
      live: per.live === true,
      main: per.main === true,
    },
    outcomes,
  };
}

function parseGame(g: any): Result<FeedGame> {
  const id = idOf(g?.id);
  if (!id) return { ok: false, error: 'game id missing or malformed' };
  if (!(FEED_LEAGUES as readonly string[]).includes(g?.league)) return { ok: false, error: `game ${id}: unknown league ${String(g?.league).slice(0, 40)}` };
  if (!Number.isFinite(g?.startTime)) return { ok: false, error: `game ${id}: startTime must be epoch ms` };
  if (!Array.isArray(g?.groups) || g.groups.length > LIMITS.groups) return { ok: false, error: `game ${id}: groups missing or too many` };
  if (!Array.isArray(g?.competitors)) return { ok: false, error: `game ${id}: competitors missing` };
  let marketCount = 0;
  const groups: FeedGroup[] = [];
  for (const grp of g.groups) {
    if (!Array.isArray(grp?.markets)) continue;
    marketCount += grp.markets.length;
    if (marketCount > LIMITS.markets) return { ok: false, error: `game ${id}: more than ${LIMITS.markets} markets` };
    groups.push({
      id: str(grp.id, 64),
      description: str(grp.description, 120) ?? 'Other',
      order: Number.isFinite(grp.order) ? grp.order : null,
      markets: grp.markets.map(parseMarket).filter((m: FeedMarket | null): m is FeedMarket => m !== null),
    });
  }
  return {
    ok: true,
    value: {
      id,
      league: g.league,
      leagueName: str(g.leagueName, 80),
      sportPath: str(g.sportPath, 120),
      description: str(g.description) ?? '',
      link: str(g.link, 300),
      startTime: g.startTime,
      live: g.live === true,
      status: str(g.status, 4),
      numMarkets: Number.isFinite(g.numMarkets) ? g.numMarkets : null,
      competitors: g.competitors.slice(0, 4).map((c: any) => ({
        id: str(c?.id, 64),
        name: str(c?.name, 120) ?? '',
        shortName: str(c?.shortName, 120),
        home: c?.home === true,
      })),
      scope: g.scope === 'full' ? 'full' : 'main',
      groups,
    },
  };
}

/** Validate a decoded push. Bad games are dropped and reported, not fatal; a bad envelope is. Pure. */
export function parseFeedPayload(raw: unknown): Result<{ payload: FeedPayload; dropped: { id: string; reason: string }[] }> {
  const r = raw as any;
  if (!r || typeof r !== 'object') return { ok: false, error: 'body is not a JSON object' };
  if (r.v !== 1) return { ok: false, error: 'unsupported payload version' };
  if (!Array.isArray(r.games)) return { ok: false, error: 'games must be an array' };
  if (r.games.length > LIMITS.games) return { ok: false, error: `more than ${LIMITS.games} games in one push` };
  const seenRaw = Array.isArray(r.seen) ? r.seen : [];
  if (seenRaw.length > LIMITS.seen) return { ok: false, error: `more than ${LIMITS.seen} seen ids in one push` };
  const games: FeedGame[] = [];
  const dropped: { id: string; reason: string }[] = [];
  for (const g of r.games) {
    const parsed = parseGame(g);
    if (parsed.ok) games.push(parsed.value);
    else dropped.push({ id: String(g?.id ?? '?').slice(0, 64), reason: parsed.error });
  }
  const seen: FeedSeen[] = seenRaw
    .map((s: any) => ({ id: idOf(s?.id), league: s?.league }))
    .filter((s: any): s is FeedSeen => !!s.id && (FEED_LEAGUES as readonly string[]).includes(s.league));
  return {
    ok: true,
    value: {
      payload: { v: 1, source: r.source === 'live' ? 'live' : 'scraper', sentAt: Number(r.sentAt) || Date.now(), games, seen },
      dropped,
    },
  };
}

// ── Prices ──────────────────────────────────────────────────────────────────

/** "+120" -> 120, "-110" -> -110, "EVEN" -> 100. Null for anything else. */
export function parseAmerican(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  if (s === 'EVEN' || s === 'EV') return 100;
  const n = Number(s);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export function parseHandicap(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  // Bovada writes split handicaps as "-0.5,-1.0" on some soccer markets; the average is the line.
  const parts = String(v).split(',').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export function marketCount(game: Pick<FeedGame, 'groups'>): number {
  return game.groups.reduce((n, g) => n + g.markets.length, 0);
}

// ── Main game lines (what the Weatherboard row shows) ───────────────────────

export interface FeedLines extends GameLines {
  /** True when these are in-game prices on a game that has started. */
  live: boolean;
  feedGameId: string;
}

function allMarkets(game: Pick<FeedGame, 'groups'>): FeedMarket[] {
  return game.groups.flatMap((g) => g.markets);
}

function pick(markets: FeedMarket[], keys: RegExp, description: RegExp): FeedMarket | undefined {
  return markets.find((m) => keys.test(m.key ?? '')) ?? markets.find((m) => description.test(m.description));
}

/**
 * Moneyline, spread (or run line / goal line) and total for the whole game.
 * Uses the markets Bovada itself marks as the game's main period, in-game ones
 * first when the game is live. Matched by Bovada's market key, with the
 * description as a fallback, the same rule the practice sportsbook uses. Pure.
 */
export function mainLinesFromGame(game: FeedGame, nowMs = Date.now()): FeedLines | null {
  const started = game.startTime <= nowMs;
  const main = allMarkets(game).filter((m) => m.period?.main);
  // A started game's in-game markets win over any pre-match leftovers.
  const pool = started && main.some((m) => m.period?.live) ? main.filter((m) => m.period?.live) : main;
  const ml = pick(pool, /(^|-)12$/, /^moneyline$/i) ?? pick(pool, /1X2/i, /3-?way moneyline|^moneyline/i);
  const spread = pick(pool, /HCAP/i, /spread|run ?line|puck ?line|goal ?line/i);
  const total = pick(pool, /(^|-)OU$/i, /^total$/i);
  if (!ml && !spread && !total) return null;

  const outcome = (m: FeedMarket | undefined, type: string) => m?.outcomes.find((o) => o.type === type);
  const pp = (m: FeedMarket | undefined, type: string) => {
    const o = outcome(m, type);
    const point = parseHandicap(o?.price.handicap);
    const price = parseAmerican(o?.price.american);
    return point !== null && price !== null ? { point, price } : null;
  };
  const over = outcome(total, 'O');
  const under = outcome(total, 'U');
  const totalPoint = parseHandicap(over?.price.handicap ?? under?.price.handicap);
  const overPrice = parseAmerican(over?.price.american);
  const underPrice = parseAmerican(under?.price.american);

  return {
    bookmaker: 'feed',
    lastUpdate: new Date(nowMs).toISOString(),
    moneylineHome: parseAmerican(outcome(ml, 'H')?.price.american),
    moneylineAway: parseAmerican(outcome(ml, 'A')?.price.american),
    spreadHome: pp(spread, 'H'),
    spreadAway: pp(spread, 'A'),
    total: totalPoint !== null && overPrice !== null && underPrice !== null ? { point: totalPoint, overPrice, underPrice } : null,
    homeRotation: null,
    awayRotation: null,
    live: started && game.live,
    feedGameId: game.id,
  };
}

// ── Hold and fair odds ──────────────────────────────────────────────────────

export function decimalOf(o: FeedOutcome): number | null {
  const d = Number(o.price.decimal);
  if (Number.isFinite(d) && d > 1) return d;
  const a = parseAmerican(o.price.american);
  if (a === null) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / -a;
}

/**
 * The book's margin on a market, as a percent, for markets with 2 or 3
 * complete, open outcomes (a two-way line or a three-way soccer result).
 * Props with long outcome lists are not a single book and get no number.
 * Suspended outcomes are left out, unlike the practice sportsbook did. Pure.
 */
export function holdPercent(m: FeedMarket): number | null {
  const open = m.outcomes.filter((o) => (o.status ?? 'O') === 'O');
  if (open.length < 2 || open.length > 3 || open.length !== m.outcomes.length) return null;
  const decs = open.map(decimalOf);
  if (decs.some((d) => d === null)) return null;
  const sum = (decs as number[]).reduce((s, d) => s + 1 / d, 0);
  return (sum - 1) * 100;
}

/** The no-vig American price for one outcome of a market with a hold. Pure. */
export function fairAmerican(m: FeedMarket, o: FeedOutcome): number | null {
  const hold = holdPercent(m);
  const d = decimalOf(o);
  if (hold === null || d === null) return null;
  const fairDec = d * (1 + hold / 100);
  return fairDec >= 2 ? Math.round((fairDec - 1) * 100) : Math.round(-100 / (fairDec - 1));
}

// ── Line movement ───────────────────────────────────────────────────────────

/** One point in a market's history: [epoch ms, [[outcomeId, american, handicap], ...]]. */
export type HistoryPoint = [number, [string, string | null, string | null][]];

/** A compact signature of a market's prices; history only grows when it changes. Pure. */
export function marketSignature(m: FeedMarket): string {
  return m.outcomes.map((o) => `${o.id}|${o.price.american ?? ''}|${o.price.handicap ?? ''}|${o.status ?? ''}`).join(';');
}

export function historyPointFor(m: FeedMarket, at: number): HistoryPoint {
  return [at, m.outcomes.map((o) => [o.id, o.price.american ?? null, o.price.handicap ?? null])];
}

/** Points kept per market. A busy live main line moves a few hundred times a game; props far less. */
export const HISTORY_POINTS_PER_MARKET = 150;

/** Append a point, keeping the newest HISTORY_POINTS_PER_MARKET. Pure. */
export function appendHistory(existing: HistoryPoint[] | null | undefined, point: HistoryPoint): HistoryPoint[] {
  const out = [...(existing ?? []), point];
  return out.length > HISTORY_POINTS_PER_MARKET ? out.slice(out.length - HISTORY_POINTS_PER_MARKET) : out;
}

/**
 * Merge a main-lines-only update into the stored full game: each incoming
 * market replaces the stored market with the same id (or is added to its
 * group), and nothing is ever removed, so a live update cannot wipe the
 * props. Pure.
 */
export function mergeMainIntoFull(full: FeedGame, main: FeedGame): FeedGame {
  const groups = full.groups.map((g) => ({ ...g, markets: [...g.markets] }));
  for (const mg of main.groups) {
    let target = groups.find((g) => g.description === mg.description);
    if (!target) {
      target = { ...mg, markets: [] };
      groups.unshift(target);
    }
    for (const m of mg.markets) {
      const i = target.markets.findIndex((x) => x.id === m.id);
      if (i >= 0) target.markets[i] = m;
      else target.markets.unshift(m);
    }
  }
  return { ...full, live: main.live, status: main.status ?? full.status, startTime: main.startTime, groups };
}
