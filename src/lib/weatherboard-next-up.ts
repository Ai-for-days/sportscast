// "Next up" for the Weatherboards (Professor ruling WOW-WB-NEXTUP-001,
// 2026-11-06). Reported by Derek: "we should show NFL games now even if
// there isn't one [today]". On a Friday the NFL board said "No tracked NFL
// games today" while Sunday's full slate was already loaded. When the
// default Today view is empty, the league board now shows the next day that
// has games, and the all-sports board links to it.
//
// Pure functions only, so the day-picking rules are unit-tested without
// network. Callers MUST bucket games with the same function the board's
// table filter uses (calendar ET date of kickoff), and start from the same
// `todayStr` (gameDayDateStr, the 6am ET rollover), or the banner and the
// table could disagree about which day is "next".

const ET = 'America/New_York';

/** Look-ahead limit for the next-up search, all leagues. Covers the normal
 *  NFL week plus the Super Bowl gap, bowl/championship gaps, MLS
 *  international breaks and the MLB All-Star break. */
export const NEXT_UP_MAX_DAYS = 14;

/** Calendar ET date (YYYY-MM-DD) of a kickoff; '' when unparseable. The
 *  same bucketing every Weatherboard table filter uses. */
export function etDateStr(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: ET });
}

/** YYYY-MM-DD plus n calendar days (pure date arithmetic, no time zone). */
export function addDaysStr(dateStr: string, n: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export interface NextGameDay {
  /** YYYY-MM-DD, in the same buckets the board table filters by. */
  date: string;
  /** Number of games in that bucket. */
  count: number;
}

/**
 * The first game day on or after `fromStr` and no later than
 * `fromStr + maxDays`, or null when there is none in that range.
 * `kickoffs` are ISO kickoff times; `bucket` maps one to its board day.
 */
export function pickNextGameDay(
  kickoffs: readonly string[],
  fromStr: string,
  maxDays: number = NEXT_UP_MAX_DAYS,
  bucket: (iso: string) => string = etDateStr,
): NextGameDay | null {
  const lastStr = addDaysStr(fromStr, maxDays);
  const counts = new Map<string, number>();
  for (const k of kickoffs) {
    const d = bucket(k);
    if (!d || d < fromStr || d > lastStr) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const date = [...counts.keys()].sort()[0];
  return { date, count: counts.get(date)! };
}

/** "Sunday, November 8" for a YYYY-MM-DD board day. */
export function formatBoardDay(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
}
