/**
 * Line results: how our posted numbers did against what actually happened.
 * DBD 2026-11-17: "we don't have any customers betting, I just want to track
 * favorites that covered, how accurate our numbers were compared to the
 * outcome, etc."
 *
 * Pure functions over graded wagers (no Redis here). One row per graded
 * market, then summaries by market family. Nothing about bets or money.
 *
 * Pointspread (Degrees HvH / LvL / HvL): settlement is A wins when
 * (A - B) + spread > 0 (nws-grading.ts gradePointspreadWager). Our line says
 * A - B will be -spread, so the line's error is (A - B) + spread: positive
 * means A beat our number. spread < 0 means A is the favorite, spread > 0
 * means B is, 0 is a pick'em (no favorite).
 *
 * Over/under (Venue Degrees O/U and others): error = actual - line.
 */
import type { Wager, WagerMetric } from './wager-types';

export type LineFamily = 'Degrees HvH' | 'Degrees LvL' | 'Degrees HvL' | 'Degrees (other)' | 'Venue Degrees O/U' | 'Over/Under (other)';

export interface LineResultRow {
  id: string;
  title: string;
  targetDate: string;
  family: LineFamily;
  auto: boolean;
  kind: 'pointspread' | 'over-under';
  /** The number at the close (what was posted when the market locked). */
  line: number;
  /** The opening number, when one was captured. */
  openingLine: number | null;
  /** Pointspread: A - B. Over/under: the observed value. */
  actual: number;
  /** actual vs our closing number (see file comment for sign). */
  error: number;
  openingError: number | null;
  /** Pointspread only. */
  favorite: 'A' | 'B' | null;
  favoriteCovered: boolean | null;
  /** Over/under only. */
  overUnder: 'over' | 'under' | 'push' | null;
  push: boolean;
}

const METRIC_SHORT: Partial<Record<WagerMetric, 'H' | 'L'>> = { high_temp: 'H', low_temp: 'L' };

