/** Betting sidebar helpers (2026-11-17). Client-safe: no server imports. */

/** Soonest game first, so today's games sit at the top. Games without a start time go last. */
export function sortByStart<T extends { startTime?: number | null }>(games: readonly T[]): T[] {
  const key = (g: T) => (typeof g.startTime === 'number' && Number.isFinite(g.startTime) ? g.startTime : Number.POSITIVE_INFINITY);
  return [...games].sort((a, b) => key(a) - key(b));
}

/** The sidebar opens on the sport of the page being viewed (NFL when the page names none). */
export function sportForPath(pathname: string): string {
  const p = (pathname || '').toLowerCase();
  if (/ncaa-football|college-football|\/cfb\b/.test(p)) return 'football/college-football';
  if (/\bmlb\b|baseball/.test(p)) return 'baseball/mlb';
  if (/\bmls\b|soccer/.test(p)) return 'soccer/north-america/united-states/mls';
  return 'football/nfl';
}
