/**
 * Betting sidebar: readable labels for the Bovada markets (DBD 2026-11-18: "all of the wagers in the side
 * bar are nonsensical and missing the important information").
 *
 * The games feed groups markets under Bovada's keys (2W-HCAP, 2W-OU, GAME-PROP ...), and several markets
 * share a key. Each market therefore gets its own id (key#index), its own title from Bovada's description,
 * and each outcome shows the team or side together with its line ("Iowa State +2.5", "Over 49.5").
 */

export interface RawOutcome {
  id?: string;
  type?: string;
  description: string;
  american?: string | null;
  handicap?: string | null;
}

export interface RawMarket {
  key: string;
  description: string;
  outcomes: RawOutcome[];
}

export interface SideOutcome {
  id: string;
  label: string;
  price: string;
  raw: RawOutcome;
}

export interface SideMarket {
  id: string;
  key: string;
  title: string;
  outcomes: SideOutcome[];
  raw: RawMarket;
}

export interface SideGroup {
  key: string;
  name: string;
  markets: SideMarket[];
}

export const GROUP_ORDER = ['Main Lines', 'Alternate Lines', 'Team Totals', 'Player Props', 'Game Props'] as const;

/** "Iowa State @ Central Florida" → { away: "Iowa State", home: "Central Florida" }. */
export function splitTeams(description: string): { away: string; home: string } | null {
  const m = /^(.+?)\s+(?:@|at|vs\.?)\s+(.+)$/i.exec((description || '').trim());
  return m ? { away: m[1].trim(), home: m[2].trim() } : null;
}

export function signed(n: number): string {
  if (n === 0) return 'PK';
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtLine(h: string | null | undefined): number | null {
  if (h === null || h === undefined || h === '') return null;
  const n = Number(h);
  return Number.isFinite(n) ? n : null;
}

/** "Over 49.5", "Iowa State +2.5", or Bovada's own words when there is no line. */
export function outcomeLabel(o: RawOutcome): string {
  const line = fmtLine(o.handicap);
  if (line === null) return o.description;
  if (o.type === 'O' || o.type === 'U' || /^(over|under)$/i.test(o.description)) return `${o.description} ${line}`;
  return `${o.description} ${signed(line)}`;
}

function groupFor(key: string, title: string, firstOfKey: boolean): string {
  if (key === '2W-12' || key === '1X2') return 'Main Lines';
  if (key === '2W-HCAP' || key === '2W-OU') {
    if (/ - /.test(title) && key === '2W-OU') return 'Team Totals';
    return firstOfKey ? 'Main Lines' : 'Alternate Lines';
  }
  if (/\(([A-Z&]{2,5})\)|Passing|Rushing|Receiving|Receptions|Touchdown|Scorer|Interception|Sacks?\b|Tackles?/i.test(title)) {
    return 'Player Props';
  }
  return 'Game Props';
}

function titleFor(key: string, desc: string, firstOfKey: boolean): string {
  if (key === '2W-12') return 'Moneyline';
  if (key === '2W-HCAP') return firstOfKey ? 'Point Spread' : (/ - /.test(desc) ? desc : 'Alternate Spread');
  if (key === '2W-OU') {
    if (/ - /.test(desc)) return desc.replace(/^Total Points - /, 'Team Total - ');
    return firstOfKey ? 'Total (Over/Under)' : 'Alternate Total';
  }
  return desc;
}

/** Group, title and label every market; groups in GROUP_ORDER, markets in feed order. */
export function sideMarketGroups(all: Record<string, RawMarket[]> | undefined | null): SideGroup[] {
  if (!all) return [];
  const byGroup = new Map<string, SideMarket[]>();
  for (const [key, list] of Object.entries(all)) {
    (list || []).forEach((m, i) => {
      if (!m || !Array.isArray(m.outcomes) || m.outcomes.length === 0) return;
      const first = i === 0;
      const title = titleFor(key, m.description || key, first);
      const group = groupFor(key, m.description || '', first);
      const outcomes = m.outcomes
        .filter((o) => o && o.american)
        .map((o, j) => ({ id: o.id || `${key}#${i}#${j}`, label: outcomeLabel(o), price: String(o.american), raw: o }));
      if (outcomes.length === 0) return;
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push({ id: `${key}#${i}`, key, title, outcomes, raw: m });
    });
  }
  const names = [...GROUP_ORDER, ...[...byGroup.keys()].filter((g) => !(GROUP_ORDER as readonly string[]).includes(g))];
  return names
    .filter((n) => byGroup.has(n))
    .map((n) => ({ key: n.toLowerCase().replace(/\s+/g, '-'), name: n, markets: byGroup.get(n)! }));
}

export interface LegLike {
  gameDescription: string;
  oddsType: 'moneyline' | 'spread' | 'total' | 'prop';
  side?: 'away' | 'home' | 'over' | 'under';
  line?: number;
  marketDescription?: string;
  outcomeDescription?: string;
}

/** Bet-slip words for a leg: "Iowa State moneyline", "Central Florida -2.5", "Over 49.5". */
export function legLabel(leg: LegLike): string {
  const t = splitTeams(leg.gameDescription);
  const team = leg.side === 'away' ? t?.away : leg.side === 'home' ? t?.home : undefined;
  if (leg.oddsType === 'moneyline') return `${team ?? (leg.side ?? '').toUpperCase()} moneyline`;
  if (leg.oddsType === 'spread') return `${team ?? (leg.side ?? '').toUpperCase()} ${leg.line !== undefined ? signed(leg.line) : ''}`.trim();
  if (leg.oddsType === 'total') return `${leg.side === 'over' ? 'Over' : 'Under'} ${leg.line ?? ''}`.trim();
  const o = leg.outcomeDescription ?? '';
  return leg.marketDescription ? `${leg.marketDescription}: ${o}` : o;
}