function familyOf(w: Wager): LineFamily | null {
  if (w.kind === 'pointspread') {
    const a = METRIC_SHORT[w.metricA ?? w.metric];
    const b = METRIC_SHORT[w.metricB ?? w.metric];
    if (a === 'H' && b === 'H') return 'Degrees HvH';
    if (a === 'L' && b === 'L') return 'Degrees LvL';
    if (a && b) return 'Degrees HvL';
    return 'Degrees (other)';
  }
  if (w.kind === 'over-under') return w.autoManaged ? 'Venue Degrees O/U' : 'Over/Under (other)';
  return null;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round1 = (v: number) => Math.round(v * 10) / 10;

/** One row for a graded market, or null when it can't be scored (not graded, odds market, missing values). */
export function lineResultRow(w: Wager): LineResultRow | null {
  if (w.status !== 'graded') return null;
  const family = familyOf(w);
  if (!family) return null;
  const base = { id: w.id, title: w.title, targetDate: w.targetDate, family, auto: !!(w as { autoManaged?: boolean }).autoManaged };

  if (w.kind === 'pointspread') {
    if (!num(w.observedValueA) || !num(w.observedValueB) || !num(w.spread)) return null;
    const actual = w.observedValueA - w.observedValueB;
    const error = round1(actual + w.spread);
    const open = w.openingLineSnapshot?.pointspread?.spread;
    const favorite = w.spread < 0 ? 'A' : w.spread > 0 ? 'B' : null;
    const push = error === 0;
    return {
      ...base, kind: 'pointspread', line: w.spread, openingLine: num(open) ? open : null,
      actual: round1(actual), error, openingError: num(open) ? round1(actual + open) : null,
      favorite,
      favoriteCovered: favorite === null || push ? null : favorite === 'A' ? error > 0 : error < 0,
      overUnder: null, push,
    };
  }
  if (w.kind === 'over-under') {
    if (!num(w.observedValue) || !num(w.line)) return null;
    const error = round1(w.observedValue - w.line);
    const open = w.openingLineSnapshot?.overUnder?.line;
    return {
      ...base, kind: 'over-under', line: w.line, openingLine: num(open) ? open : null,
      actual: w.observedValue, error, openingError: num(open) ? round1(w.observedValue - open) : null,
      favorite: null, favoriteCovered: null,
      overUnder: error > 0 ? 'over' : error < 0 ? 'under' : 'push', push: error === 0,
    };
  }
  return null;
}

export interface LineSummary {
  family: LineFamily | 'All';
  markets: number;
  /** Average of error: positive = actual ran above our number (A beat the spread / went over). */
  bias: number | null;
  /** Mean absolute error in degrees. */
  mae: number | null;
  rmse: number | null;
  within2: number | null;  // share of markets where |error| <= 2
  within5: number | null;
  /** Opening-line MAE over markets that had an opening number (did moving the line help?). */
  openingMae: number | null;
  closingMaeSameMarkets: number | null;
  favorites: number;        // pointspread markets with a favorite and no push
  favoritesCovered: number;
  favoriteCoverRate: number | null;
  overs: number;
  unders: number;
  overRate: number | null;
  pushes: number;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function summarize(rows: LineResultRow[], family: LineFamily | 'All'): LineSummary {
  const errs = rows.map((r) => r.error);
  const withOpen = rows.filter((r) => r.openingError !== null);
  const fav = rows.filter((r) => r.favoriteCovered !== null);
  const ou = rows.filter((r) => r.overUnder === 'over' || r.overUnder === 'under');
  const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
  return {
    family,
    markets: rows.length,
    bias: r2(mean(errs)),
    mae: r2(mean(errs.map(Math.abs))),
    rmse: r2(errs.length ? Math.sqrt(mean(errs.map((e) => e * e))!) : null),
    within2: r2(errs.length ? errs.filter((e) => Math.abs(e) <= 2).length / errs.length : null),
    within5: r2(errs.length ? errs.filter((e) => Math.abs(e) <= 5).length / errs.length : null),
    openingMae: r2(mean(withOpen.map((r) => Math.abs(r.openingError!)))),
    closingMaeSameMarkets: r2(mean(withOpen.map((r) => Math.abs(r.error)))),
    favorites: fav.length,
    favoritesCovered: fav.filter((r) => r.favoriteCovered).length,
    favoriteCoverRate: r2(fav.length ? fav.filter((r) => r.favoriteCovered).length / fav.length : null),
    overs: ou.filter((r) => r.overUnder === 'over').length,
    unders: ou.filter((r) => r.overUnder === 'under').length,
    overRate: r2(ou.length ? ou.filter((r) => r.overUnder === 'over').length / ou.length : null),
    pushes: rows.filter((r) => r.push).length,
  };
}

const FAMILY_ORDER: LineFamily[] = ['Degrees HvH', 'Degrees LvL', 'Degrees HvL', 'Degrees (other)', 'Venue Degrees O/U', 'Over/Under (other)'];

/** Rows (newest target date first) plus an "All" summary and one per family that has markets. */
export function lineResults(wagers: Wager[], opts: { from?: string; to?: string } = {}) {
  const rows = wagers
    .map(lineResultRow)
    .filter((r): r is LineResultRow => r !== null)
    .filter((r) => (!opts.from || r.targetDate >= opts.from) && (!opts.to || r.targetDate <= opts.to))
    .sort((a, b) => (a.targetDate < b.targetDate ? 1 : a.targetDate > b.targetDate ? -1 : a.id.localeCompare(b.id)));
  const summaries = [summarize(rows, 'All')].concat(
    FAMILY_ORDER.map((f) => rows.filter((r) => r.family === f)).filter((g) => g.length).map((g) => summarize(g, g[0].family)),
  );
  return { rows, summaries };
}
